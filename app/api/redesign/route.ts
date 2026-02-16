import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { captureScreenshots } from '@/lib/ingest/screenshot';
import { extractContent } from '@/lib/ingest/extract';
import { analyzeDesign } from '@/lib/llm/gemini';
import { generateBlockSchema } from '@/lib/llm/claude';
import { validateAndAutofix } from '@/lib/rules/autofix';
import { generateAssets } from '@/lib/llm/recraft';
import { renderPageHtml } from '@/lib/render/renderHtml';

export const runtime = 'nodejs';
export const maxDuration = 120;

const RequestSchema = z.object({
  url: z.string().url().refine((u) => u.startsWith('https://'), {
    message: 'Only HTTPS URLs are supported',
  }),
  withIllustrations: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input = RequestSchema.parse(body);

    // Step A: Ingest (parallel — screenshots + content extraction)
    const [screenshots, content] = await Promise.all([
      captureScreenshots(input.url),
      extractContent(input.url),
    ]);

    // Step B: Gemini Vision — design direction analysis
    const direction = await analyzeDesign(
      screenshots.desktop,
      screenshots.mobile,
      {
        title: content.title,
        description: content.description,
        brandName: content.brandName,
      }
    );

    // Step C: Claude — block schema generation
    const rawSchema = await generateBlockSchema(direction, content);

    // Step D: Validate + autofix
    const { schema, warnings } = await validateAndAutofix(rawSchema);

    // Step E: Optional Recraft illustrations
    if (input.withIllustrations) {
      const assets = await generateAssets(
        schema.tokens.brandName,
        direction.mood,
        direction.siteType
      );

      // Inject hero image if generated
      if (assets.heroImage) {
        const heroBlock = schema.blocks.find((b) => b.type === 'HeroSplit');
        if (heroBlock && heroBlock.type === 'HeroSplit') {
          (heroBlock as { imageUrl?: string }).imageUrl = assets.heroImage;
          (heroBlock as { imageAlt?: string }).imageAlt = `${schema.tokens.brandName} hero illustration`;
        }
      }
    }

    // Step F: Render deterministic HTML
    const html = renderPageHtml(schema);

    return NextResponse.json({
      html,
      schema,
      direction,
      warnings,
    });
  } catch (error) {
    console.error('Redesign pipeline error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request', details: error.issues.map((i) => i.message) },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
