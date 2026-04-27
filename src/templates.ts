import type { SessionState } from './types';
import { escapeHtml } from './utils/html';

function statusLabel(status: string): string {
  return status === 'mastered' ? '✓ Mastered'
    : status === 'learning' ? '● Learning'
    : status === 'skipped' ? '— Skipped'
    : '○ Pending';
}

function statusColor(status: string): string {
  return status === 'mastered' ? '#4caf50'
    : status === 'learning' ? '#2196f3'
    : status === 'skipped' ? '#9e9e9e'
    : '#e0e0e0';
}

export function generateRoadmapHtml(session: SessionState): string {
  const s = session;
  const escapedTitle = escapeHtml(s.noteTitle);

  const conceptsHtml = s.concepts.map(c => {
    const color = statusColor(c.status);
    return `<div class="concept" style="border-left: 4px solid ${color}; padding: 8px 12px; margin: 8px 0; background: #f5f5f5; border-radius: 4px;">
      <strong>${escapeHtml(c.name)}</strong>
      <span style="float:right; color: ${color};">${statusLabel(c.status)} (${c.masteryScore}%)</span>
    </div>`;
  }).join('');

  const progress = s.concepts.length > 0
    ? Math.round(s.concepts.filter(c => c.status === 'mastered').length / s.concepts.length * 100)
    : 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Learning Roadmap — ${escapedTitle}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #fff; color: #333; }
    h1 { color: #1a1a1a; border-bottom: 2px solid #e0e0e0; padding-bottom: 8px; }
    .progress-bar { height: 24px; background: #e0e0e0; border-radius: 12px; overflow: hidden; margin: 16px 0; }
    .progress-fill { height: 100%; background: linear-gradient(90deg, #4caf50, #81c784); border-radius: 12px; transition: width 0.3s; }
    .legend { display: flex; gap: 16px; margin: 16px 0; }
    .legend-item { display: flex; align-items: center; gap: 4px; font-size: 14px; }
    .legend-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 16px 0; }
    .stat-card { background: #f5f5f5; padding: 12px; border-radius: 8px; text-align: center; }
    .stat-value { font-size: 24px; font-weight: bold; color: #1a1a1a; }
    .stat-label { font-size: 12px; color: #666; margin-top: 4px; }
  </style>
</head>
<body>
  <h1>Learning Roadmap: ${escapedTitle}</h1>
  <p>Started: ${new Date(s.createdAt).toLocaleDateString()} | Last updated: ${new Date(s.updatedAt).toLocaleDateString()}</p>
  <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
  <div class="legend">
    <span class="legend-item"><span class="legend-dot" style="background:#4caf50"></span> Mastered</span>
    <span class="legend-item"><span class="legend-dot" style="background:#2196f3"></span> Learning</span>
    <span class="legend-item"><span class="legend-dot" style="background:#e0e0e0"></span> Pending</span>
    <span class="legend-item"><span class="legend-dot" style="background:#9e9e9e"></span> Skipped</span>
  </div>
  <div class="stats">
    <div class="stat-card"><div class="stat-value">${s.concepts.length}</div><div class="stat-label">Total Concepts</div></div>
    <div class="stat-card"><div class="stat-value">${s.concepts.filter(c => c.status === 'mastered').length}</div><div class="stat-label">Mastered</div></div>
    <div class="stat-card"><div class="stat-value">${s.concepts.filter(c => c.status === 'learning').length}</div><div class="stat-label">In Progress</div></div>
    <div class="stat-card"><div class="stat-value">${s.misconceptions.filter(m => m.resolved).length}/${s.misconceptions.length}</div><div class="stat-label">Misconceptions Resolved</div></div>
  </div>
  ${conceptsHtml}
</body>
</html>`;
}

export function generateSummaryHtml(session: SessionState, isFinal: boolean): string {
  const s = session;
  const escapedTitle = escapeHtml(s.noteTitle);

  const conceptsHtml = s.concepts.map(c => `<tr>
    <td>${escapeHtml(c.name)}</td>
    <td>${c.status}</td>
    <td>${c.masteryScore}%</td>
    <td>${c.lastReviewTime ? new Date(c.lastReviewTime).toLocaleDateString() : '-'}</td>
  </tr>`).join('');

  const misconceptionsHtml = s.misconceptions.map(m => `<tr>
    <td>${m.misconception}</td>
    <td>${m.resolved ? '✓ Resolved' : '✗ Unresolved'}</td>
  </tr>`).join('');

  const unmastered = s.concepts.filter(c => c.status !== 'mastered');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${isFinal ? 'Final Summary' : 'Progress Summary'} — ${escapedTitle}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #fff; color: #333; }
    h1 { color: #1a1a1a; border-bottom: 2px solid #e0e0e0; padding-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #e0e0e0; }
    th { background: #f5f5f5; font-weight: 600; }
  </style>
</head>
<body>
  <h1>${isFinal ? 'Final Summary' : 'Progress Summary'}: ${escapedTitle}</h1>
  <p>Session ${isFinal ? 'completed' : 'in progress'} | Started: ${new Date(s.createdAt).toLocaleDateString()}</p>

  <h2>Concepts</h2>
  <table>
    <thead><tr><th>Concept</th><th>Status</th><th>Mastery</th><th>Last Review</th></tr></thead>
    <tbody>${conceptsHtml}</tbody>
  </table>

  ${s.misconceptions.length > 0 ? `<h2>Misconceptions</h2>
  <table>
    <thead><tr><th>Misconception</th><th>Status</th></tr></thead>
    <tbody>${misconceptionsHtml}</tbody>
  </table>` : ''}

  <h2>Recommendations</h2>
  <ul>
    ${unmastered.length > 0
      ? `<li>Continue working on: ${unmastered.map(c => escapeHtml(c.name)).join(', ')}</li>`
      : '<li>All concepts mastered! Consider reviewing with spaced repetition.</li>'}
    <li>Concepts mastered: ${s.concepts.filter(c => c.status === 'mastered').length}/${s.concepts.length}</li>
  </ul>
</body>
</html>`;
}
