import { describe, expect, it } from 'vitest';
import { classifyFailure, retryDelayMs, runnableCommands } from './outbox.js';

const command = (
  seq: number,
  group: string,
  extra: Partial<{ status: 'pending' | 'attention'; nextAttemptAt: number }> = {},
) => ({
  seq,
  group,
  status: 'pending' as const,
  nextAttemptAt: 0,
  ...extra,
});

describe('runnableCommands', () => {
  it('sends the first command of every group, in order', () => {
    const commands = [command(3, 'b'), command(1, 'a'), command(2, 'a'), command(4, 'c')];
    expect(runnableCommands(commands, 10).map((c) => c.seq)).toEqual([1, 3, 4]);
  });
  it('holds a whole group behind a command that needs attention or waits for a retry', () => {
    const commands = [
      command(1, 'a', { status: 'attention' }),
      command(2, 'a'),
      command(3, 'b', { nextAttemptAt: 100 }),
      command(4, 'b'),
      command(5, 'c'),
    ];
    expect(runnableCommands(commands, 10).map((c) => c.seq)).toEqual([5]);
    expect(runnableCommands(commands, 100).map((c) => c.seq)).toEqual([3, 5]);
  });
});

describe('classifyFailure and retryDelayMs', () => {
  it('retries connection and server problems, pauses on 401, asks on other rejections', () => {
    expect([0, 408, 429, 500, 503].map(classifyFailure)).toEqual(Array(5).fill('retry'));
    expect(classifyFailure(401)).toBe('auth');
    expect([400, 403, 404, 409].map(classifyFailure)).toEqual(Array(4).fill('attention'));
  });
  it('backs off exponentially up to five minutes', () => {
    expect([1, 2, 3, 10, 20].map(retryDelayMs)).toEqual([2000, 4000, 8000, 300_000, 300_000]);
  });
});
