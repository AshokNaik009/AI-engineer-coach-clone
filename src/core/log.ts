/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Core logging helpers -- keep parser/analyzer diagnostics consistent. */

export type CoreLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface CoreLogEntry {
  timestamp: number;
  level: CoreLogLevel;
  scope: string;
  message: string;
  detail?: string;
}

const recentEntries: CoreLogEntry[] = [];
const MAX_RECENT_ENTRIES = 200;

function detailToString(detail: unknown): string | undefined {
  if (detail === undefined || detail === null) return undefined;
  if (detail instanceof Error) return detail.message;
  if (typeof detail === 'string') return detail;
  if (typeof detail === 'number' || typeof detail === 'boolean' || typeof detail === 'bigint') {
    return `${detail}`;
  }
  try {
    return JSON.stringify(detail);
  } catch {
    return Object.prototype.toString.call(detail);
  }
}

function emit(level: CoreLogLevel, scope: string, message: string, detail?: unknown): void {
  const entry: CoreLogEntry = {
    timestamp: Date.now(),
    level,
    scope,
    message,
    detail: detailToString(detail),
  };
  recentEntries.push(entry);
  if (recentEntries.length > MAX_RECENT_ENTRIES) recentEntries.shift();

  const prefix = `[${scope}] ${message}`;
  const suffix = entry.detail ? `: ${entry.detail}` : '';
  if (level === 'debug') console.debug(prefix + suffix);
  else if (level === 'info') console.info(prefix + suffix);
  else if (level === 'warn') console.warn(prefix + suffix);
  else console.error(prefix + suffix);
}

export function debugCore(scope: string, message: string, detail?: unknown): void {
  emit('debug', scope, message, detail);
}

export function infoCore(scope: string, message: string, detail?: unknown): void {
  emit('info', scope, message, detail);
}

export function warnCore(scope: string, message: string, detail?: unknown): void {
  emit('warn', scope, message, detail);
}

export function errorCore(scope: string, message: string, detail?: unknown): void {
  emit('error', scope, message, detail);
}