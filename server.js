import express from 'express';
import { JSDOM } from 'jsdom';
import * as csstree from 'css-tree';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    // Always serve dev HTML/CSS fresh so changes show on refresh
    res.setHeader('Cache-Control', 'no-cache');
  },
}));

// ── Helpers ──────────────────────────────────────────

function absolutize(url, base) {
  try { return new URL(url, base).href; } catch { return null; }
}

async function fetchPage(targetUrl) {
  const resp = await axios.get(targetUrl, {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; GetDesign/1.0)',
      'Accept': 'text/html,*/*',
    },
    maxRedirects: 5,
    responseType: 'text',
  });
  return { html: resp.data, finalUrl: resp.request?.res?.responseUrl || targetUrl };
}

async function fetchCSS(href) {
  try {
    const resp = await axios.get(href, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GetDesign/1.0)' },
      responseType: 'text',
    });
    return resp.data;
  } catch { return ''; }
}

// ── CSS Extraction ───────────────────────────────────

function extractCSSData(rawCSS) {
  const result = {
    variables: {},
    colors: new Set(),
    fonts: new Set(),
    fontSizes: new Set(),
    spacing: new Set(),
    radii: new Set(),
    shadows: new Set(),
    mediaQueries: [],
    keyframes: [],
    selectors: [],
    rawDeclarations: [],
  };

  let ast;
  try {
    ast = csstree.parse(rawCSS, { parseCustomProperty: true, positions: false });
  } catch { return result; }

  csstree.walk(ast, {
    visit: 'Rule',
    enter(node) {
      if (node.type === 'Atrule') {
        if (node.name === 'media' && node.prelude) {
          result.mediaQueries.push(csstree.generate(node.prelude));
        }
        if (node.name === 'keyframes' && node.prelude) {
          result.keyframes.push(csstree.generate(node.prelude));
        }
        return;
      }
      if (node.type !== 'Rule' || !node.prelude) return;
      const sel = csstree.generate(node.prelude);
      if (!node.block) return;

      const decls = [];
      csstree.walk(node.block, {
        visit: 'Declaration',
        enter(declNode) {
          const prop = declNode.property;
          const val = csstree.generate(declNode.value);
          decls.push({ prop, val });

          if (prop.startsWith('--')) {
            result.variables[prop] = val;
          }

          if (/color|background|border|fill|stroke|shadow/i.test(prop)) {
            const colorMatch = val.match(/#[0-9a-fA-F]{3,8}\b/g);
            if (colorMatch) colorMatch.forEach(c => result.colors.add(c.toLowerCase()));
            const rgbMatch = val.match(/rgba?\([^)]+\)/g);
            if (rgbMatch) rgbMatch.forEach(c => result.colors.add(c));
            const hslMatch = val.match(/hsla?\([^)]+\)/g);
            if (hslMatch) hslMatch.forEach(c => result.colors.add(c));
          }

          if (prop === 'font-family') {
            val.split(',').forEach(f => {
              const clean = f.trim().replace(/['"]/g, '');
              if (clean && !['inherit', 'initial', 'unset', 'serif', 'sans-serif', 'monospace'].includes(clean)) {
                result.fonts.add(clean);
              }
            });
          }

          if (prop === 'font-size') result.fontSizes.add(val);
          if (/^(padding|margin|gap|row-gap|column-gap)/.test(prop)) result.spacing.add(val);
          if (prop === 'border-radius') result.radii.add(val);
          if (prop === 'box-shadow' || prop === 'text-shadow') result.shadows.add(val);
        },
      });

      result.selectors.push({ selector: sel, declarations: decls });
      result.rawDeclarations.push(...decls);
    },
  });

  return result;
}

function buildSummary(data) {
  return {
    colorCount: data.colors.size,
    fontCount: data.fonts.size,
    variableCount: Object.keys(data.variables).length,
    selectorCount: data.selectors.length,
    topColors: [...data.colors].slice(0, 20),
    fonts: [...data.fonts],
    fontSizes: [...data.fontSizes].slice(0, 15),
    radii: [...data.radii].slice(0, 10),
    variables: Object.fromEntries(Object.entries(data.variables).slice(0, 60)),
    mediaQueries: data.mediaQueries.slice(0, 10),
    spacingSamples: [...data.spacing].slice(0, 15),
    shadowSamples: [...data.shadows].slice(0, 5),
  };
}

// ── Gemini AI ────────────────────────────────────────

async function callGemini(systemPrompt, userPrompt) {
  if (!GEMINI_KEY) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;

  try {
    const resp = await axios.post(
      url,
      {
        system_instruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 8000,
        },
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000,
      },
    );

    const text = resp.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.error('Gemini: empty response', JSON.stringify(resp.data).slice(0, 300));
      return null;
    }
    console.log(`[gemini] used model: ${GEMINI_MODEL}`);
    return text;
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data?.error?.message || err.response?.data?.error || err.message;
    console.error(`Gemini error [${status}]:`, body);
    return null;
  }
}

