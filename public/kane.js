// Kane dashboard: renders the latest kane-report.json served by
// GET /api/kane-report, plus the chaos-toggle state from /api/config.

async function load() {
  const configRes = await fetch('/api/config');
  if (configRes.ok) {
    const config = await configRes.json();
    document.getElementById('bug-banner').hidden = !config.checkoutBug;
  }

  const reportRes = await fetch('/api/kane-report');
  const emptyEl = document.getElementById('empty-state');
  const reportEl = document.getElementById('report');
  if (!reportRes.ok) {
    emptyEl.hidden = false;
    reportEl.hidden = true;
    return;
  }
  const report = await reportRes.json();
  emptyEl.hidden = true;
  reportEl.hidden = false;

  const badge = document.getElementById('overall-badge');
  badge.textContent = report.overall === 'pass' ? 'ALL FLOWS PASSED' : report.overall === 'fail' ? 'KANE FAILED' : 'RUN ERROR';
  badge.className = `badge ${report.overall === 'pass' ? 'pass' : report.overall === 'fail' ? 'fail' : 'idle'}`;
  const passed = report.flows.filter((f) => f.verdict === 'pass').length;
  document.getElementById('report-meta').textContent =
    `Ran ${new Date(report.generatedAt).toLocaleString()} against ${report.baseUrl} — ` +
    `${passed}/${report.flows.length} flows passed, ${report.totalCredits ?? 0} credits used.`;

  const rowsEl = document.getElementById('report-rows');
  rowsEl.innerHTML = '';
  for (const flow of report.flows) {
    const row = document.createElement('tr');
    const verdict = document.createElement('span');
    verdict.className = `badge ${flow.verdict === 'pass' ? 'pass' : flow.verdict === 'fail' ? 'fail' : 'idle'}`;
    verdict.textContent = flow.verdict.toUpperCase();
    const evidence = document.createElement('td');
    if (flow.testUrl) {
      const link = document.createElement('a');
      link.href = flow.testUrl;
      link.textContent = 'View run';
      link.target = '_blank';
      link.rel = 'noopener';
      evidence.appendChild(link);
    } else {
      evidence.textContent = flow.sessionDir || '—';
    }
    row.innerHTML = `
      <td><strong>${flow.name}</strong></td>
      <td></td>
      <td>${flow.exitCode ?? '—'}</td>
      <td>${flow.durationSeconds != null ? `${flow.durationSeconds}s` : '—'}</td>
      <td>${flow.credits ?? '—'}</td>
      <td>${flow.summary || flow.reason || '—'}</td>
    `;
    row.children[1].appendChild(verdict);
    row.appendChild(evidence);
    rowsEl.appendChild(row);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  load();
  document.getElementById('refresh-button').addEventListener('click', load);
});
