/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Output page renderer -- merges Production & Consumption into a single tabbed view */

import { DateFilter } from '../core/types';
import { TOKEN_DATA_AVAILABLE_FROM } from '../core/constants';
import { isoWeek } from '../core/helpers';
import { rpc, createChart, formatNum, formatMoney, $$, PALETTE, COLORS, HARNESS_COLORS } from './shared';
import { html, render, StatCard, CanvasEl, ComponentChildren } from './render';

type AggLevel = 'daily' | 'weekly' | 'monthly';

function aggregationLevel(rangeDays: number): AggLevel {
  if (rangeDays === 0) return 'monthly';
  if (rangeDays >= 180) return 'weekly';
  return 'daily';
}

function aggregateTimeline(
  labels: string[], values: number[], level: AggLevel,
): { labels: string[]; values: number[] } {
  if (level === 'daily') return { labels, values };
  const bucketKey = level === 'weekly'
    ? (dateStr: string) => isoWeek(new Date(dateStr + 'T00:00:00'))
    : (dateStr: string) => dateStr.slice(0, 7); // YYYY-MM
  const map = new Map<string, number>();
  for (let i = 0; i < labels.length; i++) {
    const k = bucketKey(labels[i]);
    map.set(k, (map.get(k) || 0) + values[i]);
  }
  const sortedKeys = Array.from(map.keys()).sort();
  return { labels: sortedKeys, values: sortedKeys.map(k => map.get(k)!) };
}

function aggregateByWorkspace(
  labels: string[], dailyByWs: Record<string, number[]>, level: AggLevel,
): { labels: string[]; byWs: Record<string, number[]> } {
  if (level === 'daily') return { labels, byWs: dailyByWs };
  const bucketKey = level === 'weekly'
    ? (dateStr: string) => isoWeek(new Date(dateStr + 'T00:00:00'))
    : (dateStr: string) => dateStr.slice(0, 7);
  const keySet = new Set<string>();
  for (const d of labels) keySet.add(bucketKey(d));
  const sortedKeys = Array.from(keySet).sort();
  const keyIndex = new Map(sortedKeys.map((k, i) => [k, i]));
  const byWs: Record<string, number[]> = {};
  for (const [ws, vals] of Object.entries(dailyByWs)) {
    const agg = new Array<number>(sortedKeys.length).fill(0);
    for (let i = 0; i < labels.length; i++) {
      agg[keyIndex.get(bucketKey(labels[i]))!] += vals[i];
    }
    byWs[ws] = agg;
  }
  return { labels: sortedKeys, byWs };
}

interface ProdData {
  summary: { totalAiLoc: number; locCost2010: number };
  dailyTimeline: { labels: string[]; aiLoc: number[] };
  byLanguage: { labels: string[]; aiLoc: number[] };
  byWorkspace: { labels: string[]; aiLoc: number[] };
  dailyByWorkspace: Record<string, number[]>;
}

interface ConsData {
  totalRequests: number;
  avgPerDay: number;
  avgPerWeek: number;
  modelTotals: Record<string, number>;
  defaultMultipliers: Record<string, number>;
  daily: { labels: string[]; values: number[]; byModel: Record<string, number[]> };
  weekly: { labels: string[]; values: number[]; byModel: Record<string, number[]> };
}

interface AiCreditRpcData {
  totalCredits: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalRequests: number;
  countedRequests: number;
  partialRequests: number;
  pendingRequests: number;
  noDataRequests: number;
  finalizableRequests: number;
  missingPct: number;
  avgCreditsPerRequest: number;
  avgCreditsPerDay: number;
  costByModel: Record<string, {
    requests: number; countedRequests: number;
    partialRequests: number; pendingRequests: number; noDataRequests: number;
    finalizableRequests: number;
    uncachedInputTokens: number; inputTokens: number; outputTokens: number;
    cacheReadTokens: number; cacheWriteTokens: number;
    credits: number; missingPct: number;
    harnesses: string[];
  }>;
  daily: { labels: string[]; credits: number[]; cumulative: number[]; byModel: Record<string, number[]> };
  weekly: { labels: string[]; credits: number[]; cumulative: number[]; byModel: Record<string, number[]> };
  dailyTokensByWorkspace: { labels: string[]; byWorkspace: Record<string, number[]> };
  topRequests: Array<{
    timestamp: number; model: string;
    inputTokens: number; outputTokens: number;
    credits: number;
    status: 'complete' | 'partial' | 'pending' | 'no-data' | 'missing';
    aggregationKind: 'exact' | 'session-aggregated';
    preview: string;
    workspace: string;
    harness: string;
    fullPrompt: string;
  }>;
}

// Module-level view state — survives filter/harness changes so the user's
// tab and range selection is preserved when only the backing data changes.
type OutputTab = 'production' | 'consumption' | 'ai-credits';
let activeRangeDays = 0;
let activeTab: OutputTab = 'production';

