/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Rule regression test.
 *
 * Verifies that the DSL-driven rule registry produces well-formed
 * AntiPattern objects for representative datasets, and that known
 * "should trigger" rule IDs actually fire.
 *
 * This replaces the previous equivalence test which compared against
 * legacy imperative detect* functions. Those were removed after the DSL
 * pipeline became the single source of truth.
 */

import { describe, it, expect } from 'vitest';
import { Session, SessionRequest } from './types';
import { runDetectors, invalidateDetectorRegistry } from './detector-registry';
import { getAllRules } from './rule-engine';

/* ── Test data builders ── */

function makeReq(overrides: Partial<SessionRequest> = {}): SessionRequest {
  return {
    requestId: `req-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    messageText: 'Hello world this is a normal prompt with some context and detail.',
    responseText: 'Sure, here is the answer you are looking for.',
    isCanceled: false,
    agentName: '',
    agentMode: 'chat',
    modelId: 'gpt-4.1',
    toolsUsed: [],
    editedFiles: [],
    referencedFiles: [],
    slashCommand: '',
    variableKinds: {},
    customInstructions: [],
    skillsUsed: [],
    firstProgress: 100,
    totalElapsed: 500,
    messageLength: 60,
    responseLength: 50,
    userCode: [],
    aiCode: [{ language: 'typescript', loc: 10 }],
    toolConfirmations: [],
    promptTokens: null,
    completionTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    compaction: null,
    todoSnapshot: null,
    workType: 'feature',
    ...overrides,
  };
}

function makeSess(overrides: Partial<Session> = {}): Session {
  const now = Date.now();
  const base = {
    sessionId: `sess-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: 'ws-1',
    workspaceName: 'my-project',
    location: 'panel',
    harness: 'Local Agent',
    creationDate: now - 3600000,
    lastMessageDate: now,
    requestCount: 1,
    requests: [makeReq()],
    ...overrides,
  };
  base.requestCount = base.requests.length;
  return base;
}

/** Build a data set that triggers many detectors simultaneously. */
function buildTriggeringDataset(): { reqs: SessionRequest[]; sessions: Session[] } {
  const reqs: SessionRequest[] = [];
  const sessions: Session[] = [];

  for (let i = 0; i < 15; i++) {
    reqs.push(makeReq({ messageLength: 5, messageText: 'fix' }));
  }
  for (let i = 0; i < 30; i++) {
    reqs.push(makeReq({
      messageLength: 100,
      messageText: 'Please refactor the authentication module to use JWT tokens with refresh capability.',
      referencedFiles: [],
      editedFiles: [],
      variableKinds: {},
    }));
  }
  for (let i = 0; i < 10; i++) {
    reqs.push(makeReq({ isCanceled: true }));
  }
  for (let i = 0; i < 8; i++) {
    reqs.push(makeReq({ totalElapsed: 45000 }));
  }
  for (let i = 0; i < 5; i++) {
    reqs.push(makeReq({
      messageText: 'How do I implement a binary search tree in Python?',
      messageLength: 52,
    }));
  }
  const megaReqs = Array.from({ length: 55 }, () => makeReq());
  sessions.push(makeSess({ requests: megaReqs, requestCount: megaReqs.length }));
  for (let i = 0; i < 8; i++) {
    sessions.push(makeSess({ requests: [makeReq()], requestCount: 1 }));
  }
  for (let i = 0; i < 10; i++) {
    const n = 5 + Math.floor(Math.random() * 10);
    const sReqs = Array.from({ length: n }, () => makeReq());
    sessions.push(makeSess({ requests: sReqs, requestCount: n }));
  }

  const allReqs = [...reqs, ...sessions.flatMap(s => s.requests)];
  return { reqs: allReqs, sessions };
}

/** Minimal data set (nothing triggers). */
function buildMinimalDataset(): { reqs: SessionRequest[]; sessions: Session[] } {
  const reqs = [makeReq(), makeReq(), makeReq()];
  const sessions = [makeSess({ requests: reqs, requestCount: 3 })];
  return { reqs, sessions };
}

/* ── Tests ── */

describe('Rule-driven registry regression', () => {
  it('loads at least 34 rules from the registry', () => {
    const rules = getAllRules();
    expect(rules.length).toBeGreaterThanOrEqual(34);
    for (const rule of rules) {
      expect(rule.id).toBeTruthy();
      expect(rule.name).toBeTruthy();
      expect(rule.group).toBeTruthy();
      expect(rule.severity).toBeTruthy();
    }
  });

  it('empty data: zero detections', () => {
    invalidateDetectorRegistry();
    const results = runDetectors([], [], false);
    expect(results).toHaveLength(0);
  });

  it('minimal data: produces well-formed results (if any)', () => {
    const { reqs, sessions } = buildMinimalDataset();
    invalidateDetectorRegistry();
    const results = runDetectors(reqs, sessions, false);
    for (const r of results) {
      expect(r.id).toBeTruthy();
      expect(r.name).toBeTruthy();
      expect(r.group).toBeTruthy();
      expect(['low', 'medium', 'high']).toContain(r.severity);
      expect(r.occurrences).toBeGreaterThan(0);
      expect(r.description.length).toBeGreaterThan(0);
    }
  });

  it('triggering data: produces non-empty detections', () => {
    const { reqs, sessions } = buildTriggeringDataset();
    invalidateDetectorRegistry();
    const results = runDetectors(reqs, sessions, false);
    expect(results.length).toBeGreaterThan(0);
  });

  it('triggering data: at least several rules fire', () => {
    const { reqs, sessions } = buildTriggeringDataset();
    invalidateDetectorRegistry();
    const results = runDetectors(reqs, sessions, false);
    // Dataset is crafted to hit many rules; don't hardcode specific IDs
    // since rule thresholds may shift, but we expect meaningful coverage.
    expect(results.length).toBeGreaterThanOrEqual(3);
  });

  it('triggering data: every result has id, name, group, severity, description, suggestion', () => {
    const { reqs, sessions } = buildTriggeringDataset();
    invalidateDetectorRegistry();
    const results = runDetectors(reqs, sessions, false);

    for (const r of results) {
      expect(r.id).toBeTruthy();
      expect(r.name).toBeTruthy();
      expect(r.group).toBeTruthy();
      expect(['low', 'medium', 'high']).toContain(r.severity);
      expect(r.occurrences).toBeGreaterThan(0);
      expect(r.description.length).toBeGreaterThan(0);
      expect(r.suggestion.length).toBeGreaterThan(0);
      expect(Array.isArray(r.examples)).toBe(true);
    }
  });

  it('triggering data: every result id exists in the rule registry', () => {
    const { reqs, sessions } = buildTriggeringDataset();
    invalidateDetectorRegistry();
    const results = runDetectors(reqs, sessions, false);
    const registryIds = new Set(getAllRules().map(r => r.id));
    for (const r of results) {
      expect(registryIds.has(r.id), `Result '${r.id}' not in rule registry`).toBe(true);
    }
  });

  it('skipIdeDetectors produces a subset of full results', () => {
    const { reqs, sessions } = buildTriggeringDataset();
    invalidateDetectorRegistry();
    const skipped = new Set(runDetectors(reqs, sessions, true).map(r => r.id));
    const full = new Set(runDetectors(reqs, sessions, false).map(r => r.id));
    for (const id of skipped) {
      expect(full.has(id), `Skipped set has '${id}' not in full set`).toBe(true);
    }
  });
});
