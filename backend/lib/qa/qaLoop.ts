import { GoogleGenerativeAI } from '@google/generative-ai';
import { PageSchema, QAPatchV2, QAPatchV2Schema, QAPatchV2Item } from '@/lib/catalog/schemas';
import type { ResolvedDesignTokens } from '@/lib/design/types';
import { screenshotHtml } from '@/lib/ingest/screenshotHtml';
import { renderPageHtml } from '@/lib/render/renderHtml';
import { applyPatches } from './patch';
import { geminiQACritiquePrompt } from '@/lib/llm/prompts';
import { ensureDiversity } from '@/lib/design/diversify';

export interface QAResult {
  html: string;
  schema: PageSchema;
  patches: QAPatchV2Item[];
  critique: string;
  iterated: boolean;
  diff: string[];
}

export async function runQALoop(
  html: string,
  schema: PageSchema,
  resolvedTokens: ResolvedDesignTokens,
  maxIterations: number = 1,
  signature?: string,
  density?: string,
): Promise<QAResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { html, schema, patches: [], critique: 'Gemini API key not set — QA skipped.', iterated: false, diff: [] };
  }

  let currentHtml = html;
  let currentSchema = schema;
  const allPatches: QAPatchV2Item[] = [];
  const allDiff: string[] = [];
  let critique = '';

  for (let i = 0; i < maxIterations; i++) {
    try {
      // 1. Screenshot the current HTML
      console.log(`[qa] Iteration ${i + 1}: taking screenshot...`);
      const screenshot = await screenshotHtml(currentHtml);
      console.log(`[qa]   Screenshot: ${screenshot.length}B base64`);

      // 2. Send to Gemini for critique
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.4,
        },
      });

      const result = await model.generateContent([
        { text: geminiQACritiquePrompt() },
        {
          inlineData: {
            mimeType: 'image/png',
            data: screenshot,
          },
        },
      ]);

      const text = result.response.text();
      let parsed: QAPatchV2;
      try {
        parsed = QAPatchV2Schema.parse(JSON.parse(text));
      } catch {
        console.warn('[qa] Failed to parse Gemini critique response, trying lenient parse');
        const raw = JSON.parse(text);
        // Ensure patches is an array with at least action and blockIndex
        parsed = {
          patches: (raw.patches || []).map((p: Record<string, unknown>) => ({
            action: p.action || 'modify',
            blockIndex: typeof p.blockIndex === 'number' ? p.blockIndex : 0,
            field: p.field as string | undefined,
            oldValue: p.oldValue as string | undefined,
            newValue: p.newValue as string | undefined,
            newBlockType: p.newBlockType as string | undefined,
            newVariant: p.newVariant as string | undefined,
            reason: (p.reason as string) || 'QA improvement',
          })),
          tokenPatches: raw.tokenPatches,
          overallNote: raw.overallNote || 'QA analysis complete',
        };
      }

      critique = parsed.overallNote;
      console.log(`[qa]   Critique: ${critique.slice(0, 100)}...`);
      console.log(`[qa]   Patches received: ${parsed.patches.length}`);
      for (const p of parsed.patches) {
        console.log(`[qa]     ${p.action} block[${p.blockIndex}] ${p.field || p.newVariant || p.newBlockType || ''}: ${p.reason.slice(0, 60)}`);
      }

      // 3. Apply patches
      const { schema: patched, appliedCount, diff } = applyPatches(currentSchema, parsed.patches);
      console.log(`[qa]   Applied: ${appliedCount}/${parsed.patches.length} patches`);
      allDiff.push(...diff);

      if (appliedCount === 0) {
        // Force one deterministic diversification if no patches worked
        console.log('[qa]   No patches applied, forcing diversification...');
        const diversityResult = ensureDiversity({
          signature: 'monoMinimal',
          presetId: 'corporate-blue',
          blocks: currentSchema.blocks,
        });
        if (diversityResult.changes.length > 0) {
          currentSchema = {
            ...currentSchema,
            blocks: diversityResult.schema.blocks,
          };
          currentHtml = renderPageHtml(currentSchema, resolvedTokens, signature, density, 'v2').html;
          allDiff.push(...diversityResult.changes.map((c) => `[forced-diversity] ${c}`));
          console.log(`[qa]   Forced diversity: ${diversityResult.changes.join('; ')}`);
        }
        return {
          html: currentHtml,
          schema: currentSchema,
          patches: allPatches,
          critique,
          iterated: diversityResult.changes.length > 0,
          diff: allDiff,
        };
      }

      allPatches.push(...parsed.patches.slice(0, appliedCount));
      currentSchema = patched;

      // 5. Re-render
      currentHtml = renderPageHtml(currentSchema, resolvedTokens, signature, density, 'v2').html;
      console.log(`[qa]   Re-rendered: ${currentHtml.length} chars`);
    } catch (error) {
      console.error('[qa] QA loop iteration failed:', error);
      critique = `QA iteration ${i + 1} failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      break;
    }
  }

  return {
    html: currentHtml,
    schema: currentSchema,
    patches: allPatches,
    critique,
    iterated: allPatches.length > 0,
    diff: allDiff,
  };
}
