/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Insights page renderer -- learning velocity, intent classification, spec-driven,
   production/review ratio, sustainable pace, prompt maturity, migration readiness */

import { DateFilter, INTENT_COLORS, SessionIntent, SESSION_INTENTS } from '../core/types';
import { rpc, createChart, formatNum, COLORS, PALETTE } from './shared';
import { html, render, StatCard, CanvasEl } from './render';

interface LearningVelocityData {
  totalLanguagesEncountered: number;
  totalNewLanguagesLearned: number;
  velocityTrend: { labels: string[]; newLanguages: number[]; cumulativeLanguages: number[] };
  topLanguages: { language: string; firstSeen: string; weekCount: number }[];
}

interface IntentClassificationData {
  distribution: Record<SessionIntent, number>;
  weeklyDistribution: { labels: string[]; series: Record<SessionIntent, number[]> };
  avgRequestsByIntent: Record<SessionIntent, number>;
}

interface SpecDrivenData {
  totalSessions: number;
  specDrivenCount: number;
  specDrivenRate: number;
  weeklyTrend: { labels: string[]; specDriven: number[]; unstructured: number[] };
  unstructuredExamples: { workspaceName: string; firstPrompt: string; date: string }[];
}

interface ProductionReviewData {
  totalAiLoc: number;
  estimatedReviewedLoc: number;
  reviewRatio: number;
  weeklyTrend: { labels: string[]; produced: number[]; estimated_reviewed: number[] };
  sessionsWithoutReview: number;
  avgReviewGapSec: number;
}

interface SustainablePaceData {
  weeklyTrend: {
    labels: string[];
    lateNightReqs: number[];
    weekendReqs: number[];
    totalReqs: number[];
    avgSessionLength: number[];
  };
  burnoutRisk: 'low' | 'medium' | 'high';
  alerts: string[];
  currentStreak: number;
  weekendTrending: 'stable' | 'increasing' | 'decreasing';
  lateNightTrending: 'stable' | 'increasing' | 'decreasing';
}

interface PromptMaturityData {
  overallGrade: string;
  score: number;
  dimensions: {
    constraints: number;
    successCriteria: number;
    verificationSteps: number;
    contextProvision: number;
    specificity: number;
  };
  weeklyTrend: { labels: string[]; scores: number[] };
  samplePrompts: { text: string; grade: string; issues: string[] }[];
}

interface MigrationReadinessData {
  primaryHarness: string;
  missingFeatures: { feature: string; availableIn: string[]; description: string }[];
  readinessScore: number;
  featureUsage: { feature: string; used: boolean; harnesses: string[] }[];
}

interface InsightsData {
  learningVelocity: LearningVelocityData;
  intentClassification: IntentClassificationData;
  specDriven: SpecDrivenData;
  productionReview: ProductionReviewData;
  sustainablePace: SustainablePaceData;
  promptMaturity: PromptMaturityData;
  migrationReadiness: MigrationReadinessData;
}

function riskColor(risk: string): string {
  return risk === 'high' ? 'var(--accent-red, #f85149)' : risk === 'medium' ? 'var(--accent-yellow, #d29922)' : 'var(--accent-green, #3fb950)';
}

function gradeColor(grade: string): string {
  if (grade === 'A') return COLORS.green;
  if (grade === 'B') return COLORS.blue;
  if (grade === 'C') return COLORS.yellow;
  if (grade === 'D') return COLORS.orange;
  return COLORS.red;
}

function trendIcon(t: string) {
  if (t === 'increasing') return html`<span style="color:var(--accent-red, #f85149);">\u25B2 Increasing</span>`;
  if (t === 'decreasing') return html`<span style="color:var(--accent-green, #3fb950);">\u25BC Decreasing</span>`;
  return html`<span style="color:var(--text-muted, #8b949e);">\u2594 Stable</span>`;
}