export async function renderOutput(container: HTMLElement, currentFilter: DateFilter): Promise<void> {

  // Tabs whose answers depend on token data quality (and so honor the
  // TOKEN_DATA_AVAILABLE_FROM cutoff). Other tabs are based on request
  // counts / LOC and can safely look at all history.
  const TOKEN_DATA_TABS = new Set<OutputTab>(['ai-credits']);

  // Disclaimer banner shown above the AI Credit Usage and Premium Request
  // Consumption tabs. Both views are computed from local session files only,
  // so they cannot see activity from other devices, cloud-hosted agents, or
  // harnesses we don't read. The link points users at the authoritative
  // source for billing.
  const APPROXIMATION_NOTICE = html`
    <div class="approximation-notice">
      <strong>Approximation only.</strong>${' '}
      AI Credit Usage and Premium Request Consumption are estimated from the
      session data this extension can read on your machine. They cannot reflect
      activity on other devices, cloud-hosted agents, or harnesses this
      extension doesn't ingest, so they will never be fully accurate.
      Use them as a workflow optimization signal, not as a billing reference.
      For authoritative consumption numbers, see your${' '}
      <a href="https://github.com/settings/copilot/features" target="_blank" rel="noopener">GitHub Copilot usage settings</a>.
    </div>
  `;
  const isTokenDataTab = (tab: OutputTab) => TOKEN_DATA_TABS.has(tab);

  // Range options shown in the bar. Order matters: longest range last so
  // "All time" (0) lives on the right. The 7/28-day buttons are short enough
  // to always be valid; longer ranges get auto-disabled for token-data tabs
  // when their nominal start dips below the cutoff.
  const RANGES: { days: number; label: string }[] = [
    { days: 7, label: 'Last 7 days' },
    { days: 28, label: 'Last 4 weeks' },
    { days: 90, label: 'Last 3 months' },
    { days: 180, label: 'Last 6 months' },
    { days: 0, label: 'All time' },
  ];

  function rangeStartDate(days: number): string {
    if (days === 0) return '0001-01-01';
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }

  function isRangeDisabled(tab: OutputTab, days: number): boolean {
    if (!isTokenDataTab(tab)) return false;
    return rangeStartDate(days) < TOKEN_DATA_AVAILABLE_FROM;
  }

  function buildRangeFilter(): Record<string, unknown> {
    const f: Record<string, unknown> = { ...currentFilter };
    const days = activeRangeDays;
    if (days > 0) {
      f.fromDate = rangeStartDate(days);
    }
    if (isTokenDataTab(activeTab)) {
      const fromDate = (f.fromDate as string | undefined) ?? '';
      if (!fromDate || fromDate < TOKEN_DATA_AVAILABLE_FROM) {
        f.fromDate = TOKEN_DATA_AVAILABLE_FROM;
      }
    }
    return f;
  }

  function creditChartTitle(): string {
    const rangeLabel = RANGES.find(r => r.days === activeRangeDays)?.label ?? 'All time';
    const granularity = activeRangeDays > 0 && activeRangeDays <= 28 ? 'Daily' : 'Weekly';
    return `${granularity} AI Credit Consumption \u2014 ${rangeLabel}`;
  }

  function tokenByWsChartTitle(): string {
    const rangeLabel = RANGES.find(r => r.days === activeRangeDays)?.label ?? 'All time';
    const level = aggregationLevel(activeRangeDays);
    const granularity = level === 'daily' ? 'Daily' : level === 'weekly' ? 'Weekly' : 'Monthly';
    return `${granularity} Token Consumption by Workspace \u2014 ${rangeLabel}`;
  }

  function consChartTitle(): string {
    const rangeLabel = RANGES.find(r => r.days === activeRangeDays)?.label ?? 'All time';
    const granularity = activeRangeDays > 0 && activeRangeDays <= 28 ? 'Daily' : 'Weekly';
    return `${granularity} Premium Request Consumption \u2014 ${rangeLabel}`;
  }

  function overlayChartTitle(): string {
    const rangeLabel = RANGES.find(r => r.days === activeRangeDays)?.label ?? 'All time';
    const granularity = activeRangeDays > 0 && activeRangeDays <= 28 ? 'Daily' : 'Weekly';
    return `${granularity} AI Credits vs Premium Requests \u2014 ${rangeLabel}`;
  }

  function renderRangeBar(): ComponentChildren {
    const cur = activeRangeDays;
    const disabledTitle = `Sessions before ${TOKEN_DATA_AVAILABLE_FROM} did not capture per-request token data, so this range can’t show meaningful coverage. It will become available again once enough recent data falls within the range.`;
    const buttons = RANGES.map(r => {
      const disabled = isRangeDisabled(activeTab, r.days);
      const isActive = cur === r.days && !disabled;
      const cls = `cons-range-btn${isActive ? ' active' : ''}${disabled ? ' disabled' : ''}`;
      return disabled
        ? html`<button class=${cls} data-range=${r.days} disabled aria-disabled="true" title=${disabledTitle} style="opacity:0.4;cursor:not-allowed;">${r.label}</button>`
        : html`<button class=${cls} data-range=${r.days}>${r.label}</button>`;
    });
    return html`${buttons}`;
  }

  function refreshRangeBar(): void {
    const bar = document.getElementById('outputRange');
    if (bar) render(html`<span>${renderRangeBar()}</span>`, bar);
  }

  // When switching to a token-data tab, snap the active range to the nearest
  // valid range if the current one is disabled. Prefer the largest enabled
  // range that's <= current selection (so widening into a token-data tab
  // doesn't silently shrink the window beyond user expectation).
  function snapActiveRangeIfDisabled(): void {
    if (!isRangeDisabled(activeTab, activeRangeDays)) return;
    const enabled = RANGES.filter(r => !isRangeDisabled(activeTab, r.days));
    if (enabled.length === 0) return;
    // Pick the longest enabled range (most data) — for token-data tabs
    // today this is "Last 3 months".
    const longest = enabled.reduce((a, b) => {
      const aSpan = a.days === 0 ? Number.POSITIVE_INFINITY : a.days;
      const bSpan = b.days === 0 ? Number.POSITIVE_INFINITY : b.days;
      return bSpan > aSpan ? b : a;
    });
    activeRangeDays = longest.days;
  }

  render(html`
    <h1>Output</h1>
    <div class="cons-range-bar" id="outputRange"></div>
    <div class="tab-bar" id="output-tabs">
      <button class=${`tab${activeTab === 'production' ? ' active' : ''}`} data-tab="production">Code Output</button>
      <button class=${`tab${activeTab === 'consumption' ? ' active' : ''}`} data-tab="consumption">Premium Request Consumption</button>
      <button class=${`tab${activeTab === 'ai-credits' ? ' active' : ''}`} data-tab="ai-credits">AI Credit Usage</button>
    </div>
    <div id="output-tab-content"></div>
  `, container);
  refreshRangeBar();

  // Populate range bar from its own Preact root so there is exactly one
  // owner of #outputRange's children (avoids duplicate buttons).
  refreshRangeBar();

  async function renderProductionTab(): Promise<void> {
    const target = document.getElementById('output-tab-content')!;
    render(html`<div class="loading-spinner"></div>`, target);

    const prod = await rpc<ProdData>('getCodeProduction', buildRangeFilter());
    const s = prod.summary;
    const level = aggregationLevel(activeRangeDays);
    const chartTitle = level === 'weekly' ? 'Weekly Production' : level === 'monthly' ? 'Monthly Production' : 'Daily Production';

    render(html`
      <div class="stat-grid">
        <${StatCard} label="AI-Generated LoC" value=${formatNum(s.totalAiLoc)} accent="var(--accent-blue)" />
        <${StatCard} label="Est. 2010s Value" value=${formatMoney(s.locCost2010)} accent="var(--accent-purple)" />
      </div>
      <${CanvasEl} id="prodDailyChart" height=${250} title=${chartTitle} />
      <div class="two-col">
        <${CanvasEl} id="prodLangChart" height=${300} title="By Language" />
        <${CanvasEl} id="prodWsChart" height=${300} title="By Workspace" />
      </div>
    `, target);

    const wsNames = prod.byWorkspace.labels;
    const wsColor = (i: number) => PALETTE[i % PALETTE.length];

    const { labels: aggLabels, byWs: aggByWs } = aggregateByWorkspace(
      prod.dailyTimeline.labels, prod.dailyByWorkspace, level,
    );
    const { values: aggTotals } = aggregateTimeline(
      prod.dailyTimeline.labels, prod.dailyTimeline.aiLoc, level,
    );

    const dailyDatasets = wsNames
      .filter(ws => aggByWs[ws])
      .map((ws, i) => ({
        label: ws,
        data: aggByWs[ws],
        backgroundColor: wsColor(i) + '80',
        borderColor: wsColor(i),
        borderWidth: 1,
      }));
    if (dailyDatasets.length === 0) {
      dailyDatasets.push({
        label: 'AI LoC',
        data: aggTotals,
        backgroundColor: PALETTE[0] + '80',
        borderColor: PALETTE[0],
        borderWidth: 1,
      });
    }

    createChart('prodDailyChart', 'bar', {
      labels: aggLabels,
      datasets: dailyDatasets,
    }, {
      plugins: { legend: { display: dailyDatasets.length > 1, position: 'bottom', labels: { boxWidth: 12, padding: 8 } } },
      scales: { x: { stacked: true, ticks: { maxTicksLimit: 15 } }, y: { stacked: true, beginAtZero: true } },
    });

    createChart('prodLangChart', 'bar', {
      labels: prod.byLanguage.labels,
      datasets: [{ label: 'AI LoC', data: prod.byLanguage.aiLoc, backgroundColor: PALETTE[0] }],
    }, {
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true } },
    });

    const wsBarColors = wsNames.map((_, i) => wsColor(i));
    createChart('prodWsChart', 'bar', {
      labels: prod.byWorkspace.labels,
      datasets: [{ label: 'AI LoC', data: prod.byWorkspace.aiLoc, backgroundColor: wsBarColors }],
    }, {
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true } },
    });
  }

  async function renderConsumptionTab(): Promise<void> {
    const target = document.getElementById('output-tab-content')!;
    render(html`<div class="loading-spinner"></div>`, target);

    const cons = await rpc<ConsData>('getConsumption', buildRangeFilter());

    render(html`
      ${APPROXIMATION_NOTICE}
      <div class="stat-grid" id="consStats">
        <${StatCard} label="Total Requests" value=${formatNum(cons.totalRequests)} accent="var(--accent-blue)" />
        <${StatCard} label="Avg/Day" value=${formatNum(Math.round(cons.avgPerDay))} accent="var(--accent-green)" />
        <${StatCard} label="Avg/Week" value=${formatNum(Math.round(cons.avgPerWeek))} accent="var(--accent-purple)" />
      </div>
      <${CanvasEl} id="consChart" height=${300} title=${consChartTitle()} />
      <h2>Model Breakdown</h2>
      <div id="modelTable"></div>
    `, target);

    const useDaily = activeRangeDays > 0 && activeRangeDays <= 28;
    const series = useDaily ? cons.daily : cons.weekly;
    const cumulative = series.values.reduce((acc: number[], v: number) => {
      acc.push((acc.length > 0 ? acc[acc.length - 1] : 0) + v);
      return acc;
    }, []);

    const modelColors = PALETTE;
    const byModel = series.byModel;
    const modelNames = Object.keys(byModel).sort((a, b) => {
      const sumA = byModel[a].reduce((s: number, v: number) => s + v, 0);
      const sumB = byModel[b].reduce((s: number, v: number) => s + v, 0);
      return sumB - sumA;
    });

    const TOP_N = 8;
    const topModels = modelNames.slice(0, TOP_N);
    const otherModels = modelNames.slice(TOP_N);

    const otherData = series.labels.map((_: string, i: number) =>
      otherModels.reduce((sum: number, m: string) => sum + (byModel[m]?.[i] ?? 0), 0)
    );

    const modelDatasets: Record<string, unknown>[] = topModels.map((model, i) => ({
      label: model,
      data: byModel[model],
      backgroundColor: modelColors[i % modelColors.length] + '99',
      borderColor: modelColors[i % modelColors.length],
      borderWidth: 1,
      order: 2,
      stack: 'models',
    }));

    if (otherModels.length > 0) {
      modelDatasets.push({
        label: `Other (${otherModels.length})`,
        data: otherData,
        backgroundColor: COLORS.muted + '60',
        borderColor: COLORS.muted,
        borderWidth: 1,
        order: 2,
        stack: 'models',
      });
    }

    const yLabel = useDaily ? 'Requests/day' : 'Requests/week';

    createChart('consChart', 'bar', {
      labels: series.labels,
      datasets: [
        ...modelDatasets as { label: string; data: number[]; backgroundColor: string; borderColor: string; borderWidth: number; order: number; stack: string }[],
        { label: 'Cumulative', data: cumulative, type: 'line' as const, borderColor: COLORS.yellow, backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, order: 1, yAxisID: 'y1' },
      ],
    }, {
      plugins: { legend: { position: 'top' } },
      scales: {
        x: { stacked: true, ticks: { maxTicksLimit: 15 } },
        y: { stacked: true, beginAtZero: true, position: 'left', title: { display: true, text: yLabel } },
        y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Cumulative' } },
      },
    });

    const models = Object.entries(cons.modelTotals).sort((a, b) => b[1] - a[1]);
    const totalReqs = cons.totalRequests || 1;
    const modelTableEl = document.getElementById('modelTable')!;
    render(html`<table class="data-table"><thead><tr><th>Model</th><th>Requests</th><th>Share</th><th>Multiplier</th><th>Premium Reqs</th></tr></thead><tbody>
      ${models.map(([model, count]) => {
        const mult = cons.defaultMultipliers[model] ?? 1;
        const premium = Math.round(count * mult);
        return html`<tr><td>${model}</td><td>${formatNum(count)}</td><td>${((count / totalReqs) * 100).toFixed(1)}%</td><td>${mult}x</td><td>${formatNum(premium)}</td></tr>`;
      })}
    </tbody></table>`, modelTableEl);
  }

  function buildCreditCoverageSummary(data: AiCreditRpcData): { missingLabel: ComponentChildren; partialLabel: ComponentChildren; pendingLabel: ComponentChildren; noDataLabel: ComponentChildren } {
    const trulyMissing = data.finalizableRequests - data.countedRequests - data.partialRequests;
    return {
      missingLabel: data.finalizableRequests > 0 && data.missingPct > 0
        ? html`<span class="missing-badge badge-popup-trigger" tabindex="0">missing ${data.missingPct}%<span class="badge-popup"><strong>Missing (${data.missingPct}%)</strong><br/>${formatNum(trulyMissing)} of ${formatNum(data.finalizableRequests)} finalizable requests have no token data (neither input nor output tokens recorded). These requests could not be billed and are excluded from credit totals.</span></span>`
        : data.finalizableRequests === 0 && data.totalRequests > 0
          ? html`<span class="missing-badge badge-popup-trigger" tabindex="0">no finalizable requests<span class="badge-popup"><strong>No finalizable requests</strong><br/>All requests in this period are either still pending (active/aborted sessions) or from sources that don\u2019t record token usage. No credit totals can be computed yet.</span></span>`
          : '',
      partialLabel: data.partialRequests > 0
        ? html` <span class="pending-badge badge-popup-trigger" tabindex="0">+${formatNum(data.partialRequests)} partial<span class="badge-popup"><strong>Partial (${formatNum(data.partialRequests)} requests)</strong><br/>These requests captured output tokens but not input tokens \u2014 credits cannot be billed exactly. The output token cost is still included in totals, but input cost is unknown. This is common with VS Code Copilot auto-completions and inline suggestions.</span></span>`
        : '',
      pendingLabel: data.pendingRequests > 0
        ? html` <span class="pending-badge badge-popup-trigger" tabindex="0">+${formatNum(data.pendingRequests)} pending<span class="badge-popup"><strong>Pending (${formatNum(data.pendingRequests)} requests)</strong><br/>Requests in active or aborted sessions where token data was never finalized. These are excluded from the missing % calculation because they may still receive data when sessions close. Common with long-running or interrupted agentic sessions.</span></span>`
        : '',
      noDataLabel: data.noDataRequests > 0
        ? html` <span class="pending-badge badge-popup-trigger" tabindex="0">+${formatNum(data.noDataRequests)} no-data<span class="badge-popup"><strong>No Data (${formatNum(data.noDataRequests)} requests)</strong><br/>Requests where the harness or source does not record token usage at all (e.g. Xcode, CLI turns aborted before any model output). This is permanent and expected \u2014 these are excluded from the missing % calculation.</span></span>`
        : '',
    };
  }

  function renderAiCreditsEmptyState(target: HTMLElement, data: AiCreditRpcData): boolean {
    if (data.countedRequests !== 0 || data.totalRequests === 0) return false;
    const heading = data.pendingRequests > 0
      ? 'No finalized billing data yet'
      : data.noDataRequests === data.totalRequests
        ? 'No token-bearing requests in this period'
        : 'No native token data available';
    const body = data.pendingRequests > 0
      ? `All ${formatNum(data.totalRequests)} request${data.totalRequests === 1 ? '' : 's'} in this period are still pending or were aborted before any model output. Token data may yet arrive once sessions finalize.`
      : data.noDataRequests === data.totalRequests
        ? `All ${formatNum(data.totalRequests)} request${data.totalRequests === 1 ? '' : 's'} are from sources that don't record token usage (e.g. Xcode), so AI Credit usage cannot be computed.`
        : `None of the ${formatNum(data.totalRequests)} request${data.totalRequests === 1 ? '' : 's'} in this period have both input and output token counts reported by the harness, so AI Credit usage cannot be computed.`;
    render(html`${APPROXIMATION_NOTICE}<div class="empty-state"><h2>${heading}</h2><p>${body}</p></div>`, target);
    return true;
  }

  function renderAiCreditsCharts(data: AiCreditRpcData): { modelEntries: [string, AiCreditRpcData['costByModel'][string]][] } {
    const uncachedInput = Math.max(0, data.totalInputTokens - data.totalCacheReadTokens - data.totalCacheWriteTokens);
    const cacheRead = data.totalCacheReadTokens;
    const cacheWrite = data.totalCacheWriteTokens;
    const hasCached = cacheRead + cacheWrite > 0;
    createChart('creditTokenPie', 'bar', {
      labels: hasCached ? ['Input (uncached)', 'Cache Read', 'Cache Write', 'Output'] : ['Input', 'Output'],
      datasets: [{
        label: 'Tokens',
        data: hasCached ? [uncachedInput, cacheRead, cacheWrite, data.totalOutputTokens] : [data.totalInputTokens, data.totalOutputTokens],
        backgroundColor: hasCached ? [PALETTE[0], PALETTE[2], PALETTE[4] || PALETTE[2], PALETTE[1]] : [PALETTE[0], PALETTE[1]],
      }],
    }, { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx: { label: string; raw: number }) => `${ctx.label}: ${formatNum(ctx.raw)}` } } }, scales: { y: { beginAtZero: true, ticks: { callback: (v: number) => formatNum(v) } } } });

    const modelEntries = Object.entries(data.costByModel).sort((a, b) => b[1].credits - a[1].credits);
    const topN = modelEntries.slice(0, 10);
    createChart('creditModelBar', 'bar', {
      labels: topN.map(([m]) => m),
      datasets: [{ label: 'AI Credits', data: topN.map(([, v]) => Math.round(v.credits * 100) / 100), backgroundColor: topN.map((_, i) => PALETTE[i % PALETTE.length]) }],
    }, { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } });

    const useDaily = activeRangeDays > 0 && activeRangeDays <= 28;
    const series = useDaily ? data.daily : data.weekly;
    const yLabel = useDaily ? 'Credits/day' : 'Credits/week';
    const byModel = series.byModel;
    const modelNames = Object.keys(byModel).sort((a, b) => byModel[b].reduce((s: number, v: number) => s + v, 0) - byModel[a].reduce((s: number, v: number) => s + v, 0));
    const topCreditModels = modelNames.slice(0, 8);
    const otherCreditModels = modelNames.slice(8);
    const otherCreditData = series.labels.map((_: string, i: number) => otherCreditModels.reduce((sum: number, m: string) => sum + (byModel[m]?.[i] ?? 0), 0));
    const creditDatasets: Record<string, unknown>[] = topCreditModels.map((model, i) => ({ label: model, data: byModel[model], backgroundColor: PALETTE[i % PALETTE.length] + '99', borderColor: PALETTE[i % PALETTE.length], borderWidth: 1, order: 2, stack: 'models' }));
    if (otherCreditModels.length > 0) {
      creditDatasets.push({ label: `Other (${otherCreditModels.length})`, data: otherCreditData, backgroundColor: COLORS.muted + '60', borderColor: COLORS.muted, borderWidth: 1, order: 2, stack: 'models' });
    }
    createChart('creditWeeklyChart', 'bar', {
      labels: series.labels,
      datasets: [
        ...creditDatasets as { label: string; data: number[]; backgroundColor: string; borderColor: string; borderWidth: number; order: number; stack: string }[],
        { label: 'Cumulative', data: series.cumulative, type: 'line' as const, borderColor: COLORS.yellow, backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, order: 1, yAxisID: 'y1' },
      ],
    }, { plugins: { legend: { position: 'top' } }, scales: { x: { stacked: true, ticks: { maxTicksLimit: 15 } }, y: { stacked: true, beginAtZero: true, position: 'left', title: { display: true, text: yLabel } }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Cumulative' } } } });

    // Token Consumption by Workspace chart
    const level = aggregationLevel(activeRangeDays);
    const { labels: wsLabels, byWs: wsBuckets } = aggregateByWorkspace(
      data.dailyTokensByWorkspace.labels, data.dailyTokensByWorkspace.byWorkspace, level,
    );
    const wsNames = Object.keys(wsBuckets).sort((a, b) => {
      const sumA = wsBuckets[a].reduce((s, v) => s + v, 0);
      const sumB = wsBuckets[b].reduce((s, v) => s + v, 0);
      return sumB - sumA;
    });
    const topWs = wsNames.slice(0, 8);
    const otherWs = wsNames.slice(8);
    const otherWsData = wsLabels.map((_, i) => otherWs.reduce((sum, ws) => sum + (wsBuckets[ws]?.[i] ?? 0), 0));
    const wsDatasets: Record<string, unknown>[] = topWs.map((ws, i) => ({
      label: ws, data: wsBuckets[ws], backgroundColor: PALETTE[i % PALETTE.length] + '99',
      borderColor: PALETTE[i % PALETTE.length], borderWidth: 1, stack: 'ws',
    }));
    if (otherWs.length > 0) {
      wsDatasets.push({ label: `Other (${otherWs.length})`, data: otherWsData, backgroundColor: COLORS.muted + '60', borderColor: COLORS.muted, borderWidth: 1, stack: 'ws' });
    }
    if (wsDatasets.length > 0) {
      const wsYLabel = level === 'daily' ? 'Tokens/day' : level === 'weekly' ? 'Tokens/week' : 'Tokens/month';
      createChart('creditTokenByWsChart', 'bar', {
        labels: wsLabels,
        datasets: wsDatasets as { label: string; data: number[]; backgroundColor: string; borderColor: string; borderWidth: number; stack: string }[],
      }, { plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (ctx: { dataset: { label: string }; raw: number }) => `${ctx.dataset.label}: ${formatNum(ctx.raw)} tokens` } } }, scales: { x: { stacked: true, ticks: { maxTicksLimit: 15 } }, y: { stacked: true, beginAtZero: true, title: { display: true, text: wsYLabel }, ticks: { callback: (v: number) => formatNum(v) } } } });
    }

    return { modelEntries };
  }

  function harnessColor(h: string): string {
    return HARNESS_COLORS[h] || '#6b7280';
  }

  function renderCreditModelTable(target: HTMLElement, modelEntries: [string, AiCreditRpcData['costByModel'][string]][]): void {
    const visibleModelEntries = modelEntries.filter(([, info]) => info.countedRequests > 0 || info.partialRequests > 0);
    const hiddenModelCount = modelEntries.length - visibleModelEntries.length;
    const anyCached = visibleModelEntries.some(([, info]) => (info.cacheReadTokens + info.cacheWriteTokens) > 0);
    render(html`
      <table class="data-table"><thead><tr><th>Model</th><th>Source</th><th>Requests</th><th>Input Tokens</th>${anyCached && html`<th title="Cached input tokens (read + write). Billed at the cached rate (~10% of input rate).">Cached</th>`}<th>Output Tokens</th><th>AI Credits</th><th>Est. Cost</th><th>Data</th></tr></thead><tbody>
        ${visibleModelEntries.map(([model, info]) => {
          const dataTag = info.finalizableRequests === 0 && info.requests > 0
            ? html`<span class="missing-badge-inline" title="No finalizable requests for this model \u2014 all are pending or from a source that doesn't record tokens.">N/A</span>`
            : info.missingPct > 0
              ? html`<span class="missing-badge" title=${info.missingPct + '% of finalizable requests for this model have no token data'}>missing ${info.missingPct}%</span>`
              : '\u2713';
          const cachedTotal = info.cacheReadTokens + info.cacheWriteTokens;
          return html`<tr>
            <td>${model}</td>
            <td>${(info.harnesses ?? []).map(h => html`<span class="harness-badge" style="--harness-color:${harnessColor(h)}" title=${h}>${h}</span> `)}</td>
            <td>${formatNum(info.requests)}</td>
            <td>${formatNum(info.inputTokens)}</td>
            ${anyCached && html`<td>${cachedTotal > 0 ? formatNum(cachedTotal) : html`<span class="missing-badge-inline">\u2014</span>`}</td>`}
            <td>${formatNum(info.outputTokens)}</td>
            <td>${info.credits.toFixed(1)}</td>
            <td>${formatMoney(info.credits / 100)}</td>
            <td>${dataTag}${info.partialRequests > 0 && html` <span class="pending-badge" title=${formatNum(info.partialRequests) + ' output-only requests (input not captured) \u2014 output tokens shown but credits cannot be billed.'}>+${formatNum(info.partialRequests)} partial</span>`}${info.pendingRequests > 0 && html` <span class="pending-badge" title=${formatNum(info.pendingRequests) + ' requests in active/aborted sessions (excluded from missing %)'}>+${formatNum(info.pendingRequests)} pending</span>`}${info.noDataRequests > 0 && html` <span class="pending-badge" title=${formatNum(info.noDataRequests) + " requests where the harness/source did not record token data (excluded from missing %)"}>+${formatNum(info.noDataRequests)} no-data</span>`}</td>
          </tr>`;
        })}
      </tbody></table>
      ${hiddenModelCount > 0 && html`<p class="credits-note" style="margin-top:6px;"><span title="Models hidden because every request is pending or from a source that doesn't record token data \u2014 there's nothing to display in the cost columns.">${hiddenModelCount} model${hiddenModelCount === 1 ? '' : 's'} hidden (no token data)</span></p>`}
    `, target);
  }

  function showPromptPopup(e: MouseEvent, fullPrompt: string): void {
    // Remove any existing popup
    document.querySelector('.prompt-popup-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'prompt-popup-overlay';

    const popup = document.createElement('div');
    popup.className = 'prompt-popup';

    const header = document.createElement('div');
    header.className = 'prompt-popup-header';
    header.textContent = 'Full Prompt';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'prompt-popup-close';
    closeBtn.textContent = '\u00d7';
    closeBtn.onclick = () => close();
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'prompt-popup-body';
    body.textContent = fullPrompt;

    popup.appendChild(header);
    popup.appendChild(body);
    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);

    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }

    // Close on overlay click (outside popup)
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) close();
    });
  }

  function renderTopRequestsTable(target: HTMLElement, data: AiCreditRpcData): void {
    render(html`
      <table class="data-table"><thead><tr><th>Date</th><th>Workspace</th><th>Source</th><th>Model</th><th>Total Tokens</th><th>Credits</th><th>Prompt</th></tr></thead><tbody>
        ${data.topRequests.map(req => {
          const d = new Date(req.timestamp).toLocaleDateString();
          const aggregated = req.aggregationKind === 'session-aggregated';
          const aggTitle = 'Estimated share of session-level totals reported by the harness \u2014 exact per-request input is not available.';
          const totalTokens = req.inputTokens + req.outputTokens;
          const tokensCell = req.status === 'complete'
            ? (aggregated ? html`<span class="aggregated-badge" title=${aggTitle}>~${formatNum(totalTokens)}</span>` : formatNum(totalTokens))
            : req.status === 'pending' ? html`<span class="missing-badge" title="Token data not yet finalized.">pending</span>`
            : req.status === 'no-data' ? html`<span class="missing-badge" title="Source structurally does not record token counts.">no-data</span>`
            : req.status === 'partial' ? html`<span class="missing-badge" title="Only output captured \u2014 total incomplete.">partial</span>`
            : html`<span class="missing-badge" title="No native token count.">missing</span>`;
          const creditsCell = req.status === 'complete'
            ? (aggregated ? html`<span class="aggregated-badge" title=${aggTitle}>~${req.credits.toFixed(2)}</span>` : req.credits.toFixed(2))
            : req.status === 'pending' ? html`<span class="missing-badge" title="Cannot compute credits \u2014 token data not yet finalized.">pending</span>`
            : req.status === 'no-data' ? html`<span class="missing-badge" title="Cannot compute credits \u2014 source does not record token usage.">no-data</span>`
            : req.status === 'partial' ? html`<span class="missing-badge" title="Cannot compute credits exactly \u2014 input tokens not captured.">partial</span>`
            : html`<span class="missing-badge" title="Cannot compute credits \u2014 no billing data">missing</span>`;
          const wsCell = req.workspace || html`<span class="missing-badge">unknown</span>`;
          const harnessCell = req.harness ? html`<span class="harness-badge" style="--harness-color:${harnessColor(req.harness)}" title=${req.harness}>${req.harness}</span>` : '';
          return html`<tr><td>${d}</td><td>${wsCell}</td><td>${harnessCell}</td><td>${req.model}</td><td>${tokensCell}</td><td>${creditsCell}</td><td><span class="prompt-preview-trigger" onclick=${(e: MouseEvent) => showPromptPopup(e, req.fullPrompt)}>${req.preview.slice(0, 50)}\u2026</span></td></tr>`;
        })}
      </tbody></table>
      ${data.topRequests.some(r => r.aggregationKind === 'session-aggregated') && html`<p class="credits-note"><span class="aggregated-badge">~value</span> = derived share of session-level totals (per-request data not reported by harness).</p>`}
    `, target);
  }

  async function renderAiCreditsTab(): Promise<void> {
    const target = document.getElementById('output-tab-content')!;
    render(html`<div class="loading-spinner"></div>`, target);

    const data = await rpc<AiCreditRpcData>('getAiCredits', buildRangeFilter());

    const { missingLabel, partialLabel, pendingLabel, noDataLabel } = buildCreditCoverageSummary(data);
    if (renderAiCreditsEmptyState(target, data)) return;

    render(html`
      ${APPROXIMATION_NOTICE}
      <div class="stat-grid" id="creditStats">
        <${StatCard} label="Total AI Credits" value=${formatNum(Math.round(data.totalCredits))} accent="var(--accent-blue)" />
        <${StatCard} label="Est. Cost" value=${formatMoney(data.totalCredits / 100)} accent="var(--accent-purple)" />
        <${StatCard} label="Avg Credits/Request" value=${data.avgCreditsPerRequest.toFixed(2)} accent="var(--accent-green)" />
        <${StatCard} label="Avg Credits/Day" value=${data.avgCreditsPerDay.toFixed(1)} accent="var(--accent-yellow)" />
      </div>
      <p class="credits-note">1 AI Credit = $0.01 USD. Code completions are free and not counted. Totals reflect ${formatNum(data.countedRequests)} of ${formatNum(data.finalizableRequests)} finalizable requests with billing data (per-request native tokens or session-level totals from the harness). ${missingLabel}${partialLabel}${pendingLabel}${noDataLabel}</p>
      <div class="chart-tabs" style="margin-top:18px">
        <button class="chart-tab active" data-chart-tab="credits">AI Credits</button>
        <button class="chart-tab" data-chart-tab="tokens-ws">Tokens by Workspace</button>
        <button class="chart-tab" data-chart-tab="overlay">Credits vs Requests</button>
      </div>
      <div id="chartTabCredits" class="chart-tab-panel active"><${CanvasEl} id="creditWeeklyChart" height=${300} title=${creditChartTitle()} /></div>
      <div id="chartTabTokensWs" class="chart-tab-panel"><${CanvasEl} id="creditTokenByWsChart" height=${350} title=${tokenByWsChartTitle()} /></div>
      <div id="chartTabOverlay" class="chart-tab-panel"><${CanvasEl} id="creditVsRequestsChart" height=${300} title=${overlayChartTitle()} /></div>
      <div class="two-col"><div class="chart-wrap"><div class="chart-title">Token Breakdown <span class="info-icon" tabindex="0" role="button" aria-label="Token breakdown info">${'\u24d8'}<span class="info-popup">Cache token breakdown (cache read / cache write) is only available for harnesses that report it natively, such as Claude Code and Copilot CLI. VS Code Copilot chat sessions report a single aggregated input token count and do not break out cached vs. uncached tokens — this is a limitation of the upstream data format, not a bug.</span></span></div><canvas id="creditTokenPie" height=${250}></canvas></div><${CanvasEl} id="creditModelBar" height=${250} title="Credit Cost by Model" /></div>
      <h2>Model Cost Breakdown</h2>
      <div id="creditModelTable"></div>
      <h2>Most Expensive Requests</h2>
      <div id="topRequestsTable"></div>
    `, target);

    const { modelEntries } = renderAiCreditsCharts(data);
    renderCreditModelTable(document.getElementById('creditModelTable')!, modelEntries);
    renderTopRequestsTable(document.getElementById('topRequestsTable')!, data);

    // Overlay chart: normalized AI Credits vs Premium Requests (both 0-100% of peak)
    const cons = await rpc<ConsData>('getConsumption', buildRangeFilter());
    const useOverlayDaily = activeRangeDays > 0 && activeRangeDays <= 28;
    const creditSeries = useOverlayDaily ? data.daily : data.weekly;
    const reqSeries = useOverlayDaily ? cons.daily : cons.weekly;
    // Align on credit series labels
    const overlayLabels = creditSeries.labels;
    const reqValues = overlayLabels.map((label, i) => {
      const idx = reqSeries.labels.indexOf(label);
      return idx >= 0 ? reqSeries.values[idx] : (i < reqSeries.values.length ? reqSeries.values[i] : 0);
    });
    // Normalize both to percentage of their max
    const creditMax = Math.max(...creditSeries.credits, 1);
    const reqMax = Math.max(...reqValues, 1);
    const creditNorm = creditSeries.credits.map((v: number) => Math.round((v / creditMax) * 1000) / 10);
    const reqNorm = reqValues.map(v => Math.round((v / reqMax) * 1000) / 10);
    const granLabel = useOverlayDaily ? 'day' : 'week';
    createChart('creditVsRequestsChart', 'line', {
      labels: overlayLabels,
      datasets: [
        { label: `AI Credits (peak: ${formatNum(Math.round(creditMax))}/${granLabel})`, data: creditNorm, borderColor: PALETTE[0], backgroundColor: PALETTE[0] + '20', borderWidth: 2, pointRadius: 1, fill: true, tension: 0.3 },
        { label: `Premium Requests (peak: ${formatNum(Math.round(reqMax))}/${granLabel})`, data: reqNorm, borderColor: PALETTE[3], backgroundColor: PALETTE[3] + '20', borderWidth: 2, pointRadius: 1, fill: true, tension: 0.3 },
      ],
    }, {
      plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (ctx: { dataset: { label: string }; raw: number }) => `${ctx.dataset.label}: ${ctx.raw}% of peak` } } },
      scales: {
        x: { ticks: { maxTicksLimit: 15 } },
        y: { beginAtZero: true, max: 100, title: { display: true, text: '% of peak' }, ticks: { callback: (v: number) => v + '%' } },
      },
    });

    // Wire chart tab switching
    for (const btn of target.querySelectorAll<HTMLButtonElement>('.chart-tab')) {
      btn.addEventListener('click', () => {
        for (const b of target.querySelectorAll<HTMLButtonElement>('.chart-tab')) b.classList.remove('active');
        btn.classList.add('active');
        const tab = btn.dataset.chartTab;
        const panels = target.querySelectorAll<HTMLElement>('.chart-tab-panel');
        for (const p of panels) p.classList.remove('active');
        const panelMap: Record<string, string> = { credits: 'chartTabCredits', 'tokens-ws': 'chartTabTokensWs', overlay: 'chartTabOverlay' };
        document.getElementById(panelMap[tab || 'credits'])!.classList.add('active');
      });
    }
  }


  async function renderActiveTab(): Promise<void> {
    if (activeTab === 'production') await renderProductionTab();
    else if (activeTab === 'ai-credits') await renderAiCreditsTab();
    else await renderConsumptionTab();
  }

  // Initial render — honour the persisted active tab
  await renderActiveTab();

  // Viewport-aware badge popup positioning — uses position:fixed and
  // clamps to viewport edges so popups never overflow off-screen.
  document.body.addEventListener('mouseenter', (e) => {
    const trigger = (e.target as HTMLElement).closest?.('.badge-popup-trigger');
    if (!trigger) return;
    const popup = trigger.querySelector('.badge-popup') as HTMLElement | null;
    if (!popup) return;
    popup.style.left = '';
    popup.style.top = '';
    const tr = trigger.getBoundingClientRect();
    const pw = 280;
    const pad = 8;
    let left = tr.left + tr.width / 2 - pw / 2;
    if (left < pad) left = pad;
    if (left + pw > window.innerWidth - pad) left = window.innerWidth - pad - pw;
    const top = tr.top - 6;
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.style.transform = 'translateY(-100%)';
    // After display, verify it doesn't overflow top; if so, show below.
    requestAnimationFrame(() => {
      const pr = popup.getBoundingClientRect();
      if (pr.top < pad) {
        popup.style.top = `${tr.bottom + 6}px`;
        popup.style.transform = 'none';
      }
    });
  }, true);

  // Date range switching — re-renders the active tab. Disabled buttons
  // (greyed out for token-data tabs whose nominal start lies before the
  // TOKEN_DATA_AVAILABLE_FROM cutoff) are ignored on click.
  document.getElementById('outputRange')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.cons-range-btn');
    if (!btn) return;
    if (btn.hasAttribute('disabled')) return;
    const days = Number(btn.dataset.range);
    if (isRangeDisabled(activeTab, days)) return;
    activeRangeDays = days;
    refreshRangeBar();
    void renderActiveTab();
  });

  // Tab switching — refresh range bar so disabled state matches the new tab,
  // and snap the active range to a valid one if the user's previous choice
  // is no longer available on this tab.
  document.getElementById('output-tabs')!.addEventListener('click', (e) => {
    void (async () => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.tab');
      if (!btn) return;
      for (const t of $$('#output-tabs .tab')) t.classList.remove('active');
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      if (!tab) return;
      activeTab = tab as OutputTab;
      snapActiveRangeIfDisabled();
      refreshRangeBar();
      await renderActiveTab();
    })();
  });
}
