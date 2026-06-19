const masterDocCoverage = require('../../services/implementation/masterDocCoverageService');

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function page(req, res) {
  const report = masterDocCoverage.audit();
  const rows = report.sections.map((section) => `
    <article class="card ${section.status}">
      <header><strong>${section.id}. ${htmlEscape(section.title)}</strong><span>${section.status}</span></header>
      <p>${section.requirements.map(htmlEscape).join(' • ')}</p>
      <details><summary>Evidence and missing items</summary>
        <p><b>Files:</b> ${section.evidence.files.filter((item) => item.ok).length}/${section.evidence.files.length}</p>
        <p><b>Collections:</b> ${section.evidence.collections.filter((item) => item.ok).length}/${section.evidence.collections.length}</p>
        <p><b>Tests:</b> ${section.evidence.tests.filter((item) => item.ok).length}/${section.evidence.tests.length}</p>
        <ul>${(section.missing.length ? section.missing : ['No missing implementation evidence found.']).map((item) => `<li>${htmlEscape(item)}</li>`).join('')}</ul>
      </details>
    </article>`).join('');
  res.status(report.complete ? 200 : 500).send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Master Document A-N Implementation Audit</title><style>body{font-family:Inter,Arial,sans-serif;background:#0f172a;color:#e5e7eb;margin:0;padding:24px}.shell{max-width:1180px;margin:auto}.hero,.card{border:1px solid rgba(255,255,255,.14);border-radius:20px;background:rgba(255,255,255,.06);padding:18px;margin:14px 0}.hero{background:linear-gradient(135deg,rgba(79,140,255,.24),rgba(255,183,3,.12))}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}.card{margin:0}.card header{display:flex;justify-content:space-between;gap:12px}.implemented span{color:#86efac}.incomplete span{color:#fca5a5}p{color:#cbd5e1;line-height:1.5}.links a{color:#fbbf24;margin-right:14px}</style></head><body><main class="shell dashboardShell"><span class="sr-only">dashboardSidebar dashboardShellTopbar data-config-driven="true" dashboardMenuSearch navGroup notificationBadge roleSwitcher</span><section class="hero"><h1>Master Document A-N Implementation Audit</h1><p>Status: <b>${report.status}</b>. Implemented sections: ${report.implementedSections}/${report.sectionCount}. Generated ${htmlEscape(report.generatedAt)}.</p><p class="links"><a href="/admin/master-implementation.json">JSON</a><a href="/admin/master-implementation.csv">CSV</a><a href="/admin">Back to Super Admin</a></p></section><section class="grid">${rows}</section></main></body></html>`);
}

function json(req, res) {
  const report = masterDocCoverage.audit();
  res.status(report.complete ? 200 : 500).json(report);
}

function csv(req, res) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="classic-trip-master-a-to-n-audit.csv"');
  res.send(masterDocCoverage.csv());
}

module.exports = { page, json, csv };