export async function renderInsights(container: HTMLElement, currentFilter: DateFilter): Promise<void> {
  const data = await rpc<InsightsData>('getInsights', currentFilter as Record<string, unknown>);

  render(html`
    <h1>Insights</h1>
    <div id="insights-learning"></div>
    <div id="insights-intent"></div>
    <div id="insights-spec"></div>
    <div id="insights-prodreview"></div>
    <div id="insights-pace"></div>
    <div id="insights-prompt"></div>
    <div id="insights-migration"></div>
  `, container);

  renderLearningVelocity(document.getElementById('insights-learning')!, data.learningVelocity);
  renderIntentClassification(document.getElementById('insights-intent')!, data.intentClassification);
  renderSpecDriven(document.getElementById('insights-spec')!, data.specDriven);
  renderProductionReview(document.getElementById('insights-prodreview')!, data.productionReview);
  renderSustainablePace(document.getElementById('insights-pace')!, data.sustainablePace);
  renderPromptMaturity(document.getElementById('insights-prompt')!, data.promptMaturity);
  renderMigrationReadiness(document.getElementById('insights-migration')!, data.migrationReadiness);
}

/* ── Learning Velocity ────────────────────────────────────────────── */

function renderLearningVelocity(container: HTMLElement, lv: LearningVelocityData): void {
  const recentNew = lv.velocityTrend.newLanguages.slice(-4);
  const recentVelocity = recentNew.reduce((a, b) => a + b, 0);

  render(html`
    <h2>Learning Velocity</h2>
    <p class="section-desc">Track how many new programming languages you touch over time. AI is a learning accelerator -- surface that.</p>
    <div class="stat-grid">
      <${StatCard} label="Total Languages" value=${String(lv.totalLanguagesEncountered)} accent=${COLORS.blue} />
      <${StatCard} label="New Languages (last 4w)" value=${String(recentVelocity)} accent=${recentVelocity > 0 ? COLORS.green : COLORS.muted} />
      <${StatCard} label="Peak Week" value=${lv.velocityTrend.newLanguages.length > 0 ? String(Math.max(...lv.velocityTrend.newLanguages)) + ' new' : '0'} accent=${COLORS.purple} />
    </div>
    ${lv.velocityTrend.labels.length > 1 ? html`
    <div class="chart-grid">
      <div class="chart-card">
        <h3>New Languages per Week</h3>
        <${CanvasEl} id="lvNewChart" height=${220} />
      </div>
      <div class="chart-card">
        <h3>Cumulative Language Exposure</h3>
        <${CanvasEl} id="lvCumChart" height=${220} />
      </div>
    </div>` : ''}
    ${lv.topLanguages.length > 0 ? html`
    <div class="chart-card" style="margin-top:1rem;">
      <h3>Language Timeline</h3>
      <div class="tag-list">${lv.topLanguages.map((l, i) =>
        html`<span class="tag" style=${`border-left:3px solid ${PALETTE[i % PALETTE.length]};`}>${l.language} <small>(since ${l.firstSeen}, ${l.weekCount}w)</small></span>`
      )}</div>
    </div>` : ''}
  `, container);

  if (lv.velocityTrend.labels.length > 1) {
    createChart('lvNewChart', 'bar', {
      labels: lv.velocityTrend.labels,
      datasets: [{ label: 'New Languages', data: lv.velocityTrend.newLanguages, backgroundColor: COLORS.green + '80', borderColor: COLORS.green, borderWidth: 1, borderRadius: 4 }],
    }, { plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 15 } }, y: { beginAtZero: true, ticks: { stepSize: 1 } } } });

    createChart('lvCumChart', 'line', {
      labels: lv.velocityTrend.labels,
      datasets: [{ label: 'Cumulative Languages', data: lv.velocityTrend.cumulativeLanguages, borderColor: COLORS.blue, backgroundColor: COLORS.blue + '20', fill: true, tension: 0.3 }],
    }, { plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 15 } }, y: { beginAtZero: true } } });
  }
}

/* ── Intent Classification ────────────────────────────────────────── */

