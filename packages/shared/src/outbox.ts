/**
 * Rules of the field outbox (ADR-0004): every field write is a command stored on the device
 * before the UI confirms it, and is sent to the server later. Commands are never dropped by the
 * app; a command the server rejects waits for the technician ("attention").
 */

export type OutboxStatus = 'pending' | 'attention';

export interface OutboxCommandState {
  seq: number;
  /** Commands of one group (e.g. one item in one inspection) are sent strictly in order. */
  group: string;
  status: OutboxStatus;
  nextAttemptAt: number;
}

/**
 * Commands that may be sent now, in order: the earliest command of each group, unless that
 * group is waiting for attention or for its retry time.
 */
export function runnableCommands<T extends OutboxCommandState>(
  commands: readonly T[],
  now: number,
): T[] {
  const blocked = new Set<string>();
  const runnable: T[] = [];
  for (const command of [...commands].sort((a, b) => a.seq - b.seq)) {
    if (blocked.has(command.group)) continue;
    blocked.add(command.group);
    if (command.status === 'pending' && command.nextAttemptAt <= now) runnable.push(command);
  }
  return runnable;
}

export type FailureKind = 'retry' | 'auth' | 'attention';

/**
 * What to do when sending failed: no connection, server errors and rate limits are retried;
 * an expired session pauses sending until the technician signs in; anything else the server
 * rejects needs a decision of the technician.
 */
export function classifyFailure(status: number): FailureKind {
  if (status === 0 || status === 408 || status === 429 || status >= 500) return 'retry';
  if (status === 401) return 'auth';
  return 'attention';
}

/** Exponential backoff for retries: 2 s, 4 s, 8 s … at most 5 minutes. */
export function retryDelayMs(attempts: number): number {
  return Math.min(2000 * 2 ** Math.max(0, attempts - 1), 5 * 60_000);
}
