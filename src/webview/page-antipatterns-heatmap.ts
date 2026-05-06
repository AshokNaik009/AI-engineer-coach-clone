/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Rule coverage heatmap for the Anti-Patterns page — Preact/htm (no innerHTML). */

import { DateFilter } from '../core/types';
import { rpc } from './shared';
import { html, render } from './render';

interface CoverageData {
  rules: Array<{ id: string; name: string; group: string }>;
  workspaces: string[];
  matrix: Record<string, Record<string, number>>;
  error?: string;
}

const GROUP_COLORS: Record<string, string> = {
  'prompt-quality': '#3b82f6',
  'session-hygiene': '#f59e0b',
  'code-review': '#ef4444',
  'tool-mastery': '#10b981',
  'context-management': '#8b5cf6',
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.substring(0, max - 2) + '\u2026' : s;
}

function computeTotals(data: CoverageData): { maxVal: number; ruleTotals: Record<string, number>; wsTotals: Record<string, number> } {
  let maxVal = 0;
  const ruleTotals: Record<string, number> = {};
  const wsTotals: Record<string, number> = {};
  for (const r of data.rules) {
    const byWs = data.matrix[r.id] || {};
    let rt = 0;
    for (const ws of data.workspaces) {
      const v = byWs[ws] || 0;
      if (v > maxVal) maxVal = v;
      rt += v;
      wsTotals[ws] = (wsTotals[ws] || 0) + v;
    }
    ruleTotals[r.id] = rt;
  }
  return { maxVal, ruleTotals, wsTotals };
}

/* ---- Components ---- */

function Loading() {
  return html`<div class="rule-coverage-loading">Computing coverage...</div>`;
}

function ErrorMsg({ message }: { message: string }) {
  return html`<div class="rule-coverage-error">Error: ${message}</div>`;
}

function Empty({ message }: { message: string }) {
  return html`<div class="rule-coverage-empty">${message}</div>`;
}

function HeaderCells({ workspaces, wsTotals }: { workspaces: string[]; wsTotals: Record<string, number> }) {
  return html`
    <div class="rcv-cell rcv-head rcv-head-rule" data-col="0">Rule</div>
    <div class="rcv-cell rcv-head rcv-head-total" data-col="1" title="Total across all workspaces">Total</div>
    ${workspaces.map((ws, i) => html`
      <div class="rcv-cell rcv-head rcv-head-ws" data-col=${i + 2} title=${ws} key=${ws}>
        <span class="rcv-head-ws-label">${truncate(ws, 22)}</span>
        <span class="rcv-head-ws-total">${wsTotals[ws] || 0}</span>
      </div>
    `)}
  `;
}

function DataRow({ rule, rowIdx, workspaces, matrix, ruleTotals, maxVal }: {
  rule: CoverageData['rules'][0];
  rowIdx: number;
  workspaces: string[];
  matrix: Record<string, Record<string, number>>;
  ruleTotals: Record<string, number>;
  maxVal: number;
}) {
  const byWs = matrix[rule.id] || {};
  const groupColor = GROUP_COLORS[rule.group] || '#64748b';
  const rowBg = rowIdx % 2 === 0 ? 'rcv-row-even' : 'rcv-row-odd';

  return html`
    <div class=${'rcv-cell rcv-rule ' + rowBg} title=${`${rule.id} \u2014 ${rule.group}`}>
      <span class="rcv-rule-dot" style=${'background:' + groupColor}></span>
      <span class="rcv-rule-name">${truncate(rule.name, 32)}</span>
    </div>
    <div class=${'rcv-cell rcv-total ' + rowBg}>${ruleTotals[rule.id] || 0}</div>
    ${workspaces.map(ws => {
      const v = byWs[ws] || 0;
      const intensity = maxVal > 0 ? v / maxVal : 0;
      const alpha = v === 0 ? 0 : 0.18 + intensity * 0.72;
      const bg = v === 0 ? 'transparent' : `rgba(234,179,8,${alpha.toFixed(2)})`;
      const textColor = intensity > 0.55 ? '#0a0a0a' : 'currentColor';
      return html`
        <div key=${ws}
          class=${'rcv-cell rcv-data ' + rowBg}
          style=${'background:' + bg + ';color:' + textColor}
          title=${`${rule.name} \u00d7 ${ws}: ${v}`}
        >${v > 0 ? v : ''}</div>
      `;
    })}
  `;
}

function Heatmap({ data }: { data: CoverageData }) {
  const { maxVal, ruleTotals, wsTotals } = computeTotals(data);
  const gridTemplate = `220px 56px repeat(${data.workspaces.length}, 64px)`;

  return html`
    <div class="rcv-legend">
      <span>Showing <strong>${data.rules.length}</strong> triggered rule(s) \u00d7 <strong>${data.workspaces.length}</strong> workspace(s). Darker = more occurrences.</span>
      <span class="rcv-scale">
        <span class="rcv-scale-label">0</span>
        <span class="rcv-scale-gradient"></span>
        <span class="rcv-scale-label">${maxVal}</span>
      </span>
    </div>
    <div class="rcv-scroll">
      <div class="rcv-grid" style=${'grid-template-columns:' + gridTemplate}>
        <${HeaderCells} workspaces=${data.workspaces} wsTotals=${wsTotals} />
        ${data.rules.map((r, i) => html`
          <${DataRow} key=${r.id} rule=${r} rowIdx=${i}
            workspaces=${data.workspaces} matrix=${data.matrix}
            ruleTotals=${ruleTotals} maxVal=${maxVal} />
        `)}
      </div>
    </div>
  `;
}

/**
 * Render the rule coverage heatmap (rules x workspaces) into `container`.
 * Uses Preact for DOM-safe rendering — zero innerHTML.
 */
export async function renderCoverageHeatmap(container: HTMLElement, currentFilter: DateFilter): Promise<void> {
  const body = container.querySelector<HTMLElement>('#rule-coverage-body')!;
  render(html`<${Loading} />`, body);

  try {
    const data = await rpc<CoverageData>('getRuleCoverage', { filter: currentFilter as Record<string, unknown> });

    if (data.error) {
      render(html`<${ErrorMsg} message=${data.error} />`, body);
      return;
    }
    if (data.rules.length === 0) {
      render(html`<${Empty} message="No rules triggered in the current filter range." />`, body);
      return;
    }
    if (data.workspaces.length === 0) {
      render(html`<${Empty} message="No workspace data available." />`, body);
      return;
    }

    render(html`<${Heatmap} data=${data} />`, body);
  } catch (err: unknown) {
    render(html`<${ErrorMsg} message=${err instanceof Error ? err.message : String(err)} />`, body);
  }
}
