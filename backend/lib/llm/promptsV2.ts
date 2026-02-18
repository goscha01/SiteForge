// ---------------------------------------------------------------------------
// promptsV2.ts — V2 prompt templates for the website design generator pipeline
// ---------------------------------------------------------------------------

// ---- System prompts (exported as constants) --------------------------------

export const STYLE_SELECTION_SYSTEM =
  'You are a senior product designer. You must strictly follow the instructions. Output MUST be valid JSON and nothing else.';

export const PREVIEW_SCHEMA_SYSTEM =
  'You are a senior product designer and information architect. Output MUST be valid JSON and nothing else.';

export const LAYOUT_PLAN_SYSTEM =
  'You are a senior product designer. Output MUST be valid JSON and nothing else.';

export const FINAL_SCHEMA_SYSTEM =
  'You are a senior product designer + strict JSON generator. Output MUST be valid JSON and nothing else.';

export const SCHEMA_REPAIR_SYSTEM =
  'You are a strict JSON repair agent. Output MUST be valid JSON and nothing else.';

export const QA_PATCH_APPLY_SYSTEM =
  'You are a strict JSON patch applier for PageSchema. Output MUST be valid JSON and nothing else.';

// ---- Template A — styleSelectionPrompt -------------------------------------

export function styleSelectionPrompt(
  observationsJson: string,
  styleLibraryJson: string,
): string {
  return `We are building a website design generator.

You MUST choose exactly THREE distinct styles from the style library below.
- You are NOT allowed to invent new styles.
- You must pick 3 styles that are maximally different (e.g., not "modern-saas" + "bold-startup" + "soft-cards" all together; include at least one dark or editorial option when appropriate).
- Use the observations to decide what fits the site's context, but prioritize variety.

Return JSON array ONLY:
[
  { "styleId": string, "confidence": number (0-1), "reason": string (max 2 sentences), "bestFor": string (max 12 words) },
  { ... },
  { ... }
]

OBSERVATIONS_JSON:
${observationsJson}

STYLE_LIBRARY_JSON:
${styleLibraryJson}`;
}

// ---- Template B — previewSchemaPrompt --------------------------------------

export function previewSchemaPrompt(
  styleId: string,
  contentSummaryJson: string,
  blockCatalogJson: string,
  styleLibraryJson: string,
): string {
  const nonce = Math.random().toString(36).slice(2, 10);
  return `Generate a MINIMAL preview schema for the chosen style. This preview is used to show the user a direction, not the final site.

VARIATION_SEED: ${nonce}
Use this seed as creative inspiration — choose different block variants, layout compositions, and content arrangements each time.

Constraints:
- Use ONLY tokens/typography from the selected style.
- Use ONLY blocks and variants from the block catalog.
- Keep it short: exactly 4 blocks.
- The FIRST block MUST be a hero with a visual variant that shows an image (e.g. HeroSplit with split-left, split-right, or asymmetric). This is critical for the preview to look good.
- For HeroSplit blocks, always include an "imageUrl" prop with value "placeholder" and "imageAlt" with a relevant description.
- Must include the style's REQUIRED signatureArtifacts (as applicable) by choosing block variants/props that trigger them.
- If content is missing, use short placeholders derived from brandName/title in CONTENT_SUMMARY_JSON; do NOT invent new products.

Return JSON ONLY:
{
  "styleId": string,
  "presetTokens": { ...copied from style.tokens... },
  "typography": { "pairingId": string, "scaleId": string },
  "blocks": [
    { "type": string, "variant": string, "props": object },
    { ... },
    { ... },
    { ... }
  ]
}

SELECTED_STYLE_ID:
${styleId}

CONTENT_SUMMARY_JSON:
${contentSummaryJson}

BLOCK_CATALOG_JSON:
${blockCatalogJson}

STYLE_LIBRARY_JSON:
${styleLibraryJson}`;
}

// ---- Template C — layoutPlanPrompt -----------------------------------------

export function layoutPlanPrompt(
  styleId: string,
  observationsJson: string,
  contentSummaryJson: string,
  blockCatalogJson: string,
  styleLibraryJson: string,
  dnaJson?: string,
): string {
  const dnaConstraints = dnaJson ? `

LAYOUT_DNA_CONSTRAINTS (MUST follow these exactly — they override general constraints):
${dnaJson}
- The hero block MUST be the type and variant specified in the DNA.
- You MUST include ALL requiredBlocks from the DNA.
- You MUST NOT include ANY forbiddenBlocks from the DNA.
- You MUST use the layout patterns specified in requiredPatterns.
- Block count MUST be within the DNA's blockCount range.
- Follow the structureHint for overall page composition.` : '';

  const nonce = Math.random().toString(36).slice(2, 10);
  return `Create a layout plan for a single-page marketing site. We only care about DESIGN quality and composition.

VARIATION_SEED: ${nonce}
Use this seed as creative inspiration — choose different block types, variant combinations, and layout patterns each time. Prioritize variety and surprise.

Constraints:
- You MUST follow the selected style definition exactly.
- You MUST satisfy style.constraints.requiredPatterns.
- You MUST avoid style.constraints.forbiddenPatterns.
- You MUST use at least style.wrappers.minDistinctWrappers distinct wrappers across sections.
- You MUST include at least 6 blocks and at most 9 blocks.
- Prefer blocks listed in style.blockBias.preferred; avoid style.blockBias.avoid.
- You MUST ensure diversity: include at least 3 distinct layout patterns (choose from: bento, zigzag, band, timeline, comparison, editorial-quote, data-viz).
- Do NOT output actual HTML.
${dnaConstraints}

Return JSON ONLY:
{
  "styleId": string,
  "sectionWrappers": [ { "index": number, "wrapper": string } ],
  "layoutPatterns": string[],
  "blocks": [
    { "type": string, "variant": string, "rationale": string (max 1 sentence) }
  ],
  "ctaStrategy": { "primaryPlacement": string, "secondaryAllowed": boolean }
}

SELECTED_STYLE_ID:
${styleId}

OBSERVATIONS_JSON:
${observationsJson}

CONTENT_SUMMARY_JSON:
${contentSummaryJson}

BLOCK_CATALOG_JSON:
${blockCatalogJson}

STYLE_LIBRARY_JSON:
${styleLibraryJson}`;
}

