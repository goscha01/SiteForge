import express, { Request, Response } from 'express';
import { chromium, Browser } from 'playwright';
import { z } from 'zod';

// Pipeline imports
import { extractContent } from '@/lib/ingest/extract';
import { observeDesign } from '@/lib/llm/gemini';
import { generateStyleSpec } from '@/lib/llm/styleDirector';
import { generateBlockSchema } from '@/lib/llm/claude';
import { generateLayoutPlan } from '@/lib/llm/layoutPlan';
import { validateAndAutofixV2 } from '@/lib/rules/autofix';
import { generateAssets } from '@/lib/llm/recraft';
import { renderPageHtml, renderPreviewHtml } from '@/lib/render/renderHtml';
import { resolveTokens } from '@/lib/design/presets';
import { computeDesignScore } from '@/lib/design/score';
import { runQALoop } from '@/lib/qa/qaLoop';

// V3 pipeline imports
import {
  selectStyles,
  generatePreviewSchema,
  generateLayoutPlanV3,
  generateFinalSchema,
  flattenBlocks,
  applyQAPatchClaude,
} from '@/lib/llm/claude';
import { validateAndAutofixV3 } from '@/lib/rules/autofix';
import {
  getStyle,
  resolveStyleTokens,
  getSignatureForStyle,
  getDensityForStyle,
  loadStyleLibrary,
} from '@/lib/design/loadStyleLibrary';
import { STYLE_DNA_MAP } from '@/lib/design/layoutDNA';
import { computeNoveltyLocks } from '@/lib/rules/autofix';

// ─── Shared Browser Instance ───────────────────────────────────────────────────

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    console.log('[browser] Launching Chromium...');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    console.log('[browser] Chromium ready');
  }
  return browser;
}

async function captureScreenshotsLocal(url: string): Promise<{ desktop: string; mobile: string }> {
  const b = await getBrowser();
  const context = await b.newContext();
  const page = await context.newPage();

  try {
    // Desktop
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
    const desktopBuffer = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: 1440, height: Math.min(bodyHeight, 4000) },
    });

    // Mobile
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    const mobileHeight = await page.evaluate(() => document.body.scrollHeight);
    const mobileBuffer = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: 390, height: Math.min(mobileHeight, 4000) },
    });

    return {
      desktop: desktopBuffer.toString('base64'),
      mobile: mobileBuffer.toString('base64'),
    };
  } finally {
    await context.close();
  }
}

async function screenshotHtmlLocal(html: string): Promise<string> {
  const b = await getBrowser();
  const context = await b.newContext();
  const page = await context.newPage();

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000);
    const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
    const buffer = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: 1440, height: Math.min(bodyHeight, 4000) },
    });
    return buffer.toString('base64');
  } finally {
    await context.close();
  }
}

async function screenshotPreviewLocal(html: string): Promise<string> {
  const b = await getBrowser();
  const context = await b.newContext();
  const page = await context.newPage();

  try {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000);
    const buffer = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: 800, height: 600 },
    });
    return buffer.toString('base64');
  } finally {
    await context.close();
  }
}

