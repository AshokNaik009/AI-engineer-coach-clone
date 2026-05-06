/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Workflow Optimization page -- clusters repeated similar prompts and suggests skills */

import { DateFilter, WorkflowCluster, WorkflowOptimizationData } from '../core/types';
import { rpc, createChart, formatNum, COLORS } from './shared';
import { html, render, StatCard, CanvasEl } from './render';

export async function renderWorkflows(container: HTMLElement, currentFilter: DateFilter): Promise<void> {
  const data = await rpc<WorkflowOptimizationData>('getWorkflowOptimization', currentFilter as Record<string, unknown>);
  const clusters = data.clusters || [];
  const total = data.totalRepetitions || 0;
  const timeSaved = data.estimatedTimeSavedMins || 0;

  const highImpact = clusters.filter(c => c.occurrences >= 10).length;

  render(html`
    <h1>Workflow Optimization</h1>
    <p class="page-desc">Repeated prompts that could be turned into
      <strong>skills</strong> — reusable instruction sets that guide the AI through
      familiar workflows faster and more reliably.</p>
    <div class="stat-grid">
      <${StatCard} label="Repeated Workflows" value=${String(clusters.length)} accent="var(--accent-blue, #58a6ff)" />
      <${StatCard} label="Total Repetitions" value=${formatNum(total)} accent="var(--accent-purple, #bc8cff)" />
      <${StatCard} label="Potential Time Saved" value=${timeSaved >= 60 ? Math.round(timeSaved / 60) + 'h' : timeSaved + 'min'} accent="var(--accent-green, #3fb950)" />
      <${StatCard} label="High-Impact (10+)" value=${String(highImpact)} accent="var(--accent-yellow, #d29922)" />
    </div>
    <div class="chart-grid">
      <div class="chart-card">
        <h3>Top Repeated Workflows</h3>
        <${CanvasEl} id="wfTopChart" height=${300} />
      </div>
      <div class="chart-card">
        <h3>Workspaces with Most Repeated Workflows</h3>
        <${CanvasEl} id="wfWsChart" height=${300} />
      </div>
    </div>
    <div id="wfClusters" style="margin-top: 1.5rem;">
      ${clusters.length === 0
        ? html`<p class="muted">No repeated workflows detected. Your prompts are diverse!</p>`
        : clusters.map(c => html`<${ClusterCard} cluster=${c} />`)}
    </div>
  `, container);

  // --- Top workflows bar chart ---
  if (clusters.length > 0) {
    const top = clusters.slice(0, 15);
    createChart('wfTopChart', 'bar', {
      labels: top.map(c => truncateLabel(c.label, 40)),
      datasets: [{
        label: 'Repetitions',
        data: top.map(c => c.occurrences),
        backgroundColor: top.map(c =>
          c.occurrences >= 10 ? COLORS.yellow : c.occurrences >= 5 ? COLORS.blue : COLORS.green
        ),
        borderRadius: 4,
      }],
    }, {
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, title: { display: true, text: 'Occurrences' } },
        y: { grid: { display: false } },
      },
    });
  }

  // --- Workspaces chart ---
  if (data.topWorkspaces && data.topWorkspaces.length > 0) {
    const ws = data.topWorkspaces;
    createChart('wfWsChart', 'bar', {
      labels: ws.map(w => truncateLabel(w.name, 30)),
      datasets: [{
        label: 'Workflow Clusters',
        data: ws.map(w => w.clusters),
        backgroundColor: COLORS.purple,
        borderRadius: 4,
      }],
    }, {
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, title: { display: true, text: 'Clusters Involved' } },
        y: { grid: { display: false } },
      },
    });
  }
}

function ClusterCard({ cluster: c }: { cluster: WorkflowCluster }) {
  const impactColor = c.occurrences >= 10 ? COLORS.yellow : c.occurrences >= 5 ? COLORS.blue : COLORS.green;
  const impactLabel = c.occurrences >= 10 ? 'high' : c.occurrences >= 5 ? 'medium' : 'low';

  return html`
    <div class="wf-card">
      <div class="wf-card-header">
        <span class="wf-impact-dot" style=${'background:' + impactColor}></span>
        <h3>${c.label}</h3>
        <span class="wf-badge" style=${'background:' + impactColor}>${impactLabel} impact</span>
      </div>
      <div class="wf-meta">
        <span>${c.occurrences} repetitions</span>
        <span>${c.sessions} session${c.sessions !== 1 ? 's' : ''}</span>
        <span>${c.workspaces.length} workspace${c.workspaces.length !== 1 ? 's' : ''}</span>
        ${c.cancelRate > 0 && html`<span>${c.cancelRate}% cancelled</span>`}
        ${c.avgCorrectionTurns > 0 && html`<span>~${c.avgCorrectionTurns} corrections/session</span>`}
      </div>
      ${c.firstSeen && c.lastSeen && html`<div class="wf-dates">${c.firstSeen} \u2014 ${c.lastSeen}</div>`}
      <div class="wf-suggestion">
        <strong>Skill opportunity:</strong> Create a reusable skill that codifies the steps
        for this workflow, so the AI can handle it faster without repeated corrections.
      </div>
      ${c.examples.length > 0 && html`
        <details class="wf-examples">
          <summary>${c.examples.length} example prompt${c.examples.length !== 1 ? 's' : ''}</summary>
          <ul>${c.examples.map(ex => html`<li>${ex}</li>`)}</ul>
        </details>
      `}
      <details class="wf-skill-draft">
        <summary>Skill template</summary>
        <pre class="wf-skill-code">${c.skillDraft}</pre>
      </details>
    </div>
  `;
}

function truncateLabel(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}
