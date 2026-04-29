import axios from 'axios';
import { load } from 'cheerio';

// Vercel serverless function — mirrors the /api/fetch-url route in server.ts
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
      timeout: 10000,
    });

    const $ = load(response.data);
    $('script, style, nav, footer, iframe, noscript').remove();

    const title = $('title').text() || $('h1').first().text() || 'Web Material';
    const bodyText = $('body').text();
    const cleanHtml = $('body').html() || '';

    res.json({ title, content: bodyText, html: cleanHtml });
  } catch (error: any) {
    console.error('Fetch URL error:', error.message);
    res
      .status(500)
      .json({ error: 'Failed to fetch URL content. Check if the URL is valid and accessible.' });
  }
}
