// ── DOM refs ──
const urlInput      = document.getElementById('urlInput');
const scanBtn       = document.getElementById('scanBtn');
const emptyState    = document.getElementById('emptyState');
const loadingState  = document.getElementById('loadingState');
const resultsContent = document.getElementById('resultsContent');
const groqStatus    = document.getElementById('groqStatus');
const toastWrap     = document.getElementById('toastWrap');

// Results fields
const pageTitle     = document.getElementById('pageTitle');
const pageUrl       = document.getElementById('pageUrl');
const pageDesc      = document.getElementById('pageDesc');
const statColors    = document.getElementById('statColors');
const statFonts     = document.getElementById('statFonts');
const statVars      = document.getElementById('statVars');
const statSelectors = document.getElementById('statSelectors');
const statSheets    = document.getElementById('statSheets');
const swatchGrid    = document.getElementById('swatchGrid');
const typeList      = document.getElementById('typeList');
const varTableBody  = document.querySelector('#varTable tbody');
const spacingList   = document.getElementById('spacingList');
const rawCSS        = document.getElementById('rawCSS');

// Gen buttons
const genDesign = document.getElementById('genDesign');
const genReadme = document.getElementById('genReadme');
const genAudit  = document.getElementById('genAudit');

// AI output
const aiOutput      = document.getElementById('aiOutput');
const aiOutputLabel = document.getElementById('aiOutputLabel');
const aiContent     = document.getElementById('aiContent');
const aiLoading     = document.getElementById('aiLoading');
const copyAI        = document.getElementById('copyAI');
const downloadAI    = document.getElementById('downloadAI');
const closeAI       = document.getElementById('closeAI');

// Download buttons
const downloadDesign = document.getElementById('downloadDesign');
const downloadCSSBtn = document.getElementById('downloadCSS');

// ── State ──
let lastScan = null;
let lastAIContent = '';
let lastAIFileName = '';

// ── Init: check Groq status ──
(async () => {
  try {
    const resp = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: '__health__' }),
    });
    const data = await resp.json();
    if (data.ok && data.gemini) {
      groqStatus.innerHTML = '<i class="fa-solid fa-circle dot"></i> AI Online';
      groqStatus.classList.add('ok');
    } else if (data.ok) {
      groqStatus.innerHTML = '<i class="fa-solid fa-circle dot"></i> no AI key';
      groqStatus.classList.add('err');
    } else {
      groqStatus.innerHTML = '<i class="fa-solid fa-circle dot"></i> error';
      groqStatus.classList.add('err');
    }
  } catch {
    groqStatus.innerHTML = '<i class="fa-solid fa-circle dot"></i> offline';
    groqStatus.classList.add('err');
  }
})();

// ── Presets ──
document.querySelectorAll('.preset').forEach(btn => {
  btn.addEventListener('click', () => {
    urlInput.value = btn.dataset.url;
    urlInput.focus();
  });
});

// ── Scan ──
async function doScan() {
  const url = urlInput.value.trim();
  if (!url) { urlInput.focus(); showToast('Enter a URL to scan', 'err'); return; }

  // UI: show loading
  emptyState.classList.add('hidden');
  resultsContent.classList.add('hidden');
  aiOutput.classList.add('hidden');
  loadingState.classList.remove('hidden');
  scanBtn.disabled = true;
  scanBtn.classList.add('loading');
  genDesign.disabled = true;
  genReadme.disabled = true;
  genAudit.disabled = true;

  try {
    const resp = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await resp.json();

    if (!resp.ok || !data.ok) {
      throw new Error(data.error || 'Scan failed');
    }

    lastScan = data;
    renderResults(data);

    loadingState.classList.add('hidden');
    resultsContent.classList.remove('hidden');
    resultsContent.classList.add('fade-in');
    genDesign.disabled = false;
    genReadme.disabled = false;
    genAudit.disabled = false;
    showToast('Scan complete');

  } catch (err) {
    loadingState.classList.add('hidden');
    emptyState.classList.remove('hidden');
    emptyState.querySelector('.empty-title').textContent = 'Scan failed';
    emptyState.querySelector('.empty-sub').textContent = err.message;
    showToast(err.message, 'err');
  } finally {
    scanBtn.disabled = false;
    scanBtn.classList.remove('loading');
  }
}

