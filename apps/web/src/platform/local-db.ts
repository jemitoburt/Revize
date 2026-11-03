import Dexie, { type EntityTable } from 'dexie';
import type { OutboxStatus } from '@revize/shared';

/** Last server answer of a read, for working without a connection (key e.g. `items:<id>`). */
export interface SnapshotRow {
  key: string;
  value: unknown;
  savedAt: string;
}

/** A field write waiting to be sent (ADR-0004). Removed only after the server accepted it. */
export interface OutboxRow {
  seq?: number;
  /** Client id of the command. */
  id: string;
  /** Who recorded it; other users' commands are never sent under a new login. */
  userId: string;
  kind: 'result' | 'result-delete' | 'photo' | 'item';
  method: 'PUT' | 'POST' | 'DELETE';
  path: string;
  /** JSON body, or the text fields of a photo upload. */
  body: unknown;
  /** Commands of one group are sent strictly in order (see `runnableCommands`). */
  group: string;
  /** How the change looks in the UI until the server's answer replaces it (result, item). */
  preview: unknown;
  /** Czech description for the list of unsent data. */
  label: string;
  inspectionId: string | null;
  itemId: string | null;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  createdAt: string;
}

/** Photo bytes of an outbox command until the upload succeeded. */
export interface PhotoBlobRow {
  id: string;
  blob: Blob;
  owner: 'item' | 'result' | 'inspection';
  itemId: string | null;
  inspectionId: string | null;
  /**
   * A defect photo taken before the result was saved: kept on the device, but not sent until
   * the result is saved (the server needs the result first).
   */
  draft: boolean;
  createdAt: string;
}

class FieldDatabase extends Dexie {
  snapshots!: EntityTable<SnapshotRow, 'key'>;
  outbox!: EntityTable<OutboxRow, 'seq'>;
  photos!: EntityTable<PhotoBlobRow, 'id'>;

  constructor() {
    super('revize-field');
    this.version(1).stores({
      snapshots: 'key',
      outbox: '++seq, &id, status, inspectionId, itemId',
      photos: 'id, itemId, inspectionId',
    });
  }
}

/** IndexedDB of the field mode (ADR-0003: storage only through `src/platform/`). */
export const localDb = new FieldDatabase();

/** Asks the browser not to evict our data under storage pressure (Safari may still ask). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
