import {
  PHOTO_LIMITS,
  apiErrorSchema,
  idSchema,
  listPhotosQuerySchema,
  movePhotoSchema,
  photoSchema,
  serverStatusSchema,
  uploadPhotoFieldsSchema,
} from '@revize/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authOf, requirePermission } from '../../auth/plugin.js';
import { AppError, validationError } from '../../errors.js';
import type { PhotosService } from './service.js';

const params = z.object({ id: idSchema });
const errors = { 400: apiErrorSchema, 404: apiErrorSchema, 409: apiErrorSchema };

export const photosRoutes: FastifyPluginAsyncZod<{ photos: PhotosService }> = async (
  app,
  { photos },
) => {
  const read = requirePermission('inspection.read');
  const perform = requirePermission('inspection.perform');
  const tags = ['Fotky'];

  app.get(
    '/photos',
    {
      preHandler: read,
      schema: {
        tags,
        summary: 'Fotky artiklu (vlastní a závad) nebo celé kontroly',
        querystring: listPhotosQuerySchema,
        response: { 200: z.array(photoSchema), ...errors },
      },
    },
    (req) => photos.list(authOf(req), req.query),
  );

  app.put(
    '/photos/:id',
    {
      preHandler: perform,
      schema: {
        tags,
        summary:
          'Nahrát fotku (multipart: pole owner, itemId, inspectionId, takenAt, caption, pak file)',
        consumes: ['multipart/form-data'],
        params,
        response: { 200: photoSchema, 201: photoSchema, ...errors },
      },
    },
    async (request, reply) => {
      const file = await request.file({ limits: { fileSize: PHOTO_LIMITS.maxBytes } });
      if (!file) throw new AppError(400, 'invalid_photo', 'Chybí soubor fotky.');
      const data = await file.toBuffer().catch(() => {
        throw new AppError(
          400,
          'invalid_photo',
          `Fotka je větší než ${PHOTO_LIMITS.maxBytes / 1024 / 1024} MB.`,
        );
      });
      const raw = Object.fromEntries(
        Object.entries(file.fields).flatMap(([name, field]) =>
          field && !Array.isArray(field) && field.type === 'field'
            ? [[name, String(field.value)]]
            : [],
        ),
      );
      const fields = uploadPhotoFieldsSchema.safeParse(raw);
      if (!fields.success) {
        throw validationError(
          fields.error.issues.map((i) => ({ path: i.path.map(String), message: i.message })),
        );
      }
      const result = await photos.upload(authOf(request), request.params.id, fields.data, {
        filename: file.filename,
        mimetype: file.mimetype,
        data,
      });
      return reply.code(result.created ? 201 : 200).send(result.photo);
    },
  );

  for (const variant of ['original', 'thumbnail'] as const) {
    app.get(
      `/photos/:id/${variant}`,
      {
        preHandler: read,
        schema: {
          tags,
          summary: variant === 'original' ? 'Soubor fotky' : 'Náhled fotky (JPEG)',
          params,
        },
      },
      async (req, reply) => {
        const { data, mimeType } = await photos.file(authOf(req), req.params.id, variant);
        return reply
          .header('content-type', mimeType)
          .header('cache-control', 'private, max-age=31536000, immutable')
          .send(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
      },
    );
  }

  app.put(
    '/photos/:id/owner',
    {
      preHandler: perform,
      schema: {
        tags,
        summary: 'Přesunout fotku mezi artiklem a závadou v kontrole',
        params,
        body: movePhotoSchema,
        response: { 200: photoSchema, ...errors },
      },
    },
    (req) => photos.move(authOf(req), req.params.id, req.body),
  );
  app.get(
    '/server-status',
    {
      preHandler: requirePermission('settings.manage'),
      schema: {
        tags: ['Provoz'],
        summary: 'Verze API a stav souborů fotek (chybějící soubory)',
        response: { 200: serverStatusSchema },
      },
    },
    (req) => photos.status(authOf(req)),
  );
  app.delete(
    '/photos/:id',
    {
      preHandler: perform,
      schema: { tags, summary: 'Smazat fotku', params, response: { 204: z.null(), ...errors } },
    },
    async (req, reply) => {
      await photos.delete(authOf(req), req.params.id);
      return reply.code(204).send(null);
    },
  );
};
