import type { PageSchema, Block } from '@/lib/catalog/schemas';
import type { ResolvedDesignTokens } from '@/lib/design/types';
import { renderHeroSplit } from './blocks/HeroSplit';
import { renderValueProps3 } from './blocks/ValueProps3';
import { renderServicesGrid } from './blocks/ServicesGrid';
import { renderSocialProofRow } from './blocks/SocialProofRow';
import { renderTestimonialsCards } from './blocks/TestimonialsCards';
import { renderFAQAccordion } from './blocks/FAQAccordion';
import { renderCTASection } from './blocks/CTASection';
import { renderFooterSimple } from './blocks/FooterSimple';
import { renderBentoGrid } from './blocks/BentoGrid';
import { renderFeatureZigzag } from './blocks/FeatureZigzag';
import { renderStatsBand } from './blocks/StatsBand';
import { renderProcessTimeline } from './blocks/ProcessTimeline';
import { getSignatureCSS, getSignatureStyles } from '@/lib/design/signatures';

// HTML entity escaping for XSS prevention
const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch] || ch);
}

type BlockRenderer = (block: never, tokens: ResolvedDesignTokens) => string;

const BLOCK_RENDERERS: Record<string, BlockRenderer> = {
  HeroSplit: renderHeroSplit as BlockRenderer,
  ValueProps3: renderValueProps3 as BlockRenderer,
  ServicesGrid: renderServicesGrid as BlockRenderer,
  SocialProofRow: renderSocialProofRow as BlockRenderer,
  TestimonialsCards: renderTestimonialsCards as BlockRenderer,
  FAQAccordion: renderFAQAccordion as BlockRenderer,
  CTASection: renderCTASection as BlockRenderer,
  FooterSimple: renderFooterSimple as BlockRenderer,
  BentoGrid: renderBentoGrid as BlockRenderer,
  FeatureZigzag: renderFeatureZigzag as BlockRenderer,
  StatsBand: renderStatsBand as BlockRenderer,
  ProcessTimeline: renderProcessTimeline as BlockRenderer,
};

// ─── Render Manifest ────────────────────────────────────────────────────────────

export interface RenderManifestBlock {
  index: number;
  type: string;
  variant: string;
}

export interface RenderManifest {
  blocks: RenderManifestBlock[];
  tokensApplied: {
    palette: Record<string, string>;
    typography: { headingFont: string; bodyFont: string };
    borderRadius: string;
  };
  signatureApplied: string | null;
  density: string;
  schemaHash: string;
  version: string;
}