// ─── Express App ────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '10mb' }));

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',');

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes('*') || (origin && ALLOWED_ORIGINS.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

function authenticate(req: Request, res: Response, next: () => void) {
  const secret = process.env.API_SECRET;
  if (!secret) return next();
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// ─── NDJSON Stream Helpers ──────────────────────────────────────────────────────

function sendEvent(res: Response, data: Record<string, unknown>) {
  res.write(JSON.stringify(data) + '\n');
}

async function runStep<T>(
  res: Response,
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  sendEvent(res, { step: name, status: 'running' });
  console.log(`[pipeline] ▶ ${name}`);
  const start = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - start;
    console.log(`[pipeline] ✓ ${name} (${ms}ms)`);
    sendEvent(res, { step: name, status: 'done', ms });
    return result;
  } catch (error) {
    const ms = Date.now() - start;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pipeline] ✗ ${name} FAILED (${ms}ms):`, message);
    sendEvent(res, { step: name, status: 'error', ms, error: message });
    throw error;
  }
}

// ─── Health Check ───────────────────────────────────────────────────────────────

app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'siteforge-backend', version: '3.0.0' });
});

// ─── Redesign Pipeline ─────────────────────────────────────────────────────────

const RedesignRequest = z.object({
  url: z.string().url(),
  withIllustrations: z.boolean().default(false),
  withQA: z.boolean().default(false),
});

app.post('/redesign', async (req: Request, res: Response) => {
  // Validate input
  const parsed = RedesignRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid request',
      details: parsed.error.issues.map((i) => i.message),
    });
    return;
  }
  const input = parsed.data;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[pipeline] Starting redesign for: ${input.url}`);
  console.log(`[pipeline] Options: illustrations=${input.withIllustrations}, QA=${input.withQA}`);
  console.log(`${'='.repeat(60)}`);

  // Set up NDJSON streaming
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');

  const pipelineStart = Date.now();

  try {
    // Step A: Ingest (parallel — screenshots + content extraction)
    const [screenshots, content] = await Promise.all([
      runStep(res, 'screenshots', () => captureScreenshotsLocal(input.url)),
      runStep(res, 'extract', () => extractContent(input.url)),
    ]);

    console.log(`[pipeline]   Brand: "${content.brandName}"`);
    console.log(`[pipeline]   Headings: ${content.headings.length}, Paragraphs: ${content.paragraphs.length}`);
    console.log(`[pipeline]   Testimonials: ${content.testimonials.length}, FAQ: ${content.faqItems.length}`);
    console.log(`[pipeline]   Desktop screenshot: ${screenshots.desktop.length}B base64`);
    console.log(`[pipeline]   Mobile screenshot: ${screenshots.mobile.length}B base64`);

    // Step B: Gemini Vision — observations
    const observations = await runStep(res, 'observe', () =>
      observeDesign(screenshots.desktop, screenshots.mobile, {
        title: content.title,
        description: content.description,
        brandName: content.brandName,
      })
    );

    console.log(`[pipeline]   Industry: ${observations.industryCandidates.map((c) => `${c.label}(${c.confidence})`).join(', ')}`);
    console.log(`[pipeline]   Visual problems: ${observations.visualProblems.slice(0, 3).join('; ')}`);
    console.log(`[pipeline]   Brand tone: "${observations.brandSignals.perceivedTone}"`);
    console.log(`[pipeline]   Avoid: ${observations.avoidPatterns.join(', ')}`);

    // Step B2: Style Director — signature + preset + fonts
    const styleSpec = await runStep(res, 'style_director', () =>
      generateStyleSpec(observations)
    );

    console.log(`[pipeline]   Signature: "${styleSpec.signature}"`);
    console.log(`[pipeline]   Preset: "${styleSpec.presetId}"`);
    console.log(`[pipeline]   Font pairing: "${styleSpec.fontPairingId}"`);
    console.log(`[pipeline]   Density: "${styleSpec.density}"`);
    console.log(`[pipeline]   Anti-template rules: ${styleSpec.antiTemplateRules.length}`);

    // Step B3: Layout Plan
    const layoutPlan = await runStep(res, 'layout_plan', () =>
      generateLayoutPlan(styleSpec, content)
    );

    console.log(`[pipeline]   Block order: ${layoutPlan.blockOrder.map((b) => `${b.type}(${b.variant})`).join(' → ')}`);
    console.log(`[pipeline]   Diversity patterns: ${layoutPlan.diversityPatterns.join(', ')}`);

    // Step C: Claude — fill content into layout plan
    const rawSchema = await runStep(res, 'claude_content', () =>
      generateBlockSchema(layoutPlan, content)
    );

    console.log(`[pipeline]   Blocks generated: ${rawSchema.blocks.length}`);
    console.log(`[pipeline]   Block types: ${rawSchema.blocks.map((b) => b.type).join(', ')}`);

    // Step D: Validate + Autofix
    const { schema: validatedV2, warnings } = await runStep(res, 'validate', () =>
      validateAndAutofixV2(rawSchema)
    );

    if (warnings.length > 0) {
      console.log(`[pipeline]   Warnings: ${warnings.join('; ')}`);
    } else {
      console.log(`[pipeline]   Validation passed, no warnings`);
    }

    // Step D2: Resolve tokens
    const resolvedTokens = resolveTokens(
      validatedV2.presetId,
      validatedV2.tokenTweaks,
      validatedV2.fontPairingId
    );
    resolvedTokens.brandName = content.brandName;

    console.log(`[pipeline]   Resolved palette: primary=${resolvedTokens.palette.primary}, accent=${resolvedTokens.palette.accent}`);
    console.log(`[pipeline]   Typography: ${resolvedTokens.typography.headingFont} / ${resolvedTokens.typography.bodyFont}`);

    // Build legacy PageSchema for rendering
    const pageSchema = {
      tokens: {
        brandName: content.brandName,
        primaryColor: resolvedTokens.palette.primary,
        secondaryColor: resolvedTokens.palette.secondary,
        accentColor: resolvedTokens.palette.accent,
        headingFont: resolvedTokens.typography.headingFont,
        bodyFont: resolvedTokens.typography.bodyFont,
      },
      blocks: validatedV2.blocks,
    };

    // Determine signature from styleSpec or schema
    const signature = validatedV2.signature || styleSpec.signature;
    const density = styleSpec.density;

    // Step D3: Score
    const score = computeDesignScore(pageSchema, resolvedTokens, signature);
    sendEvent(res, { step: 'score', status: 'done', ms: 0, data: { total: score.total, mustImprove: score.mustImprove } });

    console.log(`[pipeline]   Design score: ${score.total}/100 (mustImprove: ${score.mustImprove})`);
    for (const [category, detail] of Object.entries(score.breakdown)) {
      console.log(`[pipeline]     ${category}: ${detail.score}/${detail.max} — ${detail.notes}`);
    }

    // Step E: Optional Recraft illustrations
    if (input.withIllustrations) {
      await runStep(res, 'illustrations', async () => {
        // Collect icon subjects from ALL blocks that have titled items
        const iconSubjects: string[] = [];
        for (const block of pageSchema.blocks) {
          if (block.type === 'ValueProps3') {
            iconSubjects.push(...block.items.map((item) => item.title));
          } else if (block.type === 'BentoGrid') {
            iconSubjects.push(...block.items.map((item) => item.title));
          } else if (block.type === 'FeatureZigzag') {
            iconSubjects.push(...block.items.map((item) => item.title));
          } else if (block.type === 'ServicesGrid') {
            iconSubjects.push(...block.services.map((s) => s.title));
          }
        }
        // Deduplicate subjects
        const uniqueSubjects = [...new Set(iconSubjects)];

        const topIndustry = observations.industryCandidates[0]?.label || 'business';
        const tone = observations.brandSignals.perceivedTone || 'professional';

        const assets = await generateAssets(
          content.brandName,
          tone,
          topIndustry,
          uniqueSubjects
        );

        console.log(`[pipeline]   Hero image: ${assets.heroImage ? 'generated' : 'none'}`);
        console.log(`[pipeline]   Icons generated: ${assets.icons.length} (subjects: ${uniqueSubjects.length})`);

        // Inject hero image
        if (assets.heroImage) {
          const heroBlock = pageSchema.blocks.find((b) => b.type === 'HeroSplit');
          if (heroBlock && heroBlock.type === 'HeroSplit') {
            (heroBlock as { imageUrl?: string }).imageUrl = assets.heroImage;
            (heroBlock as { imageAlt?: string }).imageAlt = `${content.brandName} hero illustration`;
          }
        }

        // Build a map: subject title → icon URL for injection
        const iconMap = new Map<string, string>();
        uniqueSubjects.forEach((subject, i) => {
          if (assets.icons[i]) {
            iconMap.set(subject, assets.icons[i]);
          }
        });

        // Inject icons into ALL blocks that have icon fields
        for (const block of pageSchema.blocks) {
          if (block.type === 'ValueProps3') {
            block.items.forEach((item) => {
              const icon = iconMap.get(item.title);
              if (icon) item.icon = icon;
            });
          } else if (block.type === 'BentoGrid') {
            block.items.forEach((item) => {
              const icon = iconMap.get(item.title);
              if (icon) (item as { icon?: string }).icon = icon;
            });
          } else if (block.type === 'FeatureZigzag') {
            block.items.forEach((item) => {
              const icon = iconMap.get(item.title);
              if (icon) (item as { icon?: string }).icon = icon;
            });
          } else if (block.type === 'ServicesGrid') {
            block.services.forEach((service) => {
              const icon = iconMap.get(service.title);
              if (icon) (service as { icon?: string }).icon = icon;
            });
          }
        }

        console.log(`[pipeline]   Icons injected into ${iconMap.size} unique items across all blocks`);
      });
    }

    // Step F: Render deterministic HTML with signature + density
    const renderResult = await runStep(res, 'render', async () => {
      return renderPageHtml(pageSchema, resolvedTokens, signature, density, 'v1');
    });
    let html = renderResult.html;
    let manifest = renderResult.manifest;

    console.log(`[pipeline]   HTML length: ${html.length} chars`);
    console.log(`[pipeline]   Signature applied: ${signature}`);
    console.log(`[pipeline]   Manifest blocks: ${manifest.blocks.map((b) => `${b.type}(${b.variant})`).join(', ')}`);

    // Track pre-QA schema for debug
    const schemaV1 = JSON.parse(JSON.stringify(pageSchema));

    // Step G: QA loop — run if requested OR if score says must improve
    let qaResult = undefined;
    const shouldRunQA = input.withQA || score.mustImprove;
    if (shouldRunQA) {
      qaResult = await runStep(res, 'qa_loop', async () => {
        const qa = await runQALoop(html, pageSchema, resolvedTokens, 1, signature, density);
        if (qa.iterated) {
          html = qa.html;
          // Update pageSchema to the post-QA version
          pageSchema.blocks = qa.schema.blocks;
          // Re-render to get updated manifest with v2 tag
          const v2Render = renderPageHtml(pageSchema, resolvedTokens, signature, density, 'v2');
          html = v2Render.html;
          manifest = v2Render.manifest;
          console.log(`[pipeline]   QA patched: ${qa.patches.length} patches applied`);
          console.log(`[pipeline]   QA diff: ${qa.diff.join('; ')}`);
          console.log(`[pipeline]   Schema updated to v2 (hash: ${manifest.schemaHash})`);
          return { patches: qa.patches, critique: qa.critique, diff: qa.diff };
        } else {
          console.log(`[pipeline]   QA: no patches needed`);
          return { patches: [], critique: qa.critique, diff: qa.diff };
        }
      });
    }

    // Done!
    const totalMs = Date.now() - pipelineStart;
    console.log(`[pipeline] ✓ Pipeline complete in ${(totalMs / 1000).toFixed(1)}s`);
    console.log(`${'='.repeat(60)}\n`);

    sendEvent(res, {
      step: 'complete',
      ms: totalMs,
      result: {
        html,
        schema: pageSchema,
        schemaV1: qaResult ? schemaV1 : undefined,
        manifest,
        observations,
        styleSpec,
        layoutPlan,
        score,
        qaResult,
        warnings,
        signature,
        density,
      },
    });

    res.end();
  } catch (error) {
    const totalMs = Date.now() - pipelineStart;
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error(`[pipeline] ✗ Pipeline failed after ${(totalMs / 1000).toFixed(1)}s:`, message);

    sendEvent(res, { step: 'error', error: message, ms: totalMs });
    res.end();
  }
});

