export interface RecraftAsset {
  url: string;
  type: 'hero' | 'icon';
}

interface GenerateOptions {
  prompt: string;
  model: 'recraftv3' | 'recraftv2';
  style: string;
  size?: string;
}

async function generate(options: GenerateOptions): Promise<string> {
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
        prompt: options.prompt,
        model: options.model,
        style: options.style,
        size: options.size || '1024x1024',
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

  return `data:image/svg+xml;base64,${b64}`;
}

export async function generateHeroIllustration(
  brandName: string,
  mood: string,
  siteType: string
): Promise<string> {
  const prompt = `Modern ${mood} hero illustration for a ${siteType} website called "${brandName}". Abstract, professional, clean design with subtle gradients. No text.`;

  return generate({
    prompt,
    model: 'recraftv3',
    style: 'vector_illustration',
    size: '1536x1024',
  });
}

export async function generateFeatureIcon(
  subject: string,
  mood: string
): Promise<string> {
  const prompt = `Simple, clean ${mood} icon representing "${subject}". Minimal, flat design. No text, no background.`;

  return generate({
    prompt,
    model: 'recraftv2',
    style: 'icon',
    size: '1024x1024',
  });
}

export async function generateAssets(
  brandName: string,
  mood: string,
  siteType: string,
  iconSubjects: string[] = []
): Promise<{ heroImage?: string; icons: string[] }> {
  const apiKey = process.env.RECRAFT_API_KEY;
  if (!apiKey) return { icons: [] };

  try {
    // Hero: Recraft V3 Vector
    const heroImage = await generateHeroIllustration(brandName, mood, siteType);

    // Feature icons: Recraft V2 Vector (parallel, up to 3)
    const subjects = iconSubjects.slice(0, 3);
    const icons = await Promise.all(
      subjects.map((subject) => generateFeatureIcon(subject, mood))
    ).catch(() => [] as string[]);

    return { heroImage, icons };
  } catch (error) {
    console.error('Recraft generation failed:', error);
    return { icons: [] };
  }
}