scanBtn.addEventListener('click', doScan);
urlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') doScan();
});

// ── Render ──
function renderResults(data) {
  pageTitle.textContent = data.title;
  pageUrl.textContent = data.url;
  pageDesc.textContent = data.description || 'No description available for this page.';
  pageDesc.classList.toggle('empty', !data.description);
  statColors.textContent = data.summary.colorCount;
  statFonts.textContent = data.summary.fontCount;
  statVars.textContent = data.summary.variableCount;
  statSelectors.textContent = data.summary.selectorCount;
  statSheets.textContent = data.stylesheetsFound;

  // Colors
  swatchGrid.innerHTML = '';
  data.summary.topColors.forEach(color => {
    const el = document.createElement('div');
    el.className = 'swatch';
    const previewColor = normalizeColor(color);
    el.innerHTML = `
      <div class="swatch-preview" style="background:${previewColor}"></div>
      <div class="swatch-info"><span class="swatch-hex">${escHtml(color)}</span></div>
    `;
    swatchGrid.appendChild(el);
  });
  if (data.summary.topColors.length === 0) {
    swatchGrid.innerHTML = '<p style="color:var(--text-3);font-size:12px;">No colors extracted.</p>';
  }

  // Typography
  typeList.innerHTML = '';
  data.summary.fonts.forEach(font => {
    const el = document.createElement('div');
    el.className = 'type-item';
    el.innerHTML = `
      <span class="type-item-name" style="font-family:'${font}',sans-serif">${escHtml(font)}</span>
      <span class="type-item-tag">font-family</span>
    `;
    typeList.appendChild(el);
  });
  data.summary.fontSizes.forEach(size => {
    const el = document.createElement('div');
    el.className = 'type-item';
    el.innerHTML = `
      <span class="type-item-name">${escHtml(size)}</span>
      <span class="type-item-tag">font-size</span>
    `;
    typeList.appendChild(el);
  });
  if (data.summary.fonts.length === 0 && data.summary.fontSizes.length === 0) {
    typeList.innerHTML = '<p style="color:var(--text-3);font-size:12px;">No typography data.</p>';
  }

  // Variables
  varTableBody.innerHTML = '';
  Object.entries(data.summary.variables).forEach(([k, v]) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escHtml(k)}</td><td>${escHtml(v)}</td>`;
    varTableBody.appendChild(tr);
  });
  if (Object.keys(data.summary.variables).length === 0) {
    varTableBody.innerHTML = '<tr><td colspan="2" style="color:var(--text-3)">No CSS custom properties found.</td></tr>';
  }

  // Spacing
  spacingList.innerHTML = '';
  data.summary.spacingSamples.forEach(s => {
    const px = parsePx(s);
    const el = document.createElement('div');
    el.className = 'spacing-chip';
    el.innerHTML = `
      <span class="spacing-bar" style="width:${Math.min(px, 120)}px"></span>
      <span class="spacing-val">${escHtml(s)}</span>
    `;
    spacingList.appendChild(el);
  });
  if (data.summary.spacingSamples.length === 0) {
    spacingList.innerHTML = '<p style="color:var(--text-3);font-size:12px;">No spacing values.</p>';
  }

  // Raw CSS
  rawCSS.textContent = data.rawCSSPreview || '/* No CSS preview available */';
}

// ── Tabs ──
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
  });
});

// ── AI Generation ──
async function callGenerate(btn, endpoint, body, label, fileName) {
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  aiOutput.classList.remove('hidden');
  aiOutputLabel.textContent = label;
  aiContent.textContent = '';
  aiLoading.classList.remove('hidden');
  lastAIFileName = fileName;

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json();

    aiLoading.classList.add('hidden');

    if (!resp.ok || !data.ok) {
      aiContent.textContent = 'Error: ' + (data.error || 'Generation failed');
      showToast(data.error || 'Generation failed', 'err');
      return;
    }

    lastAIContent = data.content;
    aiContent.textContent = data.content;
    showToast(label + ' generated', 'info');
  } catch (err) {
    aiLoading.classList.add('hidden');
    aiContent.textContent = 'Error: ' + err.message;
    showToast(err.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
  }
}

genDesign.addEventListener('click', () => {
  if (!lastScan) return;
  callGenerate(genDesign, '/api/generate', {
    url: lastScan.url,
    title: lastScan.title,
    summary: lastScan.summary,
    rawCSS: lastScan.rawCSSPreview,
    format: 'design',
  }, 'DESIGN.md', 'DESIGN.md');
});

genReadme.addEventListener('click', () => {
  if (!lastScan) return;
  callGenerate(genReadme, '/api/generate', {
    url: lastScan.url,
    title: lastScan.title,
    summary: lastScan.summary,
    rawCSS: lastScan.rawCSSPreview,
    format: 'readme',
  }, 'README.md', 'README.md');
});

genAudit.addEventListener('click', () => {
  if (!lastScan) return;
  callGenerate(genAudit, '/api/audit-css', {
    rawCSS: lastScan.rawCSSPreview,
  }, 'CSS Audit', 'audit.css');
});

// ── AI actions ──
copyAI.addEventListener('click', () => {
  if (!lastAIContent) return;
  navigator.clipboard.writeText(lastAIContent).then(() => {
    copyAI.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
    showToast('Copied to clipboard');
    setTimeout(() => { copyAI.innerHTML = '<i class="fa-solid fa-copy"></i> Copy'; }, 1500);
  }).catch(() => showToast('Copy failed', 'err'));
});

downloadAI.addEventListener('click', () => {
  if (!lastAIContent) return;
  download(lastAIFileName, lastAIContent, 'text/markdown');
  showToast('Downloaded ' + lastAIFileName);
});

closeAI.addEventListener('click', () => {
  aiOutput.classList.add('hidden');
});

// ── Downloads ──
downloadDesign.addEventListener('click', () => {
  if (!lastScan) return;
  // Build a basic DESIGN.md from extracted data
  const s = lastScan.summary;
  let md = `# Design System: ${lastScan.title}\n`;
  md += `\nSource: ${lastScan.url}\n`;
  md += `\n## Colors (${s.colorCount})\n`;
  s.topColors.forEach(c => { md += `- \`${c}\`\n`; });
  md += `\n## Fonts (${s.fontCount})\n`;
  s.fonts.forEach(f => { md += `- ${f}\n`; });
  md += `\n## Font Sizes\n`;
  s.fontSizes.forEach(f => { md += `- \`${f}\`\n`; });
  md += `\n## CSS Variables (${s.variableCount})\n`;
  Object.entries(s.variables).forEach(([k, v]) => { md += `- \`${k}\`: \`${v}\`\n`; });
  md += `\n## Spacing\n`;
  s.spacingSamples.forEach(sp => { md += `- \`${sp}\`\n`; });
  md += `\n## Radii\n`;
  s.radii.forEach(r => { md += `- \`${r}\`\n`; });
  download('DESIGN.md', md, 'text/markdown');
  showToast('Downloaded DESIGN.md');
});

downloadCSSBtn.addEventListener('click', () => {
  if (!lastScan) return;
  download('audit.css', lastScan.rawCSSPreview, 'text/css');
  showToast('Downloaded audit.css');
});

// ── Helpers ──
// type: 'success' | 'err' | 'info'
function showToast(msg, type = 'success') {
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  const icon = type === 'err' ? 'fa-circle-exclamation'
    : type === 'info' ? 'fa-circle-info' : 'fa-circle-check';
  toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${escHtml(msg)}</span>`;
  toastWrap.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastIn .3s reverse forwards';
    setTimeout(() => toast.remove(), 300);
  }, 2200);
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function normalizeColor(c) {
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    return '#' + c[1]+c[1]+c[2]+c[2]+c[3]+c[3];
  }
  return c;
}

function parsePx(s) {
  const m = s.match(/([\d.]+)\s*px/);
  return m ? parseFloat(m[1]) : 8;
}
