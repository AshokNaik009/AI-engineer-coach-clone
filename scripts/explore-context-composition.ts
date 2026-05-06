/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { findLogsDirs, parseAllLogs } from '../src/core/parser';

const dirs = findLogsDirs();
const { sessions } = parseAllLogs(dirs);
const reqs = sessions.flatMap(s => s.requests);

console.log("=== Context Composition Exploration ===");
console.log("Sessions:", sessions.length, "Requests:", reqs.length);

// 1. Token data availability
const withPrompt = reqs.filter(r => r.promptTokens != null);
const withCompletion = reqs.filter(r => r.completionTokens != null);
console.log("\n--- Token Availability ---");
console.log("With promptTokens:", withPrompt.length, `(${(withPrompt.length/reqs.length*100).toFixed(1)}%)`);
console.log("With completionTokens:", withCompletion.length, `(${(withCompletion.length/reqs.length*100).toFixed(1)}%)`);

// 2. Context sections: what makes up a prompt?
console.log("\n--- Context Section Coverage ---");
const withTools = reqs.filter(r => r.toolsUsed.length > 0);
const withFiles = reqs.filter(r => r.referencedFiles.length > 0);
const withInstr = reqs.filter(r => r.customInstructions.length > 0);
const withSkills = reqs.filter(r => r.skillsUsed.length > 0);
const withVars = reqs.filter(r => Object.keys(r.variableKinds).length > 0);
const withMsg = reqs.filter(r => r.messageLength > 0);
const withResp = reqs.filter(r => r.responseLength > 0);

console.log("  User message:", withMsg.length, `(${(withMsg.length/reqs.length*100).toFixed(1)}%)`);
console.log("  Assistant response:", withResp.length, `(${(withResp.length/reqs.length*100).toFixed(1)}%)`);
console.log("  Tool calls:", withTools.length, `(${(withTools.length/reqs.length*100).toFixed(1)}%)`);
console.log("  File references:", withFiles.length, `(${(withFiles.length/reqs.length*100).toFixed(1)}%)`);
console.log("  Custom instructions:", withInstr.length, `(${(withInstr.length/reqs.length*100).toFixed(1)}%)`);
console.log("  Skills:", withSkills.length, `(${(withSkills.length/reqs.length*100).toFixed(1)}%)`);
console.log("  Variable kinds:", withVars.length, `(${(withVars.length/reqs.length*100).toFixed(1)}%)`);

// 3. Per-session composition: cumulative text sizes
console.log("\n--- Session Composition (text-based proxy) ---");
type SessionComposition = {
  workspace: string;
  harness: string;
  totalUserChars: number;
  totalAssistantChars: number;
  totalToolCalls: number;
  totalFileRefs: number;
  totalInstructions: number;
  totalSkills: number;
  reqCount: number;
  promptTokens: number | null;
};

const compositions: SessionComposition[] = [];
for (const s of sessions) {
  let totalUserChars = 0, totalAssistantChars = 0, totalToolCalls = 0;
  let totalFileRefs = 0, totalInstructions = 0, totalSkills = 0;
  let promptTokens: number | null = null;
  for (const r of s.requests) {
    totalUserChars += r.messageLength;
    totalAssistantChars += r.responseLength;
    totalToolCalls += r.toolsUsed.length;
    totalFileRefs += r.referencedFiles.length;
    totalInstructions += r.customInstructions.length;
    totalSkills += r.skillsUsed.length;
    if (r.promptTokens != null) promptTokens = r.promptTokens;
  }
  compositions.push({
    workspace: s.workspaceName,
    harness: s.harness,
    totalUserChars, totalAssistantChars, totalToolCalls,
    totalFileRefs, totalInstructions, totalSkills,
    reqCount: s.requests.length,
    promptTokens,
  });
}

// 4. Estimate composition ratios using chars/4 as token proxy
console.log("\n--- Composition Ratio Estimates (sessions with 5+ requests) ---");
const CHARS_PER_TOKEN = 4;
const SYS_PROMPT_TOKENS = 500;
const FILE_REF_TOKENS = 250;
const TOOL_CALL_TOKENS = 1000;
const INSTRUCTION_TOKENS = 800;
const SKILL_TOKENS = 600;

const rich = compositions.filter(c => c.reqCount >= 5);
console.log("Sessions with 5+ requests:", rich.length);

