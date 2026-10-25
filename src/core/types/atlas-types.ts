/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Atlas (Archify-generated codebase map) wire types — shared between the pure
 * core (`atlas-runner.ts`, `atlas-store.ts`), the RPC layer and the webview. */

export type AtlasIneligibleReason =
  | 'feature-disabled'
  | 'no-workspace'
  | 'workspace-untrusted'
  | 'cli-missing'
  | 'cli-too-old'
  | 'skill-missing'
  | 'consent-missing';

export interface AtlasEligibility {
  eligible: boolean;
  reason?: AtlasIneligibleReason;
  detail?: string;
  workspaceRoot?: string;
  /** Resolved Archify skill directory (`~/.agents/skills/archify` or `~/.claude/skills/archify`). */
  skillPath?: string;
  /** `claude --version` output when the probe succeeded. */
  cliVersion?: string;
}

export interface AtlasScopeEstimate {
  /** Tracked files (`git ls-files`, else fs walk with ignore list). */
  fileCount: number;
  approxBytes: number;
  /** Thresholds: <300 → small, <2000 → medium, else large. */
  hint: 'small' | 'medium' | 'large';
}

export type AtlasMapKind = 'full' | 'session-overlay' | 'explainer';

export interface AtlasMapMeta {
  /** `<timestamp>-<rand4>` */
  id: string;
  /** sha1(workspaceRoot) */
  workspaceHash: string;
  createdAt: number;
  /** "Full repository" | "Session <short-id> overlay" | refinement title */
  title: string;
  kind: AtlasMapKind;
  /** Absolute, inside globalStorage. */
  htmlPath: string;
  /** `git rev-parse HEAD` at generation. */
  headSha?: string;
  dirtyAtGeneration?: boolean;
  /** The Archify run's own Claude session — needed for L3 `--resume`. */
  claudeSessionId?: string;
  model?: string;
  durationMs?: number;
  costUsd?: number;
  /** For kind='session-overlay' / 'explainer'. */
  sourceSessionId?: string;
  /** L3: the map this one was refined from. */
  baseMapId?: string;
  /** L3: the user's refinement instruction. */
  instruction?: string;
  /** Set when the post-run file hunt had to relocate the output. */
  relocatedFrom?: string;
}

export interface AtlasStaleness {
  /** null when git is unavailable or the map has no headSha. */
  commitsBehind: number | null;
  dirtyNow: boolean;
}

export interface AtlasGenerateParams {
  kind: AtlasMapKind;
  /** session-overlay only (workspace-relative). */
  highlightFiles?: string[];
  sourceSessionId?: string;
  /** L3: refine an existing map instead of generating fresh. */
  baseMapId?: string;
  /** L3: free-text refinement. */
  instruction?: string;
  /** Explainer: pinned excerpts (the session's diffs) the page should cite. */
  excerpts?: string[];
}

export type AtlasProgressEvent =
  | { kind: 'status'; text: string }
  | { kind: 'tool'; name: string; summary: string }
  | { kind: 'done'; map: AtlasMapMeta }
  | { kind: 'error'; message: string; stderrTail?: string }
  | { kind: 'cancelled' };

export interface AtlasRunHandle {
  runId: string;
}
