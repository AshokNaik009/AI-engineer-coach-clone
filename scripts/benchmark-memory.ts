/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * Memory benchmark: measures RAM usage of parsed session data.
 *
 * Run:  npx tsx --expose-gc --max-old-space-size=8192 scripts/benchmark-memory.ts
 *
 * Reports heap used before/after parsing, per-session average,
 * and the effect of stripSessionsForMemory.
 */

import { parseAllLogsAsync, findLogsDirs } from '../src/core/parser';
import { stripSessionsForMemory } from '../src/core/cache';
import { Analyzer } from '../src/core/analyzer';
import type { Session, SessionRequest } from '../src/core/types/session-types';

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function estimateTextBytes(sessions: Session[]): {
  messageTextBytes: number;
  responseTextBytes: number;
  codeBlockBytes: number;
  totalRequests: number;
} {
  let messageTextBytes = 0;
  let responseTextBytes = 0;
  let codeBlockBytes = 0;
  let totalRequests = 0;
  for (const s of sessions) {
    for (const r of s.requests) {
      totalRequests++;
      messageTextBytes += r.messageText.length * 2;
      responseTextBytes += r.responseText.length * 2;
      for (const cb of [...r.aiCode, ...r.userCode]) {
        codeBlockBytes += (cb.language.length * 2) + 8;
      }
    }
  }
  return { messageTextBytes, responseTextBytes, codeBlockBytes, totalRequests };
}

async function main() {
  console.log('=== Memory Benchmark ===\n');

  if (global.gc) global.gc();
  const heapBefore = process.memoryUsage();
  console.log(`Heap before parse: ${mb(heapBefore.heapUsed)} (RSS: ${mb(heapBefore.rss)})`);

  const dirs = findLogsDirs();
  console.log(`Log directories: ${dirs.length}`);

  // Phase 1: Parse (includes stripSessionsForMemory automatically now)
  const t0 = Date.now();
  const result = await parseAllLogsAsync(dirs, (p) => {
    if (p.pct % 25 === 0 || p.phase !== 2) {
      const mem = process.memoryUsage();
      process.stdout.write(`\r  [${p.pct}%] ${p.detail || ''} | heap=${mb(mem.heapUsed)} rss=${mb(mem.rss)}   `);
    }
  });
  const elapsed = Date.now() - t0;
  console.log(`\nParse completed in ${(elapsed / 1000).toFixed(1)}s`);

  // Allow cache worker to finish writing and release the JSON string
  await new Promise(r => setTimeout(r, 5_000));
  if (global.gc) global.gc();
  await new Promise(r => setTimeout(r, 500));
  if (global.gc) global.gc();
  const heapAfterParse = process.memoryUsage();
  console.log(`Heap after parse+strip: ${mb(heapAfterParse.heapUsed)} (RSS: ${mb(heapAfterParse.rss)})`);
  console.log(`Heap delta: ${mb(heapAfterParse.heapUsed - heapBefore.heapUsed)}`);

  console.log(`\nSessions: ${result.sessions.length}`);
  console.log(`Workspaces: ${result.workspaces.size}`);

  const est = estimateTextBytes(result.sessions);
  console.log(`\n--- Retained Text Field Sizes (in-memory, post-strip) ---`);
  console.log(`Total requests: ${est.totalRequests}`);
  console.log(`messageText total: ${mb(est.messageTextBytes)} (max 500 chars/req)`);
  console.log(`responseText total: ${mb(est.responseTextBytes)} (should be ~0)`);
  console.log(`Code blocks total: ${mb(est.codeBlockBytes)}`);

  // Phase 2: Build Analyzer (as the panel does)
  const t1 = Date.now();
  const analyzer = new Analyzer(result.sessions, result.editLocIndex, result.workspaces);
  console.log(`\nAnalyzer built in ${Date.now() - t1}ms`);

  if (global.gc) global.gc();
  const heapAfterAnalyzer = process.memoryUsage();
  console.log(`Heap after Analyzer: ${mb(heapAfterAnalyzer.heapUsed)} (RSS: ${mb(heapAfterAnalyzer.rss)})`);

  // Phase 3: warmUp
  const t2 = Date.now();
  await analyzer.warmUp();
  console.log(`WarmUp completed in ${Date.now() - t2}ms`);

  if (global.gc) global.gc();
  const heapFinal = process.memoryUsage();
  console.log(`Heap final (after warmUp): ${mb(heapFinal.heapUsed)} (RSS: ${mb(heapFinal.rss)})`);

  // Check workType precomputation
  let withWorkType = 0;
  let totalReqs = 0;
  for (const s of result.sessions) {
    for (const r of s.requests) {
      totalReqs++;
      if (r.workType && r.workType !== '') withWorkType++;
    }
  }
  console.log(`\nworkType coverage: ${withWorkType}/${totalReqs} (${((withWorkType / totalReqs) * 100).toFixed(0)}%)`);

  console.log('\n=== Summary ===');
  console.log(`Parse+strip heap: ${mb(heapAfterParse.heapUsed - heapBefore.heapUsed)}`);
  console.log(`Full pipeline heap: ${mb(heapFinal.heapUsed - heapBefore.heapUsed)}`);
  console.log(`Total time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('=== Benchmark Complete ===');
}

main().catch(console.error);