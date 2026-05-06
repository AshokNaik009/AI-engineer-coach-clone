/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* File reconstruction and workspace metadata helpers for VS Code session parsing. */

import * as fs from 'fs';
import { assertTrustedPath, prefetchCache } from './parser-shared';
import { debugCore, warnCore } from './log';

export function readFile(fpath: string): string {
  assertTrustedPath(fpath);
  const cached = prefetchCache.get(fpath);
  if (cached !== undefined) {
    prefetchCache.delete(fpath);
    return cached;
  }
  return fs.readFileSync(fpath, 'utf-8');
}

function skipQuotedString(raw: string, start: number): number {
  let i = start + 1;
  while (i < raw.length) {
    if (raw[i] === '\\') {
      i += 2;
      continue;
    }
    if (raw[i] === '"') return i + 1;
    i++;
  }
  return i;
}

function consumeBalancedObject(raw: string, start: number): number {
  let depth = 1;
  let i = start + 1;
  while (i < raw.length && depth > 0) {
    const ch = raw[i];
    if (ch === '{') {
      depth++;
      i++;
      continue;
    }
    if (ch === '}') {
      depth--;
      i++;
      continue;
    }
    if (ch === '"') {
      i = skipQuotedString(raw, i);
      continue;
    }
    i++;
  }
  return i;
}

export function stripImageData(raw: string): string {
  // Phase 1: strip byte-array image data ("data":[255,216,255,...] JPEG/PNG blobs)
  // These are screenshot byte arrays that inflate file sizes by 30-40%.
  raw = stripByteArrayImages(raw);

  if (!raw.includes('"image"')) return raw;

  const parts: string[] = [];
  let lastEnd = 0;
  const kindRe = /"kind"\s*:\s*"image"/g;
  let m: RegExpExecArray | null;

  while ((m = kindRe.exec(raw)) !== null) {
    const searchStart = m.index + m[0].length;
    const searchSlice = raw.slice(searchStart, searchStart + 200);
    const valMatch = searchSlice.match(/"value"\s*:/);
    if (!valMatch || valMatch.index === undefined) continue;

    const colonEnd = searchStart + valMatch.index + valMatch[0].length;
    let valStart = colonEnd;
    while (valStart < raw.length && ' \t\n\r'.includes(raw[valStart])) valStart++;
    if (raw[valStart] !== '{') continue;

    parts.push(raw.slice(lastEnd, valStart));
    parts.push('"[stripped]"');
    lastEnd = consumeBalancedObject(raw, valStart);
  }

  if (parts.length === 0) return raw;
  parts.push(raw.slice(lastEnd));
  return parts.join('');
}

/**
 * Strip byte-array image data: patterns like "data":[255,216,255,...]
 * where the array starts with JPEG (FF D8 FF) or PNG (137,80,78,71) signatures.
 * These are screenshot blobs that can be hundreds of KB each.
 */
function stripByteArrayImages(raw: string): string {
  // Quick bail: if no byte-array image signatures present, skip the regex work
  if (!raw.includes('[255,216,255') && !raw.includes('[137,80,78,71')) return raw;

  // Match "data":[<JPEG or PNG signature>,...] — the array can be very large
  return raw.replaceAll(/"data":\[(255,216,255|137,80,78,71)[0-9,]*\]/g, '"data":[]');
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = Record<string, JsonValue>;
type PathKey = string | number;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const parsed: unknown = JSON.parse(raw);
  return isJsonObject(parsed) ? parsed : null;
}

function workspaceLocationFromJson(wsJsonPath: string): string | null {
  const data = parseJsonObject(readFile(wsJsonPath));
  if (!data) return null;

  const rawLocation = typeof data.folder === 'string'
    ? data.folder
    : typeof data.workspace === 'string'
      ? data.workspace
      : null;
  if (!rawLocation) return null;

  const decoded = decodeURIComponent(rawLocation.replace(/^file:\/\//, ''));
  return decoded.replace(/\/+$/, '');
}

function setAtPath(obj: JsonValue, keys: PathKey[], value: JsonValue): void {
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (typeof key === 'number' && Array.isArray(current)) {
      while (current.length <= key) current.push(null);
      if (current[key] === null) current[key] = {};
      current = current[key]!;
    } else if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
      if (!(key as string in current)) (current as JsonObject)[key as string] = {};
      current = (current as JsonObject)[key as string];
    }
  }
  const last = keys[keys.length - 1];
  if (Array.isArray(current)) {
    while (current.length <= (last as number)) current.push(null);
    current[last as number] = value;
  } else if (typeof current === 'object' && current !== null) {
    (current as JsonObject)[last as string] = value;
  }
}