// ---- Template D — finalSchemaPrompt ----------------------------------------

export function finalSchemaPrompt(
  styleId: string,
  layoutPlanJson: string,
  contentSummaryJson: string,
  blockCatalogJson: string,
  styleLibraryJson: string,
  dnaJson?: string,
): string {
  const dnaConstraints = dnaJson ? `
- LAYOUT DNA ACTIVE: The hero block type/variant, required blocks, and forbidden blocks from the DNA MUST be preserved exactly as specified in the layout plan. Do NOT change the hero type or variant.
DNA: ${dnaJson}` : '';

  const nonce = Math.random().toString(36).slice(2, 10);
  return `Generate the final PageSchema for rendering. This is design-first: composition, typography, wrappers, and signature artifacts matter most.

VARIATION_SEED: ${nonce}
Write fresh, creative content for each block. Vary phrasing, word choice, and structural emphasis. Do NOT reuse phrasing from previous generations.

Hard rules:
- Use ONLY tokens/typography from the selected style.tokens and its font pairing + type scale.
- Do NOT invent colors, fonts, spacing, or wrappers outside the style definition.
- Use ONLY blocks/variants in the catalog.
- Must satisfy ALL style.constraints.requiredPatterns.
- Must avoid ALL style.constraints.forbiddenPatterns.
- Ensure wrappers meet style.wrappers.minDistinctWrappers.
- Include required signatureArtifacts by selecting variants/props that make them appear.
- Keep CTA rules: style.constraints.ctaRules.maxPrimaryAboveFold.
${dnaConstraints}

Return JSON ONLY:
{
  "styleId": string,
  "tokens": {
    "mode": "light|dark",
    "containerMaxWidth": number,
    "radius": { "card": number, "button": number, "input": number },
    "shadow": { "card": string, "hover": string },
    "border": { "width": number, "style": string },
    "palette": { "bg": string, "surface": string, "surface2": string, "text": string, "mutedText": string, "border": string, "primary": string, "primaryHover": string, "accent": string, "accent2": string },
    "spacing": { "density": "tight|normal|loose", "sectionY": number, "sectionYMobile": number, "gutterX": number, "gutterXMobile": number },
    "typography": { "pairingId": string, "scaleId": string }
  },
  "sectionWrappers": [ { "index": number, "wrapper": string } ],
  "blocks": [
    { "type": string, "variant": string, "props": object }
  ],
  "signatureFlags": { "backgroundMotif": string[], "separators": string[], "microElements": string[] }
}

SELECTED_STYLE_ID:
${styleId}

LAYOUT_PLAN_JSON:
${layoutPlanJson}

CONTENT_SUMMARY_JSON:
${contentSummaryJson}

BLOCK_CATALOG_JSON:
${blockCatalogJson}

STYLE_LIBRARY_JSON:
${styleLibraryJson}`;
}

// ---- Template E — schemaRepairPrompt ---------------------------------------

export function schemaRepairPrompt(
  validationErrors: string,
  invalidSchemaJson: string,
  blockCatalogJson: string,
  styleLibraryJson: string,
): string {
  return `The PageSchema JSON failed validation. Fix it.

Rules:
- Keep styleId and selected style tokens exactly as provided.
- Do NOT add new blocks not in the catalog.
- Do NOT invent new tokens/fonts/colors/wrappers.
- Only correct structure/required props/variants.

Return corrected PageSchema JSON ONLY.

VALIDATION_ERRORS:
${validationErrors}

INVALID_SCHEMA_JSON:
${invalidSchemaJson}

BLOCK_CATALOG_JSON:
${blockCatalogJson}

STYLE_LIBRARY_JSON:
${styleLibraryJson}`;
}

// ---- Template F — qaPatchApplyPrompt ---------------------------------------

export function qaPatchApplyPrompt(
  pageSchemaJson: string,
  qaPatchJson: string,
  blockCatalogJson: string,
  styleLibraryJson: string,
): string {
  return `Apply the QAPatch to the PageSchema while preserving the selected style.

Rules:
- You MUST keep styleId unchanged.
- You MUST keep tokens exactly as-is (no palette/font changes).
- You MAY adjust: sectionWrappers, block order, block variants, block props, and insert/remove blocks (only from catalog).
- You MUST still satisfy style.requiredPatterns and avoid style.forbiddenPatterns.
- If QAPatch requests something outside constraints, implement the closest allowed alternative.

Return updated PageSchema JSON ONLY.

PAGE_SCHEMA_JSON:
${pageSchemaJson}

QA_PATCH_JSON:
${qaPatchJson}

BLOCK_CATALOG_JSON:
${blockCatalogJson}

STYLE_LIBRARY_JSON:
${styleLibraryJson}`;
}
