import Anthropic from '@anthropic-ai/sdk';
import {
  PageSchemaV2,
  PageSchemaV2Output,
  PageSchema,
  PageSchemaOutput,
  LayoutPlanV2,
  ExtractedContent,
  // V3 types
  StyleSelectionItem,
  StyleSelectionSchema,
  PreviewSchema,
  PreviewSchemaOutput,
  LayoutPlanV3,
  LayoutPlanV3Schema,
  FinalPageSchema,
  FinalPageSchemaOutput,
  GeminiObservations,
  Block,
  BlockSchema,
} from '@/lib/catalog/schemas';
import { BLOCK_CATALOG } from '@/lib/catalog/blocks';
import { claudeContentPrompt, claudeRepairPrompt } from './prompts';
import {
  styleSelectionPrompt,
  previewSchemaPrompt,
  layoutPlanPrompt,
  finalSchemaPrompt,
  schemaRepairPrompt as schemaRepairPromptV3,
  qaPatchApplyPrompt,
  STYLE_SELECTION_SYSTEM,
  PREVIEW_SCHEMA_SYSTEM,
  LAYOUT_PLAN_SYSTEM,
  FINAL_SCHEMA_SYSTEM,
  SCHEMA_REPAIR_SYSTEM,
  QA_PATCH_APPLY_SYSTEM,
} from './promptsV2';
import { loadStyleLibrary } from '@/lib/design/loadStyleLibrary';

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  return new Anthropic({ apiKey });
}

function extractJson(text: string): string {
  return text
    .replace(/^```(?:json)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim();
}

export async function generateBlockSchema(
  layoutPlan: LayoutPlanV2,
  content: ExtractedContent
): Promise<PageSchemaV2> {
  const client = getClient();

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: claudeContentPrompt(layoutPlan, content, BLOCK_CATALOG),
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude returned no text content');
  }

  const jsonStr = extractJson(textBlock.text);
  return PageSchemaV2Output.parse(JSON.parse(jsonStr));
}

export async function repairSchema(
  rawJson: string,
  errors: string[]
): Promise<PageSchema> {
  const client = getClient();

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: claudeRepairPrompt(rawJson, errors),
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude repair returned no text content');
  }

  const jsonStr = extractJson(textBlock.text);
  return PageSchemaOutput.parse(JSON.parse(jsonStr));
}

// ---------------------------------------------------------------------------
// V3 helpers & service functions
// ---------------------------------------------------------------------------

async function callClaude(system: string, userMessage: string, temperature?: number): Promise<string> {
  const client = getClient();
  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    temperature: temperature ?? 0.7,
    system,
    messages: [{ role: 'user', content: userMessage }],
  });
  const textBlock = message.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude returned no text content');
  }
  return extractJson(textBlock.text);
}

function getStyleLibraryJson(): string {
  return JSON.stringify(loadStyleLibrary());
}

function getBlockCatalogJson(): string {
  return JSON.stringify(BLOCK_CATALOG);
}

export function flattenBlocks(blocks: Array<{ type: string; variant: string; props: Record<string, unknown> }>): Block[] {
  return blocks.map((b) => {
    const flat = { type: b.type, variant: b.variant, ...b.props };
    return BlockSchema.parse(flat);
  });
}

// ---------------------------------------------------------------------------
// V3 service functions
// ---------------------------------------------------------------------------

export async function selectStyles(
  observations: GeminiObservations
): Promise<StyleSelectionItem[]> {
  const json = await callClaude(
    STYLE_SELECTION_SYSTEM,
    styleSelectionPrompt(JSON.stringify(observations), getStyleLibraryJson())
  );
  return StyleSelectionSchema.parse(JSON.parse(json));
}

export async function generatePreviewSchema(
  styleId: string,
  content: ExtractedContent
): Promise<PreviewSchema> {
  const json = await callClaude(
    PREVIEW_SCHEMA_SYSTEM,
    previewSchemaPrompt(styleId, JSON.stringify(content), getBlockCatalogJson(), getStyleLibraryJson()),
    0.9,
  );
  return PreviewSchemaOutput.parse(JSON.parse(json));
}

export async function generateLayoutPlanV3(
  styleId: string,
  observations: GeminiObservations,
  content: ExtractedContent,
  dnaJson?: string,
): Promise<LayoutPlanV3> {
  const json = await callClaude(
    LAYOUT_PLAN_SYSTEM,
    layoutPlanPrompt(styleId, JSON.stringify(observations), JSON.stringify(content), getBlockCatalogJson(), getStyleLibraryJson(), dnaJson),
    0.9,
  );
  return LayoutPlanV3Schema.parse(JSON.parse(json));
}

export async function generateFinalSchema(
  styleId: string,
  layoutPlan: LayoutPlanV3,
  content: ExtractedContent,
  dnaJson?: string,
): Promise<FinalPageSchema> {
  const json = await callClaude(
    FINAL_SCHEMA_SYSTEM,
    finalSchemaPrompt(styleId, JSON.stringify(layoutPlan), JSON.stringify(content), getBlockCatalogJson(), getStyleLibraryJson(), dnaJson),
    0.85,
  );
  return FinalPageSchemaOutput.parse(JSON.parse(json));
}

export async function repairSchemaV3(
  invalidSchema: string,
  errors: string[]
): Promise<FinalPageSchema> {
  const json = await callClaude(
    SCHEMA_REPAIR_SYSTEM,
    schemaRepairPromptV3(errors.join('\n'), invalidSchema, getBlockCatalogJson(), getStyleLibraryJson()),
    0.2,
  );
  return FinalPageSchemaOutput.parse(JSON.parse(json));
}

export async function applyQAPatchClaude(
  schema: string,
  qaPatch: string
): Promise<FinalPageSchema> {
  const json = await callClaude(
    QA_PATCH_APPLY_SYSTEM,
    qaPatchApplyPrompt(schema, qaPatch, getBlockCatalogJson(), getStyleLibraryJson()),
    0.2,
  );
  return FinalPageSchemaOutput.parse(JSON.parse(json));
}
