import type { ResolvedDesignTokens } from './types';
import type { PageSchema } from '@/lib/catalog/schemas';
import { contrastRatio, colorDistance } from './colorUtils';
import { FONT_PAIRINGS } from './fonts';

interface ScoreCategory {
  score: number;
  max: number;
  notes: string;
}

export interface DesignScoreResult {
  total: number;
  mustImprove: boolean;
  breakdown: Record<string, ScoreCategory>;
}

// Default forbidden sequence — the "SaaS template" we want to avoid
const DEFAULT_SEQUENCE = ['HeroSplit', 'ValueProps3', 'SocialProofRow', 'CTASection', 'FooterSimple'];

// Non-standard block types that indicate layout diversity
const DIVERSITY_BLOCKS = new Set([
  'BentoGrid', 'FeatureZigzag', 'StatsBand', 'ProcessTimeline',
]);

export function computeDesignScore(
  schema: PageSchema,
  tokens: ResolvedDesignTokens,
  signature?: string
): DesignScoreResult {
  const breakdown: Record<string, ScoreCategory> = {};

  // Contrast (20 pts)
  breakdown.contrast = scoreContrast(tokens);

  // Hierarchy (10 pts)
  breakdown.hierarchy = scoreHierarchy(schema);

  // Layout Diversity (25 pts) — the big one
  breakdown.layoutDiversity = scoreLayoutDiversity(schema);

  // Signature Presence (20 pts)
  breakdown.signaturePresence = scoreSignaturePresence(schema, signature);

  // Typography (10 pts)
  breakdown.typography = scoreTypography(tokens);

  // Rhythm Variety (10 pts)
  breakdown.rhythmVariety = scoreRhythmVariety(schema);

  // Anti-Template (5 pts)
  breakdown.antiTemplate = scoreAntiTemplate(schema);

  const total = Object.values(breakdown).reduce((sum, cat) => sum + cat.score, 0);
  const hasSignatureBlocks = schema.blocks.some((b) => DIVERSITY_BLOCKS.has(b.type));
  const mustImprove = total < 60 || !hasSignatureBlocks;

  return { total, mustImprove, breakdown };
}

function scoreContrast(tokens: ResolvedDesignTokens): ScoreCategory {
  const { palette } = tokens;
  let score = 0;
  const notes: string[] = [];

  // Primary text on background
  const primaryOnBg = contrastRatio(palette.textPrimary, palette.background);
  if (primaryOnBg >= 7) {
    score += 8;
  } else if (primaryOnBg >= 4.5) {
    score += 5;
    notes.push(`Primary text contrast ${primaryOnBg.toFixed(1)}:1 (AA but not AAA)`);
  } else {
    notes.push(`Primary text contrast FAILS AA: ${primaryOnBg.toFixed(1)}:1`);
  }

  // Accent on background
  const accentOnBg = contrastRatio(palette.accent, palette.background);
  if (accentOnBg >= 4.5) {
    score += 6;
  } else if (accentOnBg >= 3) {
    score += 4;
    notes.push(`Accent contrast ${accentOnBg.toFixed(1)}:1 — borderline`);
  } else {
    notes.push(`Accent fails contrast: ${accentOnBg.toFixed(1)}:1`);
  }

  // Button text readability
  const whiteOnAccent = contrastRatio('#FFFFFF', palette.accent);
  const blackOnAccent = contrastRatio('#000000', palette.accent);
  const bestBtnContrast = Math.max(whiteOnAccent, blackOnAccent);
  if (bestBtnContrast >= 4.5) {
    score += 6;
  } else if (bestBtnContrast >= 3) {
    score += 3;
    notes.push('Button text contrast is borderline');
  } else {
    notes.push('Button text contrast fails');
  }

  return { score, max: 20, notes: notes.join('; ') || 'All contrast checks pass' };
}

function scoreHierarchy(schema: PageSchema): ScoreCategory {
  let score = 0;
  const notes: string[] = [];

  // Hero first
  if (schema.blocks[0]?.type === 'HeroSplit') {
    score += 4;
  } else {
    notes.push('Hero is not the first block');
  }

  // Footer last
  if (schema.blocks[schema.blocks.length - 1]?.type === 'FooterSimple') {
    score += 3;
  } else {
    notes.push('Footer is not the last block');
  }

  // CTA present — check for dedicated CTA block OR CTA in hero
  const hasCTABlock = schema.blocks.some((b) => b.type === 'CTASection');
  const heroBlock = schema.blocks.find((b) => b.type === 'HeroSplit');
  const heroCTA = heroBlock && 'ctaText' in heroBlock && (heroBlock as Record<string, unknown>).ctaText;
  if (hasCTABlock) {
    score += 3;
  } else if (heroCTA) {
    score += 2;
    notes.push('CTA found in hero (no dedicated CTA section)');
  } else {
    notes.push('No CTA found');
  }

  return { score, max: 10, notes: notes.join('; ') || 'Good visual hierarchy' };
}