let totalSys = 0, totalUser = 0, totalAssistant = 0, totalTool = 0, totalFile = 0, totalInstr = 0, totalSkill = 0;
for (const c of rich) {
  totalSys += SYS_PROMPT_TOKENS;
  totalUser += c.totalUserChars / CHARS_PER_TOKEN;
  totalAssistant += c.totalAssistantChars / CHARS_PER_TOKEN;
  totalTool += c.totalToolCalls * TOOL_CALL_TOKENS;
  totalFile += c.totalFileRefs * FILE_REF_TOKENS;
  totalInstr += c.totalInstructions * INSTRUCTION_TOKENS;
  totalSkill += c.totalSkills * SKILL_TOKENS;
}
const grandTotal = totalSys + totalUser + totalAssistant + totalTool + totalFile + totalInstr + totalSkill;

console.log("Estimated composition breakdown:");
console.log(`  System prompt: ${(totalSys/grandTotal*100).toFixed(1)}% (${Math.round(totalSys/rich.length)} avg tokens/session)`);
console.log(`  User messages: ${(totalUser/grandTotal*100).toFixed(1)}% (${Math.round(totalUser/rich.length)} avg tokens/session)`);
console.log(`  Assistant history: ${(totalAssistant/grandTotal*100).toFixed(1)}% (${Math.round(totalAssistant/rich.length)} avg tokens/session)`);
console.log(`  Tool call overhead: ${(totalTool/grandTotal*100).toFixed(1)}% (${Math.round(totalTool/rich.length)} avg tokens/session)`);
console.log(`  File references: ${(totalFile/grandTotal*100).toFixed(1)}% (${Math.round(totalFile/rich.length)} avg tokens/session)`);
console.log(`  Instructions: ${(totalInstr/grandTotal*100).toFixed(1)}% (${Math.round(totalInstr/rich.length)} avg tokens/session)`);
console.log(`  Skills: ${(totalSkill/grandTotal*100).toFixed(1)}% (${Math.round(totalSkill/rich.length)} avg tokens/session)`);

