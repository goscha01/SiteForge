import { z } from 'zod';
import { ServicesGridSchema } from '@/lib/catalog/schemas';
import { escapeHtml } from '../renderHtml';
import type { Tokens } from '@/lib/catalog/schemas';

type ServicesGridBlock = z.infer<typeof ServicesGridSchema>;

export function renderServicesGrid(block: ServicesGridBlock, tokens: Tokens): string {
  const cols = block.services.length <= 3 ? 'md:grid-cols-3' : 'md:grid-cols-2 lg:grid-cols-4';

  const servicesHtml = block.services.map((service) => `
    <div class="p-6 rounded-xl border border-gray-100 hover:shadow-lg transition-shadow duration-200" style="background: ${tokens.secondaryColor}08;">
      ${service.icon ? `<div class="text-3xl mb-3">${service.icon}</div>` : ''}
      <h3 class="text-lg font-semibold mb-2" style="color: ${tokens.primaryColor}; font-family: '${tokens.headingFont}', sans-serif;">
        ${escapeHtml(service.title)}
      </h3>
      <p class="text-gray-600 text-sm leading-relaxed" style="font-family: '${tokens.bodyFont}', sans-serif;">
        ${escapeHtml(service.description)}
      </p>
    </div>
  `).join('');

  return `
<section class="py-16 lg:py-24" style="background: ${tokens.primaryColor}04;">
  <div class="max-w-7xl mx-auto px-6">
    <h2 class="text-3xl lg:text-4xl font-bold text-center mb-12" style="color: ${tokens.primaryColor}; font-family: '${tokens.headingFont}', sans-serif;">
      ${escapeHtml(block.sectionTitle)}
    </h2>
    <div class="grid grid-cols-1 ${cols} gap-6">
      ${servicesHtml}
    </div>
  </div>
</section>`;
}