function scoreLayoutDiversity(schema: PageSchema): ScoreCategory {
  let score = 0;
  const notes: string[] = [];

  const blockTypes = schema.blocks.map((b) => b.type);
  const uniqueTypes = new Set(blockTypes);

  // Count distinct block types (excluding hero/footer which are structural)
  const contentTypes = new Set(
    blockTypes.filter((t) => t !== 'HeroSplit' && t !== 'FooterSimple')
  );

  // Count non-standard blocks
  const nonStandardCount = blockTypes.filter((t) => DIVERSITY_BLOCKS.has(t)).length;

  // Distinct types score (max 10)
  if (contentTypes.size >= 5) {
    score += 10;
  } else if (contentTypes.size >= 4) {
    score += 8;
  } else if (contentTypes.size >= 3) {
    score += 6;
  } else {
    score += 2;
    notes.push(`Only ${contentTypes.size} distinct content block types`);
  }

  // Non-standard blocks score (max 10) — require >= 3
  if (nonStandardCount >= 3) {
    score += 10;
  } else if (nonStandardCount >= 2) {
    score += 7;
  } else if (nonStandardCount >= 1) {
    score += 4;
  } else {
    notes.push('No non-standard blocks (BentoGrid, FeatureZigzag, StatsBand, ProcessTimeline)');
  }

  // Penalize default sequence (max 5)
  const typeSeq = blockTypes.join(',');
  const defaultSeq = DEFAULT_SEQUENCE.join(',');
  if (typeSeq.includes(defaultSeq)) {
    notes.push('Contains default SaaS template sequence — penalized');
  } else {
    score += 5;
  }

  return { score, max: 25, notes: notes.join('; ') || 'Good layout diversity' };
}

function scoreSignaturePresence(schema: PageSchema, signature?: string): ScoreCategory {
  let score = 0;
  const notes: string[] = [];

  // Has a signature at all (10 pts)
  if (signature) {
    score += 10;
  } else {
    notes.push('No style signature applied');
  }

  // Variant diversity — not all defaults (10 pts)
  const variants = schema.blocks
    .map((b) => ('variant' in b ? (b as Record<string, unknown>).variant : undefined))
    .filter(Boolean) as string[];

  const defaultVariants = new Set([
    'split-left', 'cards', 'logo-bar', 'gradient-bg', 'minimal', 'classic',
  ]);

  const nonDefaultVariants = variants.filter((v) => !defaultVariants.has(v));
  if (nonDefaultVariants.length >= 3) {
    score += 10;
  } else if (nonDefaultVariants.length >= 2) {
    score += 7;
  } else if (nonDefaultVariants.length >= 1) {
    score += 4;
  } else {
    notes.push('All blocks use default variants');
  }

  return { score, max: 20, notes: notes.join('; ') || 'Strong signature presence' };
}

function scoreTypography(tokens: ResolvedDesignTokens): ScoreCategory {
  let score = 0;
  const notes: string[] = [];

  const matchesCurated = FONT_PAIRINGS.some(
    (p) => p.heading === tokens.typography.headingFont && p.body === tokens.typography.bodyFont
  );

  if (matchesCurated) {
    score += 10;
  } else {
    const allFonts = new Set(FONT_PAIRINGS.flatMap((p) => [p.heading, p.body]));
    const headingKnown = allFonts.has(tokens.typography.headingFont);
    const bodyKnown = allFonts.has(tokens.typography.bodyFont);
    if (headingKnown && bodyKnown) {
      score += 7;
      notes.push('Font combination exists in known fonts but not a curated pairing');
    } else {
      score += 3;
      notes.push(`Non-curated fonts: ${tokens.typography.headingFont} / ${tokens.typography.bodyFont}`);
    }
  }

  return { score, max: 10, notes: notes.join('; ') || 'Curated font pairing' };
}

function scoreRhythmVariety(schema: PageSchema): ScoreCategory {
  let score = 0;
  const notes: string[] = [];

  // Check if blocks alternate between different densities/styles
  const variants = schema.blocks
    .map((b) => ('variant' in b ? (b as Record<string, unknown>).variant : 'default'))
    .filter(Boolean) as string[];

  const uniqueVariants = new Set(variants);

  // Variety in variants
  if (uniqueVariants.size >= Math.ceil(variants.length * 0.6)) {
    score += 5;
  } else if (uniqueVariants.size >= Math.ceil(variants.length * 0.4)) {
    score += 3;
  } else {
    score += 1;
    notes.push('Low variant diversity — sections feel repetitive');
  }

  // Mix of visual weights — check for dense vs sparse blocks
  const denseBlocks = new Set(['BentoGrid', 'ServicesGrid', 'FAQAccordion']);
  const sparseBlocks = new Set(['StatsBand', 'SocialProofRow', 'CTASection']);
  const hasDense = schema.blocks.some((b) => denseBlocks.has(b.type));
  const hasSparse = schema.blocks.some((b) => sparseBlocks.has(b.type));

  if (hasDense && hasSparse) {
    score += 5;
  } else if (hasDense || hasSparse) {
    score += 3;
  } else {
    score += 1;
    notes.push('No mix of dense and sparse sections');
  }

  return { score, max: 10, notes: notes.join('; ') || 'Good visual rhythm' };
}

function scoreAntiTemplate(schema: PageSchema): ScoreCategory {
  let score = 5;
  const notes: string[] = [];
  const blockTypes = schema.blocks.map((b) => b.type);

  // Penalize: exactly the default SaaS sequence
  const typeStr = blockTypes.join(' → ');
  if (typeStr.includes('HeroSplit → ValueProps3 → SocialProofRow → CTASection → FooterSimple')) {
    score -= 3;
    notes.push('Matches forbidden default SaaS sequence');
  }

  // Penalize: all blocks are from the "original 8" with no new types
  const allOriginal = blockTypes.every((t) =>
    ['HeroSplit', 'ValueProps3', 'ServicesGrid', 'SocialProofRow',
     'TestimonialsCards', 'FAQAccordion', 'CTASection', 'FooterSimple'].includes(t)
  );
  if (allOriginal) {
    score -= 2;
    notes.push('No new block types used — still template-like');
  }

  return { score: Math.max(0, score), max: 5, notes: notes.join('; ') || 'Passes anti-template checks' };
}