function renderIntentClassification(container: HTMLElement, ic: IntentClassificationData): void {
  const total = SESSION_INTENTS.reduce((s, i) => s + ic.distribution[i], 0);

  render(html`
    <h2 style="margin-top:2rem;">Session Intent Classification</h2>
    <p class="section-desc">Each session is tagged as Planning, Implementation, Debugging, Review, or Exploration based on prompt analysis.</p>
    <div class="stat-grid">
      ${SESSION_INTENTS.map(intent =>
        html`<${StatCard} label=${intent} value=${String(ic.distribution[intent])} accent=${INTENT_COLORS[intent]} />`
      )}
    </div>
    <div class="chart-grid">
      <div class="chart-card">
        <h3>Intent Distribution</h3>
        <${CanvasEl} id="intentPieChart" height=${260} />
      </div>
      <div class="chart-card">
        <h3>Avg Requests by Intent</h3>
        <${CanvasEl} id="intentAvgChart" height=${260} />
      </div>
    </div>
    ${ic.weeklyDistribution.labels.length > 1 ? html`
    <div class="chart-card" style="margin-top:1rem;">
      <h3>Weekly Intent Mix</h3>
      <${CanvasEl} id="intentWeeklyChart" height=${240} />
    </div>` : ''}
  `, container);

  if (total > 0) {
    createChart('intentPieChart', 'doughnut', {
      labels: SESSION_INTENTS,
      datasets: [{ data: SESSION_INTENTS.map(i => ic.distribution[i]), backgroundColor: SESSION_INTENTS.map(i => INTENT_COLORS[i]), borderWidth: 0 }],
    }, { plugins: { legend: { position: 'right' } } });

    createChart('intentAvgChart', 'bar', {
      labels: SESSION_INTENTS,
      datasets: [{ label: 'Avg Requests', data: SESSION_INTENTS.map(i => ic.avgRequestsByIntent[i]), backgroundColor: SESSION_INTENTS.map(i => INTENT_COLORS[i]), borderRadius: 4 }],
    }, { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } });
  }

  if (ic.weeklyDistribution.labels.length > 1) {
    createChart('intentWeeklyChart', 'bar', {
      labels: ic.weeklyDistribution.labels,
      datasets: SESSION_INTENTS.map(intent => ({
        label: intent,
        data: ic.weeklyDistribution.series[intent],
        backgroundColor: INTENT_COLORS[intent] + '90',
        borderColor: INTENT_COLORS[intent],
        borderWidth: 1,
      })),
    }, {
      plugins: { legend: { position: 'top' } },
      scales: { x: { stacked: true, ticks: { maxTicksLimit: 15 } }, y: { stacked: true, beginAtZero: true } },
    });
  }
}

/* ── Spec-Driven ──────────────────────────────────────────────────── */

function renderSpecDriven(container: HTMLElement, sd: SpecDrivenData): void {
  const rateColor = sd.specDrivenRate >= 0.5 ? COLORS.green : sd.specDrivenRate >= 0.2 ? COLORS.yellow : COLORS.red;

  render(html`
    <h2 style="margin-top:2rem;">Spec-Driven Development</h2>
    <p class="section-desc">Sessions that start with structured specs, plans, or design docs produce better outcomes. Spec-first beats vibe-coding.</p>
    <div class="stat-grid">
      <${StatCard} label="Total Sessions (3+ reqs)" value=${String(sd.totalSessions)} accent=${COLORS.blue} />
      <${StatCard} label="Spec-Driven" value=${String(sd.specDrivenCount)} accent=${COLORS.green} />
      <${StatCard} label="Spec Rate" value=${(sd.specDrivenRate * 100).toFixed(0) + '%'} accent=${rateColor} />
      <${StatCard} label="Unstructured" value=${String(sd.totalSessions - sd.specDrivenCount)} accent=${sd.totalSessions - sd.specDrivenCount > 0 ? COLORS.red : COLORS.green} />
    </div>
    ${sd.weeklyTrend.labels.length > 1 ? html`
    <div class="chart-card" style="margin-top:1rem;">
      <h3>Weekly Spec vs Unstructured Sessions</h3>
      <${CanvasEl} id="specWeeklyChart" height=${220} />
    </div>` : ''}
    ${sd.unstructuredExamples.length > 0 ? html`
    <div class="chart-card" style="margin-top:1rem;">
      <h3>Unstructured Session Examples</h3>
      <div class="examples-list">${sd.unstructuredExamples.map(ex => html`
        <div class="example-item">
          <span class="muted">${ex.date}</span>
          <strong>${ex.workspaceName}</strong>:
          <em>"${ex.firstPrompt}"</em>
        </div>
      `)}</div>
    </div>` : ''}
  `, container);

  if (sd.weeklyTrend.labels.length > 1) {
    createChart('specWeeklyChart', 'bar', {
      labels: sd.weeklyTrend.labels,
      datasets: [
        { label: 'Spec-Driven', data: sd.weeklyTrend.specDriven, backgroundColor: COLORS.green + '80', borderColor: COLORS.green, borderWidth: 1 },
        { label: 'Unstructured', data: sd.weeklyTrend.unstructured, backgroundColor: COLORS.red + '40', borderColor: COLORS.red, borderWidth: 1 },
      ],
    }, {
      plugins: { legend: { position: 'top' } },
      scales: { x: { stacked: true, ticks: { maxTicksLimit: 15 } }, y: { stacked: true, beginAtZero: true } },
    });
  }
}

