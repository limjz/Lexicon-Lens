import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import { load } from "cheerio";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API to fetch URL content
  app.post("/api/fetch-url", async (req, res) => {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        timeout: 10000
      });

      const $ = load(response.data);
      
      // Basic extraction: get main content areas
      // Remove scripts, styles, nav, footer to clean up for AI
      $('script, style, nav, footer, iframe, noscript').remove();
      
      const title = $('title').text() || $('h1').first().text() || "Web Material";
      const bodyText = $('body').text();
      
      // Also return the raw-ish cleaned HTML for Gemini to process better
      const cleanHtml = $('body').html() || "";

      res.json({ 
        title,
        content: bodyText,
        html: cleanHtml
      });
    } catch (error: any) {
      console.error("Fetch URL error:", error.message);
      res.status(500).json({ error: "Failed to fetch URL content. Check if the URL is valid and accessible." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
