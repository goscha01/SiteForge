import { BlockType } from './schemas';

export interface BlockMeta {
  type: BlockType;
  displayName: string;
  description: string;
  requiredFields: string[];
}

export const BLOCK_CATALOG: BlockMeta[] = [
  {
    type: 'HeroSplit',
    displayName: 'Hero (Split Layout)',
    description: 'Full-width hero with headline, subheadline, CTA button on one side, and image/gradient on the other',
    requiredFields: ['headline', 'subheadline', 'ctaText', 'ctaHref'],
  },
  {
    type: 'ValueProps3',
    displayName: 'Value Propositions',
    description: '2-4 column grid of value propositions, each with an icon/emoji, title, and short description',
    requiredFields: ['sectionTitle', 'items[].icon', 'items[].title', 'items[].description'],
  },
  {
    type: 'ServicesGrid',
    displayName: 'Services Grid',
    description: 'Grid of service/feature cards with title, description, and optional icon',
    requiredFields: ['sectionTitle', 'services[].title', 'services[].description'],
  },
  {
    type: 'SocialProofRow',
    displayName: 'Social Proof Row',
    description: 'Horizontal row of client/partner names with an optional label like "Trusted by"',
    requiredFields: ['items[].name'],
  },
  {
    type: 'TestimonialsCards',
    displayName: 'Testimonials Cards',
    description: '1-4 testimonial cards with quote text, author name, and optional role',
    requiredFields: ['sectionTitle', 'testimonials[].quote', 'testimonials[].author'],
  },
  {
    type: 'FAQAccordion',
    displayName: 'FAQ Accordion',
    description: 'Expandable FAQ section with question-answer pairs',
    requiredFields: ['sectionTitle', 'items[].question', 'items[].answer'],
  },
  {
    type: 'CTASection',
    displayName: 'Call to Action',
    description: 'Centered CTA section with headline, optional subtext, and action button',
    requiredFields: ['headline', 'ctaText', 'ctaHref'],
  },
  {
    type: 'FooterSimple',
    displayName: 'Simple Footer',
    description: 'Minimal footer with brand name, navigation links, and copyright text',
    requiredFields: ['brandName', 'links[].text', 'links[].href'],
  },
];
