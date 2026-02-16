import { z } from 'zod';
import { FAQAccordionSchema } from '@/lib/catalog/schemas';
import { escapeHtml } from '../renderHtml';
import type { Tokens } from '@/lib/catalog/schemas';

type FAQAccordionBlock = z.infer<typeof FAQAccordionSchema>;

export function renderFAQAccordion(block: FAQAccordionBlock, tokens: Tokens): string {
  const itemsHtml = block.items.map((item, i) => `
    <details class="group border-b border-gray-200" ${i === 0 ? 'open' : ''}>
      <summary class="flex justify-between items-center cursor-pointer py-5 text-left">
        <span class="font-semibold text-gray-900 pr-4" style="font-family: '${tokens.headingFont}', sans-serif;">
          ${escapeHtml(item.question)}
        </span>
        <span class="text-gray-400 group-open:rotate-180 transition-transform duration-200 shrink-0">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg>
        </span>
      </summary>
      <div class="pb-5 text-gray-600 leading-relaxed" style="font-family: '${tokens.bodyFont}', sans-serif;">
        ${escapeHtml(item.answer)}
      </div>
    </details>
  `).join('');

  return `
<section class="py-16 lg:py-24 bg-white">
  <div class="max-w-3xl mx-auto px-6">
    <h2 class="text-3xl lg:text-4xl font-bold text-center mb-12" style="color: ${tokens.primaryColor}; font-family: '${tokens.headingFont}', sans-serif;">
      ${escapeHtml(block.sectionTitle)}
    </h2>
    <div class="divide-y divide-gray-200 border-t border-gray-200">
      ${itemsHtml}
    </div>
  </div>
</section>`;
}
