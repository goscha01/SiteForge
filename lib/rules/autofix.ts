import { PageSchema } from '@/lib/catalog/schemas';
import { validatePageSchema, ValidationResult } from './validate';
import { repairSchema } from '@/lib/llm/claude';

export async function validateAndAutofix(
  rawSchema: unknown
): Promise<{ schema: PageSchema; warnings: string[] }> {
  // First validation attempt
  let result = validatePageSchema(rawSchema);

  if (result.valid && result.data) {
    return { schema: result.data, warnings: result.warnings };
  }

  // If invalid, try Claude repair (single attempt)
  console.log('Schema validation failed, attempting repair...', result.errors);

  const repaired = await repairSchema(
    JSON.stringify(rawSchema, null, 2),
    result.errors
  );

  // Validate the repaired schema
  result = validatePageSchema(repaired);

  if (result.valid && result.data) {
    return {
      schema: result.data,
      warnings: [...result.warnings, 'Schema was auto-repaired by Claude.'],
    };
  }

  // If repair also fails, throw with details
  throw new Error(
    `Schema validation failed after repair attempt. Errors: ${result.errors.join('; ')}`
  );
}
