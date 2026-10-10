import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

app.use(express.json());

const backendApiUrl = process.env.BACKEND_API_URL || 'http://127.0.0.1:8000';
app.use('/api/v1', async (req, res) => {
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value && !['host', 'connection', 'content-length', 'expect', 'transfer-encoding'].includes(key.toLowerCase())) {
        headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
    }
    const method = req.method.toUpperCase();
    const upstream = await fetch(`${backendApiUrl}${req.originalUrl}`, {
      method,
      headers,
      body: ['GET', 'HEAD'].includes(method) ? undefined : JSON.stringify(req.body ?? {}),
      redirect: 'manual',
    });
    res.status(upstream.status);
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('content-type', contentType);
    const cookies = upstream.headers.getSetCookie?.() ?? [];
    if (cookies.length) res.setHeader('set-cookie', cookies);
    const body = Buffer.from(await upstream.arrayBuffer());
    res.send(body);
  } catch (error) {
    console.error('FastAPI proxy request failed:', error);
    res.status(502).json({ detail: 'Backend API is unavailable', code: 'backend_unavailable' });
  }
});

app.get('/api/weather-advisories', async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(503).json({ success: false, error: 'AI advisories are not configured. Core Monstera features do not require GEMINI_API_KEY.' });
      return;
    }
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    const location = (req.query.location as string) || 'New Delhi, India';
    const prompt = `Search the web for today's current real-time local weather, air quality index, pollen count, and particulate matter (PM2.5 / PM10) advisories or smog warnings for ${location}.
Provide a concise, practical bulletin covering:
1. Particulate & Pollen Alert Level (e.g. Severe Particulate Inversion, Elevated Tree Pollen, Moderate)
2. Dominant airborne triggers (e.g., surface inversion smog, fine PM2.5 soot, dust resuspension, grass/weed pollen)
3. Immediate health recommendation for morning/evening commuters and sensitive individuals.
Keep the summary clean, punchy, formatted in 3 crisp bullet points, under 140 words total.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const text = response.text || 'No active particulate or pollen advisory found.';
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

    const sources = groundingChunks
      .map((chunk: any) => chunk?.web)
      .filter((web: any) => web && web.uri)
      .map((web: any) => ({
        title: web.title || 'Live Weather / Air Quality Report',
        uri: web.uri,
      }))
      // Deduplicate sources by URL
      .filter((item: any, idx: number, arr: any[]) => arr.findIndex((t: any) => t.uri === item.uri) === idx);

    res.json({
      success: true,
      location,
      advisory: text,
      sources,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error fetching search grounded advisories:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to fetch weather advisories',
    });
  }
});

const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  if (!isProduction) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on all network interfaces. Open http://localhost:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
