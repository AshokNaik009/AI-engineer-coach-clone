/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Tests for getTokenCoverage — verifies that per-harness/per-workspace token
 * coverage is computed correctly and that requests without billing data are
 * surfaced as missing rather than approximated. */

import { describe, it, expect } from 'vitest';
import { Analyzer } from './analyzer';
import { ModelUsage, Session, SessionRequest } from './types';
import { createRequest, createSession } from './parser-shared';

const BASE_TS = new Date(2025, 5, 15, 10, 0, 0).getTime();

function req(overrides: Partial<SessionRequest> = {}): SessionRequest {
  return createRequest({
    messageText: 'hi',
    responseText: 'reply',
    requestId: overrides.requestId ?? `r-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: overrides.timestamp ?? BASE_TS,
    promptTokens: overrides.promptTokens ?? null,
    completionTokens: overrides.completionTokens ?? null,
    modelId: overrides.modelId ?? 'gpt-5.5',
    ...overrides,
  });
}

function sess(opts: {
  harness: string;
  workspaceName: string;
  workspaceId?: string;
  requests: SessionRequest[];
  modelUsage?: Record<string, ModelUsage>;
}): Session {
  const base = createSession({
    sessionId: `s-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: opts.workspaceId ?? `ws-${opts.workspaceName}`,
    workspaceName: opts.workspaceName,
    harness: opts.harness,
    requests: opts.requests,
  });
  return opts.modelUsage ? { ...base, modelUsage: opts.modelUsage } : base;
}

