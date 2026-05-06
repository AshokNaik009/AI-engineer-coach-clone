/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * AST and token types for the metric expression DSL.
 *
 * The DSL supports:
 * - Field access:  messageLength, referencedFiles.length, variableKinds.file
 * - Comparisons:   <, >, <=, >=, ==, !=
 * - Logical ops:   AND, OR, NOT
 * - Functions:     length(), contains(), matches(), hour(), dayOfWeek(), ...
 * - Literals:      42, 3.14, "hello", true, false
 * - Pipe filters:  messageText | truncate:80
 */

/* ------------------------------------------------------------------ */
/*  Tokens                                                            */
/* ------------------------------------------------------------------ */

export enum TokenType {
  NUMBER,
  STRING,
  BOOLEAN,
  IDENTIFIER,
  // Comparison operators
  LT,
  GT,
  LTE,
  GTE,
  EQ,
  NEQ,
  // Logical operators
  AND,
  OR,
  NOT,
  // Arithmetic operators
  PLUS,
  MINUS,
  STAR,
  SLASH,
  // Punctuation
  LPAREN,
  RPAREN,
  LBRACKET,
  RBRACKET,
  DOT,
  COMMA,
  PIPE,
  COLON,
  // End
  EOF,
}

export interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

/* ------------------------------------------------------------------ */
/*  AST Nodes                                                         */
/* ------------------------------------------------------------------ */

export interface NumberNode    { type: 'number';       value: number }
export interface StringNode    { type: 'string';       value: string }
export interface BooleanNode   { type: 'boolean';      value: boolean }
export interface IdentifierNode { type: 'identifier';  name: string }
export interface FieldAccessNode { type: 'field_access'; object: ASTNode; field: string }
export interface BinaryNode    { type: 'binary';       op: string; left: ASTNode; right: ASTNode }
export interface UnaryNode     { type: 'unary';        op: string; operand: ASTNode }
export interface CallNode      { type: 'call';         name: string; args: ASTNode[] }
export interface PipeNode      { type: 'pipe';         value: ASTNode; filter: string; arg?: ASTNode }
export interface ArrayNode     { type: 'array';        elements: ASTNode[] }

export type ASTNode =
  | NumberNode
  | StringNode
  | BooleanNode
  | IdentifierNode
  | FieldAccessNode
  | BinaryNode
  | UnaryNode
  | CallNode
  | PipeNode
  | ArrayNode;

/* ------------------------------------------------------------------ */
/*  Metric definition (parsed from .metric.md or inline # Filter)     */
/* ------------------------------------------------------------------ */

export type AggregationType = 'count' | 'ratio' | 'sum' | 'avg' | 'min' | 'max' | 'unique' | 'percentile';

export interface MetricAggregation {
  type: AggregationType;
  field?: string;       // for sum/avg/min/max/unique
  percentile?: number;  // for percentile(field, N)
}

/* ------------------------------------------------------------------ */
/*  Compiled metric / filter / trigger                                */
/* ------------------------------------------------------------------ */

export type FilterFn  = (row: Record<string, unknown>) => boolean;
export type MetricFn  = (rows: Record<string, unknown>[]) => number;
export type TriggerFn = (emission: { count: number; total: number; ratio: number; extra: Record<string, unknown> }) => boolean;
export type FormatFn  = (row: Record<string, unknown>) => string;
