import { z } from 'zod';
import { HeroSplitSchema } from '@/lib/catalog/schemas';
import { escapeHtml } from '../renderHtml';
import type { Tokens } from '@/lib/catalog/schemas';

type HeroSplitBlock = z.infer<typeof HeroSplitSchema>;

export function renderHeroSplit(block: HeroSplitBlock, tokens: Tokens): string {
  const imageHtml = block.imageUrl
    ? `<img src="${escapeHtml(block.imageUrl)}" alt="${escapeHtml(block.imageAlt || tokens.brandName)}" class="rounded-2xl shadow-2xl w-full max-h-[500px] object-cover" />`
    : `<div class="w-full h-80 lg:h-[400px] rounded-2xl bg-gradient-to-br" style="background: linear-gradient(135deg, ${tokens.primaryColor}22, ${tokens.accentColor}33);"></div>`;

  return `
<section class="relative overflow-hidden" style="background: linear-gradient(135deg, ${tokens.primaryColor}08, ${tokens.secondaryColor}0A);">
  <div class="max-w-7xl mx-auto px-6 py-20 lg:py-28 flex flex-col lg:flex-row items-center gap-12">
    <div class="flex-1 text-center lg:text-left">
      <h1 class="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6" style="color: ${tokens.primaryColor}; font-family: '${tokens.headingFont}', sans-serif;">
        ${escapeHtml(block.headline)}
      </h1>
      <p class="text-lg lg:text-xl text-gray-600 mb-8 max-w-xl mx-auto lg:mx-0" style="font-family: '${tokens.bodyFont}', sans-serif;">
        ${escapeHtml(block.subheadline)}
      </p>
      <a href="${escapeHtml(block.ctaHref)}"
         class="inline-block px-8 py-4 text-white font-semibold rounded-lg text-lg transition-all duration-200 hover:shadow-lg hover:scale-105"
         style="background-color: ${tokens.accentColor};">
        ${escapeHtml(block.ctaText)}
      </a>
    </div>
    <div class="flex-1 w-full">
      ${imageHtml}
    </div>
  </div>
</section>`;
}
