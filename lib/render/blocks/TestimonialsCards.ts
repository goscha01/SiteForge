import { z } from 'zod';
import { TestimonialsCardsSchema } from '@/lib/catalog/schemas';
import { escapeHtml } from '../renderHtml';
import type { Tokens } from '@/lib/catalog/schemas';

type TestimonialsCardsBlock = z.infer<typeof TestimonialsCardsSchema>;

export function renderTestimonialsCards(block: TestimonialsCardsBlock, tokens: Tokens): string {
  const cols = block.testimonials.length === 1 ? 'max-w-2xl mx-auto' :
    block.testimonials.length === 2 ? 'grid md:grid-cols-2 gap-8' :
    'grid md:grid-cols-2 lg:grid-cols-3 gap-8';

  const cardsHtml = block.testimonials.map((t) => `
    <div class="bg-white p-8 rounded-xl shadow-sm border border-gray-100">
      <div class="text-3xl mb-4" style="color: ${tokens.accentColor};">&ldquo;</div>
      <p class="text-gray-700 leading-relaxed mb-6" style="font-family: '${tokens.bodyFont}', sans-serif;">
        ${escapeHtml(t.quote)}
      </p>
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm" style="background-color: ${tokens.primaryColor};">
          ${t.author.charAt(0).toUpperCase()}
        </div>
        <div>
          <p class="font-semibold text-gray-900" style="font-family: '${tokens.headingFont}', sans-serif;">${escapeHtml(t.author)}</p>
          ${t.role ? `<p class="text-sm text-gray-500">${escapeHtml(t.role)}</p>` : ''}
        </div>
      </div>
    </div>
  `).join('');

  return `
<section class="py-16 lg:py-24" style="background: ${tokens.secondaryColor}08;">
  <div class="max-w-7xl mx-auto px-6">
    <h2 class="text-3xl lg:text-4xl font-bold text-center mb-12" style="color: ${tokens.primaryColor}; font-family: '${tokens.headingFont}', sans-serif;">
      ${escapeHtml(block.sectionTitle)}
    </h2>
    <div class="${cols}">
      ${cardsHtml}
    </div>
  </div>
</section>`;
}
