import { z } from 'zod';
import { ServicesGridSchema } from '@/lib/catalog/schemas';
import { escapeHtml } from '../renderHtml';
import type { ResolvedDesignTokens } from '@/lib/design/types';

type ServicesGridBlock = z.infer<typeof ServicesGridSchema>;

export function renderServicesGrid(block: ServicesGridBlock, tokens: ResolvedDesignTokens): string {
  const { palette, typography, borderRadius } = tokens;

  const sectionTitleHtml = `
    <h2 class="text-3xl lg:text-4xl text-center mb-12" style="color: ${palette.textPrimary}; font-family: '${typography.headingFont}', sans-serif; font-weight: ${typography.headingWeight};">
      ${escapeHtml(block.sectionTitle)}
    </h2>`;

  function renderServiceIcon(icon?: string, title?: string): string {
    if (!icon) return '';
    if (icon.startsWith('data:')) {
      return `<img src="${icon}" alt="${escapeHtml(title || '')}" class="w-12 h-12 mb-3 object-contain" />`;
    }
    return `<div class="text-3xl mb-3">${icon}</div>`;
  }

  switch (block.variant) {
    case 'minimal-list': {
      const servicesHtml = block.services.map((service) => `
        <div class="py-6" style="border-bottom: 1px solid ${palette.secondary}20;">
          <div class="flex items-start gap-4">
            ${service.icon
              ? (service.icon.startsWith('data:')
                ? `<img src="${service.icon}" alt="${escapeHtml(service.title)}" class="w-8 h-8 shrink-0 object-contain" />`
                : `<span class="text-2xl shrink-0" style="color: ${palette.accent};">${service.icon}</span>`)
              : ''}
            <div>
              <h3 class="text-lg mb-1" style="color: ${palette.textPrimary}; font-family: '${typography.headingFont}', sans-serif; font-weight: ${typography.headingWeight};">
                ${escapeHtml(service.title)}
              </h3>
              <p class="text-sm leading-relaxed" style="color: ${palette.textSecondary}; font-family: '${typography.bodyFont}', sans-serif; font-weight: ${typography.bodyWeight};">
                ${escapeHtml(service.description)}
              </p>
            </div>
          </div>
        </div>
      `).join('');

      return `
<section class="py-16 lg:py-24" style="background-color: ${palette.background};">
  <div class="max-w-3xl mx-auto px-6">
    ${sectionTitleHtml}
    <div>
      ${servicesHtml}
    </div>
  </div>
</section>`;
    }

    case 'icon-left': {
      const servicesHtml = block.services.map((service) => `
        <div class="flex items-start gap-6 p-6 transition-shadow duration-200 hover:shadow-md" style="background-color: ${palette.surface}; border-radius: ${borderRadius}; border: 1px solid ${palette.secondary}12;">
          ${service.icon
            ? (service.icon.startsWith('data:')
              ? `<div class="shrink-0 w-14 h-14 flex items-center justify-center" style="background: ${palette.primary}10; border-radius: ${borderRadius};">
                  <img src="${service.icon}" alt="${escapeHtml(service.title)}" class="w-10 h-10 object-contain" />
                </div>`
              : `<div class="shrink-0 w-14 h-14 flex items-center justify-center" style="background: ${palette.primary}10; border-radius: ${borderRadius};">
                  <span class="text-2xl">${service.icon}</span>
                </div>`)
            : ''}
          <div>
            <h3 class="text-lg mb-2" style="color: ${palette.textPrimary}; font-family: '${typography.headingFont}', sans-serif; font-weight: ${typography.headingWeight};">
              ${escapeHtml(service.title)}
            </h3>
            <p class="text-sm leading-relaxed" style="color: ${palette.textSecondary}; font-family: '${typography.bodyFont}', sans-serif; font-weight: ${typography.bodyWeight};">
              ${escapeHtml(service.description)}
            </p>
          </div>
        </div>
      `).join('');

      const cols = block.services.length <= 2 ? 'md:grid-cols-2' : 'md:grid-cols-2';

      return `
<section class="py-16 lg:py-24" style="background: ${palette.primary}04;">
  <div class="max-w-7xl mx-auto px-6">
    ${sectionTitleHtml}
    <div class="grid grid-cols-1 ${cols} gap-6">
      ${servicesHtml}
    </div>
  </div>
</section>`;
    }

    case 'cards':
    default: {
      const cols = block.services.length <= 3 ? 'md:grid-cols-3' : 'md:grid-cols-2 lg:grid-cols-4';

      const servicesHtml = block.services.map((service) => `
        <div class="p-6 transition-shadow duration-200 hover:shadow-lg" style="background-color: ${palette.surface}; border-radius: ${borderRadius}; border: 1px solid ${palette.secondary}12;">
          ${renderServiceIcon(service.icon, service.title)}
          <h3 class="text-lg mb-2" style="color: ${palette.textPrimary}; font-family: '${typography.headingFont}', sans-serif; font-weight: ${typography.headingWeight};">
            ${escapeHtml(service.title)}
          </h3>
          <p class="text-sm leading-relaxed" style="color: ${palette.textSecondary}; font-family: '${typography.bodyFont}', sans-serif; font-weight: ${typography.bodyWeight};">
            ${escapeHtml(service.description)}
          </p>
        </div>
      `).join('');

      return `
<section class="py-16 lg:py-24" style="background: ${palette.primary}04;">
  <div class="max-w-7xl mx-auto px-6">
    ${sectionTitleHtml}
    <div class="grid grid-cols-1 ${cols} gap-6">
      ${servicesHtml}
    </div>
  </div>
</section>`;
    }
  }
}
