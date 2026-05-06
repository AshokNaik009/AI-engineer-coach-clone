/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Cache write worker — writes cache data to disk off the main thread. */

import { workerData } from 'worker_threads';
import * as fs from 'fs';

interface CacheWriteWorkerData {
  f: string;
  m: string;
  json: string;
  metaJson: string;
}

function isCacheWriteWorkerData(value: unknown): value is CacheWriteWorkerData {
  if (typeof value !== 'object' || value === null) return false;
  const data = value as Record<string, unknown>;
  return typeof data.f === 'string' &&
    typeof data.m === 'string' &&
    typeof data.json === 'string' &&
    typeof data.metaJson === 'string';
}

try {
  if (!isCacheWriteWorkerData(workerData)) {
    throw new Error('Invalid worker payload');
  }
  fs.writeFileSync(workerData.f, workerData.json, 'utf-8');
  fs.writeFileSync(workerData.m, workerData.metaJson, 'utf-8');
} catch (e) {
  console.warn('[cache-worker]', e instanceof Error ? e.message : e);
}
