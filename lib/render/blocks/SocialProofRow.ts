import { z } from 'zod';
import { SocialProofRowSchema } from '@/lib/catalog/schemas';
import { escapeHtml } from '../renderHtml';
import type { Tokens } from '@/lib/catalog/schemas';

type SocialProofRowBlock = z.infer<typeof SocialProofRowSchema>;

export function renderSocialProofRow(block: SocialProofRowBlock, tokens: Tokens): string {
  const itemsHtml = block.items.map((item) => `
    <div class="px-6 py-3">
      <span class="text-gray-400 font-semibold text-lg tracking-wide" style="font-family: '${tokens.headingFont}', sans-serif;">
        ${escapeHtml(item.name)}
      </span>
    </div>
  `).join('');

  return `
<section class="py-12 bg-gray-50 border-y border-gray-100">
  <div class="max-w-7xl mx-auto px-6">
    ${block.label ? `<p class="text-center text-sm text-gray-400 uppercase tracking-widest mb-6" style="font-family: '${tokens.bodyFont}', sans-serif;">${escapeHtml(block.label)}</p>` : ''}
    <div class="flex flex-wrap justify-center items-center gap-8">
      ${itemsHtml}
    </div>
  </div>
</section>`;
}
