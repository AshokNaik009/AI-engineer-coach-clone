/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatChildLike, ChatSpawnFn, ClaudeChatProcessOptions } from './claude-chat-process';
import {
  ClaudeChatProcess,
  closeAllChatProcesses,
  closeChatProcess,
  getChatProcess,
  getOrCreateChatProcess,
} from './claude-chat-process';
import type { ChatEvent } from './types/session-chat-types';

const SESSION_ID = '0eabb490-c980-4bc9-93a0-4be21da759b9';
const OTHER_ID = '11111111-2222-3333-4444-555555555555';
const THIRD_ID = '22222222-3333-4444-5555-666666666666';

const BASE_ARGS = [
  '-p',
  '--resume', SESSION_ID,
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--include-partial-messages',
];

/* ================================================================== */
/*  Fake child + spawn capture (zero real processes)                  */
/* ================================================================== */

type Listener = (...args: unknown[]) => void;

class FakeChild implements ChatChildLike {
  written: string[] = [];
  kills: string[] = [];
  private readonly handlers = new Map<string, Listener[]>();

  stdin = {
    write: (chunk: string): boolean => {
      this.written.push(String(chunk));
      return true;
    },
  };
  stdout = {
    on: (event: 'data', listener: (chunk: Buffer | string) => void): void => {
      this.add(`stdout:${event}`, listener as Listener);
    },
  };
  stderr = {
    on: (event: 'data', listener: (chunk: Buffer | string) => void): void => {
      this.add(`stderr:${event}`, listener as Listener);
    },
  };

  on(event: 'close', listener: (code: number | null) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'close' | 'error', listener: ((code: number | null) => void) | ((err: Error) => void)): this {
    this.add(event, listener as Listener);
    return this;
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.kills.push(signal ?? 'SIGTERM');
    return true;
  }

  emitStdout(chunk: string): void { this.fire('stdout:data', Buffer.from(chunk)); }
  emitStderr(chunk: string): void { this.fire('stderr:data', Buffer.from(chunk)); }
  emitClose(code: number | null): void { this.fire('close', code); }
  emitError(err: Error): void { this.fire('error', err); }

  private add(key: string, listener: Listener): void {
    const list = this.handlers.get(key) ?? [];
    list.push(listener);
    this.handlers.set(key, list);
  }

  private fire(key: string, ...args: unknown[]): void {
    for (const listener of this.handlers.get(key) ?? []) listener(...args);
  }
}

interface SpawnCall {
  child: FakeChild;
  binPath: string;
  args: string[];
  cwd: string;
}

function makeSpawn(): { spawnFn: ChatSpawnFn; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawnFn: ChatSpawnFn = (binPath, args, opts) => {
    const child = new FakeChild();
    calls.push({ child, binPath, args, cwd: opts.cwd });
    return child;
  };
  return { spawnFn, calls };
}

function makeProc(extra: Partial<ClaudeChatProcessOptions> = {}): {
  proc: ClaudeChatProcess;
  child: FakeChild;
  calls: SpawnCall[];
  events: ChatEvent[];
} {
  const { spawnFn, calls } = makeSpawn();
  const proc = new ClaudeChatProcess({ sessionId: SESSION_ID, cwd: '/tmp/proj', spawnFn, ...extra });
  const events: ChatEvent[] = [];
  proc.onEvent(e => events.push(e));
  return { proc, child: calls[0].child, calls, events };
}

const deltaLine = (text: string): string =>
  JSON.stringify({
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  }) + '\n';

afterEach(() => {
  closeAllChatProcesses();
  vi.useRealTimers();
});

/* ================================================================== */
/*  Arg shape                                                         */
/* ================================================================== */