// ─── V3: Directions Endpoint ─────────────────────────────────────────────────

const DirectionsRequest = z.object({
  url: z.string().url(),
});

app.post('/directions', async (req: Request, res: Response) => {
  const parsed = DirectionsRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid request',
      details: parsed.error.issues.map((i) => i.message),
    });
    return;
  }
  const { url } = parsed.data;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[directions] Starting for: ${url}`);
  console.log(`${'='.repeat(60)}`);

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');

  const pipelineStart = Date.now();

  try {
    // Step 1: Ingest (parallel)
    const [screenshots, content] = await Promise.all([
      runStep(res, 'screenshots', () => captureScreenshotsLocal(url)),
      runStep(res, 'extract', () => extractContent(url)),
    ]);

    // Step 2: Observe design
    const observations = await runStep(res, 'observe', () =>
      observeDesign(screenshots.desktop, screenshots.mobile, {
        title: content.title,
        description: content.description,
        brandName: content.brandName,
      })
    );

    // Step 3: Select 3 styles
    const styleSelections = await runStep(res, 'select_styles', () =>
      selectStyles(observations)
    );

    console.log(`[directions] Selected styles: ${styleSelections.map((s) => `${s.styleId}(${s.confidence})`).join(', ')}`);

    // Step 4: Generate preview for each style (parallel)
    const directionLabels = ['A', 'B', 'C'] as const;
    const directions = await Promise.all(
      styleSelections.map(async (selection, idx) => {
        const label = directionLabels[idx];
        const stepName = `preview_${label}`;

        return runStep(res, stepName, async () => {
          const style = getStyle(selection.styleId);
          if (!style) throw new Error(`Unknown styleId: ${selection.styleId}`);

          // Generate preview schema (4 blocks)
          const previewSchema = await generatePreviewSchema(selection.styleId, content);

          // Flatten blocks
          let previewBlocks;
          try {
            previewBlocks = flattenBlocks(previewSchema.blocks);
          } catch (err) {
            console.warn(`[directions] Block flattening failed for ${selection.styleId}, using fallback`);
            previewBlocks = [];
          }

          // Resolve tokens
          const tokens = resolveStyleTokens(style, content.brandName);
          const signature = getSignatureForStyle(selection.styleId);
          const density = getDensityForStyle(style);

          // Inject placeholder images into hero blocks so previews look visual
          for (const block of previewBlocks) {
            const b = block as Record<string, unknown>;
            const bType = b.type as string;
            if ((bType === 'HeroSplit' || bType === 'HeroTerminal' || bType === 'HeroChart') && !b.imageUrl) {
              const p = tokens.palette;
              b.imageUrl = `data:image/svg+xml,${encodeURIComponent(
                `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">` +
                `<defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">` +
                `<stop offset="0%" stop-color="${p.primary}"/>` +
                `<stop offset="50%" stop-color="${p.accent}"/>` +
                `<stop offset="100%" stop-color="${p.secondary}"/>` +
                `</linearGradient></defs>` +
                `<rect width="800" height="500" fill="url(#g)" rx="16"/>` +
                `<circle cx="250" cy="200" r="80" fill="${p.background}" opacity="0.15"/>` +
                `<circle cx="550" cy="300" r="120" fill="${p.background}" opacity="0.1"/>` +
                `<rect x="320" y="180" width="160" height="140" rx="12" fill="${p.background}" opacity="0.12"/>` +
                `</svg>`
              )}`;
              b.imageAlt = `${content.brandName} preview`;
            }
          }

          // Render preview HTML (live iframe, no screenshot needed)
          let previewHtml = '';

          if (previewBlocks.length > 0) {
            previewHtml = renderPreviewHtml(previewBlocks, tokens, signature, density);
          } else {
            // Fallback: generate a simple color/typography showcase
            const t = tokens;
            previewHtml = `<!DOCTYPE html><html><head>
