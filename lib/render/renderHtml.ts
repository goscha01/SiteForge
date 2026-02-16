import { PageSchema, Block, Tokens } from '@/lib/catalog/schemas';
import { renderHeroSplit } from './blocks/HeroSplit';
import { renderValueProps3 } from './blocks/ValueProps3';
import { renderServicesGrid } from './blocks/ServicesGrid';
import { renderSocialProofRow } from './blocks/SocialProofRow';
import { renderTestimonialsCards } from './blocks/TestimonialsCards';
import { renderFAQAccordion } from './blocks/FAQAccordion';
import { renderCTASection } from './blocks/CTASection';
import { renderFooterSimple } from './blocks/FooterSimple';

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

type BlockRenderer = (block: never, tokens: Tokens) => string;

const BLOCK_RENDERERS: Record<string, BlockRenderer> = {
  HeroSplit: renderHeroSplit as BlockRenderer,
  ValueProps3: renderValueProps3 as BlockRenderer,
  ServicesGrid: renderServicesGrid as BlockRenderer,
  SocialProofRow: renderSocialProofRow as BlockRenderer,
  TestimonialsCards: renderTestimonialsCards as BlockRenderer,
  FAQAccordion: renderFAQAccordion as BlockRenderer,
  CTASection: renderCTASection as BlockRenderer,
  FooterSimple: renderFooterSimple as BlockRenderer,
};

export function renderPageHtml(schema: PageSchema): string {
  const { tokens, blocks } = schema;

  const blockHtml = blocks
    .map((block: Block) => {
      const renderer = BLOCK_RENDERERS[block.type];
      if (!renderer) return `<!-- Unknown block type: ${block.type} -->`;
      return renderer(block as never, tokens);
    })
    .join('\n');

  const headingFont = encodeURIComponent(tokens.headingFont);
  const bodyFont = encodeURIComponent(tokens.bodyFont);
  const fontsParam = headingFont === bodyFont
    ? `family=${headingFont}:wght@400;500;600;700`
    : `family=${headingFont}:wght@400;500;600;700&family=${bodyFont}:wght@400;500;600;700`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(tokens.brandName)} — Redesigned</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?${fontsParam}&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: '${tokens.bodyFont}', system-ui, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    h1, h2, h3, h4, h5, h6 {
      font-family: '${tokens.headingFont}', system-ui, sans-serif;
    }
    details summary { list-style: none; }
    details summary::-webkit-details-marker { display: none; }
  </style>
</head>
<body class="bg-white text-gray-900">
${blockHtml}
</body>
</html>`;
}
