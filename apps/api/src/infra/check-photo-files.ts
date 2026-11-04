import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/client.js';
import { photo } from '../db/schema.js';
import type { FileStorage } from './file-storage.js';

/**
 * Startup check: every photo in the database should have its file in the storage. Missing files
 * mean the file volume was lost or not mounted (the photos then disappear from protocols and
 * exports), so it is logged loudly with the directory in use.
 */
export async function checkPhotoFiles(
  db: Db,
  files: FileStorage,
  dir: string,
  log: FastifyBaseLogger,
): Promise<void> {
  const rows = await db.select({ key: photo.storageKey }).from(photo);
  let missing = 0;
  for (const row of rows) if (!(await files.exists(row.key))) missing += 1;
  if (missing > 0) {
    log.error(
      `Úložiště souborů (${dir}): ${missing} z ${rows.length} fotek v databázi nemá soubor. ` +
        'Zkontrolujte, že je adresář připojený jako trvalý svazek (volume).',
    );
  } else {
    log.info(`Úložiště souborů (${dir}): ${rows.length} fotek, všechny soubory jsou na místě.`);
  }
}
