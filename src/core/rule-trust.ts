/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Trust gate for locally-authored rule / metric markdown files.
 *
 * Built-in rules ship with the extension and are implicitly trusted.
 * Personal (`~/.ai-engineer-coach/rules|metrics/`) and project
 * (`<workspace>/.ai-engineer-coach/rules|metrics/`) files are NOT trusted by
 * default: a malicious repository could drop a `.ai-engineer-coach/rules/`
 * directory whose DSL executes the moment the dashboard is opened.
 *
 * This module implements a "trust on first use" policy:
 *   - Each local file's content is hashed (SHA-256) the first time we see it.
 *   - The hash + absolute path is recorded in the extension's `globalState`
 *     once the user explicitly approves it.
 *   - On subsequent loads, the recorded hash must match the current file
 *     contents exactly; any edit invalidates prior approval.
 *   - Files that fail the check are skipped by the loader and queued in an
 *     in-memory pending list for the UI to surface.
 *
 * This module is pure: it accepts a `Memento`-compatible storage object (so
 * tests can inject a Map-backed fake) and has no dependency on `vscode`.
 */

import { createHash } from 'crypto';

/** Minimum surface of `vscode.Memento` that we need. */
export interface TrustMemento {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

export interface ApprovedEntry {
  hash: string;
  approvedAt: number;
}

export type ApprovalMap = Record<string, ApprovedEntry>;

/** Key used in `globalState` to persist the approval map. */
const STORAGE_KEY = 'aiEngineerCoach.ruleTrust.v1';

/** Compute a stable content hash. */
export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Read the approval map from storage. */
export function listApproved(store: TrustMemento): ApprovalMap {
  return { ...store.get<ApprovalMap>(STORAGE_KEY, {}) };
}

/** True iff this exact file + content has been previously approved. */
export function isApproved(store: TrustMemento, filePath: string, content: string): boolean {
  const approvals = store.get<ApprovalMap>(STORAGE_KEY, {});
  const entry = approvals[filePath];
  if (!entry) return false;
  return entry.hash === hashContent(content);
}

/** Record approval for a file at its current content. */
export async function approve(store: TrustMemento, filePath: string, content: string): Promise<void> {
  const approvals: ApprovalMap = { ...store.get<ApprovalMap>(STORAGE_KEY, {}) };
  approvals[filePath] = { hash: hashContent(content), approvedAt: Date.now() };
  await store.update(STORAGE_KEY, approvals);
}

/** Revoke approval for a single file. */
export async function revoke(store: TrustMemento, filePath: string): Promise<void> {
  const approvals: ApprovalMap = { ...store.get<ApprovalMap>(STORAGE_KEY, {}) };
  if (filePath in approvals) {
    delete approvals[filePath];
    await store.update(STORAGE_KEY, approvals);
  }
}

/** Remove every approval (for diagnostics / user reset). */
export async function clearAllApprovals(store: TrustMemento): Promise<void> {
  await store.update(STORAGE_KEY, {});
}

/* ============================================================== */
/*  Pending list (in-memory) + TrustGate interface                */
/* ============================================================== */

export type TrustLayer = 'personal' | 'project';
export type TrustKind = 'rule' | 'metric';

export interface PendingEntry {
  filePath: string;
  layer: TrustLayer;
  kind: TrustKind;
  hash: string;
  /** Raw file contents -- retained so the UI can show a preview and the
   *  loader can re-register the file after approval without re-reading it. */
  content: string;
}

const pendingByPath = new Map<string, PendingEntry>();

/** Add or replace a pending entry. Keyed by absolute path. */
export function addPending(entry: PendingEntry): void {
  pendingByPath.set(entry.filePath, entry);
}

/** Remove a single pending entry (e.g. after approval). */
export function removePending(filePath: string): void {
  pendingByPath.delete(filePath);
}

/** Snapshot of currently pending entries. */
export function getPending(): PendingEntry[] {
  return Array.from(pendingByPath.values());
}

/** Clear the pending list (e.g. when reloading all layers). */
export function clearPending(): void {
  pendingByPath.clear();
}

/**
 * The object loaders consult for every personal / project markdown file.
 * When no gate is supplied, loaders fall back to "allow everything" --
 * preserving the long-standing behaviour relied upon by tests and scripts.
 */
export interface TrustGate {
  /** Return true to admit the file, false to block it. */
  isAllowed(filePath: string, content: string): boolean;
  /** Called with full context for every blocked file. */
  onBlocked(entry: PendingEntry): void;
}

/**
 * Build a `TrustGate` that checks approvals in the given Memento store and
 * records every blocked file in the shared pending list.
 */
export function createTrustGate(store: TrustMemento): TrustGate {
  return {
    isAllowed(filePath, content) {
      return isApproved(store, filePath, content);
    },
    onBlocked(entry) {
      addPending(entry);
    },
  };
}

/* ============================================================== */
/*  Default store accessor (used by helpers that lack a context)  */
/* ============================================================== */

let defaultStore: TrustMemento | undefined;
export function setDefaultTrustStore(store: TrustMemento | undefined): void {
  defaultStore = store;
}
export function getDefaultTrustStore(): TrustMemento | undefined {
  return defaultStore;
}
