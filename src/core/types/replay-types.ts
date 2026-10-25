/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Replay ("git blame for AI") wire types — shared between the pure core
 * (`replay-index.ts`, `replay-reader.ts`), the RPC layer and the webview page. */

import type { FileChangeRef } from './session-types';

/** One session/request that touched a file, as listed in the Replay file view. */
export interface ReplayFileHit {
  sessionId: string;
  requestIdx: number;
  /** -1 for harnesses without pointers (no diff available). */
  changeIdx: number;
  ts: number | null;
  workspaceName: string;
  harness: string;
  /** Truncated user prompt of the request that made the edit. */
  userPrompt: string;
  /** Pointer for Claude hits; absent for other harnesses. */
  ref?: FileChangeRef;
}

export interface ReplayFileHistory {
  /** Display spelling of the requested path. */
  path: string;
  hits: ReplayFileHit[];
  /** Hits whose request falls outside the active DateFilter are dropped;
   *  this is the pre-filter total so the header can say "N of M". */
  total: number;
}

export interface ReplayTopFile {
  path: string;
  edits: number;
  sessions: number;
}

export interface FileChangeEdit {
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

export interface FileChangePayload {
  tool: FileChangeRef['tool'];
  path: string;
  /** `Write` → one edit with `oldString: ''` and the full content. */
  edits: FileChangeEdit[];
  /** Payload exceeded `replay.maxDiffBytes`; `edits` is empty. */
  truncated?: boolean;
  /** Byte length of the source line (set when truncated). */
  bytes?: number;
  /** From the matching tool_result, when found within the next 50 lines. */
  toolResultOk?: boolean;
}

export type FileChangeResult = FileChangePayload | { error: string };

export interface ReplayFileChangeParams {
  sessionId: string;
  lineNo: number;
  toolUseId?: string;
  path?: string;
  tool?: FileChangeRef['tool'];
}
