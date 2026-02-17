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
import { renderPageHtml } from '@/lib/render/renderHtml';
import { resolveTokens } from '@/lib/design/presets';
import { computeDesignScore } from '@/lib/design/score';
import { runQALoop } from '@/lib/qa/qaLoop';

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
        const valueBlock = pageSchema.blocks.find((b) => b.type === 'ValueProps3');
        const iconSubjects = valueBlock && valueBlock.type === 'ValueProps3'
          ? valueBlock.items.map((item) => item.title)
          : [];

        const topIndustry = observations.industryCandidates[0]?.label || 'business';
        const tone = observations.brandSignals.perceivedTone || 'professional';

        const assets = await generateAssets(
          content.brandName,
          tone,
          topIndustry,
          iconSubjects
        );

        console.log(`[pipeline]   Hero image: ${assets.heroImage ? 'generated' : 'none'}`);
        console.log(`[pipeline]   Icons generated: ${assets.icons.length}`);

        // Inject hero image
        if (assets.heroImage) {
          const heroBlock = pageSchema.blocks.find((b) => b.type === 'HeroSplit');
          if (heroBlock && heroBlock.type === 'HeroSplit') {
            (heroBlock as { imageUrl?: string }).imageUrl = assets.heroImage;
            (heroBlock as { imageAlt?: string }).imageAlt = `${content.brandName} hero illustration`;
          }
        }

        // Inject feature icons
        if (assets.icons.length > 0 && valueBlock && valueBlock.type === 'ValueProps3') {
          valueBlock.items.forEach((item, i) => {
            if (assets.icons[i]) {
              item.icon = assets.icons[i];
            }
          });
        }
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