// 5. Per-harness breakdown
console.log("\n--- Per-Harness Composition ---");
const harnessMap = new Map<string, SessionComposition[]>();
for (const c of compositions) {
  const arr = harnessMap.get(c.harness) || [];
  arr.push(c);
  harnessMap.set(c.harness, arr);
}
for (const [h, comps] of [...harnessMap.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const avgUser = comps.reduce((s, c) => s + c.totalUserChars, 0) / comps.length;
  const avgAssistant = comps.reduce((s, c) => s + c.totalAssistantChars, 0) / comps.length;
  const avgTools = comps.reduce((s, c) => s + c.totalToolCalls, 0) / comps.length;
  const avgFiles = comps.reduce((s, c) => s + c.totalFileRefs, 0) / comps.length;
  const avgInstr = comps.reduce((s, c) => s + c.totalInstructions, 0) / comps.length;
  const avgReqs = comps.reduce((s, c) => s + c.reqCount, 0) / comps.length;
  console.log(`  ${h} (${comps.length} sessions, ${avgReqs.toFixed(1)} avg reqs):`);
  console.log(`    User: ${Math.round(avgUser)} chars, Assistant: ${Math.round(avgAssistant)} chars`);
  console.log(`    Tools: ${avgTools.toFixed(1)} avg, Files: ${avgFiles.toFixed(1)} avg, Instructions: ${avgInstr.toFixed(1)} avg`);
}

// 6. Tool call distribution - which tools dominate context?
console.log("\n--- Tool Usage Impact on Context ---");
const toolCounts = new Map<string, number>();
for (const r of reqs) for (const t of r.toolsUsed) toolCounts.set(t, (toolCounts.get(t) || 0) + 1);
const totalToolInvocations = [...toolCounts.values()].reduce((a, b) => a + b, 0);
console.log("Total tool invocations:", totalToolInvocations);
for (const [t, c] of [...toolCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${t}: ${c} (${(c/totalToolInvocations*100).toFixed(1)}%)`);
}

// 7. File ref counts per request distribution
console.log("\n--- File Refs Per Request Distribution ---");
const fileRefDist = new Map<number, number>();
for (const r of reqs) {
  const n = r.referencedFiles.length;
  fileRefDist.set(n, (fileRefDist.get(n) || 0) + 1);
}
for (const [n, c] of [...fileRefDist.entries()].sort((a, b) => a[0] - b[0]).slice(0, 15)) {
  console.log(`  ${n} files: ${c} requests (${(c/reqs.length*100).toFixed(1)}%)`);
}

// 8. Tool calls per request distribution 
console.log("\n--- Tool Calls Per Request Distribution ---");
const toolCallDist = new Map<number, number>();
for (const r of reqs) {
  const n = r.toolsUsed.length;
  toolCallDist.set(n, (toolCallDist.get(n) || 0) + 1);
}
for (const [n, c] of [...toolCallDist.entries()].sort((a, b) => a[0] - b[0]).slice(0, 15)) {
  console.log(`  ${n} tools: ${c} requests (${(c/reqs.length*100).toFixed(1)}%)`);
}

// 9. Token ratio: user prompt vs total (for sessions with native tokens)
console.log("\n--- Prompt Size Relative to User Message (native token sessions) ---");
const nativeSessions = compositions.filter(c => c.promptTokens != null && c.promptTokens > 0 && c.totalUserChars > 0);
console.log("Sessions with native tokens + user messages:", nativeSessions.length);
if (nativeSessions.length > 0) {
  const ratios = nativeSessions.map(c => c.promptTokens! / (c.totalUserChars / CHARS_PER_TOKEN));
  ratios.sort((a, b) => a - b);
  console.log("  Prompt tokens / user-text tokens ratio:");
  console.log(`    p10: ${ratios[Math.floor(ratios.length * 0.1)].toFixed(2)}`);
  console.log(`    p25: ${ratios[Math.floor(ratios.length * 0.25)].toFixed(2)}`);
  console.log(`    p50: ${ratios[Math.floor(ratios.length * 0.5)].toFixed(2)}`);
  console.log(`    p75: ${ratios[Math.floor(ratios.length * 0.75)].toFixed(2)}`);
  console.log(`    p90: ${ratios[Math.floor(ratios.length * 0.9)].toFixed(2)}`);
  console.log("  (>1 means system prompt + history + tools + files add overhead beyond user text)");
}

// 10. Compaction data
console.log("\n--- Compaction Events ---");
const compReqs = reqs.filter(r => r.compaction);
console.log("Requests with compaction:", compReqs.length);
if (compReqs.length > 0) {
  const modes = new Map<string, number>();
  for (const r of compReqs) modes.set(r.compaction!.mode, (modes.get(r.compaction!.mode) || 0) + 1);
  for (const [m, c] of modes) console.log(`  ${m}: ${c}`);
  const ctxBefore = compReqs.filter(r => r.compaction!.contextLengthBefore > 0).map(r => r.compaction!.contextLengthBefore);
  if (ctxBefore.length > 0) {
    ctxBefore.sort((a, b) => a - b);
    console.log("  Context length before compaction:");
    console.log(`    p25: ${ctxBefore[Math.floor(ctxBefore.length * 0.25)]}`);
    console.log(`    p50: ${ctxBefore[Math.floor(ctxBefore.length * 0.5)]}`);
    console.log(`    p75: ${ctxBefore[Math.floor(ctxBefore.length * 0.75)]}`);
    console.log(`    max: ${ctxBefore[ctxBefore.length - 1]}`);
  }
}

// 11. Per-workspace context budget
console.log("\n--- Top 15 Workspaces by Context Volume ---");
const wsComps = new Map<string, { chars: number; tools: number; files: number; reqs: number; sessions: number }>();
for (const c of compositions) {
  const e = wsComps.get(c.workspace) || { chars: 0, tools: 0, files: 0, reqs: 0, sessions: 0 };
  e.chars += c.totalUserChars + c.totalAssistantChars;
  e.tools += c.totalToolCalls;
  e.files += c.totalFileRefs;
  e.reqs += c.reqCount;
  e.sessions += 1;
  wsComps.set(c.workspace, e);
}
for (const [ws, d] of [...wsComps.entries()].sort((a, b) => b[1].chars - a[1].chars).slice(0, 15)) {
  const estTokens = d.chars / CHARS_PER_TOKEN + d.tools * TOOL_CALL_TOKENS + d.files * FILE_REF_TOKENS;
  console.log(`  ${ws}: ${Math.round(estTokens/1000)}k tokens est, ${d.tools} tools, ${d.files} files, ${d.reqs} reqs, ${d.sessions} sessions`);
}

// 12. Variable kinds breakdown (VS Code specific)
console.log("\n--- Variable Kinds (VS Code) ---");
const allVarKinds = new Map<string, number>();
for (const r of reqs) {
  for (const [k, v] of Object.entries(r.variableKinds)) {
    allVarKinds.set(k, (allVarKinds.get(k) || 0) + (v as number));
  }
}
for (const [k, c] of [...allVarKinds.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${c}`);
}
