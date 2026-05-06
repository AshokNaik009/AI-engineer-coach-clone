/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Burndown page renderer */

import { DateFilter } from '../core/types';
import { rpc, createChart, destroyChartById, COLORS } from './shared';
import { html, render, CanvasEl } from './render';

interface BdData {
  dayOfMonth: number;
  daysInMonth: number;
  dailyConsumption: { labels: string[]; cumulative: number[] };
  projectedLine: number[];
  budgetLine: number[];
  status: string;
  consumed: number;
  budget: number;
  projected: number;
  recommendation: string;
}

interface AiCreditBdData extends BdData {
  daysUntilExhaustion: number | null;
  safeDailyBudget: number;
  projectedOverageUsd: number;
  missingPct: number;
  totalRequests: number;
  countedRequests: number;
  partialRequests: number;
  pendingRequests: number;
  noDataRequests: number;
  finalizableRequests: number;
  coverageByDay: {
    complete: number[];
    partial: number[];
    pending: number[];
    noData: number[];
    missing: number[];
  };
}

function renderBurndownChartLater(renderBurndownChart: () => Promise<void>): void {
  void renderBurndownChart();
}

function CreditExtraInfo({ bd }: { bd: AiCreditBdData }) {
  const trulyMissing = bd.finalizableRequests - bd.countedRequests - bd.partialRequests;
  return html`
    <p>
      ${bd.daysUntilExhaustion != null && html`<strong>Days to exhaustion:</strong> ${bd.daysUntilExhaustion} | `}
      <strong>Safe daily budget:</strong> ${Math.round(bd.safeDailyBudget)} credits/day |${' '}
      ${bd.projectedOverageUsd > 0 && html`<strong>Projected overage:</strong> $${bd.projectedOverageUsd.toFixed(2)} | `}
      ${bd.finalizableRequests > 0 && bd.missingPct > 0 && html` <span class="missing-badge" title=${trulyMissing + ' of ' + bd.finalizableRequests + ' finalizable requests have no token data and were not counted toward credit usage.'}>missing ${bd.missingPct}%</span>`}
      ${bd.partialRequests > 0 && html` <span class="pending-badge" title=${bd.partialRequests + ' output-only requests in this period (excluded from missing %)'}>+${bd.partialRequests} partial</span>`}
      ${bd.pendingRequests > 0 && html` <span class="pending-badge" title=${bd.pendingRequests + ' requests in active/aborted sessions (excluded from missing %)'}>+${bd.pendingRequests} pending</span>`}
      ${bd.noDataRequests > 0 && html` <span class="pending-badge" title=${bd.noDataRequests + ' requests where the harness/source did not record token data (excluded from missing %)'}>+${bd.noDataRequests} no-data</span>`}
    </p>
  `;
}

// Module-level view state — survives filter/harness changes.
const _now = new Date();
let selectedYear = _now.getFullYear();
let selectedMonth = _now.getMonth() + 1;

