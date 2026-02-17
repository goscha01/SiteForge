import { z } from 'zod';
import { ValueProps3Schema } from '@/lib/catalog/schemas';
import { escapeHtml } from '../renderHtml';
import type { Tokens } from '@/lib/catalog/schemas';

type ValueProps3Block = z.infer<typeof ValueProps3Schema>;

export function renderValueProps3(block: ValueProps3Block, tokens: Tokens): string {
  const cols = block.items.length <= 2 ? 'md:grid-cols-2' : block.items.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2 lg:grid-cols-4';

  const itemsHtml = block.items.map((item) => `
    <div class="text-center p-6">
      ${item.icon.startsWith('data:') ? `<img src="${item.icon}" alt="${escapeHtml(item.title)}" class="w-16 h-16 mx-auto mb-2" />` : `<div class="text-4xl mb-4">${item.icon}</div>`}
      <h3 class="text-xl font-semibold mb-3" style="color: ${tokens.primaryColor}; font-family: '${tokens.headingFont}', sans-serif;">
        ${escapeHtml(item.title)}
      </h3>
      <p class="text-gray-600 leading-relaxed" style="font-family: '${tokens.bodyFont}', sans-serif;">
        ${escapeHtml(item.description)}
      </p>
    </div>
  `).join('');

  return `
<section class="py-16 lg:py-24 bg-white">
  <div class="max-w-7xl mx-auto px-6">
    <h2 class="text-3xl lg:text-4xl font-bold text-center mb-12" style="color: ${tokens.primaryColor}; font-family: '${tokens.headingFont}', sans-serif;">
      ${escapeHtml(block.sectionTitle)}
    </h2>
    <div class="grid grid-cols-1 ${cols} gap-8">
      ${itemsHtml}
    </div>
  </div>
</section>`;
}
