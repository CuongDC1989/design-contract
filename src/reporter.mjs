import fs from 'node:fs/promises';
import path from 'node:path';

export async function generateReport(results, config, meta = {}) {
  const outputPath = path.resolve(process.cwd(), config.reportOutputPath ?? './design-check-report.html');
  await fs.writeFile(outputPath, buildHtml(results, config, meta), 'utf8');
  return outputPath;
}

// ─── HTML builder ─────────────────────────────────────────────────────────────

function buildHtml(results, config, meta) {
  const passed  = results.filter(r => r.status === 'pass').length;
  const failed  = results.filter(r => r.status !== 'pass').length;
  const total   = results.length;
  const rate    = total > 0 ? Math.round((passed / total) * 100) : 0;
  const barColor = rate === 100 ? '#2ea043' : rate >= 70 ? '#d29922' : '#f85149';
  const duration = meta.endTime && meta.startTime
    ? `${((meta.endTime - meta.startTime) / 1000).toFixed(1)}s`
    : '';
  const ts = meta.startTime
    ? new Date(meta.startTime).toLocaleString()
    : new Date().toLocaleString();

  const failedList  = results.filter(r => r.status !== 'pass');
  const passedList  = results.filter(r => r.status === 'pass');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Design Contract Report</title>
<style>${CSS}</style>
</head>
<body>

<header class="header">
  <div class="header-inner">
    <div class="header-left">
      <div class="logo">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect width="20" height="20" rx="5" fill="#FF3986"/>
          <path d="M5 10h10M10 5v10" stroke="white" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <span>Design Contract</span>
      </div>
      <p class="header-sub">${ts}${duration ? ` · ${duration}` : ''} · ${total} cases</p>
    </div>
    <div class="summary-pills">
      <span class="pill pass">✓ ${passed} passed</span>
      <span class="pill fail">✗ ${failed} failed</span>
    </div>
  </div>
  <div class="progress-wrap">
    <div class="progress-bar">
      <div class="progress-fill" style="width:${rate}%;background:${barColor}"></div>
    </div>
    <span class="progress-label" style="color:${barColor}">${rate}%</span>
  </div>
</header>

<main class="main">

  ${failedList.length > 0 ? `
  <div class="group-title fail">
    <span class="dot fail"></span> FAILED <span class="group-count">${failedList.length}</span>
  </div>
  ${failedList.map(r => renderCase(r, config)).join('\n')}
  ` : ''}

  ${passedList.length > 0 ? `
  <div class="group-title pass">
    <span class="dot pass"></span> PASSED <span class="group-count">${passedList.length}</span>
  </div>
  ${passedList.map(r => renderCase(r, config)).join('\n')}
  ` : ''}

</main>

<script>${JS}</script>
</body>
</html>`;
}

// ─── Case card ─────────────────────────────────────────────────────────────────

function renderCase(r, config) {
  const isFail = r.status !== 'pass';
  const icon   = r.status === 'pass' ? '✓' : r.status === 'error' ? '!' : '✗';
  const figmaUrl = config.figmaFileKey && r.figmaNodeId
    ? `https://www.figma.com/file/${config.figmaFileKey}?node-id=${r.figmaNodeId.replace(/-/g, ':')}`
    : null;

  return `
<div class="case ${r.status}${isFail ? ' open' : ''}" onclick="toggleCase(this)">
  <div class="case-header">
    <span class="status-icon ${r.status}">${icon}</span>
    <div class="case-main">
      <div class="case-name">${esc(r.name)}</div>
      <div class="case-meta">
        <span class="meta-item">📖 <code>${esc(r.storyId)}</code></span>
        ${r.figmaNodeId ? `<span class="meta-item">🎨 ${figmaUrl
          ? `<a href="${figmaUrl}" target="_blank" onclick="event.stopPropagation()">${esc(r.figmaNodeId)}</a>`
          : esc(r.figmaNodeId)}</span>` : ''}
        ${r.selector ? `<span class="meta-item">🎯 <code>${esc(r.selector)}</code></span>` : ''}
      </div>
      <div class="checks-row">
        ${(r.checks || []).map(c => `<span class="check-tag">${c}</span>`).join('')}
      </div>
    </div>
    <span class="toggle">›</span>
  </div>
  <div class="case-body">
    ${r.errorMessage ? `<div class="error-msg">⚠ ${esc(r.errorMessage)}</div>` : ''}
    ${r.details && r.details.length > 0
      ? renderDetails(r.details, r.screenshot)
      : r.failures && r.failures.length > 0
        ? renderFailures(r.failures, r.screenshot)
        : r.screenshot ? `<div class="pass-preview"><div class="preview-label">Storybook snapshot</div><img src="data:image/png;base64,${r.screenshot}" class="preview-img" alt="${esc(r.name)}"></div>` : ''}
  </div>
</div>`;
}

