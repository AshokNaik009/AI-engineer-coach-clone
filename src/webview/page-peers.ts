/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Share Card -- Generate a personalized stats image to share with peers */

import { DateFilter } from '../core/types';
import { rpc, formatNum } from './shared';
import { html, render, LoadingScreen } from './render';
import { SVG } from './svg-icons';

/* ── Canvas Card Renderer ─────────────────────────────────────────── */

function drawShareCard(canvas: HTMLCanvasElement, data: {
  totalLoc: number;
  totalSessions: number;
  totalRequests: number;
  currentStreak: number;
  bestStreak: number;
  flowScore: number;
  topLanguages: string[];
  activeDays: number;
  firstDay: string;
}): void {
  const W = 600;
  const H = 340;
  canvas.width = W * 2;  // 2x for retina
  canvas.height = H * 2;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(2, 2);

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0d1117');
  bg.addColorStop(1, '#161b22');
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.fill();

  // Border
  ctx.strokeStyle = '#30363d';
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, W - 1, H - 1, 16);
  ctx.stroke();

  // Accent bar at top
  const accent = ctx.createLinearGradient(0, 0, W, 0);
  accent.addColorStop(0, '#58a6ff');
  accent.addColorStop(0.5, '#3fb950');
  accent.addColorStop(1, '#bc8cff');
  ctx.fillStyle = accent;
  ctx.fillRect(24, 0, W - 48, 3);

  // Title
  ctx.fillStyle = '#e6edf3';
  ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('GitHub Copilot Stats', 28, 36);

  // Subtitle
  ctx.fillStyle = '#8b949e';
  ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(`Since ${data.firstDay} \u00b7 ${data.activeDays} active days`, 28, 56);

  // Divider
  ctx.strokeStyle = '#21262d';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(28, 68);
  ctx.lineTo(W - 28, 68);
  ctx.stroke();

  // Stats grid (2 rows x 3 cols)
  const stats = [
    { label: 'AI Lines of Code', value: formatNum(data.totalLoc), color: '#3fb950' },
    { label: 'Current Streak', value: `${data.currentStreak}d`, color: '#d29922' },
    { label: 'Flow Score', value: String(data.flowScore), color: '#58a6ff' },
    { label: 'Sessions', value: formatNum(data.totalSessions), color: '#e6edf3' },
    { label: 'Best Streak', value: `${data.bestStreak}d`, color: '#d29922' },
    { label: 'Requests', value: formatNum(data.totalRequests), color: '#bc8cff' },
  ];

  const colW = (W - 56) / 3;
  const rowH = 64;
  const startY = 88;

  for (const [i, s] of stats.entries()) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 28 + col * colW;
    const y = startY + row * rowH;

    ctx.fillStyle = s.color;
    ctx.font = 'bold 26px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(s.value, x, y + 24);

    ctx.fillStyle = '#8b949e';
    ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(s.label, x, y + 42);
  }

  // Divider before languages
  const langY = startY + 2 * rowH + 10;
  ctx.strokeStyle = '#21262d';
  ctx.beginPath();
  ctx.moveTo(28, langY);
  ctx.lineTo(W - 28, langY);
  ctx.stroke();

  // Top languages as pills
  ctx.fillStyle = '#8b949e';
  ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('Top Languages', 28, langY + 22);

  let pillX = 130;
  const langColors = ['#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#f85149'];
  for (const [i, lang] of data.topLanguages.slice(0, 5).entries()) {
    const tw = ctx.measureText(lang).width + 16;
    ctx.fillStyle = langColors[i % langColors.length] + '20';
    roundRect(ctx, pillX, langY + 8, tw, 22, 11);
    ctx.fill();
    ctx.fillStyle = langColors[i % langColors.length];
    ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(lang, pillX + 8, langY + 23);
    pillX += tw + 6;
  }

  // Footer
  ctx.fillStyle = '#484f58';
  ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('ai-engineer-coach', 28, H - 16);

  const dateStr = new Date().toISOString().slice(0, 10);
  const dateW = ctx.measureText(dateStr).width;
  ctx.fillText(dateStr, W - 28 - dateW, H - 16);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/* ── Main Render ──────────────────────────────────────────────────── */

