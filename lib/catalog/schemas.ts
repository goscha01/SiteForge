import { z } from 'zod';

// ===== Extracted Content (from Cheerio) =====
export const ExtractedContentSchema = z.object({
  title: z.string(),
  description: z.string(),
  headings: z.array(z.string()),
  paragraphs: z.array(z.string()),
  navItems: z.array(z.string()),
  ctaTexts: z.array(z.string()),
  testimonials: z.array(z.string()),
  faqItems: z.array(z.object({ question: z.string(), answer: z.string() })),
  brandName: z.string(),
  contactInfo: z.string().optional(),
});

// ===== Gemini Output: DesignDirectionBrief =====
export const DesignDirectionBriefSchema = z.object({
  siteType: z.string(),
  mood: z.string(),
  primaryColor: z.string(),
  secondaryColor: z.string(),
  accentColor: z.string(),
  fontSuggestion: z.object({
    heading: z.string(),
    body: z.string(),
  }),
  layoutStyle: z.enum(['corporate', 'creative', 'minimal', 'bold', 'elegant']),
  suggestedBlocks: z.array(z.string()),
  designNotes: z.string(),
});

// ===== Block Types =====
export const BlockTypeEnum = z.enum([
  'HeroSplit',
  'ValueProps3',
  'ServicesGrid',
  'SocialProofRow',
  'TestimonialsCards',
  'FAQAccordion',
  'CTASection',
  'FooterSimple',
]);

// ===== Individual Block Schemas =====
export const HeroSplitSchema = z.object({
  type: z.literal('HeroSplit'),
  headline: z.string().min(1).max(200),
  subheadline: z.string().max(300),
  ctaText: z.string().max(60),
  ctaHref: z.string(),
  imageUrl: z.string().optional(),
  imageAlt: z.string().optional(),
});

export const ValueProps3Schema = z.object({
  type: z.literal('ValueProps3'),
  sectionTitle: z.string(),
  items: z.array(z.object({
    icon: z.string(),
    title: z.string(),
    description: z.string(),
  })).min(2).max(4),
});

export const ServicesGridSchema = z.object({
  type: z.literal('ServicesGrid'),
  sectionTitle: z.string(),
  services: z.array(z.object({
    title: z.string(),
    description: z.string(),
    icon: z.string().optional(),
  })).min(2).max(8),
});

export const SocialProofRowSchema = z.object({
  type: z.literal('SocialProofRow'),
  label: z.string().optional(),
  items: z.array(z.object({
    name: z.string(),
  })).min(2).max(8),
});

export const TestimonialsCardsSchema = z.object({
  type: z.literal('TestimonialsCards'),
  sectionTitle: z.string(),
  testimonials: z.array(z.object({
    quote: z.string(),
    author: z.string(),
    role: z.string().optional(),
  })).min(1).max(4),
});

export const FAQAccordionSchema = z.object({
  type: z.literal('FAQAccordion'),
  sectionTitle: z.string(),
  items: z.array(z.object({
    question: z.string(),
    answer: z.string(),
  })).min(1).max(10),
});

export const CTASectionSchema = z.object({
  type: z.literal('CTASection'),
  headline: z.string(),
  subtext: z.string().optional(),
  ctaText: z.string(),
  ctaHref: z.string(),
});

export const FooterSimpleSchema = z.object({
  type: z.literal('FooterSimple'),
  brandName: z.string(),
  links: z.array(z.object({
    text: z.string(),
    href: z.string(),
  })),
  copyright: z.string().optional(),
});

// ===== Discriminated Union of All Blocks =====
export const BlockSchema = z.discriminatedUnion('type', [
  HeroSplitSchema,
  ValueProps3Schema,
  ServicesGridSchema,
  SocialProofRowSchema,
  TestimonialsCardsSchema,
  FAQAccordionSchema,
  CTASectionSchema,
  FooterSimpleSchema,
]);

// ===== Design Tokens =====
export const TokensSchema = z.object({
  brandName: z.string(),
  primaryColor: z.string(),
  secondaryColor: z.string(),
  accentColor: z.string(),
  headingFont: z.string(),
  bodyFont: z.string(),
});

// ===== Claude Output: Full Page Schema =====
export const PageSchemaOutput = z.object({
  tokens: TokensSchema,
  blocks: z.array(BlockSchema).min(3).max(12),
});

// ===== TypeScript types =====
export type ExtractedContent = z.infer<typeof ExtractedContentSchema>;
export type DesignDirectionBrief = z.infer<typeof DesignDirectionBriefSchema>;
export type Block = z.infer<typeof BlockSchema>;
export type Tokens = z.infer<typeof TokensSchema>;
export type PageSchema = z.infer<typeof PageSchemaOutput>;
export type BlockType = z.infer<typeof BlockTypeEnum>;
