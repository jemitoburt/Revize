import { z } from 'zod';
import { idSchema } from './common.js';

const text = (max: number) => z.string().trim().max(max).default('');

/** Company details and texts printed on protocols (office → Nastavení). */
export const organizationSettingsSchema = z.object({
  companyId: text(20),
  address: text(300),
  phone: text(50),
  email: text(200),
  web: text(200),
  /** Printed under the technician's signature line, e.g. "Osvědčení č. 123/2024". */
  certification: text(300),
  /** Document control of the protocol form, printed in the page header ("Datum vydání", "Verze"). */
  protocolIssueDate: text(30),
  protocolVersion: text(30),
  /** Bottom left of every page, e.g. "BOZP • PO • REVIZE" (the web address is bottom right). */
  pageFooter: text(200),
  /** Additional text after the standard statements at the end of the protocol. */
  protocolFooter: text(3000),
  /**
   * Closing an inspection deletes the defect photos of earlier inspections of the same items
   * (backed up outside via the photo ZIP), so the server does not keep piling them up.
   */
  deletePreviousDefectPhotos: z.boolean().default(true),
});
export type OrganizationSettings = z.infer<typeof organizationSettingsSchema>;

export const organizationSchema = z.object({
  id: idSchema,
  name: z.string(),
  settings: organizationSettingsSchema,
  hasLogo: z.boolean(),
  updatedAt: z.string(),
});
export type Organization = z.infer<typeof organizationSchema>;

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1, 'Zadejte název firmy').max(200),
  settings: organizationSettingsSchema,
});

export const LOGO_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  mimeTypes: ['image/png', 'image/jpeg'],
} as const;