describe('getTokenCoverage', () => {
  it('aggregates totals across multiple harnesses and workspaces', () => {
    const sessions = [
      sess({
        harness: 'Claude', workspaceName: 'proj-a',
        requests: [req({ promptTokens: 100, completionTokens: 50 })],
      }),
      sess({
        harness: 'OpenCode', workspaceName: 'proj-b',
        requests: [req({ promptTokens: 200, completionTokens: 100 })],
      }),
      sess({
        harness: 'Claude', workspaceName: 'proj-b',
        requests: [req({ promptTokens: 300, completionTokens: 150 })],
      }),
    ];
    const data = new Analyzer(sessions).getTokenCoverage();
    expect(data.totalSessions).toBe(3);
    expect(data.totalRequests).toBe(3);
    expect(data.totalWorkspaces).toBe(2);
    expect(data.totalHarnesses).toBe(2);
    expect(data.countedRequests).toBe(3);
    expect(data.missingPct).toBe(0);
    expect(data.totalInputTokens).toBe(600);
    expect(data.totalOutputTokens).toBe(300);
  });

  it('flags missing data per harness with a missingPct', () => {
    const sessions = [
      sess({
        harness: 'Claude', workspaceName: 'proj',
        requests: [
          req({ requestId: 'a1', promptTokens: 100, completionTokens: 50 }),
          req({ requestId: 'a2' }), // missing
        ],
      }),
      sess({
        harness: 'Codex', workspaceName: 'proj',
        requests: [
          req({ requestId: 'c1' }), // missing
          req({ requestId: 'c2' }), // missing
        ],
      }),
    ];
    const data = new Analyzer(sessions).getTokenCoverage();
    const claude = data.byHarness.find(h => h.harness === 'Claude')!;
    const codex = data.byHarness.find(h => h.harness === 'Codex')!;
    expect(claude.missingPct).toBe(50);
    expect(claude.countedRequests).toBe(1);
    expect(codex.missingPct).toBe(100);
    expect(codex.countedRequests).toBe(0);
    expect(codex.source).toBe('none');
    expect(claude.source).toBe('per-request');
    expect(data.missingPct).toBe(75);
  });

  it('marks CLI source as session-aggregated when modelUsage present', () => {
    const sessions = [
      sess({
        harness: 'GitHub Copilot CLI', workspaceName: 'cli-proj',
        modelUsage: { 'gpt-5.5': { inputTokens: 4000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 } },
        requests: [
          req({ modelId: 'gpt-5.5', completionTokens: 100 }),
          req({ modelId: 'gpt-5.5', completionTokens: 100 }),
        ],
      }),
    ];
    const data = new Analyzer(sessions).getTokenCoverage();
    const cli = data.byHarness.find(h => h.harness === 'GitHub Copilot CLI')!;
    expect(cli.source).toBe('session-aggregated');
    expect(cli.countedRequests).toBe(2);
    expect(cli.inputTokens).toBe(4000);
    expect(cli.outputTokens).toBe(200);
    expect(cli.missingPct).toBe(0);
  });

  it('marks source="mixed" when both per-request and aggregated are present in same harness', () => {
    // CLI session with two models — one in modelUsage (aggregated), one with
    // per-request data only (falls back to per-request path).
    const sessions = [
      sess({
        harness: 'GitHub Copilot CLI', workspaceName: 'p',
        modelUsage: { 'gpt-5.5': { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 } },
        requests: [
          req({ modelId: 'gpt-5.5', completionTokens: 100 }),
          req({ modelId: 'gpt-4o', promptTokens: 500, completionTokens: 250 }),
        ],
      }),
    ];
    const data = new Analyzer(sessions).getTokenCoverage();
    const cli = data.byHarness.find(h => h.harness === 'GitHub Copilot CLI')!;
    expect(cli.source).toBe('mixed');
  });

  it('sorts byHarness and byWorkspace by request count (desc)', () => {
    const sessions = [
      sess({ harness: 'Claude', workspaceName: 'big',
        requests: Array.from({ length: 5 }, () => req({ promptTokens: 10, completionTokens: 10 })),
      }),
      sess({ harness: 'Codex', workspaceName: 'small',
        requests: [req({ promptTokens: 10, completionTokens: 10 })],
      }),
    ];
    const data = new Analyzer(sessions).getTokenCoverage();
    expect(data.byHarness[0].harness).toBe('Claude');
    expect(data.byWorkspace[0].workspaceName).toBe('big');
  });

  it('returns empty result when no sessions', () => {
    const data = new Analyzer([]).getTokenCoverage();
    expect(data.totalSessions).toBe(0);
    expect(data.totalRequests).toBe(0);
    expect(data.totalWorkspaces).toBe(0);
    expect(data.totalHarnesses).toBe(0);
    expect(data.byHarness).toEqual([]);
    expect(data.byWorkspace).toEqual([]);
    expect(data.missingPct).toBe(0);
  });

  it('respects date filter — workspace with only out-of-range requests is excluded', () => {
    const inRange = new Date(2025, 5, 15).getTime();
    const outRange = new Date(2025, 5, 20).getTime();
    const sessions = [
      sess({ harness: 'Claude', workspaceName: 'in-window',
        requests: [req({ timestamp: inRange, promptTokens: 100, completionTokens: 50 })],
      }),
      sess({ harness: 'Claude', workspaceName: 'out-of-window',
        requests: [req({ timestamp: outRange, promptTokens: 100, completionTokens: 50 })],
      }),
    ];
    const data = new Analyzer(sessions).getTokenCoverage({
      fromDate: '2025-06-15', toDate: '2025-06-15',
    });
    expect(data.totalWorkspaces).toBe(1);
    expect(data.byWorkspace[0].workspaceName).toBe('in-window');
  });

  it('counts a session as covered when any of its requests has billing data', () => {
    const sessions = [
      sess({ harness: 'Claude', workspaceName: 'p',
        requests: [
          req({ requestId: 'a' }), // missing
          req({ requestId: 'b', promptTokens: 100, completionTokens: 50 }),
          req({ requestId: 'c' }), // missing
        ],
      }),
    ];
    const data = new Analyzer(sessions).getTokenCoverage();
    expect(data.countedSessions).toBe(1);
    expect(data.totalSessions).toBe(1);
    expect(data.countedRequests).toBe(1);
    expect(data.missingRequests).toBe(2);
  });

  it('emits per-session rows sorted worst-coverage-first', () => {
    const sessions = [
      sess({ harness: 'Claude', workspaceName: 'p',
        requests: [
          req({ requestId: 'g1', promptTokens: 100, completionTokens: 50 }),
          req({ requestId: 'g2', promptTokens: 100, completionTokens: 50 }),
        ],
      }),
      sess({ harness: 'Codex', workspaceName: 'p',
        requests: [
          req({ requestId: 'b1' }),
          req({ requestId: 'b2', promptTokens: 100, completionTokens: 50 }),
        ],
      }),
    ];
    const data = new Analyzer(sessions).getTokenCoverage();
    expect(data.bySession).toHaveLength(2);
    // Worst (50% missing) sorts before fully covered (0% missing)
    expect(data.bySession[0].harness).toBe('Codex');
    expect(data.bySession[0].missingPct).toBe(50);
    expect(data.bySession[0].source).toBe('per-request');
    expect(data.bySession[1].harness).toBe('Claude');
    expect(data.bySession[1].missingPct).toBe(0);
  });

  it('marks a session as session-aggregated source when modelUsage drives billing', () => {
    const sessions = [
      sess({
        harness: 'Codex', workspaceName: 'p',
        modelUsage: { 'gpt-5.3-codex': { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 } },
        requests: [
          req({ modelId: 'gpt-5.3-codex', completionTokens: 100 }),
          req({ modelId: 'gpt-5.3-codex', completionTokens: 100 }),
        ],
      }),
    ];
    const data = new Analyzer(sessions).getTokenCoverage();
    expect(data.bySession).toHaveLength(1);
    expect(data.bySession[0].source).toBe('session-aggregated');
    expect(data.bySession[0].countedRequests).toBe(2);
    expect(data.bySession[0].missingPct).toBe(0);
  });

  it('marks an entirely-missing session as source="none"', () => {
    const sessions = [
      sess({ harness: 'Claude', workspaceName: 'p',
        requests: [req({ requestId: 'm1' }), req({ requestId: 'm2' })],
      }),
    ];
    const data = new Analyzer(sessions).getTokenCoverage();
    expect(data.bySession).toHaveLength(1);
    expect(data.bySession[0].source).toBe('none');
    expect(data.bySession[0].countedRequests).toBe(0);
    expect(data.bySession[0].missingPct).toBe(100);
    expect(data.bySession[0].inputTokens).toBe(0);
  });

  it('excludes pending requests in active sessions from missing %', () => {
    const sessions = [
      // Active session — no shutdown event yet, no token data.
      sess({
        harness: 'GitHub Copilot CLI', workspaceName: 'live',
        requests: [req({ requestId: 'a1' }), req({ requestId: 'a2' })],
      }),
      // A separate normal session with full coverage so totals aren't all 0.
      sess({
        harness: 'Claude', workspaceName: 'done',
        requests: [req({ requestId: 'b1', promptTokens: 100, completionTokens: 50 })],
      }),
    ];
    sessions[0].endReason = 'active';
    const data = new Analyzer(sessions).getTokenCoverage();

    expect(data.activeSessions).toBe(1);
    expect(data.pendingRequests).toBe(2);
    // Only the Claude request is "finalizable" — the 2 active CLI reqs don't count.
    expect(data.countedRequests).toBe(1);
    expect(data.missingRequests).toBe(0);
    expect(data.missingPct).toBe(0);

    const cliRow = data.bySession.find(s => s.harness === 'GitHub Copilot CLI')!;
    expect(cliRow.endReason).toBe('active');
    expect(cliRow.pendingRequests).toBe(2);
    expect(cliRow.missingPct).toBe(0); // all pending → no finalizable, no missing
  });

  it('excludes pending requests in aborted sessions from missing %', () => {
    const sessions = [
      sess({
        harness: 'Codex', workspaceName: 'p',
        requests: [req({ requestId: 'x1' })],
      }),
    ];
    sessions[0].endReason = 'aborted';
    const data = new Analyzer(sessions).getTokenCoverage();

    expect(data.abortedSessions).toBe(1);
    expect(data.pendingRequests).toBe(1);
    expect(data.missingRequests).toBe(0);
    expect(data.missingPct).toBe(0);
    expect(data.bySession[0].endReason).toBe('aborted');
  });

  it('classifies output-only requests as partial, not counted or missing', () => {
    const sessions = [
      // VS Code copilot/auto: completionTokens present, promptTokens missing.
      sess({
        harness: 'Local Agent (Insiders)', workspaceName: 'auto',
        requests: [req({ requestId: 'p1', completionTokens: 500, promptTokens: null })],
      }),
    ];
    const data = new Analyzer(sessions).getTokenCoverage();

    expect(data.partialRequests).toBe(1);
    expect(data.partialOutputTokens).toBe(500);
    expect(data.countedRequests).toBe(0);
    expect(data.missingRequests).toBe(0);
    expect(data.missingPct).toBe(0); // partial != missing — output is real

    expect(data.byHarness[0].partialRequests).toBe(1);
    expect(data.byHarness[0].partialOutputTokens).toBe(500);
    expect(data.bySession[0].partialRequests).toBe(1);
  });

  it('builds per-month per-harness timeline buckets', () => {
    const may1 = new Date(2025, 4, 1, 12).getTime();
    const may15 = new Date(2025, 4, 15, 12).getTime();
    const jun1 = new Date(2025, 5, 1, 12).getTime();
    const sessions = [
      sess({
        harness: 'Claude', workspaceName: 'p',
        requests: [
          req({ requestId: 'm1', timestamp: may1, promptTokens: 100, completionTokens: 50 }),
          req({ requestId: 'm2', timestamp: may15 }), // missing
          req({ requestId: 'm3', timestamp: jun1, promptTokens: 200, completionTokens: 80 }),
        ],
      }),
      sess({
        harness: 'OpenCode', workspaceName: 'p',
        requests: [req({ requestId: 'o1', timestamp: jun1, promptTokens: 50, completionTokens: 25 })],
      }),
    ];
    const data = new Analyzer(sessions).getTokenCoverage();

    expect(data.timeline.months).toEqual(['2025-05', '2025-06']);
    expect(data.timeline.harnesses.sort()).toEqual(['Claude', 'OpenCode']);

    const claudeMay = data.timeline.cells['Claude']['2025-05']!;
    expect(claudeMay.requests).toBe(2);
    expect(claudeMay.countedRequests).toBe(1);
    expect(claudeMay.missingPct).toBe(50);

    const claudeJun = data.timeline.cells['Claude']['2025-06']!;
    expect(claudeJun.requests).toBe(1);
    expect(claudeJun.countedRequests).toBe(1);
    expect(claudeJun.missingPct).toBe(0);

    expect(data.timeline.cells['OpenCode']['2025-05']).toBeUndefined();
    expect(data.timeline.cells['OpenCode']['2025-06']!.countedRequests).toBe(1);
  });

  it('classifies active CLI sessions without shutdown as pending, not partial', () => {
    // Copilot CLI emits per-request output tokens via assistant.message events
    // but only emits authoritative input/output totals at session.shutdown.
    // An active CLI session with no shutdown yet should NOT be counted as
    // partial — those requests are still pending the shutdown event.
    const baseCli = createSession({
      sessionId: 's-cli-active',
      workspaceId: 'ws-1',
      workspaceName: 'wp',
      harness: 'GitHub Copilot CLI',
      requests: [
        req({ requestId: 'cli-1', completionTokens: 100, promptTokens: null, modelId: 'gpt-5.4' }),
        req({ requestId: 'cli-2', completionTokens: 200, promptTokens: null, modelId: 'gpt-5.4' }),
      ],
    });
    const cliActive: Session = { ...baseCli, endReason: 'active' };

    // For comparison: Local Agent active session with output-only data should
    // remain `partial` because per-request data IS the final form there.
    const baseLa = createSession({
      sessionId: 's-la-active',
      workspaceId: 'ws-2',
      workspaceName: 'wp',
      harness: 'Local Agent (Insiders)',
      requests: [req({ requestId: 'la-1', completionTokens: 50, promptTokens: null })],
    });
    const laActive: Session = { ...baseLa, endReason: 'active' };

    const data = new Analyzer([cliActive, laActive]).getTokenCoverage();
    // CLI requests: pending (excluded from missing% denominator)
    // LA request:   partial (kept in denominator, but counts as not missing)
    expect(data.pendingRequests).toBe(2);
    expect(data.partialRequests).toBe(1);
    expect(data.countedRequests).toBe(0);
    expect(data.missingRequests).toBe(0);

    const cliRow = data.byHarness.find(h => h.harness === 'GitHub Copilot CLI')!;
    expect(cliRow.pendingRequests).toBe(2);
    expect(cliRow.partialRequests).toBe(0);
    expect(cliRow.missingPct).toBe(0); // pending excluded from denom

    const laRow = data.byHarness.find(h => h.harness === 'Local Agent (Insiders)')!;
    expect(laRow.partialRequests).toBe(1);
    expect(laRow.pendingRequests).toBe(0);
  });

  it('finalized CLI sessions still get full coverage from session-aggregated totals', () => {
    // Once a CLI session shuts down it gets modelUsage; coverage should be 100%.
    const sessions = [
      sess({
        harness: 'GitHub Copilot CLI', workspaceName: 'wp',
        requests: [
          req({ requestId: 'cli-1', completionTokens: 100, promptTokens: null, modelId: 'gpt-5.4' }),
          req({ requestId: 'cli-2', completionTokens: 200, promptTokens: null, modelId: 'gpt-5.4' }),
        ],
        modelUsage: { 'gpt-5.4': { inputTokens: 1000, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 } },
      }),
    ];
    const data = new Analyzer(sessions).getTokenCoverage();
    expect(data.countedRequests).toBe(2);
    expect(data.pendingRequests).toBe(0);
    expect(data.partialRequests).toBe(0);
    expect(data.missingPct).toBe(0);
  });

  it('errored VS Code chat requests are pending, not missing (excluded from coverage denom)', () => {
    // VS Code chat requests with `result.errorDetails` (canceled, network
    // failure, length limit, etc.) never received token data. They should
    // not be counted as a parser gap.
    const sessions = [
      sess({
        harness: 'Local Agent (Insiders)', workspaceName: 'wp',
        requests: [
          req({ requestId: 'ok', promptTokens: 100, completionTokens: 50 }),
          req({ requestId: 'err', endState: 'errored' }),
        ],
      }),
    ];
    const data = new Analyzer(sessions).getTokenCoverage();
    expect(data.countedRequests).toBe(1);
    expect(data.pendingRequests).toBe(1);
    expect(data.missingRequests).toBe(0);
    expect(data.missingPct).toBe(0);
  });

  it('in-flight (no-result) VS Code chat requests are pending, not missing', () => {
    // Requests where `result === {}` (e.g. window closed, app crashed,
    // request still in-flight) should be excluded from the coverage
    // denominator — they never had a chance to record token data.
    const sessions = [
      sess({
        harness: 'Local Agent (Insiders)', workspaceName: 'wp',
        requests: [
          req({ requestId: 'ok', promptTokens: 100, completionTokens: 50 }),
          req({ requestId: 'inflight', endState: 'pending' }),
        ],
      }),
    ];
    const data = new Analyzer(sessions).getTokenCoverage();
    expect(data.countedRequests).toBe(1);
    expect(data.pendingRequests).toBe(1);
    expect(data.missingRequests).toBe(0);
    expect(data.missingPct).toBe(0);
  });

  it('genuine missing requests (finalized but no tokens) still count as missing', () => {
    // VS Code chat requests where result+metadata exist but neither
    // promptTokens nor completionTokens were captured (e.g. some older
    // copilot/auto requests). These ARE genuine parser-coverage gaps.
    const sessions = [
      sess({
        harness: 'Local Agent (Insiders)', workspaceName: 'wp',
        requests: [
          req({ requestId: 'ok', promptTokens: 100, completionTokens: 50 }),
          req({ requestId: 'gap' }), // no endState set, no tokens
        ],
      }),
    ];
    const data = new Analyzer(sessions).getTokenCoverage();
    expect(data.countedRequests).toBe(1);
    expect(data.missingRequests).toBe(1);
    expect(data.pendingRequests).toBe(0);
    expect(data.missingPct).toBeGreaterThan(0);
  });

  it('endState=no-data requests are tracked separately and excluded from coverage denominator', () => {
    // Harness either inherently doesn't capture tokens (Xcode) or completed
    // a request but didn't write token fields (some VS Code copilot/auto and
    // copilot/gpt-5.4 requests). Cannot be recovered, so should not be flagged
    // as missing — but they're also distinct from in-flight pending requests.
    const sessions = [
      sess({
        harness: 'Local Agent (Insiders)', workspaceName: 'wp',
        requests: [
          req({ requestId: 'ok', promptTokens: 100, completionTokens: 50 }),
          req({ requestId: 'nodata', endState: 'no-data' }),
        ],
      }),
    ];
    const data = new Analyzer(sessions).getTokenCoverage();
    expect(data.countedRequests).toBe(1);
    expect(data.noDataRequests).toBe(1);
    expect(data.pendingRequests).toBe(0);
    expect(data.missingRequests).toBe(0);
    expect(data.missingPct).toBe(0);
  });

  it('CLI abort-only turns (errored endState from parser) are excluded from coverage denominator', () => {
    // CLI sessions where the user typed a prompt and immediately aborted (Ctrl+C)
    // before the model produced any output. The CLI parser sets endState='errored'
    // (NOT analyzer-level isCanceled detection) on such synthetic requests.
    const sessions = [
      sess({
        harness: 'GitHub Copilot CLI', workspaceName: 'wp',
        requests: [
          req({ requestId: 'ok', promptTokens: 100, completionTokens: 50 }),
          req({ requestId: 'aborted', isCanceled: true, endState: 'errored' }),
        ],
      }),
    ];
    const data = new Analyzer(sessions).getTokenCoverage();
    expect(data.countedRequests).toBe(1);
    expect(data.pendingRequests).toBe(1);
    expect(data.missingRequests).toBe(0);
    expect(data.missingPct).toBe(0);
  });

  it('isCanceled WITHOUT endState (e.g. from a future harness) still counts as missing', () => {
    // Defensive: the analyzer doesn't have a generic isCanceled→pending fallback,
    // so any harness that wants to opt out of the coverage denominator must set
    // endState explicitly. This prevents future parser regressions from being
    // silently masked as "pending".
    const sessions = [
      sess({
        harness: 'Some Future Harness', workspaceName: 'wp',
        requests: [
          req({ requestId: 'ok', promptTokens: 100, completionTokens: 50 }),
          req({ requestId: 'aborted', isCanceled: true }),
        ],
      }),
    ];
    const data = new Analyzer(sessions).getTokenCoverage();
    expect(data.countedRequests).toBe(1);
    expect(data.missingRequests).toBe(1);
    expect(data.pendingRequests).toBe(0);
    expect(data.missingPct).toBeGreaterThan(0);
  });
});
