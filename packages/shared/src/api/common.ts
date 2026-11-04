import { z } from 'zod';

export const idSchema = z.uuid();
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

/** Error body returned by the API for every non-2xx response. */
export const apiErrorSchema = z.object({
  error: z.string().describe('Machine-readable code, e.g. "validation", "not_found"'),
  message: z.string().describe('Czech message that can be shown to the user'),
  issues: z
    .array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() }))
    .optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** E.g. "Osvědčení č. 123/2024 (ČSN EN 15635)". */
export const certificationSchema = z.string().trim().max(300);
/** Per equipment type; empty texts are dropped. */
export const certificationsSchema = z
  .record(z.uuid(), certificationSchema)
  .transform((map) => Object.fromEntries(Object.entries(map).filter(([, text]) => text !== '')));