export function renderBurndown(container: HTMLElement, currentFilter: DateFilter): void {
  const skus = ['pro', 'pro-plus', 'business', 'enterprise'];

  const now = new Date();

  function formatMonthLabel(year: number, month: number): string {
    return new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
  }

  function isCurrentMonth(): boolean {
    return selectedYear === now.getFullYear() && selectedMonth === now.getMonth() + 1;
  }

  function navigateMonth(delta: number) {
    selectedMonth += delta;
    if (selectedMonth < 1) { selectedMonth = 12; selectedYear--; }
    else if (selectedMonth > 12) { selectedMonth = 1; selectedYear++; }
    document.getElementById('monthLabel')!.textContent = formatMonthLabel(selectedYear, selectedMonth);
    (document.getElementById('nextMonth') as HTMLButtonElement).disabled = isCurrentMonth();
    renderBurndownChartLater(renderBurndownChart);
  }

  render(html`
    <h1>Burndown</h1>
    <div class="approximation-notice">
      <strong>Approximation only.</strong>
      Burndown projections are estimated from the session data this extension
      can read on your machine. They cannot reflect activity on other devices,
      cloud-hosted agents, or harnesses this extension doesn't ingest, so they
      will never be fully accurate.
      Use them as a workflow optimization signal, not as a billing reference.
      For authoritative consumption numbers, see your
      <a href="https://github.com/settings/copilot/features" target="_blank" rel="noopener">GitHub Copilot usage settings</a>.
    </div>
    <div class="burndown-controls">
      <div class="month-nav">
        <button id="prevMonth" title="Previous month" onClick=${() => navigateMonth(-1)}>\u2190</button>
        <span id="monthLabel">${formatMonthLabel(selectedYear, selectedMonth)}</span>
        <button id="nextMonth" title="Next month" disabled onClick=${() => navigateMonth(1)}>\u2192</button>
      </div>
      <label>Plan: <select id="skuSelect" onChange=${() => renderBurndownChartLater(renderBurndownChart)}>
        ${skus.map(s => html`<option value=${s}>${s}</option>`)}
      </select></label>
      <label>Custom Budget: <input id="customBudget" type="number" placeholder="optional" style="width:80px"
        onChange=${() => renderBurndownChartLater(renderBurndownChart)} /></label>
      <label>Mode: <select id="burndownMode" onChange=${() => renderBurndownChartLater(renderBurndownChart)}>
        <option value="premium">Premium Requests</option>
        <option value="credits">AI Credits</option>
      </select></label>
    </div>
    <${CanvasEl} id="burndownChart" height=${350} />
    <div id="burndownStatus"></div>
  `, container);

  async function renderBurndownChart() {
    const sku = (document.getElementById('skuSelect') as HTMLSelectElement).value;
    const customVal = (document.getElementById('customBudget') as HTMLInputElement).value;
    const mode = (document.getElementById('burndownMode') as HTMLSelectElement).value;
    const month = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
    const config: Record<string, unknown> = { sku, month };
    if (customVal) config.customBudget = Number(customVal);

    const rpcMethod = mode === 'credits' ? 'getAiCreditBurndown' : 'getBurndown';
    const bd = await rpc<AiCreditBdData>(rpcMethod, { config, filter: { ...currentFilter, workspaceId: undefined } });
    destroyChartById('burndownChart');

    const unit = mode === 'credits' ? 'credits' : 'reqs';

    const actualLine = bd.dailyConsumption.cumulative.map((value, index) =>
      index < bd.dayOfMonth ? value : null,
    );

    createChart('burndownChart', 'line', {
      labels: bd.dailyConsumption.labels,
      datasets: [
        { label: `Cumulative (${unit})`, data: actualLine, borderColor: COLORS.blue, backgroundColor: COLORS.blue + '20', fill: true, borderWidth: 2, pointRadius: 1, spanGaps: false },
        { label: 'Projected', data: bd.projectedLine, borderColor: COLORS.yellow, borderDash: [5, 5], borderWidth: 2, pointRadius: 0, fill: false },
        { label: 'Budget', data: bd.budgetLine, borderColor: COLORS.red, borderDash: [10, 5], borderWidth: 2, pointRadius: 0, fill: false },
      ],
    }, {
      plugins: { legend: { position: 'top' } },
      scales: { y: { beginAtZero: true } },
    });

    const statusClass = bd.status === 'on-track' ? 'status-good'
      : bd.status === 'warning' ? 'status-warn'
      : bd.status === 'no-data' || bd.status === 'pending-only' ? 'status-nodata'
      : 'status-bad';

    const isPartial = mode === 'credits' && bd.missingPct > 0 && bd.status !== 'no-data' && bd.status !== 'pending-only';

    const statusEl = document.getElementById('burndownStatus')!;
    render(html`
      <div class=${'burndown-info ' + statusClass}>
        ${(bd.status === 'no-data' || bd.status === 'pending-only')
          ? html`<p><strong>Status:</strong> ${bd.status} \u2014 ${bd.status === 'pending-only' ? 'all requests in this period are still pending.' : 'no native token data available for this period.'}</p>`
          : html`<p>
              <strong>Status:</strong> ${bd.status} | <strong>Consumed:</strong> ${Math.round(bd.consumed)} / ${bd.budget} ${unit}${isPartial && html` <span class="missing-badge" title=${bd.missingPct + '% of finalizable requests in this period are missing native token data \u2014 these values are a lower bound.'}>lower bound</span>`} | <strong>Projected:</strong> ${Math.round(bd.projected)}${isPartial && html` <span class="missing-badge" title=${bd.missingPct + '% of finalizable requests in this period are missing native token data \u2014 these values are a lower bound.'}>lower bound</span>`}
            </p>`
        }
        ${mode === 'credits' && html`<${CreditExtraInfo} bd=${bd} />`}
        <p>${bd.recommendation}</p>
      </div>
    `, statusEl);
  }

  renderBurndownChartLater(renderBurndownChart);
}