function computeSchemaHash(schema: PageSchema): string {
  const str = JSON.stringify(schema);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// ─── Density Spacing ────────────────────────────────────────────────────────────

function getDensityPadding(density?: string): { section: string; sectionPx: string } {
  switch (density) {
    case 'loose':
      return { section: 'py-20 lg:py-28', sectionPx: '5rem' };
    case 'tight':
      return { section: 'py-8 lg:py-12', sectionPx: '2rem' };
    case 'normal':
    default:
      return { section: 'py-14 lg:py-20', sectionPx: '3.5rem' };
  }
}

// ─── Section Separator ──────────────────────────────────────────────────────────

function getSeparatorHtml(signature?: string): string {
  if (!signature) return '';
  const sig = getSignatureStyles(signature);

  switch (sig.id) {
    case 'editorial':
      return '<div class="sig-separator" style="max-width:900px;margin:0 auto;height:1px;background:rgba(0,0,0,0.12);"></div>';
    case 'technicalGrid':
      return '<div class="sig-separator" style="height:1px;background:rgba(0,0,0,0.06);"></div>';
    case 'darkNeon':
      return '<div class="sig-separator" style="height:1px;background:linear-gradient(90deg,transparent,var(--color-accent),transparent);opacity:0.3;"></div>';
    case 'colorBlocks':
      return ''; // color blocks use alternating backgrounds instead
    case 'bento':
      return '<div class="sig-separator" style="height:12px;"></div>';
    default:
      return '';
  }
}

// ─── Main Renderer ──────────────────────────────────────────────────────────────

export function renderPageHtml(
  schema: PageSchema,
  resolvedTokens: ResolvedDesignTokens,
  signature?: string,
  density?: string,
  version: string = 'v1',
): { html: string; manifest: RenderManifest } {
  const { blocks } = schema;
  const t = resolvedTokens;

  const sig = signature ? getSignatureStyles(signature) : null;
  const sigCSS = signature ? getSignatureCSS(signature) : '';
  const wrapperClass = sig ? sig.sectionClass : '';
  const densityPad = getDensityPadding(density);
  const schemaHash = computeSchemaHash(schema);
  const separator = getSeparatorHtml(signature);

  // Build manifest
  const manifestBlocks: RenderManifestBlock[] = [];

  const blockHtmlParts = blocks.map((block: Block, index: number) => {
    const renderer = BLOCK_RENDERERS[block.type];
    const variant = ('variant' in block ? (block as Record<string, unknown>).variant as string : 'default') || 'default';

    if (!renderer) {
      console.error(`[render] UNKNOWN BLOCK TYPE: "${block.type}" at index ${index} — rendering error placeholder`);
      manifestBlocks.push({ index, type: block.type, variant });
      return `<section data-block-type="${escapeHtml(block.type)}" data-variant="${escapeHtml(variant)}" data-block-index="${index}" style="background:#fee2e2;padding:2rem;text-align:center;color:#991b1b;font-family:monospace;">
  <strong>RENDER ERROR:</strong> Unknown block type "${escapeHtml(block.type)}"
</section>`;
    }

    manifestBlocks.push({ index, type: block.type, variant });

    // Render the block
    let rendered = renderer(block as never, t);

    // Inject data attributes into the first <section> or <footer> tag
    const tagMatch = rendered.match(/^(\s*<(?:section|footer))([ >])/);
    if (tagMatch) {
      const attrs = ` data-block-type="${escapeHtml(block.type)}" data-variant="${escapeHtml(variant)}" data-block-index="${index}"`;
      rendered = rendered.replace(tagMatch[0], `${tagMatch[1]}${attrs}${tagMatch[2]}`);
    }

    return rendered;
  });

  // Join blocks with separators
  const blockHtml = blockHtmlParts.join(separator ? `\n${separator}\n` : '\n');

  const manifest: RenderManifest = {
    blocks: manifestBlocks,
    tokensApplied: {
      palette: { ...t.palette },
      typography: { headingFont: t.typography.headingFont, bodyFont: t.typography.bodyFont },
      borderRadius: t.borderRadius,
    },
    signatureApplied: signature || null,
    density: density || 'normal',
    schemaHash,
    version,
  };

  const headingFont = encodeURIComponent(t.typography.headingFont);
  const bodyFont = encodeURIComponent(t.typography.bodyFont);
  const fontsParam = headingFont === bodyFont
    ? `family=${headingFont}:wght@400;500;600;700`
    : `family=${headingFont}:wght@400;500;600;700&family=${bodyFont}:wght@400;500;600;700`;

  // Signature-specific global enhancements
  const signatureEnhancements = getSignatureEnhancements(signature, t);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(t.brandName)} — Redesigned</title>
  <!-- schemaHash: ${schemaHash} version: ${version} signature: ${signature || 'none'} density: ${density || 'normal'} -->
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?${fontsParam}&display=swap" rel="stylesheet">
  <style>
    :root {
      --color-primary: ${t.palette.primary};
      --color-secondary: ${t.palette.secondary};
      --color-accent: ${t.palette.accent};
      --color-background: ${t.palette.background};
      --color-surface: ${t.palette.surface};
      --color-text-primary: ${t.palette.textPrimary};
      --color-text-secondary: ${t.palette.textSecondary};
      --font-heading: '${t.typography.headingFont}', system-ui, sans-serif;
      --font-body: '${t.typography.bodyFont}', system-ui, sans-serif;
      --radius: ${t.borderRadius};
      --primary: ${t.palette.primary};
      --accent: ${t.palette.accent};
      --background: ${t.palette.background};
      --surface: ${t.palette.surface};
      --density-section-padding: ${densityPad.sectionPx};
    }
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--font-body);
      color: var(--color-text-primary);
      background-color: var(--color-background);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    h1, h2, h3, h4, h5, h6 {
      font-family: var(--font-heading);
    }
    details summary { list-style: none; }
    details summary::-webkit-details-marker { display: none; }

    /* Focus rings */
    a:focus-visible, button:focus-visible {
      outline: 2px solid var(--color-accent);
      outline-offset: 2px;
    }

    /* Hover states for interactive elements */
    a[href]:not(.no-hover):hover {
      opacity: 0.9;
      transition: opacity 0.15s ease;
    }

    ${sigCSS}
    ${signatureEnhancements}
  </style>
