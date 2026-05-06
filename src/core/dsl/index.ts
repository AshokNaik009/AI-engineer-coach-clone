/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Public API for the metric expression DSL.
 *
 * Compiles source expressions into executable functions.
 * Re-exports schema and primitives for discovery UIs.
 */

import { lex } from './lexer';
import { parse } from './parser';
import { evaluate } from './interpreter';
import type { FilterFn, TriggerFn, MetricAggregation } from './types';

export { FIELD_SCHEMA, METRIC_PRIMITIVES, FUNCTION_CATALOG } from './schema';
export type { FieldInfo, MetricPrimitive, FunctionInfo } from './schema';
export type { ASTNode, FilterFn, TriggerFn, MetricAggregation } from './types';

/**
 * Evaluate a DSL expression string against a context object.
 * Returns the raw result (number, string, boolean, object, array, etc.).
 */
export function evaluateExpression(expr: string, ctx: Record<string, unknown>): unknown {
  const trimmed = expr.trim();
  if (!trimmed) return null;
  try {
    const tokens = lex(trimmed);
    const ast = parse(tokens);
    return evaluate(ast, ctx);
  } catch {
    return null;
  }
}

/**
 * Compile a filter expression string into a predicate function.
 * The function takes a single row (request or session) as a flat object
 * and returns true if the row matches the filter.
 */
export function compileFilter(expr: string): FilterFn {
  const trimmed = expr.trim();
  if (!trimmed) return () => true;
  const tokens = lex(trimmed);
  const ast = parse(tokens);
  return (row: Record<string, unknown>) => {
    try {
      return !!evaluate(ast, row);
    } catch {
      return false;
    }
  };
}

/**
 * Compile a trigger expression string into a predicate.
 * Evaluated against the emission object (count, total, ratio, extra.*).
 */
export function compileTrigger(expr: string): TriggerFn {
  const trimmed = expr.trim();
  if (!trimmed) return () => false;
  const tokens = lex(trimmed);
  const ast = parse(tokens);
  return (emission) => {
    try {
      const ctx: Record<string, unknown> = {
        count: emission.count,
        total: emission.total,
        ratio: emission.ratio,
        ...emission.extra,
        extra: emission.extra,
      };
      return !!evaluate(ast, ctx);
    } catch {
      return false;
    }
  };
}

/**
 * Parse an aggregation expression like "ratio", "count", "avg(totalElapsed)".
 */
export function parseAggregation(expr: string): MetricAggregation {
  const trimmed = expr.trim();
  const lower = trimmed.toLowerCase();

  if (lower === 'ratio') return { type: 'ratio' };
  if (lower === 'count') return { type: 'count' };

  const funcMatch = trimmed.match(/^(sum|avg|min|max|unique|percentile)\((\w[\w.]*)\s*(?:,\s*(\d+))?\)$/i);
  if (funcMatch) {
    const result: MetricAggregation = {
      type: funcMatch[1].toLowerCase() as MetricAggregation['type'],
      field: funcMatch[2],
    };
    if (funcMatch[3]) result.percentile = Number.parseInt(funcMatch[3]);
    return result;
  }

  // Default to count
  return { type: 'count' };
}

/**
 * Compute an aggregation over filtered rows.
 */
export function computeAggregation(
  agg: MetricAggregation,
  matchedRows: Record<string, unknown>[],
  totalRows: Record<string, unknown>[],
): number {
  switch (agg.type) {
    case 'count':
      return matchedRows.length;
    case 'ratio':
      return totalRows.length > 0 ? matchedRows.length / totalRows.length : 0;
    case 'sum':
      return matchedRows.reduce((s, r) => s + toNum(resolveField(r, agg.field!)), 0);
    case 'avg': {
      if (matchedRows.length === 0) return 0;
      const total = matchedRows.reduce((s, r) => s + toNum(resolveField(r, agg.field!)), 0);
      return total / matchedRows.length;
    }
    case 'min':
      return matchedRows.reduce((m, r) => Math.min(m, toNum(resolveField(r, agg.field!))), Infinity);
    case 'max':
      return matchedRows.reduce((m, r) => Math.max(m, toNum(resolveField(r, agg.field!))), -Infinity);
    case 'unique':
      return new Set(matchedRows.map(r => resolveField(r, agg.field!))).size;
    case 'percentile': {
      const values = matchedRows.map(r => toNum(resolveField(r, agg.field!))).sort((a, b) => a - b);
      if (values.length === 0) return 0;
      const p = (agg.percentile ?? 50) / 100;
      const idx = Math.floor(p * (values.length - 1));
      return values[idx];
    }
  }
}

/**
 * Evaluate a format/example template string against a row.
 * Handles {{field}}, {{field | filter:arg}}, and nested {{field.sub}}.
 */
export function evaluateTemplate(template: string, row: Record<string, unknown>): string {
  return template.replaceAll(/\{\{(.+?)\}\}/g, (_match, rawExpr: string) => {
    try {
      // Support pipe filters: {{expr | filter:arg}}
      const pipeIdx = rawExpr.indexOf('|');
      let expr = rawExpr.trim();
      let filterName = '';
      let filterArg = '';
      if (pipeIdx >= 0) {
        expr = rawExpr.substring(0, pipeIdx).trim();
        const filterPart = rawExpr.substring(pipeIdx + 1).trim();
        const colonIdx = filterPart.indexOf(':');
        if (colonIdx >= 0) {
          filterName = filterPart.substring(0, colonIdx).trim();
          filterArg = filterPart.substring(colonIdx + 1).trim();
        } else {
          filterName = filterPart;
        }
      }

      const tokens = lex(expr);
      const ast = parse(tokens);
      let result = evaluate(ast, row);
      if (result == null) return '';

      // Apply filter
      if (filterName === 'truncate' && typeof result === 'string') {
        const maxLen = Number.parseInt(filterArg, 10) || 80;
        if (result.length > maxLen) {
          result = result.substring(0, maxLen) + '...';
        }
      } else if (filterName === 'clip' && typeof result === 'string') {
        // Always clip to N chars and append "..." (even if string is shorter)
        const maxLen = Number.parseInt(filterArg, 10) || 80;
        result = result.substring(0, maxLen) + '...';
      }

      return String(result);
    } catch {
      return `{{${rawExpr}}}`;
    }
  });
}

/**
 * Try to compile an expression and return any error message, or null if valid.
 */
export function validateExpression(expr: string): string | null {
  try {
    const tokens = lex(expr.trim());
    parse(tokens);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/* ---- Internal helpers ---- */

function resolveField(row: Record<string, unknown>, field: string): unknown {
  const parts = field.split('.');
  let current: unknown = row;
  for (const part of parts) {
    if (current == null) return undefined;
    if (typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[part];
    } else if (Array.isArray(current) && part === 'length') {
      return current.length;
    } else if (typeof current === 'string' && part === 'length') {
      return current.length;
    } else {
      return undefined;
    }
  }
  return current;
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const n = Number.parseFloat(v); return Number.isNaN(n) ? 0 : n; }
  return 0;
}
