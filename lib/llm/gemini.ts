import { GoogleGenerativeAI } from '@google/generative-ai';
import { DesignDirectionBrief, DesignDirectionBriefSchema } from '@/lib/catalog/schemas';
import { geminiDesignPrompt } from './prompts';

export async function analyzeDesign(
  desktopScreenshot: string,
  mobileScreenshot: string,
  context: { title: string; description: string; brandName: string }
): Promise<DesignDirectionBrief> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.4,
    },
  });

  const result = await model.generateContent([
    { text: geminiDesignPrompt(context) },
    {
      inlineData: {
        mimeType: 'image/png',
        data: desktopScreenshot,
      },
    },
    {
      inlineData: {
        mimeType: 'image/png',
        data: mobileScreenshot,
      },
    },
  ]);

  const text = result.response.text();
  const json = JSON.parse(text);
  return DesignDirectionBriefSchema.parse(json);
}