/* ── Production vs Review ─────────────────────────────────────────── */

function renderProductionReview(container: HTMLElement, pr: ProductionReviewData): void {
  const ratioColor = pr.reviewRatio >= 0.5 ? COLORS.green : pr.reviewRatio >= 0.25 ? COLORS.yellow : COLORS.red;

  render(html`
    <h2 style="margin-top:2rem;">Production vs Review Ratio</h2>
    <p class="section-desc">Velocity without understanding creates knowledge debt. How much AI-generated code are you actually reviewing?</p>
    <div class="stat-grid">
      <${StatCard} label="AI-Generated LoC" value=${formatNum(pr.totalAiLoc)} accent=${COLORS.blue} />
      <${StatCard} label="Est. Reviewed LoC" value=${formatNum(pr.estimatedReviewedLoc)} accent=${COLORS.green} />
      <${StatCard} label="Review Ratio" value=${(pr.reviewRatio * 100).toFixed(0) + '%'} accent=${ratioColor} />
      <${StatCard} label="Sessions w/o Review" value=${String(pr.sessionsWithoutReview)} accent=${pr.sessionsWithoutReview > 0 ? COLORS.red : COLORS.green} />
    </div>
    ${pr.avgReviewGapSec > 0 ? html`<p class="muted" style="margin-top:0.5rem;">Average review gap: ${pr.avgReviewGapSec}s (time between receiving AI code and next message)</p>` : ''}
    ${pr.weeklyTrend.labels.length > 1 ? html`
    <div class="chart-card" style="margin-top:1rem;">
      <h3>Weekly Production vs Reviewed</h3>
      <${CanvasEl} id="prWeeklyChart" height=${220} />
    </div>` : ''}
  `, container);

  if (pr.weeklyTrend.labels.length > 1) {
    createChart('prWeeklyChart', 'bar', {
      labels: pr.weeklyTrend.labels,
      datasets: [
        { label: 'Produced (AI LoC)', data: pr.weeklyTrend.produced, backgroundColor: COLORS.blue + '60', borderColor: COLORS.blue, borderWidth: 1 },
        { label: 'Est. Reviewed', data: pr.weeklyTrend.estimated_reviewed, backgroundColor: COLORS.green + '60', borderColor: COLORS.green, borderWidth: 1 },
      ],
    }, {
      plugins: { legend: { position: 'top' } },
      scales: { x: { ticks: { maxTicksLimit: 15 } }, y: { beginAtZero: true } },
    });
  }
}

/* ── Sustainable Pace ─────────────────────────────────────────────── */

