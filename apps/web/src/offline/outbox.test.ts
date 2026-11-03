import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ClientModule from '../api/client.js';
import { ApiRequestError } from '../api/client.js';
import { localDb } from '../platform/local-db.js';
import {
  enqueue,
  getSyncState,
  retryCommand,
  startSync,
  stopSync,
  syncNow,
  type NewCommand,
} from './outbox.js';

const request = vi.fn();
const uploadFile = vi.fn();
vi.mock('../api/client.js', async (original) => ({
  ...(await original<typeof ClientModule>()),
  request: (...args: unknown[]) => request(...args),
  uploadFile: (...args: unknown[]) => uploadFile(...args),
}));
vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
vi.stubGlobal('document', {
  addEventListener() {},
  removeEventListener() {},
  visibilityState: 'visible',
});

const fail = (status: number) =>
  new ApiRequestError(status, { error: 'x', message: `HTTP ${status}` });
const command = (id: string, group: string): NewCommand => ({
  id,
  kind: 'result',
  method: 'PUT',
  path: `/x/${id}`,
  body: { id },
  group,
  preview: null,
  label: id,
  inspectionId: null,
  itemId: null,
});
const stored = async () => (await localDb.outbox.orderBy('seq').toArray()).map((c) => c.id);

beforeEach(async () => {
  stopSync();
  await localDb.outbox.clear();
  await localDb.photos.clear();
  request.mockReset();
  uploadFile.mockReset();
});

describe('outbox', () => {
  it('stores the command before resolving and removes it once the server accepted it', async () => {
    request.mockRejectedValue(fail(0));
    startSync('u1');
    await enqueue(command('a', 'g1'));
    expect(await stored()).toEqual(['a']);
    await syncNow();
    const [kept] = await localDb.outbox.toArray();
    expect(kept).toMatchObject({ status: 'pending', attempts: 1 });
    expect(getSyncState().offlineSince).not.toBeNull();

    request.mockResolvedValue({});
    await localDb.outbox.toCollection().modify({ nextAttemptAt: 0 });
    await syncNow();
    expect(await stored()).toEqual([]);
    expect(request).toHaveBeenLastCalledWith('PUT', '/x/a', { id: 'a' });
  });

  it('holds a rejected command for attention, blocks its group only, retries on request', async () => {
    request.mockImplementation((_method: string, path: string) =>
      path === '/x/a' ? Promise.reject(fail(409)) : Promise.resolve({}),
    );
    startSync('u1');
    await enqueue(command('a', 'g1'));
    await enqueue(command('b', 'g1'));
    await enqueue(command('c', 'g2'));
    await syncNow();
    expect(await stored()).toEqual(['a', 'b']);
    const [a] = await localDb.outbox.toArray();
    expect(a).toMatchObject({ status: 'attention', lastError: 'HTTP 409' });

    request.mockResolvedValue({});
    await retryCommand(a!.seq!);
    await syncNow();
    expect(await stored()).toEqual([]);
  });

  it('pauses on an expired session and never sends commands of another user', async () => {
    request.mockRejectedValue(fail(401));
    startSync('u1');
    await enqueue(command('a', 'g1'));
    await syncNow();
    expect(getSyncState().needsLogin).toBe(true);
    expect(await stored()).toEqual(['a']);

    request.mockReset();
    request.mockResolvedValue({});
    startSync('u2');
    await syncNow();
    expect(request).not.toHaveBeenCalled();
    expect(await stored()).toEqual(['a']);
    startSync('u1');
    await syncNow();
    expect(await stored()).toEqual([]);
  });

  it('uploads photos with their stored bytes and deletes the bytes afterwards', async () => {
    uploadFile.mockResolvedValue({});
    startSync('u1');
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    await enqueue(
      {
        ...command('p1', 'g1'),
        kind: 'photo',
        path: '/photos/p1',
        body: { owner: 'item', itemId: 'i' },
      },
      {
        id: 'p1',
        blob,
        owner: 'item',
        itemId: 'i',
        inspectionId: null,
        draft: false,
        createdAt: '',
      },
    );
    await syncNow();
    expect(uploadFile).toHaveBeenCalledWith(
      '/photos/p1',
      expect.any(Blob),
      { owner: 'item', itemId: 'i' },
      {
        method: 'PUT',
        fileName: 'p1.jpg',
      },
    );
    expect(await localDb.photos.count()).toBe(0);
    expect(await stored()).toEqual([]);
  });
});
