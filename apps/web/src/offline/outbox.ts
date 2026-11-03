import { classifyFailure, retryDelayMs, runnableCommands } from '@revize/shared';
import { zipSync } from 'fflate';
import { ApiRequestError, request, uploadFile } from '../api/client.js';
import { localDb, type OutboxRow, type PhotoBlobRow } from '../platform/local-db.js';

/**
 * Field writes go through this outbox (ADR-0004): `enqueue` commits the command (and photo
 * bytes) to IndexedDB and only then resolves, so the UI never confirms data that could still
 * be lost. A background loop sends the commands in order and removes each one only after the
 * server accepted it. Rejected commands wait for the technician; nothing is ever dropped.
 */

export type NewCommand = Omit<
  OutboxRow,
  'seq' | 'userId' | 'status' | 'attempts' | 'nextAttemptAt' | 'lastError' | 'createdAt'
>;

export interface SyncState {
  /** Signed-in user whose commands are being sent (null = sync stopped). */
  userId: string | null;
  sending: boolean;
  /** The session expired: sending waits for a new login. */
  needsLogin: boolean;
  /** Last connection problem (cleared by the next successful send). */
  offlineSince: string | null;
}

let state: SyncState = { userId: null, sending: false, needsLogin: false, offlineSince: null };
const listeners = new Set<() => void>();
const sentListeners = new Set<(command: OutboxRow, response: unknown) => void>();
let again = false;
let running: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let interval: ReturnType<typeof setInterval> | undefined;

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export const getSyncState = () => state;
export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
/** Called after each command the server accepted (e.g. to refresh cached lists). */
export function onCommandSent(listener: (command: OutboxRow, response: unknown) => void) {
  sentListeners.add(listener);
  return () => sentListeners.delete(listener);
}

/** Stores a field write on the device; resolves once it is safely in IndexedDB. */
export async function enqueue(command: NewCommand, photo?: PhotoBlobRow): Promise<void> {
  if (!state.userId) throw new Error('Synchronizace není spuštěná (nepřihlášený uživatel).');
  const row: OutboxRow = {
    ...command,
    userId: state.userId,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
  };
  await localDb.transaction('rw', localDb.outbox, localDb.photos, async () => {
    if (photo) await localDb.photos.put(photo);
    await localDb.outbox.add(row);
  });
  void syncNow();
}

/** Keeps a defect photo on the device until its result is saved (see `PhotoBlobRow.draft`). */
export async function saveDraftPhoto(photo: PhotoBlobRow): Promise<void> {
  await localDb.photos.put(photo);
}

/** Removes a photo that has not been sent yet (the technician deleted it). */
export async function cancelPhoto(photoId: string): Promise<void> {
  await localDb.transaction('rw', localDb.outbox, localDb.photos, async () => {
    await localDb.outbox.where('id').equals(photoId).delete();
    await localDb.photos.delete(photoId);
  });
}

/** Sends a command that waits for attention again (after the cause was fixed). */
export async function retryCommand(seq: number): Promise<void> {
  await localDb.outbox.update(seq, { status: 'pending', nextAttemptAt: 0, lastError: null });
  void syncNow();
}

type Outcome = 'sent' | 'retry' | 'auth' | 'attention';

async function sendOne(command: OutboxRow): Promise<Outcome> {
  try {
    let response: unknown;
    if (command.kind === 'photo') {
      const photo = await localDb.photos.get(command.id);
      if (!photo) {
        await localDb.outbox.update(command.seq!, {
          status: 'attention',
          lastError: 'Soubor fotky v zařízení chybí.',
        });
        return 'attention';
      }
      response = await uploadFile(
        command.path,
        photo.blob,
        command.body as Record<string, string>,
        {
          method: 'PUT',
          fileName: `${command.id}.jpg`,
        },
      );
    } else {
      response = await request(command.method, command.path, command.body ?? undefined);
    }
    await localDb.transaction('rw', localDb.outbox, localDb.photos, async () => {
      await localDb.outbox.delete(command.seq!);
      if (command.kind === 'photo') await localDb.photos.delete(command.id);
    });
    for (const listener of sentListeners) listener(command, response);
    return 'sent';
  } catch (error) {
    const status = error instanceof ApiRequestError ? error.status : 0;
    const message = error instanceof Error ? error.message : String(error);
    const kind = classifyFailure(status);
    if (kind === 'auth') return 'auth';
    if (kind === 'retry') {
      const attempts = command.attempts + 1;
      await localDb.outbox.update(command.seq!, {
        attempts,
        nextAttemptAt: Date.now() + retryDelayMs(attempts),
        lastError: message,
      });
      return 'retry';
    }
    await localDb.outbox.update(command.seq!, { status: 'attention', lastError: message });
    return 'attention';
  }
}

