import Anthropic from '@anthropic-ai/sdk';
import {
  PageSchema,
  PageSchemaOutput,
  DesignDirectionBrief,
  ExtractedContent,
} from '@/lib/catalog/schemas';
import { BLOCK_CATALOG } from '@/lib/catalog/blocks';
import { claudeSchemaPrompt, claudeRepairPrompt } from './prompts';

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  return new Anthropic({ apiKey });
}

function extractJson(text: string): string {
  // Strip markdown code fences if present
  return text
    .replace(/^```(?:json)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim();
}

export async function generateBlockSchema(
  direction: DesignDirectionBrief,
  content: ExtractedContent
): Promise<PageSchema> {
  const client = getClient();

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: claudeSchemaPrompt(direction, content, BLOCK_CATALOG),
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude returned no text content');
  }

  const jsonStr = extractJson(textBlock.text);
  return PageSchemaOutput.parse(JSON.parse(jsonStr));
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