<link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(t.typography.headingFont)}:wght@700&family=${encodeURIComponent(t.typography.bodyFont)}:wght@400&display=swap" rel="stylesheet">
<style>*{margin:0;box-sizing:border-box}body{font-family:'${t.typography.bodyFont}',system-ui,sans-serif;background:${t.palette.background};color:${t.palette.textPrimary}}</style>
</head><body>
<div style="padding:3rem 2rem;text-align:center">
  <div style="display:flex;gap:8px;justify-content:center;margin-bottom:2rem">
    ${[t.palette.primary, t.palette.secondary, t.palette.accent, t.palette.surface].map(c => `<div style="width:48px;height:48px;border-radius:8px;background:${c}"></div>`).join('')}
  </div>
  <h1 style="font-family:'${t.typography.headingFont}',system-ui,sans-serif;font-size:2rem;font-weight:700;margin-bottom:0.5rem;color:${t.palette.textPrimary}">${style.label}</h1>
  <p style="color:${t.palette.textSecondary};font-size:0.95rem;max-width:400px;margin:0 auto">Style preview — full layout will be generated after you choose this direction.</p>
</div>
</body></html>`;
            console.log(`[directions] Using fallback preview for ${selection.styleId}`);
          }

          // Get DNA options for this style
          const dnaSet = STYLE_DNA_MAP[selection.styleId];
          const dnaOptions = dnaSet?.dnas || [];

          return {
            id: label,
            styleId: selection.styleId,
            styleLabel: style.label,
            confidence: selection.confidence,
            reason: selection.reason,
            bestFor: selection.bestFor,
            previewHtml,
            dnaOptions,
          };
        });
      })
    );

    const totalMs = Date.now() - pipelineStart;
    console.log(`[directions] ✓ Complete in ${(totalMs / 1000).toFixed(1)}s`);

    sendEvent(res, {
      step: 'complete',
      ms: totalMs,
      result: {
        observations,
        directions,
        extractedContent: content,
      },
    });

    res.end();
  } catch (error) {
    const totalMs = Date.now() - pipelineStart;
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error(`[directions] ✗ Failed after ${(totalMs / 1000).toFixed(1)}s:`, message);
    sendEvent(res, { step: 'error', error: message, ms: totalMs });
    res.end();
  }
});

// ─── V3: Finalize Endpoint ──────────────────────────────────────────────────

const FinalizeRequest = z.object({
  url: z.string().url(),
  styleId: z.string(),
  dnaId: z.string().optional(),
  withIllustrations: z.boolean().default(false),
  runQa: z.boolean().default(true),
  extractedContent: z.any().optional(),
  observations: z.any().optional(),
});

app.post('/finalize', async (req: Request, res: Response) => {
  const parsed = FinalizeRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid request',
      details: parsed.error.issues.map((i) => i.message),
    });
    return;
  }
  const input = parsed.data;

  const style = getStyle(input.styleId);
  if (!style) {
    res.status(400).json({ error: `Unknown styleId: ${input.styleId}` });
    return;
  }

  // Look up DNA if provided
  const dnaSet = STYLE_DNA_MAP[input.styleId];
  const selectedDNA = input.dnaId && dnaSet
    ? dnaSet.dnas.find((d) => d.id === input.dnaId)
    : undefined;
  const dnaJson = selectedDNA ? JSON.stringify(selectedDNA) : undefined;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[finalize] Starting for: ${input.url} (style: ${input.styleId}, dna: ${input.dnaId || 'none'})`);
  console.log(`[finalize] Options: illustrations=${input.withIllustrations}, QA=${input.runQa}`);
  console.log(`${'='.repeat(60)}`);

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');

  const pipelineStart = Date.now();

  try {
    // Step 1: Get content + observations (reuse if provided)
    let content = input.extractedContent;
    let observations = input.observations;

    if (!content) {
      const [screenshots, extracted] = await Promise.all([
        runStep(res, 'screenshots', () => captureScreenshotsLocal(input.url)),
        runStep(res, 'extract', () => extractContent(input.url)),
      ]);
      content = extracted;

      if (!observations) {
        observations = await runStep(res, 'observe', () =>
          observeDesign(screenshots.desktop, screenshots.mobile, {
            title: content.title,
            description: content.description,
            brandName: content.brandName,
          })
        );
      }
    } else if (!observations) {
      // We have content but not observations — capture screenshots for observe
      const screenshots = await runStep(res, 'screenshots', () => captureScreenshotsLocal(input.url));
      observations = await runStep(res, 'observe', () =>
        observeDesign(screenshots.desktop, screenshots.mobile, {
          title: content.title,
          description: content.description,
          brandName: content.brandName,
        })
      );
    }

    // Step 2: Layout plan (with DNA constraints if selected)
    const layoutPlanV3 = await runStep(res, 'layout_plan', () =>
      generateLayoutPlanV3(input.styleId, observations, content, dnaJson)
    );

    console.log(`[finalize] Layout: ${layoutPlanV3.blocks.map((b) => `${b.type}(${b.variant})`).join(' → ')}`);

    // Step 3: Final page schema (with DNA constraints if selected)
    const finalSchema = await runStep(res, 'page_schema', () =>
      generateFinalSchema(input.styleId, layoutPlanV3, content, dnaJson)
    );

    console.log(`[finalize] Schema blocks: ${finalSchema.blocks.length}`);

    // Step 4: Validate + autofix
    const { blocks: validBlocks, warnings } = await runStep(res, 'validate', () =>
      validateAndAutofixV3(finalSchema, input.styleId)
    );

    console.log(`[finalize] Valid blocks: ${validBlocks.length}, warnings: ${warnings.length}`);

    // Step 5: Resolve tokens
    const resolvedTokens = resolveStyleTokens(style, content.brandName);
    const signature = getSignatureForStyle(input.styleId);
    const density = getDensityForStyle(style);

    // Build page schema for rendering
    const pageSchema = {
      tokens: {
        brandName: content.brandName,
        primaryColor: resolvedTokens.palette.primary,
        secondaryColor: resolvedTokens.palette.secondary,
        accentColor: resolvedTokens.palette.accent,
        headingFont: resolvedTokens.typography.headingFont,
        bodyFont: resolvedTokens.typography.bodyFont,
      },
      blocks: validBlocks,
    };

    // Step 5b: Compute novelty locks from validated blocks + DNA
    const noveltyLocks = computeNoveltyLocks(validBlocks, selectedDNA);
    console.log(`[finalize] Novelty locks: hero=${noveltyLocks.heroTypeLocked}(${noveltyLocks.heroVariantLocked}), required=${noveltyLocks.requiredBlockTypes.join(',')}`);

    // Step 6: Score (with DNA)
    const score = computeDesignScore(pageSchema, resolvedTokens, signature, selectedDNA);
    sendEvent(res, { step: 'score', status: 'done', ms: 0, data: { total: score.total, mustImprove: score.mustImprove } });
    console.log(`[finalize] Design score: ${score.total}/100`);

    // Step 7: Optional illustrations (style-aware)
    if (input.withIllustrations) {
      await runStep(res, 'illustrations', async () => {
        const iconSubjects: string[] = [];
        for (const block of pageSchema.blocks) {
          if (block.type === 'ValueProps3') {
            iconSubjects.push(...block.items.map((item) => item.title));
          } else if (block.type === 'BentoGrid') {
            iconSubjects.push(...block.items.map((item) => item.title));
          } else if (block.type === 'FeatureZigzag') {
            iconSubjects.push(...block.items.map((item) => item.title));
          } else if (block.type === 'ServicesGrid') {
            iconSubjects.push(...block.services.map((s) => s.title));
          }
        }
        const uniqueSubjects = [...new Set(iconSubjects)];
        const topIndustry = observations?.industryCandidates?.[0]?.label || 'business';
        const tone = observations?.brandSignals?.perceivedTone || 'professional';

        const assets = await generateAssets(content.brandName, tone, topIndustry, uniqueSubjects, input.styleId);

        if (assets.heroImage) {
          const heroBlock = pageSchema.blocks.find((b) => b.type === 'HeroSplit');
          if (heroBlock && heroBlock.type === 'HeroSplit') {
            (heroBlock as { imageUrl?: string }).imageUrl = assets.heroImage;
            (heroBlock as { imageAlt?: string }).imageAlt = `${content.brandName} hero illustration`;
          }
        }

        const iconMap = new Map<string, string>();
        uniqueSubjects.forEach((subject, i) => {
          if (assets.icons[i]) iconMap.set(subject, assets.icons[i]);
        });

        for (const block of pageSchema.blocks) {
          if (block.type === 'ValueProps3') {
            block.items.forEach((item) => { const icon = iconMap.get(item.title); if (icon) item.icon = icon; });
          } else if (block.type === 'BentoGrid') {
            block.items.forEach((item) => { const icon = iconMap.get(item.title); if (icon) (item as { icon?: string }).icon = icon; });
          } else if (block.type === 'FeatureZigzag') {
            block.items.forEach((item) => { const icon = iconMap.get(item.title); if (icon) (item as { icon?: string }).icon = icon; });
          } else if (block.type === 'ServicesGrid') {
            block.services.forEach((s) => { const icon = iconMap.get(s.title); if (icon) (s as { icon?: string }).icon = icon; });
          }
        }

        console.log(`[finalize] Icons injected: ${iconMap.size}`);
      });
    }

    // Step 8: Render HTML
    const renderResult = await runStep(res, 'render', async () => {
      return renderPageHtml(pageSchema, resolvedTokens, signature, density, 'v1');
    });
    let html = renderResult.html;
    let manifest = renderResult.manifest;

    const schemaV1 = JSON.parse(JSON.stringify(pageSchema));

    // Step 9: Optional QA loop (with novelty locks to prevent regression)
    let qaResult = undefined;
    const shouldRunQA = input.runQa || score.mustImprove;
    if (shouldRunQA) {
      qaResult = await runStep(res, 'qa_loop', async () => {
        const qa = await runQALoop(html, pageSchema, resolvedTokens, 1, signature, density, noveltyLocks);
        if (qa.iterated) {
          pageSchema.blocks = qa.schema.blocks;
          const v2Render = renderPageHtml(pageSchema, resolvedTokens, signature, density, 'v2');
          html = v2Render.html;
          manifest = v2Render.manifest;
          return { patches: qa.patches, critique: qa.critique, diff: qa.diff };
        }
        return { patches: [], critique: qa.critique, diff: qa.diff };
      });
    }

    const totalMs = Date.now() - pipelineStart;
    console.log(`[finalize] ✓ Complete in ${(totalMs / 1000).toFixed(1)}s`);

    sendEvent(res, {
      step: 'complete',
      ms: totalMs,
      result: {
        styleId: input.styleId,
        html,
        schema: pageSchema,
        schemaV1: qaResult ? schemaV1 : undefined,
        manifest,
        layoutPlan: layoutPlanV3,
        score,
        qaResult,
        warnings,
        signature,
        density,
      },
    });

    res.end();
  } catch (error) {
    const totalMs = Date.now() - pipelineStart;
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error(`[finalize] ✗ Failed after ${(totalMs / 1000).toFixed(1)}s:`, message);
    sendEvent(res, { step: 'error', error: message, ms: totalMs });
    res.end();
  }
});

