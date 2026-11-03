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
import { importsRoutes } from './modules/imports/routes.js';
import { createImportsService } from './modules/imports/service.js';
import { itemsRoutes } from './modules/items/routes.js';
import { createItemsService } from './modules/items/service.js';
import { locationsRoutes } from './modules/locations/routes.js';
import { createLocationsService } from './modules/locations/service.js';
import { usersRoutes } from './modules/users/routes.js';
import { createUsersService } from './modules/users/service.js';

export interface RouteDeps {
  db: Db;
  config: Config;
}

/**
 * Every API module under `/api`. Shared by the Fastify server and the in-browser demo runtime
 * (`src/demo/`), so both expose exactly the same endpoints and rules.
 */
export async function registerApiRoutes(api: FastifyInstance, { db, config }: RouteDeps) {
  await api.register(healthRoutes, { db });
  await api.register(authRoutes, { auth: createAuthService(db, config), config });
  await api.register(usersRoutes, { users: createUsersService(db) });
  await api.register(auditRoutes, { db });
  await api.register(customersRoutes, { customers: createCustomersService(db) });
  await api.register(locationsRoutes, { locations: createLocationsService(db) });
  await api.register(equipmentTypesRoutes, { types: createEquipmentTypesService(db) });
  await api.register(itemsRoutes, { items: createItemsService(db) });
  await api.register(importsRoutes, { imports: createImportsService(db), db });
}