function renderDetails(details, screenshot) {
  return `
<div class="failures-wrap">
  ${screenshot ? `
  <div class="screenshot-col">
    <div class="col-label">Actual (Storybook)</div>
    <img src="data:image/png;base64,${screenshot}" class="element-img" alt="screenshot">
  </div>` : ''}
  <div class="table-col">
    <table class="failures-table">
      <thead>
        <tr>
          <th></th>
          <th>Check</th>
          <th>Property</th>
          <th>Expected <span class="th-sub">(Figma)</span></th>
          <th>Actual <span class="th-sub">(Browser)</span></th>
        </tr>
      </thead>
      <tbody>
        ${details.map(d => `
        <tr class="${d.pass ? 'row-pass' : 'row-fail'}">
          <td class="row-icon">${d.pass ? '<span class="ri pass">✓</span>' : '<span class="ri fail">✗</span>'}</td>
          <td><span class="check-badge">${esc(d.check)}</span></td>
          <td class="prop-name">${esc(d.property)}</td>
          <td class="val-cell expected">${renderValue(d.expected)}</td>
          <td class="val-cell actual ${d.pass ? 'match' : ''}">${renderValue(d.actual)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
</div>`;
}

function renderFailures(failures, screenshot) {
  return renderDetails(failures.map(f => ({ ...f, pass: false })), screenshot);
}

function renderValue(val) {
  if (val == null) return '<span class="dim">—</span>';
  const s = String(val);
  const isColor = /^rgba?\(|^#[0-9a-f]{3,8}$/i.test(s.trim());
  if (isColor) {
    return `<div class="val-inner"><span class="color-swatch" style="background:${esc(s)}"></span><code>${esc(s)}</code></div>`;
  }
  return `<code>${esc(s)}</code>`;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#0d1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.5;min-height:100vh}
a{color:#79c0ff;text-decoration:none}
a:hover{text-decoration:underline}
code{font-family:'SFMono-Regular','Cascadia Code','Fira Code',monospace;font-size:12px;background:rgba(255,255,255,.06);padding:1px 5px;border-radius:3px}

/* Header */
.header{position:sticky;top:0;z-index:10;background:#0d1117;border-bottom:1px solid #21262d;padding:16px 32px}
.header-inner{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.logo{display:flex;align-items:center;gap:8px;font-size:16px;font-weight:700;color:#e6edf3;margin-bottom:4px}
.header-sub{font-size:12px;color:#8b949e}
.summary-pills{display:flex;gap:8px;flex-shrink:0;margin-top:2px}
.pill{font-size:12px;font-weight:600;padding:3px 12px;border-radius:20px}
.pill.pass{background:rgba(46,160,67,.15);color:#2ea043;border:1px solid rgba(46,160,67,.3)}
.pill.fail{background:rgba(248,81,73,.15);color:#f85149;border:1px solid rgba(248,81,73,.3)}
.progress-wrap{display:flex;align-items:center;gap:10px;margin-top:12px}
.progress-bar{flex:1;height:4px;background:#21262d;border-radius:2px;overflow:hidden}
.progress-fill{height:100%;border-radius:2px;transition:width .4s}
.progress-label{font-size:12px;font-weight:700;min-width:36px;text-align:right}

/* Main */
.main{max-width:1100px;margin:0 auto;padding:24px 32px 48px}

/* Group title */
.group-title{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;padding:4px 0 10px;margin-top:8px}
.group-title.fail{color:#f85149}
.group-title.pass{color:#2ea043}
.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.dot.fail{background:#f85149}
.dot.pass{background:#2ea043}
.group-count{font-size:11px;background:rgba(255,255,255,.08);padding:1px 8px;border-radius:10px;color:#8b949e}

/* Case card */
.case{border:1px solid #21262d;border-radius:8px;margin-bottom:8px;overflow:hidden;cursor:pointer;transition:border-color .15s}
.case:hover{border-color:rgba(56,139,253,.4)}
.case.fail{border-color:rgba(248,81,73,.35)}
.case.fail:hover{border-color:#f85149}
.case.error{border-color:rgba(210,153,34,.35)}
.case.pass:hover{border-color:rgba(46,160,67,.3)}

/* Case header */
.case-header{display:flex;align-items:flex-start;gap:12px;padding:11px 14px;user-select:none}
.case.fail .case-header{background:rgba(248,81,73,.06)}
.case.error .case-header{background:rgba(210,153,34,.06)}
.case.pass .case-header{background:#161b22}

.status-icon{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;margin-top:1px}
.status-icon.fail{background:rgba(248,81,73,.2);color:#f85149}
.status-icon.pass{background:rgba(46,160,67,.2);color:#2ea043}
.status-icon.error{background:rgba(210,153,34,.2);color:#d29922}

.case-main{flex:1;min-width:0}
.case-name{font-size:13px;font-weight:600;color:#e6edf3;margin-bottom:4px}
.case-meta{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:5px}
.meta-item{font-size:11px;color:#8b949e;display:flex;align-items:center;gap:3px}

.checks-row{display:flex;flex-wrap:wrap;gap:3px}
.check-tag{font-size:10px;padding:1px 6px;border-radius:10px;background:rgba(255,255,255,.06);color:#8b949e;border:1px solid rgba(255,255,255,.06)}

.toggle{color:#8b949e;font-size:20px;flex-shrink:0;margin-top:-1px;transition:transform .2s;line-height:1}
.case.open .toggle{transform:rotate(90deg)}

/* Case body */
.case-body{display:none;border-top:1px solid #21262d}
.case.open .case-body{display:block}

/* Failures */
.failures-wrap{display:flex;min-height:80px}
.screenshot-col{padding:16px;border-right:1px solid #21262d;flex-shrink:0;display:flex;flex-direction:column;gap:8px}
.col-label{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#8b949e;font-weight:600}
.element-img{max-width:280px;max-height:360px;border-radius:5px;border:1px solid #30363d;object-fit:contain;display:block}

.table-col{flex:1;overflow:auto}
.failures-table{width:100%;border-collapse:collapse;font-size:13px}
.failures-table th{padding:9px 14px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;text-align:left;white-space:nowrap;background:#0d1117}
.th-sub{font-weight:400;color:#484f58;text-transform:none;letter-spacing:0}
.failures-table td{padding:9px 14px;border-bottom:1px solid rgba(33,38,45,.7);vertical-align:middle}
.failures-table tr:last-child td{border-bottom:none}
.failures-table tr:hover td{background:rgba(255,255,255,.02)}

.check-badge{font-size:10px;padding:2px 7px;border-radius:3px;background:rgba(255,255,255,.07);color:#8b949e;font-weight:600;text-transform:uppercase;white-space:nowrap;letter-spacing:.3px}
.prop-name{font-family:'SFMono-Regular',monospace;font-size:12px;color:#c9d1d9}
.val-cell{font-family:'SFMono-Regular',monospace;font-size:12px;vertical-align:middle}
.val-cell code{background:transparent;padding:0;font-size:12px}
.val-inner{display:flex;align-items:center;gap:6px}
.val-cell.expected code{color:#2ea043}
.val-cell.actual code{color:#f85149}
.val-cell.actual.match code{color:#2ea043}
.color-swatch{width:13px;height:13px;border-radius:3px;flex-shrink:0;border:1px solid rgba(255,255,255,.15);display:inline-block}
.dim{color:#484f58}
.row-icon{width:24px;text-align:center;padding:9px 4px 9px 12px}
.ri{font-size:11px;font-weight:700}
.ri.pass{color:#2ea043}
.ri.fail{color:#f85149}
.row-pass td{opacity:.75}
.row-pass:hover td{opacity:1}

/* Error */
.error-msg{padding:12px 16px;font-family:monospace;font-size:13px;color:#d29922;background:rgba(210,153,34,.07);border-bottom:1px solid #21262d}

/* Pass preview */
.pass-preview{padding:12px 16px;display:flex;flex-direction:column;gap:8px;background:#0d1117}
.preview-label{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#8b949e;font-weight:600}
.preview-img{max-height:200px;border-radius:5px;border:1px solid #30363d;object-fit:contain}
`;

// ─── Script ───────────────────────────────────────────────────────────────────

const JS = `
function toggleCase(el) {
  el.classList.toggle('open');
}
`;
