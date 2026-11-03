import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bearer, createTestContext, errorCode, type TestContext } from './helpers.js';

let ctx: TestContext;
let adminToken: string;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.app.close();
  await ctx.database.close();
});
beforeEach(async () => {
  await ctx.reset();
  adminToken = (await ctx.login(ADMIN.email, ADMIN.password)).token;
});

const technik = {
  email: 'technik@test.cz',
  displayName: 'Jan Technik',
  role: 'inspector',
  password: 'technik-heslo-1',
};

async function createUser(payload: Record<string, unknown> = technik) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/users',
    headers: bearer(adminToken),
    payload,
  });
}

describe('users', () => {
  it('admin creates an inspector who can sign in with limited permissions', async () => {
    const created = await createUser();
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      email: technik.email,
      role: 'inspector',
      active: true,
      version: 1,
    });
    expect(created.json()).not.toHaveProperty('passwordHash');

    const { token } = await ctx.login(technik.email, technik.password);
    const me = await ctx.app.inject({ url: '/api/auth/me', headers: bearer(token) });
    expect(me.json().permissions).toContain('inspection.perform');
    expect(me.json().permissions).not.toContain('user.manage');

    const forbidden = await ctx.app.inject({ url: '/api/users', headers: bearer(token) });
    expect(forbidden.statusCode).toBe(403);
    expect(errorCode(forbidden)).toBe('forbidden');
  });

  it('rejects a duplicate e-mail but repeats an identical request idempotently', async () => {
    const id = '0195f1a2-0000-7000-8000-000000000001';
    expect((await createUser({ ...technik, id })).statusCode).toBe(201);
    const repeated = await createUser({ ...technik, id });
    expect(repeated.statusCode).toBe(201);
    expect(repeated.json().id).toBe(id);

    const duplicate = await createUser({ ...technik, email: 'TECHNIK@test.cz' });
    expect(duplicate.statusCode).toBe(409);
    expect(errorCode(duplicate)).toBe('email_taken');

    const list = await ctx.app.inject({ url: '/api/users', headers: bearer(adminToken) });
    expect(list.json()).toHaveLength(2);
  });

  it('uses optimistic locking', async () => {
    const user = (await createUser()).json();
    const first = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${user.id}`,
      headers: bearer(adminToken),
      payload: { displayName: 'Jan Novák', version: 1 },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ displayName: 'Jan Novák', version: 2 });

    const stale = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${user.id}`,
      headers: bearer(adminToken),
      payload: { displayName: 'Jiný', version: 1 },
    });
    expect(stale.statusCode).toBe(409);
    expect(errorCode(stale)).toBe('version_conflict');
  });

  it('keeps at least one active administrator', async () => {
    const me = (await ctx.app.inject({ url: '/api/auth/me', headers: bearer(adminToken) })).json();
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${me.id}`,
      headers: bearer(adminToken),
      payload: { role: 'inspector', version: 1 },
    });
    expect(response.statusCode).toBe(409);
    expect(errorCode(response)).toBe('last_admin');
  });

  it('deletes a user: signed out, hidden, e-mail free again; not yourself', async () => {
    const created = (await createUser()).json();
    const { token } = await ctx.login(technik.email, technik.password);
    const del = (id: string, as = adminToken) =>
      ctx.app.inject({ method: 'DELETE', url: `/api/users/${id}`, headers: bearer(as) });

    expect((await del(created.id, token)).statusCode).toBe(403);
    expect((await del(created.id)).statusCode).toBe(204);
    expect((await ctx.app.inject({ url: '/api/auth/me', headers: bearer(token) })).statusCode).toBe(
      401,
    );
    await expect(ctx.login(technik.email, technik.password)).rejects.toThrow();
    const list = (await ctx.app.inject({ url: '/api/users', headers: bearer(adminToken) })).json<
      { id: string }[]
    >();
    expect(list.map((u) => u.id)).not.toContain(created.id);
    expect((await del(created.id)).statusCode).toBe(404);
    // The e-mail can be used for a new account.
    expect((await createUser({ ...technik, id: undefined })).statusCode).toBe(201);

    const me = (await ctx.app.inject({ url: '/api/auth/me', headers: bearer(adminToken) })).json();
    expect(errorCode(await del(me.id))).toBe('delete_self');
  });

  it('deactivation and password reset sign the user out', async () => {
    const user = (await createUser()).json();
    const { token } = await ctx.login(technik.email, technik.password);

    const reset = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${user.id}`,
      headers: bearer(adminToken),
      payload: { password: 'uplne-nove-heslo', version: 1 },
    });
    expect(reset.statusCode).toBe(200);
    expect((await ctx.app.inject({ url: '/api/auth/me', headers: bearer(token) })).statusCode).toBe(
      401,
    );

    const again = await ctx.login(technik.email, 'uplne-nove-heslo');
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${user.id}`,
      headers: bearer(adminToken),
      payload: { active: false, version: 2 },
    });
    expect(
      (await ctx.app.inject({ url: '/api/auth/me', headers: bearer(again.token) })).statusCode,
    ).toBe(401);
    await expect(ctx.login(technik.email, 'uplne-nove-heslo')).rejects.toThrow('login failed');
  });

  it('records changes in the audit log without secrets', async () => {
    const user = (await createUser()).json();
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${user.id}`,
      headers: bearer(adminToken),
      payload: { role: 'admin', version: 1 },
    });
    const audit = await ctx.app.inject({
      url: `/api/audit?entityType=user&entityId=${user.id}`,
      headers: bearer(adminToken),
    });
    expect(audit.statusCode).toBe(200);
    const entries = audit.json();
    expect(entries.map((e: { action: string }) => e.action)).toEqual([
      'user.update',
      'user.create',
    ]);
    expect(entries[0].before.role).toBe('inspector');
    expect(entries[0].after.role).toBe('admin');
    expect(entries[0].actor.displayName).toBe('Administrátor');
    expect(JSON.stringify(entries)).not.toContain('argon2');
  });
});
