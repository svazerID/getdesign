# GetDesign

Extract design systems from any website — colors, typography, CSS custom properties, spacing, radii, and shadows — then generate structured documentation with AI.

## Features

- **URL Scanner** — paste any public URL and automatically fetch its HTML and stylesheets (external + inline CSS).
- **CSS Extraction** — parses CSS with `css-tree` and surfaces:
  - Colors (hex / rgb / hsl)
  - Font families & font sizes
  - CSS custom properties (`--variables`)
  - Spacing values (padding, margin, gap)
  - Border radii, box/text shadows
  - Media queries & keyframes
- **AI Generation** (requires Gemini API key):
  - `DESIGN.md` — full design-system reference
  - `README.md` — design-system doc for a reference project
  - CSS Audit — deduplicated, grouped, cleaned CSS
- **Downloadable output** — DESIGN.md, audit CSS, and raw extracted CSS.

## Tech Stack

- **Backend:** Node.js + Express
- **Parsing:** `css-tree`, `jsdom`, `axios`
- **AI:** Google Gemini (`generativelanguage.googleapis.com`)
- **Frontend:** static HTML/CSS/JS in `public/`

## Getting Started

### Prerequisites

- Node.js 18+
- A Google Gemini API key (for AI features only — the scanner works without it)

### Install

```bash
npm install
```

### Configure

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

```ini
# Get your key at https://aistudio.google.com/apikey
GEMINI_API_KEY=AIzaSy…xxxx

# Model name (gemini-2.5-flash, gemini-2.0-flash, etc.)
GEMINI_MODEL=gemini-2.5-flash

# Server port
PORT=3000
```

> AI generation features are disabled until `GEMINI_API_KEY` is set. The scanner/extraction still works without it.

### Run

```bash
# production
npm start

# development (auto-reload)
npm run dev
```

Open http://localhost:3000 and paste a URL to scan.

## API

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/api/scan` | Fetch a URL and return extracted CSS data + summary. Body: `{ "url": "https://..." }` |
| `POST` | `/api/generate` | Generate docs via Gemini. Body: `{ "url", "title", "summary", "rawCSS", "format": "readme" \| "design" }` |
| `POST` | `/api/audit-css` | Clean/audit raw CSS via Gemini. Body: `{ "rawCSS": "..." }` |

Health check: `POST /api/scan` with body `{ "url": "__health__" }` returns Gemini status and active model.

## Project Structure

```
designsf-app/
├── server.js            # Express server, CSS extraction, Gemini routes
├── public/
│   ├── index.html       # Scanner UI
│   ├── app.js           # Frontend logic
│   └── style.css        # UI styles
├── .env.example         # Environment template
└── package.json
```

## Notes

- Maximum 15 stylesheets and up to 15 redirects are followed per scan.
- Raw CSS preview is truncated to 8 KB in the scan response.
- Results depend on the target site's CSS being reachable and not blocked by CORS/anti-bot measures.
