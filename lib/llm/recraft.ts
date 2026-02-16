export interface RecraftAsset {
  url: string;
  type: 'hero' | 'icon';
}

export async function generateIllustration(
  prompt: string,
  style: 'digital_illustration' | 'icon' = 'digital_illustration',
  size: string = '1024x1024'
): Promise<string> {
  const apiKey = process.env.RECRAFT_API_KEY;
  if (!apiKey) throw new Error('RECRAFT_API_KEY not set');

  const response = await fetch(
    'https://external.api.recraft.ai/v1/images/generations',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        prompt,
        style,
        model: 'recraftv3',
        size,
        response_format: 'b64_json',
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Recraft API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('Recraft returned no image data');

  return `data:image/png;base64,${b64}`;
}

export async function generateAssets(
  brandName: string,
  mood: string,
  siteType: string
): Promise<{ heroImage?: string; icons: string[] }> {
  const apiKey = process.env.RECRAFT_API_KEY;
  if (!apiKey) return { icons: [] };

  try {
    const heroPrompt = `Modern ${mood} hero illustration for a ${siteType} website called "${brandName}". Abstract, professional, clean design with subtle gradients. No text.`;
    const heroImage = await generateIllustration(heroPrompt, 'digital_illustration', '1536x1024');

    return { heroImage, icons: [] };
  } catch (error) {
    console.error('Recraft generation failed:', error);
    return { icons: [] };
  }
}
