import { createHash } from 'node:crypto';
import {
  PHOTO_LIMITS,
  type Photo,
  type listPhotosQuerySchema,
  type uploadPhotoFieldsSchema,
} from '@revize/shared';
import { and, asc, eq, isNull, or, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { AuthContext } from '../../auth/context.js';
import type { Db, DbOrTx } from '../../db/client.js';
import { inspection, inspectionResult, item, photo } from '../../db/schema.js';
import { AppError, conflict, notFound } from '../../errors.js';
import type { FileStorage } from '../../infra/file-storage.js';
import type { ImageProcessor } from '../../infra/image-processor.js';
import { recordAudit } from '../audit/service.js';
import { inspectionClosed, lockInspection } from '../inspections/service.js';

type PhotoRow = typeof photo.$inferSelect;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface PhotoFile {
  filename: string;
  mimetype: string;
  data: Uint8Array;
}

const invalidPhoto = (message: string) => new AppError(400, 'invalid_photo', message);

export function createPhotosService(db: Db, files: FileStorage, images: ImageProcessor) {
  /** Photos with the item and inspection they belong to (defect photos through their result). */
  const joined = (tx: DbOrTx) =>
    tx
      .select({
        photo,
        resultItemId: inspectionResult.itemId,
        resultInspectionId: inspectionResult.inspectionId,
      })
      .from(photo)
      .leftJoin(inspectionResult, eq(inspectionResult.id, photo.inspectionResultId));

  type Joined = { photo: PhotoRow; resultItemId: string | null; resultInspectionId: string | null };

  function toDto({ photo: row, resultItemId, resultInspectionId }: Joined): Photo {
    return {
      id: row.id,
      owner: row.itemId ? 'item' : row.inspectionResultId ? 'result' : 'inspection',
      itemId: row.itemId ?? resultItemId,
      inspectionId: row.inspectionId ?? resultInspectionId,
      mimeType: row.mimeType,
      width: row.width,
      height: row.height,
      sizeBytes: row.sizeBytes,
      hasThumbnail: row.thumbnailKey !== null,
      takenAt: row.takenAt?.toISOString() ?? null,
      caption: row.caption,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async function getJoined(tx: DbOrTx, auth: AuthContext, id: string): Promise<Joined> {
    const [row] = await joined(tx).where(
      and(eq(photo.organizationId, auth.organizationId), eq(photo.id, id)),
    );
    if (!row) throw notFound('Fotka neexistuje.');
    return row;
  }

  /** The owner columns of a new photo; result and inspection photos need an open inspection. */
  async function ownerOf(
    tx: DbOrTx,
    auth: AuthContext,
    fields: z.output<typeof uploadPhotoFieldsSchema>,
  ): Promise<Pick<PhotoRow, 'itemId' | 'inspectionResultId' | 'inspectionId'>> {
    const none = { itemId: null, inspectionResultId: null, inspectionId: null };
    if (fields.owner === 'item') {
      const [row] = await tx
        .select({ id: item.id })
        .from(item)
        .where(and(eq(item.organizationId, auth.organizationId), eq(item.id, fields.itemId!)));
      if (!row) throw notFound('Artikl neexistuje.');
      return { ...none, itemId: row.id };
    }
    const target = await lockInspection(tx, auth, fields.inspectionId!);
    if (target.status === 'closed') throw inspectionClosed();
    if (fields.owner === 'inspection') return { ...none, inspectionId: target.id };
    const [result] = await tx
      .select({ id: inspectionResult.id })
      .from(inspectionResult)
      .where(
        and(
          eq(inspectionResult.inspectionId, target.id),
          eq(inspectionResult.itemId, fields.itemId!),
        ),
      );
    if (!result) throw conflict('result_missing', 'Nejdřív uložte výsledek kontroly artiklu.');
    return { ...none, inspectionResultId: result.id };
  }

  return {
    async list(auth: AuthContext, query: z.output<typeof listPhotosQuerySchema>): Promise<Photo[]> {
      const filters: SQL[] = [eq(photo.organizationId, auth.organizationId)];
      if (query.itemId) {
        const defects = query.inspectionId
          ? and(
              eq(inspectionResult.itemId, query.itemId),
              eq(inspectionResult.inspectionId, query.inspectionId),
            )
          : eq(inspectionResult.itemId, query.itemId);
        filters.push(or(eq(photo.itemId, query.itemId), defects)!);
      } else {
        filters.push(eq(photo.inspectionId, query.inspectionId!), isNull(photo.itemId));
      }
      const rows = await joined(db)
        .where(and(...filters))
        .orderBy(asc(photo.createdAt), asc(photo.id));
      return rows.map(toDto);
    },

    /** Stores a photo under the client's id; repeating the upload returns the stored photo. */
    async upload(
      auth: AuthContext,
      id: string,
      fields: z.output<typeof uploadPhotoFieldsSchema>,
      file: PhotoFile,
    ): Promise<{ created: boolean; photo: Photo }> {
      const [existing] = await db
        .select({ org: photo.organizationId })
        .from(photo)
        .where(eq(photo.id, id));
      if (existing) {
        if (existing.org !== auth.organizationId)
          throw new AppError(409, 'id_taken', 'ID je již použito.');
        return { created: false, photo: toDto(await getJoined(db, auth, id)) };
      }
      const extension = EXTENSIONS[file.mimetype];
      if (!extension) throw invalidPhoto('Fotka musí být JPEG, PNG nebo WebP.');
      if (file.data.byteLength > PHOTO_LIMITS.maxBytes) {
        throw invalidPhoto(`Fotka je větší než ${PHOTO_LIMITS.maxBytes / 1024 / 1024} MB.`);
      }
      const processed = await images.process(file.data, PHOTO_LIMITS.thumbnailSize);
      if (!processed) throw invalidPhoto('Soubor se nepodařilo přečíst jako obrázek.');

      const now = new Date();
      const folder = `photos/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}`;
      const storageKey = `${folder}/original.${extension}`;
      const thumbnailKey = `${folder}/thumb.jpg`;
      await files.put(storageKey, file.data);
      await files.put(thumbnailKey, processed.thumbnail);
      try {
        await db.transaction(async (tx) => {
          const owner = await ownerOf(tx, auth, fields);
          const [row] = await tx
            .insert(photo)
            .values({
              id,
              organizationId: auth.organizationId,
              ...owner,
              storageKey,
              thumbnailKey,
              mimeType: file.mimetype,
              width: processed.width,
              height: processed.height,
              sizeBytes: file.data.byteLength,
              sha256: createHash('sha256').update(file.data).digest('hex'),
              takenAt: fields.takenAt ? new Date(fields.takenAt) : null,
              caption: fields.caption || null,
              createdBy: auth.userId,
            })
            .returning();
          await recordAudit(tx, {
            organizationId: auth.organizationId,
            actorUserId: auth.userId,
            action: 'photo.create',
            entityType: 'photo',
            entityId: id,
            after: row,
          });
        });
      } catch (error) {
        await Promise.all([files.delete(storageKey), files.delete(thumbnailKey)]);
        throw error;
      }
      return { created: true, photo: toDto(await getJoined(db, auth, id)) };
    },

    async file(
      auth: AuthContext,
      id: string,
      variant: 'original' | 'thumbnail',
    ): Promise<{ data: Uint8Array; mimeType: string }> {
      const { photo: row } = await getJoined(db, auth, id);
      const useThumb = variant === 'thumbnail' && row.thumbnailKey !== null;
      const key = useThumb ? row.thumbnailKey! : row.storageKey;
      if (!(await files.exists(key))) throw notFound('Soubor fotky chybí v úložišti.');
      return { data: await files.read(key), mimeType: useThumb ? 'image/jpeg' : row.mimeType };
    },

    /** Item photos can always be deleted; photos of an inspection only while it is open. */
    async delete(auth: AuthContext, id: string): Promise<void> {
      const deleted = await db.transaction(async (tx) => {
        const found = await getJoined(tx, auth, id);
        const inspectionId = found.photo.inspectionId ?? found.resultInspectionId;
        if (inspectionId) {
          const [row] = await tx
            .select({ status: inspection.status })
            .from(inspection)
            .where(eq(inspection.id, inspectionId))
            .for('update');
          if (row?.status === 'closed') throw inspectionClosed();
        }
        await tx.delete(photo).where(eq(photo.id, id));
        await recordAudit(tx, {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          action: 'photo.delete',
          entityType: 'photo',
          entityId: id,
          before: found.photo,
        });
        return found.photo;
      });
      await files.delete(deleted.storageKey);
      if (deleted.thumbnailKey) await files.delete(deleted.thumbnailKey);
    },
  };
}

export type PhotosService = ReturnType<typeof createPhotosService>;