function renderSustainablePace(container: HTMLElement, sp: SustainablePaceData): void {
  render(html`
    <h2 style="margin-top:2rem;">Sustainable Pace</h2>
    <p class="section-desc">Alert before burnout, not after. Track late-night and weekend work trends.</p>
    <div class="stat-grid">
      <${StatCard} label="Burnout Risk" value=${sp.burnoutRisk.toUpperCase()} accent=${riskColor(sp.burnoutRisk)} />
      <${StatCard} label="Active Streak" value=${sp.currentStreak + ' days'} accent=${sp.currentStreak >= 14 ? COLORS.red : sp.currentStreak >= 7 ? COLORS.yellow : COLORS.green} />
      <${StatCard} label="Late-Night Trend" value=${''} accent=${COLORS.muted} />
      <${StatCard} label="Weekend Trend" value=${''} accent=${COLORS.muted} />
    </div>
    <div class="stat-grid" style="margin-top:0;">
      <div></div><div></div>
      <div style="text-align:center;margin-top:-1.5rem;">${trendIcon(sp.lateNightTrending)}</div>
      <div style="text-align:center;margin-top:-1.5rem;">${trendIcon(sp.weekendTrending)}</div>
    </div>
    ${sp.alerts.length > 0 ? html`
    <div class="alerts-box" style="margin-top:1rem;">
      ${sp.alerts.map(a => html`<div class="alert-item">${'\u26A0'} ${a}</div>`)}
    </div>` : html`<div class="success-box" style="margin-top:1rem;">No burnout warning signs detected. Keep it up!</div>`}
    ${sp.weeklyTrend.labels.length > 1 ? html`
    <div class="chart-grid" style="margin-top:1rem;">
      <div class="chart-card">
        <h3>Weekly Activity</h3>
        <${CanvasEl} id="paceWeeklyChart" height=${220} />
      </div>
      <div class="chart-card">
        <h3>After-Hours Work</h3>
        <${CanvasEl} id="paceAfterHoursChart" height=${220} />
      </div>
    </div>` : ''}
  `, container);

  if (sp.weeklyTrend.labels.length > 1) {
    createChart('paceWeeklyChart', 'line', {
      labels: sp.weeklyTrend.labels,
      datasets: [
        { label: 'Total Requests', data: sp.weeklyTrend.totalReqs, borderColor: COLORS.blue, backgroundColor: COLORS.blue + '20', fill: true, tension: 0.3 },
        { label: 'Avg Session Length', data: sp.weeklyTrend.avgSessionLength, borderColor: COLORS.purple, backgroundColor: 'transparent', tension: 0.3, yAxisID: 'y1' },
      ],
    }, {
      plugins: { legend: { position: 'top' } },
      scales: {
        x: { ticks: { maxTicksLimit: 15 } },
        y: { beginAtZero: true, title: { display: true, text: 'Requests' } },
        y1: { position: 'right', beginAtZero: true, title: { display: true, text: 'Avg Reqs/Session' }, grid: { drawOnChartArea: false } },
      },
    });

    createChart('paceAfterHoursChart', 'bar', {
      labels: sp.weeklyTrend.labels,
      datasets: [
        { label: 'Late-Night', data: sp.weeklyTrend.lateNightReqs, backgroundColor: COLORS.red + '70', borderColor: COLORS.red, borderWidth: 1 },
        { label: 'Weekend', data: sp.weeklyTrend.weekendReqs, backgroundColor: COLORS.yellow + '70', borderColor: COLORS.yellow, borderWidth: 1 },
      ],
    }, {
      plugins: { legend: { position: 'top' } },
      scales: { x: { stacked: true, ticks: { maxTicksLimit: 15 } }, y: { stacked: true, beginAtZero: true } },
    });
  }
}

/* ── Prompt Engineering Maturity ──────────────────────────────────── */