// ─── Standalone Screenshot Endpoints (backward compat) ─────────────────────────

app.post('/screenshot', authenticate, async (req: Request, res: Response) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'Missing or invalid "url" field' });
    return;
  }

  try { new URL(url); } catch {
    res.status(400).json({ error: 'Invalid URL format' });
    return;
  }

  console.log(`[screenshot] Capturing: ${url}`);
  const startTime = Date.now();

  try {
    const result = await captureScreenshotsLocal(url);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[screenshot] Done in ${elapsed}s — desktop: ${result.desktop.length}B, mobile: ${result.mobile.length}B`);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[screenshot] Error:', message);
    res.status(500).json({ error: `Screenshot failed: ${message}` });
  }
});

app.post('/screenshot-html', authenticate, async (req: Request, res: Response) => {
  const { html } = req.body;

  if (!html || typeof html !== 'string') {
    res.status(400).json({ error: 'Missing or invalid "html" field' });
    return;
  }

  console.log(`[screenshot-html] Rendering HTML (${html.length} chars)`);
  const startTime = Date.now();

  try {
    const screenshot = await screenshotHtmlLocal(html);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[screenshot-html] Done in ${elapsed}s`);
    res.json({ screenshot });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[screenshot-html] Error:', message);
    res.status(500).json({ error: `Screenshot-html failed: ${message}` });
  }
});

// ─── Start ──────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(Number(PORT), '0.0.0.0', async () => {
  console.log(`SiteForge backend v3.0.0 running on port ${PORT}`);

  // Pre-warm browser
  try {
    await getBrowser();
    console.log('[startup] Browser pre-warmed');
  } catch (e) {
    console.error('[startup] Browser pre-warm failed:', e);
  }
});