</head>
<body data-signature="${escapeHtml(signature || 'none')}" data-density="${escapeHtml(density || 'normal')}">
<div class="${wrapperClass}">
${blockHtml}
</div>
<script id="render-manifest" type="application/json">${JSON.stringify(manifest)}</script>
</body>
</html>`;

  return { html, manifest };
}

// ─── Signature Visual Enhancements ──────────────────────────────────────────────

function getSignatureEnhancements(signature?: string, tokens?: ResolvedDesignTokens): string {
  if (!signature) return '';
  const accent = tokens?.palette.accent || '#3b82f6';
  const primary = tokens?.palette.primary || '#1e40af';

  switch (signature) {
    case 'technicalGrid':
      return `
    /* Technical Grid: subtle grid background, monospace labels, fine lines */
    body { background-image: linear-gradient(rgba(0,0,0,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.025) 1px, transparent 1px); background-size: 40px 40px; }
    [data-block-type] { position: relative; }
    .sig-techgrid [data-block-type]::before {
      content: attr(data-block-type) ' / ' attr(data-variant);
      position: absolute; top: 8px; right: 12px;
      font-family: monospace; font-size: 10px; text-transform: uppercase;
      color: rgba(0,0,0,0.15); letter-spacing: 0.05em; pointer-events: none;
    }
    .sig-techgrid section { border-bottom: 1px solid rgba(0,0,0,0.06); }
    .sig-techgrid h2 { letter-spacing: -0.01em; }
    .sig-techgrid .block-card { border: 1px solid rgba(0,0,0,0.08); border-radius: 4px; }
      `;

    case 'darkNeon':
      return `
    /* Dark Neon: dark background, glow effects, neon accent */
    body { background: #0a0a0a !important; color: #e0e0e0 !important; }
    h1, h2, h3, h4 { color: #ffffff !important; }
    section { background: #0a0a0a !important; }
    [data-block-type="StatsBand"] { border-top: 1px solid rgba(255,255,255,0.06); border-bottom: 1px solid rgba(255,255,255,0.06); }
    a[href] { color: ${accent}; text-shadow: 0 0 10px ${accent}40; }
    [data-block-type="HeroSplit"] a[href],
    [data-block-type="CTASection"] a[href] {
      box-shadow: 0 0 20px ${accent}30;
    }
    .sig-darkneon section + section { border-top: 1px solid rgba(255,255,255,0.04); }
      `;

    case 'editorial':
      return `
    /* Editorial: generous whitespace, thin rules, underlined headings */
    h2 { text-decoration: underline; text-decoration-color: ${accent}60; text-decoration-thickness: 2px; text-underline-offset: 6px; }
    section { border-bottom: 1px solid rgba(0,0,0,0.08); }
    section:last-of-type { border-bottom: none; }
    [data-block-type="HeroSplit"] h1 { font-size: clamp(2.5rem, 6vw, 5rem); line-height: 1.05; letter-spacing: -0.03em; }
      `;

    case 'colorBlocks':
      return `
    /* Color Blocks: alternating bold section backgrounds */
    section:nth-of-type(even) { background: ${primary} !important; color: #ffffff !important; }
    section:nth-of-type(even) h2, section:nth-of-type(even) h3, section:nth-of-type(even) p { color: inherit !important; }
    section:nth-of-type(even) a[href] { background: #ffffff !important; color: ${primary} !important; }
      `;

    case 'bento':
      return `
    /* Bento: surface panels, rounded cards, subtle shadows */
    section { background: var(--color-surface); margin: 6px 0; border-radius: 1rem; border: 1px solid rgba(0,0,0,0.06); }
    section:first-of-type { border-radius: 1rem 1rem 0.5rem 0.5rem; margin-top: 0; }
    section:last-of-type { border-radius: 0.5rem 0.5rem 1rem 1rem; margin-bottom: 0; }
      `;

    case 'softCards':
      return `
    /* Soft Cards: pastel backgrounds, generous rounding, soft shadows */
    section { border-radius: 0; }
    [data-block-type="ValueProps3"] > div > div > div,
    [data-block-type="ServicesGrid"] > div > div > div,
    [data-block-type="BentoGrid"] > div > div > div > div {
      border-radius: 1.25rem !important; box-shadow: 0 2px 8px rgba(0,0,0,0.06); background: var(--color-surface);
    }
      `;

    case 'monoMinimal':
      return `
    /* Mono Minimal: constrained width, spare layout, single accent */
    section > div { max-width: 900px; }
    h2 { letter-spacing: -0.02em; }
    section:nth-of-type(odd) { background: #fafafa; }
      `;

    default:
      return '';
  }
}
