import type { FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { auditRoutes } from './modules/audit/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { createAuthService } from './modules/auth/service.js';
import { customersRoutes } from './modules/customers/routes.js';
import { createCustomersService } from './modules/customers/service.js';
import { equipmentTypesRoutes } from './modules/equipment-types/routes.js';
import { createEquipmentTypesService } from './modules/equipment-types/service.js';
import { healthRoutes } from './modules/health/routes.js';
import type { FileStorage } from './infra/file-storage.js';
import type { ImageProcessor } from './infra/image-processor.js';
import type { MetadataWriter } from './infra/metadata-writer.js';
import type { PdfRenderer } from './infra/pdf-renderer.js';
import { exportsRoutes } from './modules/exports/routes.js';
import { createExportsService } from './modules/exports/service.js';
import { importsRoutes } from './modules/imports/routes.js';
import { createImportsService } from './modules/imports/service.js';
import { inspectionsRoutes } from './modules/inspections/routes.js';
import { createInspectionsService } from './modules/inspections/service.js';
import { itemsRoutes } from './modules/items/routes.js';
import { createItemsService } from './modules/items/service.js';
import { locationsRoutes } from './modules/locations/routes.js';
import { createLocationsService } from './modules/locations/service.js';
import { organizationRoutes } from './modules/organization/routes.js';
import { createOrganizationService } from './modules/organization/service.js';
import { photosRoutes } from './modules/photos/routes.js';
import { createPhotosService } from './modules/photos/service.js';
import { protocolsRoutes } from './modules/protocols/routes.js';
import { createProtocolsService } from './modules/protocols/service.js';
import { usersRoutes } from './modules/users/routes.js';
import { createUsersService } from './modules/users/service.js';

export interface RouteDeps {
  db: Db;
  config: Config;
  files: FileStorage;
  images: ImageProcessor;
  /** Null where no PDF can be made (browser demo: the protocol is printed from its HTML). */
  pdf: PdfRenderer | null;
  /** Metadata of exported photos (demo: none). */
  metadata: MetadataWriter;
}

/**
 * Every API module under `/api`. Shared by the Fastify server and the in-browser demo runtime
 * (`src/demo/`), so both expose exactly the same endpoints and rules.
 */
export async function registerApiRoutes(
  api: FastifyInstance,
  { db, config, files, images, pdf, metadata }: RouteDeps,
) {
  await api.register(healthRoutes, { db });
  await api.register(authRoutes, { auth: createAuthService(db, config), config });
  await api.register(usersRoutes, { users: createUsersService(db) });
  await api.register(auditRoutes, { db });
  await api.register(customersRoutes, { customers: createCustomersService(db) });
  await api.register(locationsRoutes, { locations: createLocationsService(db) });
  await api.register(equipmentTypesRoutes, { types: createEquipmentTypesService(db) });
  await api.register(itemsRoutes, { items: createItemsService(db) });
  await api.register(importsRoutes, { imports: createImportsService(db), db });
  const inspections = createInspectionsService(db);
  await api.register(inspectionsRoutes, { inspections });
  await api.register(organizationRoutes, { organization: createOrganizationService(db, files) });
  await api.register(protocolsRoutes, {
    protocols: createProtocolsService(db, files, inspections, pdf),
  });
  await api.register(exportsRoutes, {
    exports: createExportsService(db, files, inspections, metadata),
  });
  await api.register(photosRoutes, { photos: createPhotosService(db, files, images) });
}
