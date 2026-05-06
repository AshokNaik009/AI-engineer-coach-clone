/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect } from 'vitest';
import { detectDevcontainerFromRequests } from './parser-shared';
import { SessionRequest } from './types';

function makeReq(overrides: Partial<SessionRequest> = {}): SessionRequest {
  return {
    requestId: 'r1',
    timestamp: 0,
    messageText: '',
    responseText: '',
    isCanceled: false,
    agentName: '',
    agentMode: 'chat',
    modelId: '',
    toolsUsed: [],
    editedFiles: [],
    referencedFiles: [],
    slashCommand: '',
    variableKinds: {},
    customInstructions: [],
    skillsUsed: [],
    firstProgress: 0,
    totalElapsed: 0,
    messageLength: 0,
    responseLength: 0,
    userCode: [],
    aiCode: [],
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

describe('detectDevcontainerFromRequests', () => {
  it('returns false when no signal is present', () => {
    expect(detectDevcontainerFromRequests([makeReq()])).toBe(false);
    expect(detectDevcontainerFromRequests([makeReq()], '/Users/me/proj')).toBe(false);
  });

  it('detects via cwd starting with /workspaces/', () => {
    expect(detectDevcontainerFromRequests([makeReq()], '/workspaces/repo')).toBe(true);
  });

  it('detects via terminal commandLine referencing /workspaces/', () => {
    const req = makeReq({
      toolConfirmations: [{ toolId: 'run_in_terminal', confirmationType: 0, isTerminal: true, commandLine: 'cd /workspaces/foo && ls' }],
    });
    expect(detectDevcontainerFromRequests([req])).toBe(true);
  });

  it('detects via editedFiles entry under /workspaces/', () => {
    const req = makeReq({ editedFiles: ['/workspaces/foo/src/index.ts'] });
    expect(detectDevcontainerFromRequests([req])).toBe(true);
  });

  it('detects via referencedFiles entry under /workspaces/', () => {
    const req = makeReq({ referencedFiles: ['/workspaces/foo/README.md'] });
    expect(detectDevcontainerFromRequests([req])).toBe(true);
  });

  it('ignores non-terminal tool confirmations even with /workspaces/ in payload', () => {
    const req = makeReq({
      toolConfirmations: [{ toolId: 'edit_file', confirmationType: 0, isTerminal: false, commandLine: '/workspaces/foo/x' }],
    });
    expect(detectDevcontainerFromRequests([req])).toBe(false);
  });

  it('does not match incidental substrings like /Users/me/workspaces-old', () => {
    const req = makeReq({ editedFiles: ['/Users/me/workspaces-old/index.ts'] });
    expect(detectDevcontainerFromRequests([req])).toBe(false);
  });
});