describe('ClaudeChatProcess — argv shape', () => {
  it('mode none (default): stream-json flags + --allowedTools "" and no --permission-mode', () => {
    const { calls } = makeProc();
    expect(calls[0].binPath).toBe('claude');
    expect(calls[0].cwd).toBe('/tmp/proj');
    expect(calls[0].args).toEqual([...BASE_ARGS, '--allowedTools', '']);
  });

  it('mode plan: --permission-mode plan replaces --allowedTools', () => {
    const { calls } = makeProc({ permissionMode: 'plan' });
    expect(calls[0].args).toEqual([...BASE_ARGS, '--permission-mode', 'plan']);
    expect(calls[0].args).not.toContain('--allowedTools');
  });

  it('mode acceptEdits: --permission-mode acceptEdits replaces --allowedTools', () => {
    const { calls } = makeProc({ permissionMode: 'acceptEdits' });
    expect(calls[0].args).toEqual([...BASE_ARGS, '--permission-mode', 'acceptEdits']);
    expect(calls[0].args).not.toContain('--allowedTools');
  });

  it('honors binPath and passes --model only when configured non-blank', () => {
    const { calls } = makeProc({ binPath: '/opt/bin/claude', model: 'haiku' });
    expect(calls[0].binPath).toBe('/opt/bin/claude');
    expect(calls[0].args.slice(-2)).toEqual(['--model', 'haiku']);

    const { calls: blank } = makeProc({ model: '   ' });
    expect(blank[0].args).not.toContain('--model');
  });

  it('rejects malformed session ids before spawning anything', () => {
    const { spawnFn, calls } = makeSpawn();
    expect(() => new ClaudeChatProcess({ sessionId: '../../etc/passwd', cwd: '/tmp', spawnFn }))
      .toThrow(/Invalid session id/);
    expect(calls).toHaveLength(0);
  });
});

/* ================================================================== */
/*  stdin frames                                                      */
/* ================================================================== */

describe('ClaudeChatProcess — stdin frames', () => {
  it('send writes one newline-terminated user frame with the exact text', () => {
    const hostile = 'line one\n`backticks` and $(rm -rf /) and "quotes" \'single\' $HOME';
    const { proc, child } = makeProc();
    proc.send(hostile);

    expect(child.written).toHaveLength(1);
    expect(child.written[0].endsWith('\n')).toBe(true);
    expect(JSON.parse(child.written[0])).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: hostile }] },
    });
  });

  it('interrupt writes a control_request frame with a unique request_id', () => {
    const { proc, child } = makeProc();
    proc.interrupt();
    proc.interrupt();

    expect(child.written).toHaveLength(2);
    const frames = child.written.map(w => JSON.parse(w) as { type: string; request_id: string; request: { subtype: string } });
    for (const frame of frames) {
      expect(frame.type).toBe('control_request');
      expect(frame.request).toEqual({ subtype: 'interrupt' });
      expect(frame.request_id).toMatch(/^interrupt-/);
    }
    expect(frames[0].request_id).not.toBe(frames[1].request_id);
  });

  it('send and interrupt are no-ops after close', () => {
    const { proc, child } = makeProc();
    child.emitClose(0);
    proc.send('hello?');
    proc.interrupt();
    expect(child.written).toHaveLength(0);
  });
});

/* ================================================================== */
/*  Event mapping                                                     */
/* ================================================================== */

