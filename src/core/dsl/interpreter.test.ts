/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { evaluate, InterpreterError } from './interpreter';
import type { ASTNode } from './types';

const numberNode = (value: number): ASTNode => ({ type: 'number', value });
const stringNode = (value: string): ASTNode => ({ type: 'string', value });
const booleanNode = (value: boolean): ASTNode => ({ type: 'boolean', value });
const identifierNode = (name: string): ASTNode => ({ type: 'identifier', name });
const fieldAccessNode = (object: ASTNode, field: string): ASTNode => ({ type: 'field_access', object, field });
const binaryNode = (op: string, left: ASTNode, right: ASTNode): ASTNode => ({ type: 'binary', op, left, right });
const unaryNode = (op: string, operand: ASTNode): ASTNode => ({ type: 'unary', op, operand });
const callNode = (name: string, ...args: ASTNode[]): ASTNode => ({ type: 'call', name, args });
const pipeNode = (value: ASTNode, filter: string, arg?: ASTNode): ASTNode => ({ type: 'pipe', value, filter, arg });
const arrayNode = (...elements: ASTNode[]): ASTNode => ({ type: 'array', elements });

const timestamp = Date.parse('2024-03-15T23:30:00Z');

const baseCtx: Record<string, unknown> = {
  num: 42,
  strNum: '12.5',
  text: '  Hello World  ',
  hello: 'Hello',
  emptyText: '',
  truthy: true,
  falsy: false,
  zero: 0,
  nil: null,
  undef: undefined,
  timestamp,
  user: {
    profile: {
      name: 'Ada',
      score: '7',
    },
  },
  list: [1, 2, 3],
  words: ['Alpha', 'Beta', 'Alpha'],
  records: [
    { active: true, score: 1, kind: 'a' },
    { active: false, score: '2', kind: 'b' },
    { active: true, score: 3, kind: 'a' },
  ],
  obj: { a: 1, b: 2 },
  emptyArray: [],
  emptyObject: {},
  nestedNull: null,
};

