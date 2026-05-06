/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * RuleEngine facade.
 *
 * Single entry point for rule loading, layering, parsing, inheritance,
 * and execution. Wraps the lower-level modules (rule-engine, rule-loader,
 * rule-parser, rule-pipeline, detector-registry) so consumers don't have
 * to understand the internal layering.
 *
 * Usage:
 *   import { RuleEngine } from './core/rule-engine-facade';
 *   RuleEngine.init();                 // load built-ins + personal
 *   RuleEngine.loadProject(workspace); // load workspace rules
 *   const rules = RuleEngine.getRules();
 *   const rule  = RuleEngine.getRule('lazy-prompting');
 *   const results = RuleEngine.runAll(reqs, sessions, skipIde);
 *   const preview = RuleEngine.testMarkdown(markdown, reqs, sessions);
 */

import type { AntiPattern, DetectionRule, DetectorEmission, RuleEvalResult, Session, SessionRequest } from './types';
import {
  getAllRules,
  getRule,
  getRulePreviewStats,
  evaluateRule,
  createRuleFromMarkdown,
  updateRuleThresholds,
} from './rule-engine';
import {
  registerAllBuiltinRules,
  registerAllBuiltinMetrics,
  loadPersonalRules,
  loadProjectRules,
  getRuleLayerInfo,
  getPersonalRulesDir,
  getProjectRulesDir,
} from './rule-loader';
import { runDetectors, runEmitters } from './detector-registry';

export const RuleEngine = {
  /** Load built-in rules + metrics + personal rules. Safe to call multiple times. */
  init(): void {
    registerAllBuiltinRules();
    registerAllBuiltinMetrics();
    loadPersonalRules();
  },

  /** Load project-level rules for the given workspace root. */
  loadProject(workspaceRoot: string): void {
    loadProjectRules(workspaceRoot);
  },

  /** Return all active rules (built-in + personal + project, merged). */
  getRules(): DetectionRule[] {
    return getAllRules();
  },

  /** Lookup a rule by id. */
  getRule(id: string): DetectionRule | undefined {
    return getRule(id);
  },

  /** Run every rule's detector against the given data set. */
  runAll(reqs: SessionRequest[], sessions: Session[], skipIdeDetectors: boolean): AntiPattern[] {
    return runDetectors(reqs, sessions, skipIdeDetectors);
  },

  /** Run emitters only (no trigger check), useful for preview/metrics. */
  runEmittersOnly(reqs: SessionRequest[], sessions: Session[], skipIdeDetectors: boolean) {
    return runEmitters(reqs, sessions, skipIdeDetectors);
  },

  /** Test arbitrary rule markdown against a data set (rule editor preview). */
  testMarkdown(markdown: string, reqs: SessionRequest[], sessions: Session[]): RuleEvalResult | null {
    const rule = createRuleFromMarkdown(markdown);
    if (!rule) return null;
    const emissions = runEmitters(reqs, sessions, false);
    const emission = emissions.get(rule.id) ?? null;
    return evaluateRule(rule, emission);
  },

  /** Preview statistics (count + trigger state) for existing rules. */
  previewRule(reqs: SessionRequest[], sessions: Session[], skipIdeDetectors: boolean, detectorResults: AntiPattern[], emissions?: Map<string, DetectorEmission>) {
    return getRulePreviewStats(reqs, sessions, skipIdeDetectors, detectorResults, emissions);
  },

  /** Update the mutable thresholds of an in-memory rule. */
  updateThresholds(id: string, thresholds: Record<string, number>): void {
    updateRuleThresholds(id, thresholds);
  },

  /** List info about every rule layer (built-in / personal / project). */
  getLayerInfo(workspaceRoot?: string) {
    return getRuleLayerInfo(workspaceRoot);
  },

  /** Absolute path helpers for UI pickers and docs. */
  paths: {
    personal: getPersonalRulesDir,
    project: getProjectRulesDir,
  },
};
