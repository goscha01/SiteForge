import { PageSchemaOutput, PageSchema } from '@/lib/catalog/schemas';

export interface ValidationResult {
  valid: boolean;
  data?: PageSchema;
  errors: string[];
  warnings: string[];
}

export function validatePageSchema(raw: unknown): ValidationResult {
  const result = PageSchemaOutput.safeParse(raw);

  if (result.success) {
    const warnings = runGuardrails(result.data);
    return { valid: true, data: result.data, errors: [], warnings };
  }

  return {
    valid: false,
    errors: result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    ),
    warnings: [],
  };
}

const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

function runGuardrails(schema: PageSchema): string[] {
  const warnings: string[] = [];

  // Must have a hero block
  if (!schema.blocks.some((b) => b.type === 'HeroSplit')) {
    warnings.push('No HeroSplit block found — consider adding one as the first section.');
  }

  // Should end with footer
  const lastBlock = schema.blocks[schema.blocks.length - 1];
  if (lastBlock?.type !== 'FooterSimple') {
    warnings.push('Page does not end with FooterSimple block.');
  }

  // Validate hex colors
  const { primaryColor, secondaryColor, accentColor } = schema.tokens;
  if (!HEX_REGEX.test(primaryColor)) {
    warnings.push(`Invalid primaryColor hex: "${primaryColor}". Expected format: #RRGGBB.`);
  }
  if (!HEX_REGEX.test(secondaryColor)) {
    warnings.push(`Invalid secondaryColor hex: "${secondaryColor}".`);
  }
  if (!HEX_REGEX.test(accentColor)) {
    warnings.push(`Invalid accentColor hex: "${accentColor}".`);
  }

  // Check for reasonable block count
  if (schema.blocks.length < 3) {
    warnings.push('Page has fewer than 3 blocks — may look sparse.');
  }

  // Check for duplicate hero blocks
  const heroCount = schema.blocks.filter((b) => b.type === 'HeroSplit').length;
  if (heroCount > 1) {
    warnings.push(`Found ${heroCount} HeroSplit blocks — typically only 1 is needed.`);
  }

  // Check for excessive CTA sections
  const ctaCount = schema.blocks.filter((b) => b.type === 'CTASection').length;
  if (ctaCount > 2) {
    warnings.push(`Found ${ctaCount} CTASection blocks — consider reducing to 1-2.`);
  }

  return warnings;
}
