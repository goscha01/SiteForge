import { z } from 'zod';
import { BentoGridSchema } from '@/lib/catalog/schemas';
import { escapeHtml } from '../renderHtml';
import type { ResolvedDesignTokens } from '@/lib/design/types';

type BentoGridBlock = z.infer<typeof BentoGridSchema>;

function renderIcon(icon: string, title: string): string {
  if (icon.startsWith('data:')) {
    return `<img src="${icon}" alt="${escapeHtml(title)}" class="w-12 h-12 mb-4 object-contain" />`;
  }
  return `<div class="text-3xl mb-4">${escapeHtml(icon)}</div>`;
}

export function renderBentoGrid(block: BentoGridBlock, tokens: ResolvedDesignTokens): string {
  const { palette, typography, borderRadius } = tokens;

  switch (block.variant) {
    case '2x2':
      return render2x2(block, palette, typography, borderRadius);
    case '3-col':
      return render3Col(block, palette, typography, borderRadius);
    case 'mixed':
    default:
      return renderMixed(block, palette, typography, borderRadius);
  }
}

function render2x2(
  block: BentoGridBlock,
  palette: ResolvedDesignTokens['palette'],
  typography: ResolvedDesignTokens['typography'],
  borderRadius: string,
): string {
  const itemsHtml = block.items.map((item) => `
    <div class="block-card p-6 lg:p-8" style="background: ${palette.surface}; border-radius: ${borderRadius}; border: 1px solid ${palette.secondary}15;">
      ${item.icon ? renderIcon(item.icon, item.title) : ''}
      <h3 class="text-lg font-bold mb-2" style="color: ${palette.textPrimary}; font-family: '${typography.headingFont}', sans-serif;">
        ${escapeHtml(item.title)}
      </h3>
      <p class="text-sm" style="color: ${palette.textSecondary}; font-family: '${typography.bodyFont}', sans-serif;">
        ${escapeHtml(item.description)}
      </p>
    </div>
  `).join('');

  return `
<section class="py-16 lg:py-24" style="background: ${palette.background};">
  <div class="max-w-5xl mx-auto px-6">
    <h2 class="text-3xl lg:text-4xl font-bold text-center mb-12" style="color: ${palette.textPrimary}; font-family: '${typography.headingFont}', sans-serif;">
      ${escapeHtml(block.sectionTitle)}
    </h2>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      ${itemsHtml}
    </div>
  </div>
</section>`;
}

function render3Col(
  block: BentoGridBlock,
  palette: ResolvedDesignTokens['palette'],
  typography: ResolvedDesignTokens['typography'],
  borderRadius: string,
): string {
  const itemsHtml = block.items.map((item) => `
    <div class="block-card p-6" style="background: ${palette.surface}; border-radius: ${borderRadius}; border: 1px solid ${palette.secondary}15;">
      ${item.icon ? renderIcon(item.icon, item.title) : ''}
      <h3 class="text-base font-bold mb-1" style="color: ${palette.textPrimary}; font-family: '${typography.headingFont}', sans-serif;">
        ${escapeHtml(item.title)}
      </h3>
      <p class="text-sm" style="color: ${palette.textSecondary}; font-family: '${typography.bodyFont}', sans-serif;">
        ${escapeHtml(item.description)}
      </p>
    </div>
  `).join('');

  return `
<section class="py-16 lg:py-24" style="background: ${palette.background};">
  <div class="max-w-6xl mx-auto px-6">
    <h2 class="text-3xl lg:text-4xl font-bold text-center mb-12" style="color: ${palette.textPrimary}; font-family: '${typography.headingFont}', sans-serif;">
      ${escapeHtml(block.sectionTitle)}
    </h2>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      ${itemsHtml}
    </div>
  </div>
</section>`;
}

function renderMixed(
  block: BentoGridBlock,
  palette: ResolvedDesignTokens['palette'],
  typography: ResolvedDesignTokens['typography'],
  borderRadius: string,
): string {
  const itemsHtml = block.items.map((item, i) => {
    const span = item.span ?? 'normal';
    let gridClass = '';
    if (span === 'wide') gridClass = 'md:col-span-2';
    else if (span === 'tall') gridClass = 'md:row-span-2';
    // First and last items get extra visual weight if no span set
    else if (i === 0 && block.items.length >= 4) gridClass = 'md:col-span-2';

    return `
    <div class="block-card p-6 lg:p-8 ${gridClass}" style="background: ${palette.surface}; border-radius: ${borderRadius}; border: 1px solid ${palette.secondary}15;">
      ${item.icon ? renderIcon(item.icon, item.title) : ''}
      <h3 class="text-lg font-bold mb-2" style="color: ${palette.textPrimary}; font-family: '${typography.headingFont}', sans-serif;">
        ${escapeHtml(item.title)}
      </h3>
      <p class="text-sm leading-relaxed" style="color: ${palette.textSecondary}; font-family: '${typography.bodyFont}', sans-serif;">
        ${escapeHtml(item.description)}
      </p>
    </div>`;
  }).join('');

  return `
<section class="py-16 lg:py-24" style="background: ${palette.background};">
  <div class="max-w-6xl mx-auto px-6">
    <h2 class="text-3xl lg:text-4xl font-bold text-center mb-12" style="color: ${palette.textPrimary}; font-family: '${typography.headingFont}', sans-serif;">
      ${escapeHtml(block.sectionTitle)}
    </h2>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 auto-rows-min">
      ${itemsHtml}
    </div>
  </div>
</section>`;
}