// ── API Routes ───────────────────────────────────────

app.post('/api/scan', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    if (url === '__health__') {
      return res.json({ ok: true, gemini: !!GEMINI_KEY, model: GEMINI_MODEL });
    }

    let targetUrl = url.trim();
    if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;

    console.log(`[scan] ${targetUrl}`);

    const { html, finalUrl } = await fetchPage(targetUrl);
    const dom = new JSDOM(html, { url: finalUrl });
    const doc = dom.window.document;

    const stylesheetUrls = [];
    doc.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
      const href = link.getAttribute('href');
      if (href) {
        const abs = absolutize(href, finalUrl);
        if (abs) stylesheetUrls.push(abs);
      }
    });

    let inlineCSS = '';
    doc.querySelectorAll('style').forEach(styleEl => {
      inlineCSS += '\n' + (styleEl.textContent || '');
    });

    const externalCSSChunks = await Promise.all(
      stylesheetUrls.slice(0, 15).map(u => fetchCSS(u)),
    );

    const allCSS = externalCSSChunks.join('\n') + '\n' + inlineCSS;
    const data = extractCSSData(allCSS);
    const summary = buildSummary(data);
    const pageTitle = doc.querySelector('title')?.textContent?.trim() || new URL(finalUrl).hostname;
    const pageDesc = doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim()
      || doc.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim()
      || '';

    res.json({
      ok: true,
      url: finalUrl,
      title: pageTitle,
      description: pageDesc,
      stylesheetsFound: stylesheetUrls.length,
      summary,
      rawCSSPreview: allCSS.slice(0, 8000),
    });
  } catch (err) {
    console.error('[scan error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/generate', async (req, res) => {
  try {
    const { url, title, summary, rawCSS, format } = req.body;

    if (!GEMINI_KEY) {
      return res.status(400).json({
        error: 'GEMINI_API_KEY not set. Add it to .env to enable AI generation.',
      });
    }

    const formatInstr = format === 'readme'
      ? `Generate a README.md suitable for a design-system reference project. Include sections: Overview, Colors, Typography, Spacing, Components, Usage Notes.`
      : `Generate a DESIGN.md file with these exact sections:
1. Visual Theme & Atmosphere
2. Color Palette & Roles (table format)
3. Typography Rules (table format)
4. Component Stylings (buttons, cards, inputs, navigation)
5. Layout Principles (spacing, grid, whitespace)
6. Depth & Elevation
7. Do's and Don'ts
8. Agent Prompt Guide (quick reference for AI models)`;

    const system = `You are a design-system documentation expert. Write precise, structured Markdown. Use tables where appropriate. Be concise but thorough. Output ONLY the Markdown document — no preamble, no code fences.`;

    const user = `Source URL: ${url}
Page title: ${title}

Extracted CSS data:
- ${summary.colorCount} unique colors found
- ${summary.fontCount} font families: ${summary.fonts.join(', ')}
- ${summary.fontSizes.length} font sizes: ${summary.fontSizes.join(', ')}
- ${summary.variableCount} CSS custom properties
- ${summary.radii.length} border-radius values: ${summary.radii.join(', ')}
- ${summary.mediaQueries.length} media queries

Top colors: ${summary.topColors.join(', ')}
Spacing samples: ${summary.spacingSamples.join(', ')}
Shadow samples: ${summary.shadowSamples.join(', ')}

CSS variables (sample):
${Object.entries(summary.variables).slice(0, 30).map(([k, v]) => `${k}: ${v}`).join('\n')}

Raw CSS excerpt (first 4000 chars):
${(rawCSS || '').slice(0, 4000)}

${formatInstr}`;

    const result = await callGemini(system, user);
    if (!result) return res.status(500).json({ error: 'Gemini API call failed' });

    res.json({ ok: true, content: result });
  } catch (err) {
    console.error('[generate error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/audit-css', async (req, res) => {
  try {
    const { rawCSS } = req.body;

    if (!GEMINI_KEY) {
      return res.status(400).json({ error: 'GEMINI_API_KEY not set.' });
    }

    const system = `You are a CSS audit expert. Clean and organize the provided CSS. Output ONLY the cleaned CSS — no explanation, no code fences. Deduplicate rules, preserve custom properties, group by category (reset, layout, components, utilities).`;

    const user = `Audit and clean this CSS. Remove duplicates, preserve custom properties and media queries, group logically:\n\n${(rawCSS || '').slice(0, 6000)}`;

    const result = await callGemini(system, user);
    if (!result) return res.status(500).json({ error: 'Gemini API call failed' });

    res.json({ ok: true, content: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`GetDesign running → http://localhost:${PORT}`);
  console.log(`Gemini model: ${GEMINI_MODEL}`);
  console.log(`Gemini API key: ${GEMINI_KEY ? '✓ loaded' : '✗ missing (AI features disabled)'}`);
});
