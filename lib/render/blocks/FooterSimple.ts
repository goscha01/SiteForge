import { z } from 'zod';
import { FooterSimpleSchema } from '@/lib/catalog/schemas';
import { escapeHtml } from '../renderHtml';
import type { Tokens } from '@/lib/catalog/schemas';

type FooterSimpleBlock = z.infer<typeof FooterSimpleSchema>;

export function renderFooterSimple(block: FooterSimpleBlock, tokens: Tokens): string {
  const linksHtml = block.links.map((link) => `
    <a href="${escapeHtml(link.href)}" class="text-gray-400 hover:text-white transition-colors duration-200" style="font-family: '${tokens.bodyFont}', sans-serif;">
      ${escapeHtml(link.text)}
    </a>
  `).join('');

  const year = new Date().getFullYear();
  const copyright = block.copyright || `\u00A9 ${year} ${block.brandName}. All rights reserved.`;

  return `
<footer class="py-12" style="background-color: ${tokens.primaryColor};">
  <div class="max-w-7xl mx-auto px-6">
    <div class="flex flex-col md:flex-row justify-between items-center gap-6">
      <div class="text-xl font-bold text-white" style="font-family: '${tokens.headingFont}', sans-serif;">
        ${escapeHtml(block.brandName)}
      </div>
      <nav class="flex flex-wrap justify-center gap-6">
        ${linksHtml}
      </nav>
    </div>
    <div class="mt-8 pt-8 border-t border-white/10 text-center">
      <p class="text-gray-400 text-sm" style="font-family: '${tokens.bodyFont}', sans-serif;">
        ${escapeHtml(copyright)}
      </p>
    </div>
  </div>
</footer>`;
}