describe('ClaudeChatProcess — event mapping', () => {
  it('reassembles JSONL lines split across stdout data boundaries', () => {
    const { child, events } = makeProc();
    const first = deltaLine('Hello, world');
    const second = deltaLine('!');

    child.emitStdout(first.slice(0, 25));
    expect(events).toHaveLength(0); // partial line buffered, nothing emitted

    child.emitStdout(first.slice(25) + second.slice(0, 10));
    expect(events).toEqual([{ kind: 'delta', text: 'Hello, world' }]);

    child.emitStdout(second.slice(10));
    expect(events).toEqual([
      { kind: 'delta', text: 'Hello, world' },
      { kind: 'delta', text: '!' },
    ]);
  });

  it('maps an assistant message with tool_use blocks to message + toolUses chips', () => {
    const { child, events } = makeProc();
    child.emitStdout(JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check.' },
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/tmp/a.txt' } },
          { type: 'tool_use', id: 't2', name: 'Bash', input: {} },
        ],
      },
    }) + '\n');

    expect(events).toEqual([{
      kind: 'message',
      text: 'Let me check.',
      toolUses: [
        { name: 'Read', inputPreview: '{"file_path":"/tmp/a.txt"}' },
        { name: 'Bash' },
      ],
    }]);
  });

  it('maps a result line to turn-end with usage and the echoed session id', () => {
    const { child, events } = makeProc();
    child.emitStdout(JSON.stringify({
      type: 'result',
      is_error: false,
      session_id: OTHER_ID, // forked id — drift tripwire data for the UI
      total_cost_usd: 0.018,
      usage: { input_tokens: 19_000, output_tokens: 42 },
    }) + '\n');

    expect(events).toEqual([{
      kind: 'turn-end',
      usage: { inputTokens: 19_000, outputTokens: 42, costUsd: 0.018 },
      sessionId: OTHER_ID,
    }]);
  });

  it('falls back to the input session id when result omits session_id', () => {
    const { child, events } = makeProc();
    child.emitStdout(JSON.stringify({ type: 'result' }) + '\n');
    expect(events).toEqual([{ kind: 'turn-end', usage: undefined, sessionId: SESSION_ID }]);
  });

  it('drops unknown event types and malformed JSON silently; later events still flow', () => {
    const { child, events } = makeProc();
    child.emitStdout(JSON.stringify({ type: 'mystery_v3_event', payload: { huge: true } }) + '\n');
    child.emitStdout('{this is not json}\n');
    child.emitStdout('[1,2,3]\n'); // valid JSON but not an object — also dropped
    child.emitStdout(deltaLine('still alive'));

    expect(events).toEqual([{ kind: 'delta', text: 'still alive' }]);
  });

  it('drops non-text stream_event sub-shapes (e.g. input_json_delta)', () => {
    const { child, events } = makeProc();
    child.emitStdout(JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"a"' } },
    }) + '\n');
    expect(events).toHaveLength(0);
  });
});

/* ================================================================== */
/*  Shutdown + lifecycle                                              */
/* ================================================================== */