describe('DSL Interpreter', () => {
  describe('literals', () => {
    it('evaluates number node', () => {
      expect(evaluate(numberNode(42), {})).toBe(42);
    });

    it('evaluates string node', () => {
      expect(evaluate(stringNode('hello'), {})).toBe('hello');
    });

    it('evaluates boolean node', () => {
      expect(evaluate(booleanNode(true), {})).toBe(true);
    });
  });

  describe('identifier resolution', () => {
    it('resolves identifier from context', () => {
      expect(evaluate(identifierNode('num'), baseCtx)).toBe(42);
    });

    it('returns undefined for missing identifier', () => {
      expect(evaluate(identifierNode('missing'), baseCtx)).toBeUndefined();
    });
  });

  describe('field access', () => {
    it('resolves nested object access', () => {
      const node = fieldAccessNode(fieldAccessNode(identifierNode('user'), 'profile'), 'name');
      expect(evaluate(node, baseCtx)).toBe('Ada');
    });

    it('returns undefined for null object', () => {
      expect(evaluate(fieldAccessNode(identifierNode('nestedNull'), 'value'), baseCtx)).toBeUndefined();
    });

    it('returns undefined for undefined object', () => {
      expect(evaluate(fieldAccessNode(identifierNode('missing'), 'value'), baseCtx)).toBeUndefined();
    });

    it('returns string length via field access', () => {
      expect(evaluate(fieldAccessNode(stringNode('hello'), 'length'), baseCtx)).toBe(5);
    });

    it('returns array length via field access', () => {
      expect(evaluate(fieldAccessNode(identifierNode('list'), 'length'), baseCtx)).toBe(3);
    });
  });

  describe('binary operators', () => {
    it('evaluates comparisons', () => {
      expect(evaluate(binaryNode('<', numberNode(1), numberNode(2)), baseCtx)).toBe(true);
      expect(evaluate(binaryNode('>', numberNode(3), numberNode(2)), baseCtx)).toBe(true);
      expect(evaluate(binaryNode('<=', numberNode(2), numberNode(2)), baseCtx)).toBe(true);
      expect(evaluate(binaryNode('>=', numberNode(2), numberNode(2)), baseCtx)).toBe(true);
      expect(evaluate(binaryNode('==', stringNode('7'), numberNode(7)), baseCtx)).toBe(true);
      expect(evaluate(binaryNode('!=', stringNode('7'), numberNode(8)), baseCtx)).toBe(true);
    });

    it('evaluates arithmetic', () => {
      expect(evaluate(binaryNode('+', numberNode(1), numberNode(2)), baseCtx)).toBe(3);
      expect(evaluate(binaryNode('-', numberNode(5), numberNode(3)), baseCtx)).toBe(2);
      expect(evaluate(binaryNode('*', numberNode(4), numberNode(3)), baseCtx)).toBe(12);
      expect(evaluate(binaryNode('/', numberNode(9), numberNode(3)), baseCtx)).toBe(3);
      expect(evaluate(binaryNode('/', numberNode(9), numberNode(0)), baseCtx)).toBe(0);
    });

    it('short-circuits AND', () => {
      const node = binaryNode('AND', booleanNode(false), callNode('missingFunction'));
      expect(evaluate(node, baseCtx)).toBe(false);
    });

    it('short-circuits OR', () => {
      const node = binaryNode('OR', booleanNode(true), callNode('missingFunction'));
      expect(evaluate(node, baseCtx)).toBe(true);
    });

    it('throws InterpreterError for unknown operator', () => {
      expect(() => evaluate(binaryNode('???', numberNode(1), numberNode(2)), baseCtx)).toThrowError(InterpreterError);
      expect(() => evaluate(binaryNode('???', numberNode(1), numberNode(2)), baseCtx)).toThrow(/Unknown operator/);
    });
  });

  describe('unary NOT', () => {
    it('coerces falsey values to true when negated', () => {
      expect(evaluate(unaryNode('NOT', booleanNode(false)), baseCtx)).toBe(true);
      expect(evaluate(unaryNode('NOT', stringNode('')), baseCtx)).toBe(true);
      expect(evaluate(unaryNode('NOT', numberNode(0)), baseCtx)).toBe(true);
      expect(evaluate(unaryNode('NOT', arrayNode()), baseCtx)).toBe(true);
      expect(evaluate(unaryNode('NOT', identifierNode('nil')), baseCtx)).toBe(true);
    });

    it('coerces truthy values to false when negated', () => {
      expect(evaluate(unaryNode('NOT', booleanNode(true)), baseCtx)).toBe(false);
      expect(evaluate(unaryNode('NOT', stringNode('x')), baseCtx)).toBe(false);
      expect(evaluate(unaryNode('NOT', numberNode(2)), baseCtx)).toBe(false);
      expect(evaluate(unaryNode('NOT', arrayNode(numberNode(1))), baseCtx)).toBe(false);
      expect(evaluate(unaryNode('NOT', identifierNode('emptyObject')), baseCtx)).toBe(false);
    });

    it('throws InterpreterError for unknown unary operator', () => {
      expect(() => evaluate(unaryNode('NEGATE', numberNode(1)), baseCtx)).toThrowError(InterpreterError);
      expect(() => evaluate(unaryNode('NEGATE', numberNode(1)), baseCtx)).toThrow(/Unknown unary operator/);
    });
  });

  describe('type coercion', () => {
    it('coerces values with toNum behavior', () => {
      expect(evaluate(callNode('num', stringNode('12.5')), baseCtx)).toBe(12.5);
      expect(evaluate(callNode('num', booleanNode(true)), baseCtx)).toBe(1);
      expect(evaluate(callNode('num', booleanNode(false)), baseCtx)).toBe(0);
      expect(evaluate(callNode('num', identifierNode('nil')), baseCtx)).toBe(0);
    });

    it('coerces values with toBool behavior', () => {
      expect(evaluate(unaryNode('NOT', stringNode('')), baseCtx)).toBe(true);
      expect(evaluate(unaryNode('NOT', numberNode(0)), baseCtx)).toBe(true);
      expect(evaluate(unaryNode('NOT', identifierNode('nil')), baseCtx)).toBe(true);
      expect(evaluate(unaryNode('NOT', identifierNode('emptyArray')), baseCtx)).toBe(true);
      expect(evaluate(unaryNode('NOT', identifierNode('list')), baseCtx)).toBe(false);
      expect(evaluate(unaryNode('NOT', identifierNode('obj')), baseCtx)).toBe(false);
    });

    it('applies looseEquals rules', () => {
      expect(evaluate(binaryNode('==', identifierNode('nil'), identifierNode('nil')), baseCtx)).toBe(true);
      expect(evaluate(binaryNode('==', numberNode(5), stringNode('5')), baseCtx)).toBe(true);
      expect(evaluate(binaryNode('==', booleanNode(true), numberNode(1)), baseCtx)).toBe(true);
      expect(evaluate(binaryNode('==', numberNode(0), booleanNode(true)), baseCtx)).toBe(false);
    });
  });

  describe('built-in functions', () => {
    it('evaluates length', () => {
      expect(evaluate(callNode('length', identifierNode('list')), baseCtx)).toBe(3);
    });

    it('evaluates contains', () => {
      expect(evaluate(callNode('contains', identifierNode('text'), stringNode('Hello')), baseCtx)).toBe(true);
    });

    it('evaluates startsWith', () => {
      expect(evaluate(callNode('startsWith', stringNode('Hello world'), stringNode('Hell')), baseCtx)).toBe(true);
    });

    it('evaluates endsWith', () => {
      expect(evaluate(callNode('endsWith', stringNode('Hello world'), stringNode('world')), baseCtx)).toBe(true);
    });

    it('evaluates matches with regex literal syntax', () => {
      expect(evaluate(callNode('matches', stringNode('Hello world'), stringNode('/^hello/i')), baseCtx)).toBe(true);
    });

    it('evaluates matches with inline regex flags', () => {
      expect(evaluate(callNode('matches', stringNode('Hello world'), stringNode('(?i)^hello')), baseCtx)).toBe(true);
    });

    it('evaluates lower', () => {
      expect(evaluate(callNode('lower', stringNode('HeLLo')), baseCtx)).toBe('hello');
    });

    it('evaluates upper', () => {
      expect(evaluate(callNode('upper', stringNode('HeLLo')), baseCtx)).toBe('HELLO');
    });

    it('evaluates trim', () => {
      expect(evaluate(callNode('trim', identifierNode('text')), baseCtx)).toBe('Hello World');
    });

    it('evaluates abs', () => {
      expect(evaluate(callNode('abs', numberNode(-8)), baseCtx)).toBe(8);
    });

    it('evaluates floor', () => {
      expect(evaluate(callNode('floor', numberNode(3.9)), baseCtx)).toBe(3);
    });

    it('evaluates ceil', () => {
      expect(evaluate(callNode('ceil', numberNode(3.1)), baseCtx)).toBe(4);
    });

    it('evaluates round', () => {
      expect(evaluate(callNode('round', numberNode(3.6)), baseCtx)).toBe(4);
    });

    it('evaluates min', () => {
      expect(evaluate(callNode('min', numberNode(5), numberNode(2), numberNode(9)), baseCtx)).toBe(2);
    });

    it('evaluates max', () => {
      expect(evaluate(callNode('max', numberNode(5), numberNode(2), numberNode(9)), baseCtx)).toBe(9);
    });

    it('evaluates hour', () => {
      expect(evaluate(callNode('hour', identifierNode('timestamp')), baseCtx)).toBe(new Date(timestamp).getHours());
    });

    it('evaluates dayOfWeek', () => {
      expect(evaluate(callNode('dayOfWeek', identifierNode('timestamp')), baseCtx)).toBe(new Date(timestamp).getDay());
    });

    it('evaluates includes', () => {
      expect(evaluate(callNode('includes', identifierNode('words'), stringNode('Beta')), baseCtx)).toBe(true);
    });

    it('evaluates some with identifier field argument', () => {
      expect(evaluate(callNode('some', identifierNode('records'), identifierNode('active')), baseCtx)).toBe(true);
    });

    it('evaluates every with identifier field argument', () => {
      expect(evaluate(callNode('every', identifierNode('records'), identifierNode('active')), baseCtx)).toBe(false);
    });

    it('evaluates count', () => {
      expect(evaluate(callNode('count', identifierNode('records')), baseCtx)).toBe(3);
    });

    it('evaluates sum without field', () => {
      expect(evaluate(callNode('sum', arrayNode(numberNode(1), stringNode('2'), booleanNode(true))), baseCtx)).toBe(4);
    });

    it('evaluates sum with field', () => {
      expect(evaluate(callNode('sum', identifierNode('records'), identifierNode('score')), baseCtx)).toBe(6);
    });

    it('evaluates avg without field', () => {
      expect(evaluate(callNode('avg', arrayNode(numberNode(1), stringNode('2'), numberNode(3))), baseCtx)).toBe(2);
    });

    it('evaluates avg with field', () => {
      expect(evaluate(callNode('avg', identifierNode('records'), identifierNode('score')), baseCtx)).toBe(2);
    });

    it('evaluates unique without field', () => {
      expect(evaluate(callNode('unique', identifierNode('words')), baseCtx)).toBe(2);
    });

    it('evaluates unique with field', () => {
      expect(evaluate(callNode('unique', identifierNode('records'), identifierNode('kind')), baseCtx)).toBe(2);
    });

    it('evaluates keys', () => {
      expect(evaluate(callNode('keys', identifierNode('obj')), baseCtx)).toEqual(['a', 'b']);
    });

    it('evaluates values', () => {
      expect(evaluate(callNode('values', identifierNode('obj')), baseCtx)).toEqual([1, 2]);
    });

    it('evaluates has for present key', () => {
      expect(evaluate(callNode('has', identifierNode('obj'), stringNode('a')), baseCtx)).toBe(true);
    });

    it('evaluates has for missing key', () => {
      expect(evaluate(callNode('has', identifierNode('obj'), stringNode('missing')), baseCtx)).toBe(false);
    });

    it('evaluates coalesce with first non-null', () => {
      expect(evaluate(callNode('coalesce', identifierNode('nil'), identifierNode('undef'), stringNode('fallback')), baseCtx)).toBe('fallback');
    });

    it('evaluates iif true branch', () => {
      expect(evaluate(callNode('iif', booleanNode(true), stringNode('yes'), stringNode('no')), baseCtx)).toBe('yes');
    });

    it('evaluates iif false branch', () => {
      expect(evaluate(callNode('iif', booleanNode(false), stringNode('yes'), stringNode('no')), baseCtx)).toBe('no');
    });

    it('evaluates str', () => {
      expect(evaluate(callNode('str', numberNode(123)), baseCtx)).toBe('123');
    });

    it('evaluates num', () => {
      expect(evaluate(callNode('num', stringNode('99.5')), baseCtx)).toBe(99.5);
    });

    it('evaluates truncate', () => {
      expect(evaluate(callNode('truncate', stringNode('Hello world'), numberNode(5)), baseCtx)).toBe('Hello...');
    });

    it('evaluates substr', () => {
      expect(evaluate(callNode('substr', stringNode('Hello world'), numberNode(1), numberNode(4)), baseCtx)).toBe('ello');
    });

    it('evaluates split', () => {
      expect(evaluate(callNode('split', stringNode('a,b,c'), stringNode(',')), baseCtx)).toEqual(['a', 'b', 'c']);
    });

    it('evaluates join', () => {
      expect(evaluate(callNode('join', arrayNode(stringNode('a'), stringNode('b'), stringNode('c')), stringNode('-')), baseCtx)).toBe('a-b-c');
    });

    it('evaluates first', () => {
      expect(evaluate(callNode('first', identifierNode('list')), baseCtx)).toBe(1);
    });

    it('evaluates at', () => {
      expect(evaluate(callNode('at', identifierNode('list'), numberNode(1)), baseCtx)).toBe(2);
    });

    it('evaluates substring', () => {
      expect(evaluate(callNode('substring', stringNode('Hello world'), numberNode(0), numberNode(5)), baseCtx)).toBe('Hello');
    });

    it('evaluates lineCount', () => {
      expect(evaluate(callNode('lineCount', stringNode('one\n\n two \n  \nthree')), baseCtx)).toBe(3);
    });
  });

  describe('pipe filters', () => {
    it('evaluates truncate pipe', () => {
      expect(evaluate(pipeNode(stringNode('Hello world'), 'truncate', numberNode(5)), baseCtx)).toBe('Hello...');
    });

    it('evaluates lower pipe', () => {
      expect(evaluate(pipeNode(stringNode('HeLLo'), 'lower'), baseCtx)).toBe('hello');
    });

    it('evaluates upper pipe', () => {
      expect(evaluate(pipeNode(stringNode('HeLLo'), 'upper'), baseCtx)).toBe('HELLO');
    });

    it('evaluates trim pipe', () => {
      expect(evaluate(pipeNode(identifierNode('text'), 'trim'), baseCtx)).toBe('Hello World');
    });

    it('evaluates round pipe', () => {
      expect(evaluate(pipeNode(numberNode(3.6), 'round'), baseCtx)).toBe(4);
    });

    it('evaluates floor pipe', () => {
      expect(evaluate(pipeNode(numberNode(3.6), 'floor'), baseCtx)).toBe(3);
    });

    it('evaluates ceil pipe', () => {
      expect(evaluate(pipeNode(numberNode(3.1), 'ceil'), baseCtx)).toBe(4);
    });

    it('evaluates abs pipe', () => {
      expect(evaluate(pipeNode(numberNode(-3), 'abs'), baseCtx)).toBe(3);
    });

    it('evaluates pct pipe', () => {
      expect(evaluate(pipeNode(numberNode(0.256), 'pct', numberNode(1)), baseCtx)).toBe('25.6%');
    });

    it('evaluates fixed pipe', () => {
      expect(evaluate(pipeNode(numberNode(12.345), 'fixed', numberNode(1)), baseCtx)).toBe('12.3');
    });

    it('evaluates locale pipe', () => {
      expect(evaluate(pipeNode(numberNode(12345.67), 'locale'), baseCtx)).toBe((12345.67).toLocaleString());
    });

    it('throws InterpreterError for unknown pipe', () => {
      expect(() => evaluate(pipeNode(stringNode('x'), 'missing'), baseCtx)).toThrowError(InterpreterError);
      expect(() => evaluate(pipeNode(stringNode('x'), 'missing'), baseCtx)).toThrow(/Unknown pipe filter/);
    });
  });

  describe('errors and arrays', () => {
    it('throws InterpreterError for unknown function', () => {
      expect(() => evaluate(callNode('missingFunction', numberNode(1)), baseCtx)).toThrowError(InterpreterError);
      expect(() => evaluate(callNode('missingFunction', numberNode(1)), baseCtx)).toThrow(/Unknown function/);
    });

    it('evaluates array node elements', () => {
      const node = arrayNode(numberNode(1), identifierNode('num'), binaryNode('+', numberNode(2), numberNode(3)));
      expect(evaluate(node, baseCtx)).toEqual([1, 42, 5]);
    });
  });

  describe('edge cases', () => {
    it('preserves null context values', () => {
      expect(evaluate(identifierNode('nil'), baseCtx)).toBeNull();
    });

    it('returns undefined for nested field access on null', () => {
      const node = fieldAccessNode(fieldAccessNode(identifierNode('nestedNull'), 'inner'), 'value');
      expect(evaluate(node, baseCtx)).toBeUndefined();
    });

    it('returns null when coalesce receives only nullish values', () => {
      expect(evaluate(callNode('coalesce', identifierNode('nil'), identifierNode('undef'), identifierNode('missing')), baseCtx)).toBeNull();
    });
  });
});
