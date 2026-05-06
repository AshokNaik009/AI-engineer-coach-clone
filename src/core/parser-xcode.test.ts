/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, it, expect } from 'vitest';
import { findXcodeDirs, parseXcodeDatabases } from './parser-xcode';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-engineer-coach-xcode-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('findXcodeDirs', () => {
  it('returns empty array when xcode dir does not exist', () => {
    const prevHome = process.env.HOME;
    const home = makeTempDir();
    process.env.HOME = home;
    try {
      const dirs = findXcodeDirs();
      expect(dirs).toEqual([]);
    } finally {
      process.env.HOME = prevHome;
    }
  });

  it('returns xcode base dir when it exists', () => {
    const prevHome = process.env.HOME;
    const home = makeTempDir();
    const xcodeDir = path.join(home, '.config', 'github-copilot', 'xcode');
    fs.mkdirSync(xcodeDir, { recursive: true });
    process.env.HOME = home;
    try {
      const dirs = findXcodeDirs();
      expect(dirs).toHaveLength(1);
      expect(dirs[0]).toBe(xcodeDir);
    } finally {
      process.env.HOME = prevHome;
    }
  });
});

describe('parseXcodeDatabases', () => {
  it('returns empty array for non-existent directory', () => {
    const sessions = parseXcodeDatabases('/nonexistent/path');
    expect(sessions).toEqual([]);
  });

  it('returns empty array when no db files present', () => {
    const xcodeBase = makeTempDir();
    const machineDir = path.join(xcodeBase, 'machine-1', 'conversations');
    fs.mkdirSync(machineDir, { recursive: true });
    const sessions = parseXcodeDatabases(xcodeBase);
    expect(sessions).toEqual([]);
  });
});