describe('ClaudeChatProcess — shutdown', () => {
  it('dispose sends SIGTERM, then SIGKILL after the 3 s grace', () => {
    vi.useFakeTimers();
    const { proc, child } = makeProc();
    proc.dispose();

    expect(child.kills).toEqual(['SIGTERM']);
    vi.advanceTimersByTime(2_999);
    expect(child.kills).toEqual(['SIGTERM']);
    vi.advanceTimersByTime(1);
    expect(child.kills).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('a child exiting within the grace cancels the SIGKILL and emits closed once', () => {
    vi.useFakeTimers();
    const { proc, child, events } = makeProc();
    proc.dispose();
    child.emitClose(0);
    vi.advanceTimersByTime(10_000);

    expect(child.kills).toEqual(['SIGTERM']);
    expect(events).toEqual([{ kind: 'closed', code: 0 }]);
  });

  it('idle timeout (5 min without a send) disposes and emits closed', () => {
    vi.useFakeTimers();
    const { child, events } = makeProc();

    vi.advanceTimersByTime(5 * 60_000 - 1);
    expect(events).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(child.kills).toContain('SIGTERM');
    expect(events).toEqual([{ kind: 'closed', code: null }]);
  });

  it('a send resets the idle clock', () => {
    vi.useFakeTimers();
    const { proc, events } = makeProc();

    vi.advanceTimersByTime(4 * 60_000);
    proc.send('keep me warm');
    vi.advanceTimersByTime(4 * 60_000);
    expect(events).toHaveLength(0); // 8 min total, but never 5 min idle

    vi.advanceTimersByTime(60_000);
    expect(events).toEqual([{ kind: 'closed', code: null }]);
  });

  it('non-zero exit emits closed with the code and the stderr tail', () => {
    const { child, events } = makeProc();
    child.emitStderr('boom: something broke\n');
    child.emitClose(2);
    child.emitClose(0); // duplicate close must not double-emit

    expect(events).toEqual([{ kind: 'closed', code: 2, error: 'boom: something broke' }]);
  });

  it('non-zero exit without stderr falls back to a generic message', () => {
    const { child, events } = makeProc();
    child.emitClose(3);
    expect(events).toEqual([{ kind: 'closed', code: 3, error: 'claude exited with code 3' }]);
  });

  it('spawn ENOENT emits closed with a friendly install hint', () => {
    const { child, events } = makeProc();
    const err = new Error('spawn claude ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    child.emitError(err);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'closed', code: null });
    expect((events[0] as { error?: string }).error).toMatch(/not found on PATH/);
  });

  it('a final unterminated stdout line is flushed before closed', () => {
    const { child, events } = makeProc();
    child.emitStdout(deltaLine('flushed').trimEnd()); // no trailing newline
    expect(events).toHaveLength(0);
    child.emitClose(0);

    expect(events).toEqual([
      { kind: 'delta', text: 'flushed' },
      { kind: 'closed', code: 0 },
    ]);
  });

  it('onEvent subscriptions can be disposed', () => {
    const { proc, child } = makeProc();
    const seen: ChatEvent[] = [];
    const sub = proc.onEvent(e => seen.push(e));
    sub.dispose();
    child.emitStdout(deltaLine('unheard'));
    expect(seen).toHaveLength(0);
  });
});

/* ================================================================== */
/*  Registry                                                          */
/* ================================================================== */

describe('chat process registry', () => {
  it('getOrCreate reuses a live process and getChatProcess finds it', () => {
    const { spawnFn, calls } = makeSpawn();
    const a = getOrCreateChatProcess({ sessionId: SESSION_ID, cwd: '/tmp', spawnFn });
    const again = getOrCreateChatProcess({ sessionId: SESSION_ID, cwd: '/tmp', spawnFn });

    expect(again).toBe(a);
    expect(calls).toHaveLength(1); // no second spawn
    expect(getChatProcess(SESSION_ID)).toBe(a);
  });

  it('cap of 2: creating a 3rd disposes the least-recently-used first', () => {
    const { spawnFn, calls } = makeSpawn();
    const a = getOrCreateChatProcess({ sessionId: SESSION_ID, cwd: '/tmp', spawnFn });
    getOrCreateChatProcess({ sessionId: OTHER_ID, cwd: '/tmp', spawnFn });
    // Touch a — OTHER_ID becomes the LRU.
    getOrCreateChatProcess({ sessionId: SESSION_ID, cwd: '/tmp', spawnFn });

    const c = getOrCreateChatProcess({ sessionId: THIRD_ID, cwd: '/tmp', spawnFn });

    expect(calls[1].child.kills).toContain('SIGTERM'); // OTHER_ID evicted
    expect(calls[0].child.kills).toHaveLength(0);      // SESSION_ID survived
    expect(getChatProcess(OTHER_ID)).toBeUndefined();
    expect(getChatProcess(SESSION_ID)).toBe(a);
    expect(getChatProcess(THIRD_ID)).toBe(c);
  });

  it('a closed process is replaced, not reused', () => {
    const { spawnFn, calls } = makeSpawn();
    const a = getOrCreateChatProcess({ sessionId: SESSION_ID, cwd: '/tmp', spawnFn });
    calls[0].child.emitClose(0);

    expect(getChatProcess(SESSION_ID)).toBeUndefined(); // self-evicted
    const b = getOrCreateChatProcess({ sessionId: SESSION_ID, cwd: '/tmp', spawnFn });
    expect(b).not.toBe(a);
    expect(calls).toHaveLength(2);
  });

  it('closeChatProcess disposes one; closeAllChatProcesses disposes everything', () => {
    const { spawnFn, calls } = makeSpawn();
    getOrCreateChatProcess({ sessionId: SESSION_ID, cwd: '/tmp', spawnFn });
    getOrCreateChatProcess({ sessionId: OTHER_ID, cwd: '/tmp', spawnFn });

    closeChatProcess(SESSION_ID);
    expect(calls[0].child.kills).toContain('SIGTERM');
    expect(getChatProcess(SESSION_ID)).toBeUndefined();
    expect(getChatProcess(OTHER_ID)).toBeDefined();

    closeAllChatProcesses();
    expect(calls[1].child.kills).toContain('SIGTERM');
    expect(getChatProcess(OTHER_ID)).toBeUndefined();
  });
});
