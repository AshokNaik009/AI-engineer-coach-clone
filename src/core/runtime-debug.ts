/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Persistent runtime logging for debugging extension-host restarts and worker stalls. */

import * as fs from 'fs';
import * as path from 'path';

const DEBUG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '', '.copilot-analytics-cache');
const DEBUG_LOG_FILE = path.join(DEBUG_DIR, 'runtime.log');
const HOOK_FLAG = '__aiEngineerCoachRuntimeHooksInstalled';
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB

let debugDirCreated = false;

function ensureDebugDir(): void {
  if (debugDirCreated) return;
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    debugDirCreated = true;
  } catch {
    // Best-effort only.
  }
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function detailToString(detail: unknown): string {
  if (detail === undefined || detail === null) return '';
  if (detail instanceof Error) return detail.stack || detail.message;
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

function runtimeMemorySummary(): string {
  const mem = process.memoryUsage();
  return `rss=${formatMb(mem.rss)} heap=${formatMb(mem.heapUsed)}/${formatMb(mem.heapTotal)} ext=${formatMb(mem.external)}`;
}

export function getRuntimeDebugLogPath(): string {
  ensureDebugDir();
  return DEBUG_LOG_FILE;
}

let outputHook: ((message: string) => void) | null = null;

export function setOutputHook(hook: ((message: string) => void) | null): void {
  outputHook = hook;
}

export function runtimeDebug(scope: string, message: string, detail?: unknown): void {
  try {
    ensureDebugDir();
    const time = new Date().toISOString();
    const suffix = detail === undefined ? '' : ` | ${detailToString(detail)}`;
    const formatted = `${time} pid=${process.pid} [${scope}] ${message} | ${runtimeMemorySummary()}${suffix}`;
    // Rotate log if it exceeds the size limit
    try {
      const stat = fs.statSync(DEBUG_LOG_FILE);
      if (stat.size > MAX_LOG_SIZE) {
        fs.truncateSync(DEBUG_LOG_FILE, 0);
      }
    } catch { /* file doesn't exist yet — that's fine */ }
    fs.appendFileSync(DEBUG_LOG_FILE, formatted + '\n', 'utf-8');
    if (outputHook) outputHook(formatted);
  } catch {
    // Best-effort only.
  }
}

export function installRuntimeDebugHooks(scope = 'extension-host'): void {
  const globalObj = globalThis as Record<string, unknown>;
  if (globalObj[HOOK_FLAG]) return;
  globalObj[HOOK_FLAG] = true;

  runtimeDebug(scope, 'process-hooks-installed');

  process.on('uncaughtException', (error) => {
    runtimeDebug(scope, 'uncaught-exception', error);
  });

  process.on('unhandledRejection', (reason) => {
    runtimeDebug(scope, 'unhandled-rejection', reason);
  });

  process.on('warning', (warning) => {
    runtimeDebug(scope, 'process-warning', warning);
  });

  process.on('beforeExit', (code) => {
    runtimeDebug(scope, 'before-exit', `code=${code}`);
  });

  process.on('exit', (code) => {
    runtimeDebug(scope, 'exit', `code=${code}`);
  });
}