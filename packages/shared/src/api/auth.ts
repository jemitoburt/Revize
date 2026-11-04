import { z } from 'zod';
import { PERMISSIONS, ROLES } from '../permissions.js';
import { certificationSchema, certificationsSchema, idSchema } from './common.js';

/** No length rule (the user's decision 2026-11-03); logins stay rate-limited. */
export const passwordSchema = z.string().min(1, 'Zadejte heslo').max(200);

/** Trimmed and lower-cased first: iPad keyboards like to capitalize the first letter. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .pipe(z.email('Neplatný e-mail'));

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  /** Shown in the list of active sessions, e.g. "iPad terén". */
  deviceLabel: z.string().max(100).optional(),
});
export type LoginRequest = z.input<typeof loginRequestSchema>;

export const currentUserSchema = z.object({
  id: idSchema,
  email: z.string(),
  displayName: z.string(),
  role: z.enum(ROLES),
  organizationId: idSchema,
  permissions: z.array(z.enum(PERMISSIONS)),
  /** The own authorization, printed under the signature in the protocol. */
  certification: z.string(),
  certifications: z.record(z.string(), z.string()),
});

/** `PATCH /auth/me`: the own profile (Můj účet). */
export const updateProfileRequestSchema = z.object({
  certification: certificationSchema,
  certifications: certificationsSchema.optional(),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

export const loginResponseSchema = z.object({
  user: currentUserSchema,
  /** Same token as the cookie; native clients (Capacitor) send it as `Authorization: Bearer`. */
  token: z.string(),
  expiresAt: z.string(),
});

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});
