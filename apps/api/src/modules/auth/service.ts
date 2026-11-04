import {
  permissionsOf,
  type CurrentUser,
  type Role,
  type changePasswordRequestSchema,
  type loginRequestSchema,
  type updateProfileRequestSchema,
} from '@revize/shared';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { AuthContext } from '../../auth/context.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../../auth/passwords.js';
import { createSession, deleteSession, deleteUserSessions } from '../../auth/sessions.js';
import type { Config } from '../../config.js';
import type { Db } from '../../db/client.js';
import { appUser } from '../../db/schema.js';
import { AppError, unauthorized, validationError } from '../../errors.js';
import { recordAudit } from '../audit/service.js';
import { usersRepository, type UserRow } from '../users/repository.js';

const invalidCredentials = () =>
  new AppError(401, 'invalid_credentials', 'Nesprávný e-mail nebo heslo.');

export function toCurrentUser(row: UserRow): CurrentUser {
  const role = row.role as Role;
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role,
    organizationId: row.organizationId,
    permissions: [...permissionsOf(role)],
    certification: row.certification,
  };
}

export function createAuthService(db: Db, config: Config) {
  return {
    async login(
      input: z.output<typeof loginRequestSchema>,
      meta: { userAgent?: string | undefined },
    ) {
      const user = await usersRepository.findByEmail(db, input.email);
      const valid = user
        ? await verifyPassword(user.passwordHash, input.password)
        : await verifyAgainstDummy(input.password);
      if (!user || !valid || !user.active) {
        if (user) {
          await recordAudit(db, {
            organizationId: user.organizationId,
            actorUserId: null,
            action: 'auth.login_failed',
            entityType: 'user',
            entityId: user.id,
          });
        }
        throw invalidCredentials();
      }

      return db.transaction(async (tx) => {
        const created = await createSession(tx, user.id, config.SESSION_TTL_DAYS, {
          deviceLabel: input.deviceLabel,
          userAgent: meta.userAgent,
        });
        await tx.update(appUser).set({ lastLoginAt: new Date() }).where(eq(appUser.id, user.id));
        await recordAudit(tx, {
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: 'auth.login',
          entityType: 'user',
          entityId: user.id,
          after: { deviceLabel: input.deviceLabel ?? null },
        });
        return { user: toCurrentUser(user), ...created };
      });
    },

    async logout(auth: AuthContext) {
      await deleteSession(db, auth.sessionId);
    },

    async me(auth: AuthContext): Promise<CurrentUser> {
      const user = await usersRepository.findById(db, auth.organizationId, auth.userId);
      if (!user) throw unauthorized();
      return toCurrentUser(user);
    },

    /** The own profile: the authorization printed under the protocol signature (audited). */
    async updateProfile(
      auth: AuthContext,
      input: z.output<typeof updateProfileRequestSchema>,
    ): Promise<CurrentUser> {
      const user = await usersRepository.findById(db, auth.organizationId, auth.userId);
      if (!user) throw unauthorized();
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(appUser)
          .set({
            certification: input.certification,
            updatedAt: new Date(),
            version: user.version + 1,
          })
          .where(eq(appUser.id, user.id))
          .returning();
        await recordAudit(tx, {
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: 'user.profile',
          entityType: 'user',
          entityId: user.id,
          before: { certification: user.certification },
          after: { certification: input.certification },
        });
        return row!;
      });
      return toCurrentUser(updated);
    },

    /** Changes the own password and signs out all other devices. */
    async changePassword(auth: AuthContext, input: z.output<typeof changePasswordRequestSchema>) {
      const user = await usersRepository.findById(db, auth.organizationId, auth.userId);
      if (!user) throw unauthorized();
      if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
        throw validationError(
          [{ path: ['currentPassword'], message: 'Současné heslo není správné.' }],
          'Současné heslo není správné.',
        );
      }
      await db.transaction(async (tx) => {
        await tx
          .update(appUser)
          .set({
            passwordHash: await hashPassword(input.newPassword),
            updatedAt: new Date(),
            version: user.version + 1,
          })
          .where(eq(appUser.id, user.id));
        await deleteUserSessions(tx, user.id, auth.sessionId);
        await recordAudit(tx, {
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: 'auth.password_change',
          entityType: 'user',
          entityId: user.id,
        });
      });
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
