import {
  newId,
  type Role,
  type User,
  type createUserRequestSchema,
  type updateUserRequestSchema,
} from '@revize/shared';
import type { z } from 'zod';
import type { AuthContext } from '../../auth/context.js';
import { hashPassword } from '../../auth/passwords.js';
import { deleteUserSessions } from '../../auth/sessions.js';
import type { Db } from '../../db/client.js';
import { conflict, notFound, versionConflict } from '../../errors.js';
import { recordAudit } from '../audit/service.js';
import { usersRepository as repo, type UserRow } from './repository.js';

export function toUserDto(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role as Role,
    active: row.active,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    certification: row.certification,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

const emailTaken = () => conflict('email_taken', 'Uživatel s tímto e-mailem už existuje.');

export function createUsersService(db: Db) {
  return {
    async list(auth: AuthContext): Promise<User[]> {
      return (await repo.listByOrganization(db, auth.organizationId)).map(toUserDto);
    },

    /** Idempotent for a repeated request with the same client id and e-mail. */
    async create(
      auth: AuthContext,
      input: z.output<typeof createUserRequestSchema>,
    ): Promise<User> {
      const id = input.id ?? newId();
      return db.transaction(async (tx) => {
        const existing = await repo.findByEmail(tx, input.email);
        if (existing) {
          if (existing.id === id && existing.organizationId === auth.organizationId) {
            return toUserDto(existing);
          }
          throw emailTaken();
        }
        const row = await repo.insert(tx, {
          id,
          organizationId: auth.organizationId,
          email: input.email,
          displayName: input.displayName,
          role: input.role,
          certification: input.certification,
          passwordHash: await hashPassword(input.password),
        });
        await recordAudit(tx, {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          action: 'user.create',
          entityType: 'user',
          entityId: row.id,
          after: toUserDto(row),
        });
        return toUserDto(row);
      });
    },

    async update(
      auth: AuthContext,
      id: string,
      input: z.output<typeof updateUserRequestSchema>,
    ): Promise<User> {
      return db.transaction(async (tx) => {
        const current = await repo.findById(tx, auth.organizationId, id);
        if (!current) throw notFound('Uživatel neexistuje.');
        if (current.version !== input.version) throw versionConflict();

        const losesAdmin =
          current.role === 'admin' &&
          current.active &&
          ((input.role !== undefined && input.role !== 'admin') || input.active === false);
        if (losesAdmin && (await repo.countActiveAdmins(tx, auth.organizationId)) <= 1) {
          throw conflict('last_admin', 'Musí zůstat aspoň jeden aktivní administrátor.');
        }

        const { password, version, ...changes } = input;
        const updated = await repo.update(tx, auth.organizationId, id, version, {
          ...changes,
          ...(password ? { passwordHash: await hashPassword(password) } : {}),
        });
        if (!updated) throw versionConflict();

        // A password reset or deactivation signs the user out everywhere.
        if (password || input.active === false) await deleteUserSessions(tx, id);

        await recordAudit(tx, {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          action: password ? 'user.update.password_reset' : 'user.update',
          entityType: 'user',
          entityId: id,
          before: toUserDto(current),
          after: toUserDto(updated),
        });
        return toUserDto(updated);
      });
    },

    /**
     * Deletes a user account: signed out, hidden, e-mail freed for a new account. Inspections,
     * results and the audit keep the name. Not yourself and not the last active admin.
     */
    async remove(auth: AuthContext, id: string): Promise<void> {
      await db.transaction(async (tx) => {
        const current = await repo.findById(tx, auth.organizationId, id);
        if (!current) throw notFound('Uživatel neexistuje.');
        if (id === auth.userId) {
          throw conflict('delete_self', 'Vlastní účet smazat nejde.');
        }
        if (
          current.role === 'admin' &&
          current.active &&
          (await repo.countActiveAdmins(tx, auth.organizationId)) <= 1
        ) {
          throw conflict('last_admin', 'Musí zůstat aspoň jeden aktivní administrátor.');
        }
        await repo.update(tx, auth.organizationId, id, current.version, {
          active: false,
          deletedAt: new Date(),
          email: `smazany-${id}@revize.invalid`,
        });
        await deleteUserSessions(tx, id);
        await recordAudit(tx, {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          action: 'user.delete',
          entityType: 'user',
          entityId: id,
          before: toUserDto(current),
        });
      });
    },
  };
}

export type UsersService = ReturnType<typeof createUsersService>;
