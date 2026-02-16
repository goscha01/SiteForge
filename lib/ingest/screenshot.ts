export interface Screenshots {
  desktop: string; // base64 PNG
  mobile: string;  // base64 PNG
}

export async function captureScreenshots(url: string): Promise<Screenshots> {
  const provider = process.env.SCREENSHOT_PROVIDER || 'playwright';

  if (provider === 'screenshotone') {
    return captureViaScreenshotOne(url);
  }
  return captureViaPlaywright(url);
}

async function captureViaPlaywright(url: string): Promise<Screenshots> {
  const isDev = process.env.NODE_ENV === 'development';

  let browser;

  if (isDev) {
    // In development, use locally installed Playwright
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch({ headless: true });
  } else {
    // In production (serverless), use @sparticuz/chromium
    const chromium = await import('@sparticuz/chromium');
    const { chromium: playwrightChromium } = await import('playwright-core');
    browser = await playwrightChromium.launch({
      args: chromium.default.args,
      executablePath: await chromium.default.executablePath(),
      headless: true,
    });
  }

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Desktop screenshot
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    // Wait a bit for animations/lazy content
    await page.waitForTimeout(1000);
    const desktopBuffer = await page.screenshot({
      fullPage: true,
      type: 'png',
      // Limit height to prevent huge images
      clip: { x: 0, y: 0, width: 1440, height: Math.min(await page.evaluate(() => document.body.scrollHeight), 4000) },
    });

    // Mobile screenshot
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000);
    const mobileBuffer = await page.screenshot({
      fullPage: true,
      type: 'png',
      clip: { x: 0, y: 0, width: 390, height: Math.min(await page.evaluate(() => document.body.scrollHeight), 4000) },
    });

    await context.close();

    return {
      desktop: desktopBuffer.toString('base64'),
      mobile: mobileBuffer.toString('base64'),
    };
  } finally {
    await browser.close();
  }
}

async function captureViaScreenshotOne(url: string): Promise<Screenshots> {
  const apiKey = process.env.SCREENSHOTONE_API_KEY;
  if (!apiKey) throw new Error('SCREENSHOTONE_API_KEY not set');

  const baseUrl = 'https://api.screenshotone.com/take';

  async function capture(viewportWidth: number, viewportHeight: number): Promise<string> {
    const params = new URLSearchParams({
      access_key: apiKey!,
      url,
      viewport_width: String(viewportWidth),
      viewport_height: String(viewportHeight),
      full_page: 'true',
      full_page_max_height: '4000',
      format: 'png',
      block_ads: 'true',
      delay: '2',
    });

    const response = await fetch(`${baseUrl}?${params}`);
    if (!response.ok) {
      throw new Error(`ScreenshotOne API error: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.toString('base64');
  }

  const [desktop, mobile] = await Promise.all([
    capture(1440, 900),
    capture(390, 844),
  ]);

  return { desktop, mobile };
}
