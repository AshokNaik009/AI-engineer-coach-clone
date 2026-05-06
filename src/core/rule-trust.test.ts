/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect, beforeEach } from 'vitest';
import {
  hashContent,
  isApproved,
  approve,
  revoke,
  clearAllApprovals,
  listApproved,
  addPending,
  getPending,
  clearPending,
  removePending,
  createTrustGate,
  type TrustMemento,
} from './rule-trust';

function makeFakeMemento(): TrustMemento {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string, defaultValue: T): T {
      return (store.has(key) ? (store.get(key) as T) : defaultValue);
    },
    update(key: string, value: unknown): Promise<void> {
      store.set(key, value);
      return Promise.resolve();
    },
  };
}

describe('rule-trust', () => {
  beforeEach(() => {
    clearPending();
  });

  it('hashes identical content to the same value and different content to different values', () => {
    expect(hashContent('abc')).toBe(hashContent('abc'));
    expect(hashContent('abc')).not.toBe(hashContent('abcd'));
  });

  it('is not approved by default', () => {
    const store = makeFakeMemento();
    expect(isApproved(store, '/a/b.md', 'hello')).toBe(false);
  });

  it('approves and round-trips', async () => {
    const store = makeFakeMemento();
    await approve(store, '/a/b.md', 'hello');
    expect(isApproved(store, '/a/b.md', 'hello')).toBe(true);
    expect(Object.keys(listApproved(store))).toEqual(['/a/b.md']);
  });

  it('invalidates approval when content changes (hash mismatch)', async () => {
    const store = makeFakeMemento();
    await approve(store, '/a/b.md', 'hello');
    expect(isApproved(store, '/a/b.md', 'hello')).toBe(true);
    expect(isApproved(store, '/a/b.md', 'hello world')).toBe(false);
  });

  it('revokes a single approval', async () => {
    const store = makeFakeMemento();
    await approve(store, '/a/b.md', 'hello');
    await revoke(store, '/a/b.md');
    expect(isApproved(store, '/a/b.md', 'hello')).toBe(false);
  });

  it('clears all approvals', async () => {
    const store = makeFakeMemento();
    await approve(store, '/a/b.md', 'a');
    await approve(store, '/c/d.md', 'b');
    await clearAllApprovals(store);
    expect(Object.keys(listApproved(store))).toEqual([]);
  });

  it('trust gate blocks unapproved files and records pending entries', () => {
    const store = makeFakeMemento();
    const gate = createTrustGate(store);

    expect(gate.isAllowed('/x/y.md', 'payload')).toBe(false);
    gate.onBlocked({ filePath: '/x/y.md', layer: 'project', kind: 'rule', hash: hashContent('payload'), content: 'payload' });

    const pending = getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].filePath).toBe('/x/y.md');
  });

  it('trust gate admits approved files', async () => {
    const store = makeFakeMemento();
    await approve(store, '/x/y.md', 'payload');
    const gate = createTrustGate(store);
    expect(gate.isAllowed('/x/y.md', 'payload')).toBe(true);
  });

  it('pending add/remove by path', () => {
    addPending({ filePath: '/a', layer: 'personal', kind: 'rule', hash: 'h', content: '' });
    addPending({ filePath: '/b', layer: 'project', kind: 'metric', hash: 'h', content: '' });
    expect(getPending()).toHaveLength(2);
    removePending('/a');
    expect(getPending().map(p => p.filePath)).toEqual(['/b']);
  });
});
