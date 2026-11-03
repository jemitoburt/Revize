import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bearer, createTestContext, errorCode, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.app.close();
  await ctx.database.close();
});
beforeEach(() => ctx.reset());

describe('login', () => {
  it('returns the user, a token and an httpOnly session cookie', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ' Admin@Test.cz ', password: ADMIN.password, deviceLabel: 'iPad terén' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.user).toMatchObject({ email: ADMIN.email, role: 'admin' });
    expect(body.user.permissions).toContain('user.manage');
    expect(body.token).toMatch(/^[\w-]{40,}$/);
    const cookie = response.cookies.find((c) => c.name === 'revize_session');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
  });

  it('gives the same answer for a wrong password and an unknown e-mail', async () => {
    const wrong = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ADMIN.email, password: 'spatne-heslo' },
    });
    const unknown = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nikdo@test.cz', password: 'spatne-heslo' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    expect(wrong.json().message).toBe('Nesprávný e-mail nebo heslo.');
  });

  it('validates the body with Czech messages', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'neni-email', password: '' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBe('validation');
    expect(body.issues.map((i: { path: string[] }) => i.path[0])).toEqual(
      expect.arrayContaining(['email', 'password']),
    );
  });

  it('is rate limited', async () => {
    const attempt = () =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '10.9.9.9',
        payload: { email: ADMIN.email, password: 'spatne-heslo' },
      });
    for (let i = 0; i < 10; i++) expect((await attempt()).statusCode).toBe(401);
    const blocked = await attempt();
    expect(blocked.statusCode).toBe(429);
    expect(errorCode(blocked)).toBe('rate_limited');
  });
});

describe('session', () => {
  it('works with the cookie and with a bearer token', async () => {
    const { token, cookie } = await ctx.login(ADMIN.email, ADMIN.password);
    const viaCookie = await ctx.app.inject({ url: '/api/auth/me', headers: { cookie } });
    const viaBearer = await ctx.app.inject({ url: '/api/auth/me', headers: bearer(token) });
    expect(viaCookie.statusCode).toBe(200);
    expect(viaBearer.json()).toEqual(viaCookie.json());
  });

  it('requires a session', async () => {
    const response = await ctx.app.inject({ url: '/api/auth/me' });
    expect(response.statusCode).toBe(401);
    expect(errorCode(response)).toBe('unauthorized');
  });

  it('logout invalidates the token', async () => {
    const { token } = await ctx.login(ADMIN.email, ADMIN.password);
    const logout = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: bearer(token),
    });
    expect(logout.statusCode).toBe(204);
    expect((await ctx.app.inject({ url: '/api/auth/me', headers: bearer(token) })).statusCode).toBe(
      401,
    );
  });

  it('rejects cookie-authenticated writes from a foreign origin (CSRF)', async () => {
    const { cookie } = await ctx.login(ADMIN.email, ADMIN.password);
    const foreign = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie, origin: 'https://evil.example', host: 'revize.example.ts.net' },
    });
    expect(foreign.statusCode).toBe(403);
    const sameOrigin = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie, origin: 'https://revize.example.ts.net', host: 'revize.example.ts.net' },
    });
    expect(sameOrigin.statusCode).toBe(204);
  });
});

describe('password change', () => {
  it('checks the current password and signs out other devices', async () => {
    const ipad = await ctx.login(ADMIN.email, ADMIN.password);
    const office = await ctx.login(ADMIN.email, ADMIN.password);

    const wrong = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: bearer(office.token),
      payload: { currentPassword: 'neni-to-ono', newPassword: 'nove-dlouhe-heslo' },
    });
    expect(wrong.statusCode).toBe(400);

    const empty = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: bearer(office.token),
      payload: { currentPassword: ADMIN.password, newPassword: '' },
    });
    expect(empty.statusCode).toBe(400);

    const ok = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: bearer(office.token),
      payload: { currentPassword: ADMIN.password, newPassword: 'abc' },
    });
    // No minimum length (only non-empty).
    expect(ok.statusCode).toBe(204);
    expect(
      (await ctx.app.inject({ url: '/api/auth/me', headers: bearer(office.token) })).statusCode,
    ).toBe(200);
    expect(
      (await ctx.app.inject({ url: '/api/auth/me', headers: bearer(ipad.token) })).statusCode,
    ).toBe(401);
    await expect(ctx.login(ADMIN.email, 'abc')).resolves.toBeTruthy();
  });
});
