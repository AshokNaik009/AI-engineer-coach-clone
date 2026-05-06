/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { findLogsDirs, parseAllLogs } from '../src/core/parser';

const dirs = findLogsDirs();
const { sessions, editLocIndex } = parseAllLogs(dirs);
const reqs = sessions.flatMap(s => s.requests);

console.log("=== Data Inventory ===");
console.log("Sessions:", sessions.length);
console.log("Requests:", reqs.length);
console.log("With timestamp:", reqs.filter(r => r.timestamp).length);
console.log("Without timestamp:", reqs.filter(r => !r.timestamp).length);

console.log("\n--- Code Blocks ---");
console.log("With AI code:", reqs.filter(r => r.aiCode.length > 0).length);
console.log("With user code:", reqs.filter(r => r.userCode.length > 0).length);

console.log("\n--- Models ---");
const models = new Map<string, number>();
for (const r of reqs) { const m = r.modelId || "(empty)"; models.set(m, (models.get(m) || 0) + 1); }
for (const [m, c] of [...models.entries()].sort((a, b) => b[1] - a[1])) console.log("  " + m + ": " + c);

console.log("\n--- Agents ---");
const agents = new Map<string, number>();
for (const r of reqs) { const a = r.agentName || "(none)"; agents.set(a, (agents.get(a) || 0) + 1); }
for (const [a, c] of [...agents.entries()].sort((a, b) => b[1] - a[1])) console.log("  " + a + ": " + c);

console.log("\n--- Agent Modes ---");
const agentModes = new Map<string, number>();
for (const r of reqs) { const m = r.agentMode || "(none)"; agentModes.set(m, (agentModes.get(m) || 0) + 1); }
for (const [m, c] of [...agentModes.entries()].sort((a, b) => b[1] - a[1])) console.log("  " + m + ": " + c);

console.log("\n--- Slash Commands ---");
const slashes = new Map<string, number>();
for (const r of reqs) { const s = r.slashCommand || "(none)"; slashes.set(s, (slashes.get(s) || 0) + 1); }
for (const [s, c] of [...slashes.entries()].sort((a, b) => b[1] - a[1])) console.log("  " + s + ": " + c);

console.log("\n--- Tools Used ---");
const tools = new Map<string, number>();
for (const r of reqs) for (const t of r.toolsUsed) tools.set(t, (tools.get(t) || 0) + 1);
console.log("Requests with tools:", reqs.filter(r => r.toolsUsed.length > 0).length);
for (const [t, c] of [...tools.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log("  " + t + ": " + c);

console.log("\n--- File References ---");
console.log("Requests with referenced files:", reqs.filter(r => r.referencedFiles.length > 0).length);
console.log("Requests with edited files:", reqs.filter(r => r.editedFiles.length > 0).length);
console.log("Edit LoC index entries:", editLocIndex.size);

console.log("\n--- Custom Instructions ---");
console.log("Requests with custom instructions:", reqs.filter(r => r.customInstructions.length > 0).length);
const instrFiles = new Map<string, number>();
for (const r of reqs) for (const i of r.customInstructions) instrFiles.set(i, (instrFiles.get(i) || 0) + 1);
for (const [i, c] of [...instrFiles.entries()].sort((a, b) => b[1] - a[1])) console.log("  " + i + ": " + c);

console.log("\n--- Skills ---");
console.log("Requests with skills:", reqs.filter(r => r.skillsUsed.length > 0).length);
const skills = new Map<string, number>();
for (const r of reqs) for (const s of r.skillsUsed) skills.set(s, (skills.get(s) || 0) + 1);
for (const [s, c] of [...skills.entries()].sort((a, b) => b[1] - a[1])) console.log("  " + s + ": " + c);

console.log("\n--- Variable Kinds ---");
const varKinds = new Map<string, number>();
for (const r of reqs) for (const [k, v] of Object.entries(r.variableKinds)) varKinds.set(k, (varKinds.get(k) || 0) + (v as number));
for (const [k, c] of [...varKinds.entries()].sort((a, b) => b[1] - a[1])) console.log("  " + k + ": " + c);

console.log("\n--- Tool Confirmations ---");
console.log("Requests with confirmations:", reqs.filter(r => r.toolConfirmations.length > 0).length);
console.log("Terminal confirmations:", reqs.reduce((s, r) => s + r.toolConfirmations.filter(t => t.isTerminal).length, 0));

console.log("\n--- Timing ---");
const withTiming = reqs.filter(r => r.totalElapsed != null && r.totalElapsed > 0);
console.log("Requests with timing data:", withTiming.length);
if (withTiming.length > 0) {
  const avg = withTiming.reduce((s, r) => s + r.totalElapsed!, 0) / withTiming.length;
  const maxT = Math.max(...withTiming.map(r => r.totalElapsed!));
  console.log("  Avg response time: " + (avg / 1000).toFixed(1) + "s");
  console.log("  Max response time: " + (maxT / 1000).toFixed(1) + "s");
}

console.log("\n--- Cancellations ---");
console.log("Cancelled:", reqs.filter(r => r.isCanceled).length, "/", reqs.length);

console.log("\n--- Session Locations ---");
const locs = new Map<string, number>();
for (const s of sessions) locs.set(s.location, (locs.get(s.location) || 0) + 1);
for (const [l, c] of [...locs.entries()].sort((a, b) => b[1] - a[1])) console.log("  " + l + ": " + c);

console.log("\n--- Languages (AI code by LoC) ---");
const langs = new Map<string, number>();
for (const r of reqs) for (const b of r.aiCode) langs.set(b.language, (langs.get(b.language) || 0) + b.loc);
for (const [l, c] of [...langs.entries()].sort((a, b) => b[1] - a[1])) console.log("  " + l + ": " + c);