function renderPromptMaturity(container: HTMLElement, pm: PromptMaturityData): void {
  const dims = pm.dimensions;
  const dimLabels = ['Constraints', 'Success Criteria', 'Verification', 'Context', 'Specificity'];
  const dimValues = [dims.constraints, dims.successCriteria, dims.verificationSteps, dims.contextProvision, dims.specificity];

  render(html`
    <h2 style="margin-top:2rem;">Prompt Engineering Maturity</h2>
    <p class="section-desc">Grade prompt sophistication: constraints, success criteria, verification steps. Iterate on instructions like a prompt engineer.</p>
    <div class="stat-grid">
      <${StatCard} label="Overall Grade" value=${pm.overallGrade} accent=${gradeColor(pm.overallGrade)} />
      <${StatCard} label="Score" value=${pm.score + '/100'} accent=${gradeColor(pm.overallGrade)} />
      <${StatCard} label="Constraints" value=${dims.constraints + '%'} accent=${dims.constraints >= 50 ? COLORS.green : COLORS.red} />
      <${StatCard} label="Success Criteria" value=${dims.successCriteria + '%'} accent=${dims.successCriteria >= 50 ? COLORS.green : COLORS.red} />
    </div>
    <div class="chart-grid" style="margin-top:1rem;">
      <div class="chart-card">
        <h3>Maturity Dimensions</h3>
        <${CanvasEl} id="pmRadarChart" height=${280} />
      </div>
      ${pm.weeklyTrend.labels.length > 1 ? html`
      <div class="chart-card">
        <h3>Weekly Prompt Quality Trend</h3>
        <${CanvasEl} id="pmTrendChart" height=${280} />
      </div>` : html`<div></div>`}
    </div>
    ${pm.samplePrompts.length > 0 ? html`
    <div class="chart-card" style="margin-top:1rem;">
      <h3>Lowest-Scoring Prompts</h3>
      <div class="examples-list">${pm.samplePrompts.map(p => html`
        <div class="example-item">
          <span class="tag" style=${`background:${gradeColor(p.grade)}20;color:${gradeColor(p.grade)};`}>${p.grade}</span>
          <em>"${p.text}"</em>
          ${p.issues.length > 0 ? html`<div class="muted" style="margin-top:4px;font-size:0.85em;">${p.issues.join(' | ')}</div>` : ''}
        </div>
      `)}</div>
    </div>` : ''}
  `, container);

  createChart('pmRadarChart', 'radar', {
    labels: dimLabels,
    datasets: [{
      label: 'Your Prompts',
      data: dimValues,
      backgroundColor: COLORS.blue + '30',
      borderColor: COLORS.blue,
      borderWidth: 2,
      pointBackgroundColor: dimValues.map(v => v >= 50 ? COLORS.green : COLORS.red),
    }],
  }, {
    scales: { r: { beginAtZero: true, max: 100, ticks: { stepSize: 25 } } },
    plugins: { legend: { display: false } },
  });

  if (pm.weeklyTrend.labels.length > 1) {
    createChart('pmTrendChart', 'line', {
      labels: pm.weeklyTrend.labels,
      datasets: [{ label: 'Prompt Quality Score', data: pm.weeklyTrend.scores, borderColor: COLORS.purple, backgroundColor: COLORS.purple + '20', fill: true, tension: 0.3 }],
    }, { plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 15 } }, y: { beginAtZero: true, max: 100 } } });
  }
}

/* ── Migration Readiness ──────────────────────────────────────────── */

function renderMigrationReadiness(container: HTMLElement, mr: MigrationReadinessData): void {
  const scoreColor = mr.readinessScore >= 70 ? COLORS.green : mr.readinessScore >= 40 ? COLORS.yellow : COLORS.red;

  render(html`
    <h2 style="margin-top:2rem;">Migration Readiness</h2>
    <p class="section-desc">For users mostly on one harness, see what features you're missing from others.</p>
    <div class="stat-grid">
      <${StatCard} label="Primary Harness" value=${mr.primaryHarness || 'N/A'} accent=${COLORS.blue} />
      <${StatCard} label="Feature Utilization" value=${mr.readinessScore + '%'} accent=${scoreColor} />
      <${StatCard} label="Missing Features" value=${String(mr.missingFeatures.length)} accent=${mr.missingFeatures.length > 3 ? COLORS.red : mr.missingFeatures.length > 0 ? COLORS.yellow : COLORS.green} />
    </div>
    ${mr.featureUsage.length > 0 ? html`
    <div class="chart-card" style="margin-top:1rem;">
      <h3>Feature Utilization Matrix</h3>
      <table class="feature-matrix">
        <thead><tr><th>Feature</th><th>Used?</th><th>Available In</th></tr></thead>
        <tbody>${mr.featureUsage.map(fu => html`
          <tr>
            <td>${fu.feature}</td>
            <td style=${`color:${fu.used ? COLORS.green : COLORS.red};`}>${fu.used ? '\u2713 Yes' : '\u2717 No'}</td>
            <td class="muted">${fu.harnesses.join(', ')}</td>
          </tr>
        `)}</tbody>
      </table>
    </div>` : ''}
    ${mr.missingFeatures.length > 0 ? html`
    <div class="chart-card" style="margin-top:1rem;">
      <h3>Features You're Missing</h3>
      <div class="examples-list">${mr.missingFeatures.map(mf => html`
        <div class="example-item">
          <strong>${mf.feature}</strong>: ${mf.description}
          <div class="muted" style="margin-top:2px;">Available in: ${mf.availableIn.join(', ')}</div>
        </div>
      `)}</div>
    </div>` : ''}
  `, container);
}
