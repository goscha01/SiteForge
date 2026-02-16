import { BlockMeta } from '@/lib/catalog/blocks';
import { DesignDirectionBrief, ExtractedContent } from '@/lib/catalog/schemas';

export function geminiDesignPrompt(context: {
  title: string;
  description: string;
  brandName: string;
}): string {
  return `You are a senior web designer analyzing a website to create a redesign brief.

WEBSITE: "${context.brandName}" — ${context.title}
DESCRIPTION: ${context.description || 'No description available.'}

Analyze the provided desktop and mobile screenshots and return a JSON object with this exact structure:

{
  "siteType": "string describing the type of website, e.g. 'SaaS landing page', 'restaurant', 'portfolio', 'e-commerce'",
  "mood": "string describing the target mood, e.g. 'professional and modern', 'warm and inviting', 'bold and energetic'",
  "primaryColor": "#hex 6-digit color - main brand color detected or recommended",
  "secondaryColor": "#hex 6-digit color - complementary secondary color",
  "accentColor": "#hex 6-digit color - accent/CTA color that contrasts well",
  "fontSuggestion": {
    "heading": "A real Google Font name for headings (e.g. 'Inter', 'Poppins', 'Playfair Display')",
    "body": "A real Google Font name for body text (e.g. 'Inter', 'Open Sans', 'Source Sans 3')"
  },
  "layoutStyle": "one of: corporate, creative, minimal, bold, elegant",
  "suggestedBlocks": ["ordered list of block type names"],
  "designNotes": "2-3 sentences about your design reasoning and key improvements"
}

AVAILABLE BLOCK TYPES (use these exact names in suggestedBlocks):
- HeroSplit: Hero with headline, subheadline, CTA, and image/gradient
- ValueProps3: 2-4 column value proposition cards with icons
- ServicesGrid: Grid of service/feature cards
- SocialProofRow: Row of client/partner names
- TestimonialsCards: Testimonial quote cards
- FAQAccordion: FAQ question-answer section
- CTASection: Call-to-action section with button
- FooterSimple: Simple footer with links

RULES:
- Suggest 4-8 blocks total
- Always start with HeroSplit
- Always end with FooterSimple
- All colors MUST be valid 6-digit hex codes starting with #
- Font names MUST be real Google Fonts
- Focus on DESIGN quality, not content changes
- Analyze the current design's strengths and weaknesses in designNotes`;
}

export function claudeSchemaPrompt(
  direction: DesignDirectionBrief,
  content: ExtractedContent,
  catalog: BlockMeta[]
): string {
  return `You are a web design system that converts website content and design direction into a structured page schema. Output ONLY valid JSON — no markdown, no explanation, no code fences.

DESIGN DIRECTION:
${JSON.stringify(direction, null, 2)}

EXTRACTED WEBSITE CONTENT:
- Brand: ${content.brandName}
- Title: ${content.title}
- Description: ${content.description}
- Headings: ${content.headings.slice(0, 15).join(' | ')}
- Navigation: ${content.navItems.join(', ')}
- Key paragraphs: ${content.paragraphs.slice(0, 8).join('\n')}
- CTA texts: ${content.ctaTexts.join(', ') || 'Learn More, Get Started'}
- Testimonials: ${content.testimonials.slice(0, 4).join(' | ') || 'None found'}
- FAQ items: ${content.faqItems.length > 0 ? content.faqItems.slice(0, 5).map(f => f.question).join(' | ') : 'None found'}

AVAILABLE BLOCKS:
${catalog.map(b => `- ${b.type}: ${b.description}. Required: ${b.requiredFields.join(', ')}`).join('\n')}

OUTPUT the following JSON structure:
{
  "tokens": {
    "brandName": "string",
    "primaryColor": "#hex",
    "secondaryColor": "#hex",
    "accentColor": "#hex",
    "headingFont": "Google Font name",
    "bodyFont": "Google Font name"
  },
  "blocks": [
    // Each block must have a "type" field matching one of the available block types
    // Populate with REAL content from the extracted website content above
    // Do NOT invent fake testimonials, services, or features — use what's extracted
    // If content is missing for a block type, use reasonable defaults derived from what IS available
  ]
}

BLOCK FIELD SPECIFICATIONS:
- HeroSplit: { type: "HeroSplit", headline: string, subheadline: string, ctaText: string, ctaHref: string }
- ValueProps3: { type: "ValueProps3", sectionTitle: string, items: [{ icon: "emoji", title: string, description: string }] (2-4 items) }
- ServicesGrid: { type: "ServicesGrid", sectionTitle: string, services: [{ title: string, description: string, icon: "emoji" }] (2-8 items) }
- SocialProofRow: { type: "SocialProofRow", label: "Trusted by" or similar, items: [{ name: string }] (2-8 items) }
- TestimonialsCards: { type: "TestimonialsCards", sectionTitle: string, testimonials: [{ quote: string, author: string, role: string }] (1-4 items) }
- FAQAccordion: { type: "FAQAccordion", sectionTitle: string, items: [{ question: string, answer: string }] (1-10 items) }
- CTASection: { type: "CTASection", headline: string, subtext: string, ctaText: string, ctaHref: string }
- FooterSimple: { type: "FooterSimple", brandName: string, links: [{ text: string, href: string }], copyright: string }

CRITICAL RULES:
1. Output ONLY the JSON object. No markdown, no explanation, no code fences.
2. Use ONLY block types from the list above.
3. Use the blocks suggested in the design direction, in that order.
4. Populate blocks with content extracted from the website. Do not hallucinate content.
5. All color values must be valid 6-digit hex codes.
6. Minimum 3 blocks, maximum 12 blocks.
7. ctaHref values should be "#" or "/" for internal links.
8. Icons should be emojis (e.g. "🚀", "💡", "⚡").`;
}

export function claudeRepairPrompt(
  rawJson: string,
  errors: string[]
): string {
  return `The following JSON page schema has validation errors. Fix ONLY the errors and return the corrected JSON. Output ONLY valid JSON — no markdown, no explanation, no code fences.

VALIDATION ERRORS:
${errors.join('\n')}

INVALID JSON:
${rawJson}

Return the corrected JSON object only.`;
}