function appendAtPath(obj: JsonValue, keys: PathKey[], items: JsonValue): void {
  let target: JsonValue = obj;
  for (const key of keys) {
    if (typeof key === 'number' && Array.isArray(target)) {
      target = target[key];
    } else if (typeof target === 'object' && target !== null && !Array.isArray(target)) {
      if (!(key as string in target)) (target as JsonObject)[key as string] = [];
      target = (target as JsonObject)[key as string];
    }
  }
  if (Array.isArray(target) && Array.isArray(items)) {
    target.push(...items);
  }
}

export function reconstructFromJsonl(fpath: string): Record<string, unknown> | null {
  let state: JsonObject = {};
  let lines: string[];
  try {
    assertTrustedPath(fpath);
    const cached = prefetchCache.get(fpath);
    let raw: string;
    if (cached !== undefined) {
      prefetchCache.delete(fpath);
      raw = cached;
    } else {
      // Read without MAX_FILE_SIZE cap — JSONL is processed line-by-line so
      // memory pressure is bounded by the largest single line, not the file.
      raw = fs.readFileSync(fpath, 'utf-8');
    }
    lines = raw.split('\n');
  } catch (e) {
    warnCore('parser-vscode', `Failed to read JSONL file ${fpath}`, e);
    return null;
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(stripImageData(trimmed)) as { kind: number; k?: PathKey[]; v?: JsonValue };
      if (entry.kind === 0) {
        state = (entry.v || {}) as JsonObject;
      } else if (entry.kind === 1) {
        setAtPath(state, entry.k || [], entry.v as JsonValue);
      } else if (entry.kind === 2) {
        appendAtPath(state, entry.k || [], entry.v as JsonValue);
      }
    } catch {
      // Skip malformed lines, don't abort the entire file
      continue;
    }
  }
  return Object.keys(state).length > 0 ? state : null;
}

export function parseWorkspaceName(wsJsonPath: string): string {
  try {
    const location = workspaceLocationFromJson(wsJsonPath);
    if (!location) return 'unknown';
    return location.split('/').pop() || 'unknown';
  } catch (e) {
    debugCore('parser-vscode', `Could not parse workspace name from ${wsJsonPath}`, e);
    return 'unknown';
  }
}

/** Returns the absolute folder path of the workspace (file system path of the
 *  user's project root) by reading workspace.json's `folder`/`workspace` field.
 *  Returns null if the file cannot be read or the path cannot be derived
 *  (e.g. multi-root workspaces without a single folder). */
export function parseWorkspaceFolderPath(wsJsonPath: string): string | null {
  try {
    const location = workspaceLocationFromJson(wsJsonPath);
    if (!location) return null;
    if (!location.startsWith('/') && !/^[A-Za-z]:/.test(location)) return null;
    return location;
  } catch (e) {
    debugCore('parser-vscode', `Could not parse workspace folder path from ${wsJsonPath}`, e);
    return null;
  }
}

export function parseCLIWorkspaceName(wsYamlPath: string): string {
  try {
    const raw = readFile(wsYamlPath);
    const cwdMatch = raw.match(/^cwd:\s*(.+)$/m);
    if (cwdMatch) {
      const cwd = cwdMatch[1].trim();
      return cwd.replace(/\/+$/, '').split('/').pop() || 'unknown';
    }
    return 'unknown';
  } catch (e) {
    debugCore('parser-vscode', `Could not parse CLI workspace name from ${wsYamlPath}`, e);
    return 'unknown';
  }
}

/** Returns the absolute folder path captured in a Copilot CLI `workspace.yaml`
 *  (the `cwd:` line). Returns null if the file is missing or has no usable
 *  cwd. Used by the `customInstructionsBytes` resolver and any other CLI
 *  per-workspace fs probes. */
export function parseCLIWorkspaceFolderPath(wsYamlPath: string): string | null {
  try {
    const raw = readFile(wsYamlPath);
    const cwdMatch = raw.match(/^cwd:\s*(.+)$/m);
    if (!cwdMatch) return null;
    const cwd = cwdMatch[1].trim();
    if (!cwd.startsWith('/') && !/^[A-Za-z]:/.test(cwd)) return null;
    return cwd.replace(/\/+$/, '');
  } catch (e) {
    debugCore('parser-vscode', `Could not parse CLI workspace cwd from ${wsYamlPath}`, e);
    return null;
  }
}