export async function renderShareCard(container: HTMLElement, filter: DateFilter): Promise<void> {
  render(html`<${LoadingScreen} message="Generating share card..." />`, container);

  const [stats, production, balance, flowState, codeByLang, dailyActivity] = await Promise.all([
    rpc<{ totalSessions: number; totalRequests: number }>('getStats', filter as Record<string, unknown>),
    rpc<{ summary: { totalAiLoc: number } }>('getCodeProduction', filter as Record<string, unknown>),
    rpc<{ maxStreak: number } | null>('getWorkLifeBalance', filter as Record<string, unknown>),
    rpc<{ overallFlowScore: number }>('getFlowState', filter as Record<string, unknown>),
    rpc<{ byLanguage: { labels: string[] } }>('getCodeProduction', filter as Record<string, unknown>),
    rpc<{ labels: string[]; values: number[] }>('getDailyActivity', filter as Record<string, unknown>),
  ]);

  // Current streak
  let currentStreak = 0;
  for (let i = dailyActivity.labels.length - 1; i >= 0; i--) {
    if (dailyActivity.values[i] > 0) currentStreak++;
    else break;
  }

  const activeDays = dailyActivity.values.filter(v => v > 0).length;
  const firstDay = dailyActivity.labels[0] ?? 'Unknown';

  const cardData = {
    totalLoc: production.summary.totalAiLoc,
    totalSessions: stats.totalSessions,
    totalRequests: stats.totalRequests,
    currentStreak,
    bestStreak: balance?.maxStreak ?? 0,
    flowScore: flowState.overallFlowScore,
    topLanguages: codeByLang.byLanguage.labels.slice(0, 5),
    activeDays,
    firstDay,
  };

  render(html`
    <div class="share-page">
      <div class="share-hero">
        <div class="share-hero-icon">${SVG.share}</div>
        <div>
          <h2 class="share-hero-title">Share Your Stats</h2>
          <p class="share-hero-sub">Generate a card with your AI coding stats to share with your team.</p>
        </div>
      </div>

      <div class="share-card-wrap">
        <canvas id="share-card-canvas"></canvas>
      </div>

      <div class="share-actions">
        <button class="btn btn-primary" id="share-download-btn">${SVG.share} Download PNG</button>
        <button class="btn btn-secondary" id="share-copy-btn">${SVG.clipboard} Copy to Clipboard</button>
        <button class="btn btn-secondary" id="share-refresh-btn">${SVG.refresh} Refresh</button>
      </div>

      <div class="share-hint" id="share-toast" style="display:none"></div>
    </div>
  `, container);

  // Draw the card
  const canvas = document.getElementById('share-card-canvas') as HTMLCanvasElement;
  if (canvas) {
    drawShareCard(canvas, cardData);
  }

  // Download handler
  document.getElementById('share-download-btn')?.addEventListener('click', () => {
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `copilot-stats-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('Image downloaded');
  });

  // Copy to clipboard handler
  document.getElementById('share-copy-btn')?.addEventListener('click', () => {
    void (async () => {
      if (!canvas) return;
      try {
        const blob = await new Promise<Blob>((resolve) => {
          canvas.toBlob(b => resolve(b!), 'image/png');
        });
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        showToast('Copied to clipboard');
      } catch {
        showToast('Copy failed \u2014 try downloading instead');
      }
    })();
  });

  // Refresh handler
  document.getElementById('share-refresh-btn')?.addEventListener('click', () => {
    void renderShareCard(container, filter);
  });
}

function showToast(msg: string): void {
  const el = document.getElementById('share-toast');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 2500);
}