async function pass(): Promise<void> {
  const userId = state.userId;
  if (!userId || state.needsLogin) return;
  for (;;) {
    const mine = (await localDb.outbox.toArray()).filter((c) => c.userId === userId);
    const next = runnableCommands(
      mine.map((c) => ({ ...c, seq: c.seq! })),
      Date.now(),
    )[0];
    if (!next) {
      scheduleRetry(mine);
      return;
    }
    const outcome = await sendOne(next);
    if (outcome === 'sent') {
      if (state.offlineSince) setState({ offlineSince: null });
    } else if (outcome === 'auth') {
      setState({ needsLogin: true });
      return;
    } else if (outcome === 'retry') {
      // No connection: the other groups would fail the same way; try again later.
      if (!state.offlineSince) setState({ offlineSince: new Date().toISOString() });
      scheduleRetry(await localDb.outbox.toArray());
      return;
    }
  }
}

function scheduleRetry(commands: OutboxRow[]) {
  clearTimeout(retryTimer);
  const waiting = commands.filter((c) => c.status === 'pending' && c.nextAttemptAt > Date.now());
  if (waiting.length === 0) return;
  const at = Math.min(...waiting.map((c) => c.nextAttemptAt));
  retryTimer = setTimeout(() => void syncNow(), Math.max(0, at - Date.now()) + 50);
}

/**
 * Sends what can be sent now. A call during a running pass schedules one more pass and
 * resolves when both are done, so awaiting it always means "everything sendable was tried".
 */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    setState({ sending: true });
    try {
      do {
        again = false;
        await pass();
      } while (again);
    } finally {
      running = null;
      setState({ sending: false });
    }
  })();
  return running;
}

/** Retry everything that waits for the network right now (e.g. "Odeslat nyní"). */
export async function syncAllNow(): Promise<void> {
  await localDb.outbox.where('status').equals('pending').modify({ nextAttemptAt: 0 });
  await syncNow();
}

const wake = () => void syncNow();
const onVisible = () => document.visibilityState === 'visible' && void syncAllNow();

/** Starts sending the signed-in user's commands; call again after every login. */
export function startSync(userId: string) {
  stopSync();
  setState({ userId, needsLogin: false });
  window.addEventListener('online', wake);
  document.addEventListener('visibilitychange', onVisible);
  interval = setInterval(wake, 20_000);
  void syncAllNow();
}

export function stopSync() {
  window.removeEventListener('online', wake);
  document.removeEventListener('visibilitychange', onVisible);
  clearInterval(interval);
  clearTimeout(retryTimer);
  setState({ userId: null });
}

/**
 * Emergency export of everything not yet sent: `neodeslano.json` with the commands and the
 * photos as files. The office can enter the data from it if a device never gets online again.
 */
export async function exportUnsent(): Promise<Blob> {
  const commands = await localDb.outbox.orderBy('seq').toArray();
  const photos = await localDb.photos.toArray();
  const files: Record<string, Uint8Array> = {
    'neodeslano.json': new TextEncoder().encode(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          commands,
          photos: photos.map(({ blob: _, ...p }) => p),
        },
        null,
        2,
      ),
    ),
  };
  for (const photo of photos) {
    files[`fotky/${photo.id}.jpg`] = new Uint8Array(await photo.blob.arrayBuffer());
  }
  return new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' });
}
