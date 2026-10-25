/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Replay lazy diff reader — pure core, no VS Code dependency.
 *
 * Given a `FileChangeRef` pointer (session file + 0-based line number) this
 * streams the .jsonl, parses exactly that line, and returns the edit payload
 * (old/new strings) for the webview to diff. Nothing is cached in memory:
 * every expand is one bounded file read.
 *
 * Guards:
 *   - the line must be an `assistant` record containing a `tool_use` of the
 *     expected write tool (and id/path when supplied). Anything else means
 *     the file was rewritten since the parse (compaction, --fork-session)
 *     → `{ error: 'stale-index' }` so the UI can offer *Reload data*.
 *   - payloads larger than `maxBytes` are not shipped to the webview; the
 *     result carries `truncated: true` and empty `edits`.
 *   - the matching `tool_result` is looked up within the next 50 lines only.
 */

import * as fs from 'fs';
import * as readline from 'readline';
import { assertTrustedPath } from './parser-shared';
import type { FileChangeRef } from './types';
import type { FileChangeEdit, FileChangePayload, FileChangeResult } from './types/replay-types';

export type { FileChangeEdit, FileChangePayload, FileChangeResult };

/** How far past the tool_use line to look for its tool_result. */
const TOOL_RESULT_LOOKAHEAD = 50;

export const DEFAULT_MAX_DIFF_BYTES = 512 * 1024;

export interface ReadFileChangeTarget {
  lineNo: number;
  tool: FileChangeRef['tool'];
  /** Narrow the tool_use block when a line carries several (preferred). */
  toolUseId?: string;
  /** Fallback narrowing when no id was recorded. */
  path?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toolMatches(name: unknown, expected: FileChangeRef['tool']): boolean {
  if (expected === 'MultiEdit') return name === 'MultiEdit' || name === 'MultiEditTool';
  return name === expected;
}

/** Extract the edit list from a write tool's input; null when malformed. */
export function extractEdits(tool: FileChangeRef['tool'], input: Record<string, unknown>): FileChangeEdit[] | null {
  if (tool === 'Write') {
    return typeof input.content === 'string' ? [{ oldString: '', newString: input.content }] : null;
  }
  if (tool === 'Edit') {
    const oldString = typeof input.old_string === 'string' ? input.old_string
      : typeof input.old_str === 'string' ? input.old_str : null;
    const newString = typeof input.new_string === 'string' ? input.new_string
      : typeof input.new_str === 'string' ? input.new_str : null;
    if (oldString === null || newString === null) return null;
    const edit: FileChangeEdit = { oldString, newString };
    if (input.replace_all === true) edit.replaceAll = true;
    return [edit];
  }
  if (!Array.isArray(input.edits)) return null;
  const edits: FileChangeEdit[] = [];
  for (const raw of input.edits) {
    if (!isRecord(raw) || typeof raw.old_string !== 'string' || typeof raw.new_string !== 'string') continue;
    const edit: FileChangeEdit = { oldString: raw.old_string, newString: raw.new_string };
    if (raw.replace_all === true) edit.replaceAll = true;
    edits.push(edit);
  }
  return edits;
}

/** Find the tool_use block on a parsed assistant line that matches the target. */
function findToolUse(line: Record<string, unknown>, target: ReadFileChangeTarget): Record<string, unknown> | null {
  if (line.type !== 'assistant') return null;
  const message = line.message;
  if (!isRecord(message) || !Array.isArray(message.content)) return null;
  for (const block of message.content) {
    if (!isRecord(block) || block.type !== 'tool_use' || !toolMatches(block.name, target.tool)) continue;
    if (target.toolUseId && block.id !== target.toolUseId) continue;
    const input = block.input;
    if (!isRecord(input)) continue;
    if (!target.toolUseId && target.path && input.file_path !== target.path) continue;
    return block;
  }
  return null;
}

/** `tool_result` outcome for the given id on a user line, or undefined. */
function toolResultOutcome(line: Record<string, unknown>, toolUseId: string): boolean | undefined {
  if (line.type !== 'user') return undefined;
  const message = line.message;
  if (!isRecord(message) || !Array.isArray(message.content)) return undefined;
  for (const block of message.content) {
    if (!isRecord(block) || block.type !== 'tool_result' || block.tool_use_id !== toolUseId) continue;
    return block.is_error !== true;
  }
  return undefined;
}

function parseLine(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Stream `sessionFilePath` to `target.lineNo` and return that tool call's edits.
 * Never throws: every failure is an `{ error }` result.
 */
export async function readFileChange(
  sessionFilePath: string,
  target: ReadFileChangeTarget,
  maxBytes: number = DEFAULT_MAX_DIFF_BYTES,
): Promise<FileChangeResult> {
  try {
    assertTrustedPath(sessionFilePath);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  if (!Number.isInteger(target.lineNo) || target.lineNo < 0) return { error: 'Invalid line number.' };

  let stream: fs.ReadStream;
  try {
    stream = fs.createReadStream(sessionFilePath, { encoding: 'utf-8' });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lineNo = -1;
  let payload: FileChangePayload | null = null;
  let toolUseId: string | undefined = target.toolUseId;
  let result: FileChangeResult | null = null;
  let lookahead = 0;

  try {
    for await (const raw of rl) {
      lineNo++;
      if (lineNo < target.lineNo) continue;

      if (lineNo === target.lineNo) {
        const parsed = parseLine(raw);
        const block = parsed ? findToolUse(parsed, target) : null;
        if (!block) { result = { error: 'stale-index' }; break; }
        const input = block.input as Record<string, unknown>;
        const filePath = typeof input.file_path === 'string' ? input.file_path : target.path ?? '';
        if (typeof block.id === 'string') toolUseId = block.id;
        const bytes = Buffer.byteLength(raw, 'utf-8');
        if (bytes > maxBytes) {
          payload = { tool: target.tool, path: filePath, edits: [], truncated: true, bytes };
        } else {
          const edits = extractEdits(target.tool, input);
          if (!edits) { result = { error: 'stale-index' }; break; }
          payload = { tool: target.tool, path: filePath, edits };
        }
        if (!toolUseId) { result = payload; break; }
        continue;
      }

      // Past the target line: look for the tool_result.
      lookahead++;
      const parsed = parseLine(raw);
      const outcome = parsed && toolUseId ? toolResultOutcome(parsed, toolUseId) : undefined;
      if (outcome !== undefined && payload) {
        payload.toolResultOk = outcome;
        result = payload;
        break;
      }
      if (lookahead >= TOOL_RESULT_LOOKAHEAD) { result = payload; break; }
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    rl.close();
    stream.destroy();
  }

  if (result) return result;
  if (payload) return payload; // EOF before a tool_result turned up
  return { error: 'stale-index' }; // file shorter than the pointer
}

/** +/- line counts for a payload (used by the session view's Files-changed card). */
export function countDiffLines(payload: FileChangePayload): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const edit of payload.edits) {
    removed += edit.oldString ? edit.oldString.split('\n').length : 0;
    added += edit.newString ? edit.newString.split('\n').length : 0;
  }
  return { added, removed };
}
