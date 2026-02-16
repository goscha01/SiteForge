import * as cheerio from 'cheerio';
import { ExtractedContent } from '@/lib/catalog/schemas';

export async function extractContent(url: string): Promise<ExtractedContent> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(15000),
  });

  const html = await response.text();
  const $ = cheerio.load(html);

  // Remove noise elements
  $('script, style, noscript, svg, iframe, link, meta[name="viewport"]').remove();

  const headings = $('h1, h2, h3')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
    .slice(0, 30);

  const paragraphs = $('p')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((t) => t.length > 40)
    .slice(0, 30);

  const navItems = $('nav a, header a')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((t) => t.length > 0 && t.length < 50);

  const ctaTexts = $('a.btn, button, [class*="cta"], [class*="button"], [class*="btn"]')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((t) => t.length > 0 && t.length < 60);

  const testimonials = $('[class*="testimonial"], [class*="review"], blockquote')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((t) => t.length > 20)
    .slice(0, 10);

  const faqItems: { question: string; answer: string }[] = [];
  $('details').each((_, el) => {
    const question = $(el).find('summary').text().trim();
    const answer = $(el).clone().children('summary').remove().end().text().trim();
    if (question && answer) {
      faqItems.push({ question, answer });
    }
  });

  const brandName =
    $('meta[property="og:site_name"]').attr('content') ||
    $('title').text().split(/[-|–—]/)[0].trim() ||
    'Website';

  const contactInfo =
    $('a[href^="mailto:"]').first().attr('href')?.replace('mailto:', '') ||
    $('a[href^="tel:"]').first().attr('href')?.replace('tel:', '') ||
    undefined;

  return {
    title: $('title').text().trim() || '',
    description: $('meta[name="description"]').attr('content') || '',
    headings,
    paragraphs,
    navItems: [...new Set(navItems)].slice(0, 15),
    ctaTexts: [...new Set(ctaTexts)].slice(0, 10),
    testimonials,
    faqItems: faqItems.slice(0, 10),
    brandName,
    contactInfo,
  };
}
