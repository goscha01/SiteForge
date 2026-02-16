import { z } from 'zod';
import { CTASectionSchema } from '@/lib/catalog/schemas';
import { escapeHtml } from '../renderHtml';
import type { Tokens } from '@/lib/catalog/schemas';

type CTASectionBlock = z.infer<typeof CTASectionSchema>;

export function renderCTASection(block: CTASectionBlock, tokens: Tokens): string {
  return `
<section class="py-16 lg:py-24" style="background: linear-gradient(135deg, ${tokens.primaryColor}, ${tokens.secondaryColor});">
  <div class="max-w-4xl mx-auto px-6 text-center">
    <h2 class="text-3xl lg:text-4xl font-bold text-white mb-4" style="font-family: '${tokens.headingFont}', sans-serif;">
      ${escapeHtml(block.headline)}
    </h2>
    ${block.subtext ? `<p class="text-lg text-white/80 mb-8 max-w-2xl mx-auto" style="font-family: '${tokens.bodyFont}', sans-serif;">${escapeHtml(block.subtext)}</p>` : '<div class="mb-8"></div>'}
    <a href="${escapeHtml(block.ctaHref)}"
       class="inline-block px-8 py-4 bg-white font-semibold rounded-lg text-lg transition-all duration-200 hover:shadow-lg hover:scale-105"
       style="color: ${tokens.primaryColor};">
      ${escapeHtml(block.ctaText)}
    </a>
  </div>
</section>`;
}
