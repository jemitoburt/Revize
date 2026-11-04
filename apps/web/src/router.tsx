import type { QueryClient } from '@tanstack/react-query';
import {
  Navigate,
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { z } from 'zod';
import { AuthGate } from './components/AuthGate.js';
import { Layout } from './components/Layout.js';
import { FieldHomePage } from './field/FieldHomePage.js';
import { FieldLayout } from './field/FieldLayout.js';
import { InspectionPage } from './field/InspectionPage.js';
import { AccountPage } from './pages/AccountPage.js';
import { CustomerPage } from './pages/CustomerPage.js';
import { CustomersPage } from './pages/CustomersPage.js';
import { EquipmentTypePage } from './pages/EquipmentTypePage.js';
import { EquipmentTypesPage } from './pages/EquipmentTypesPage.js';
import { ImportPage } from './pages/ImportPage.js';
import { InspectionDetailPage } from './pages/InspectionDetailPage.js';
import { InspectionsPage } from './pages/InspectionsPage.js';
import { ItemsPage } from './pages/ItemsPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { SitePage } from './pages/SitePage.js';
import { UsersPage } from './pages/UsersPage.js';

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Outlet,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/prihlaseni',
  validateSearch: z.object({ next: z.string().optional() }),
  component: LoginPage,
});

/** Everything else needs a signed-in user (Layout redirects to /prihlaseni). */
const appRoute = createRoute({ getParentRoute: () => rootRoute, id: 'app', component: Layout });

/** Office staff start with the customers, technicians directly in the field mode. */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <AuthGate>
      {(user) => (
        <Navigate to={user.permissions.includes('customer.write') ? '/zakaznici' : '/teren'} />
      )}
    </AuthGate>
  ),
});

/** Field mode for the iPad (M5): own shell without the office navigation. */
const fieldRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'field',
  component: FieldLayout,
});
const fieldHomeRoute = createRoute({
  getParentRoute: () => fieldRoute,
  path: '/teren',
  component: FieldHomePage,
});
export const fieldInspectionRoute = createRoute({
  getParentRoute: () => fieldRoute,
  path: '/teren/kontrola/$inspectionId',
  component: InspectionPage,
});

const customersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/zakaznici',
  component: CustomersPage,
});
export const customerRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/zakaznici/$customerId',
  component: CustomerPage,
});
export const siteRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/provozovny/$siteId',
  component: SitePage,
});
const typesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/typy',
  component: EquipmentTypesPage,
});
export const typeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/typy/$typeId',
  component: EquipmentTypePage,
});

export const itemsSearchSchema = z.object({
  customerId: z.string().optional(),
  siteId: z.string().optional(),
  equipmentTypeId: z.string().optional(),
  locationId: z.string().optional(),
  status: z.enum(['in_service', 'out_of_service']).optional(),
  due: z.enum(['overdue', '30', '60', '90']).optional(),
  lastInspection: z.enum(['unchecked']).optional(),
  q: z.string().optional(),
  sort: z.enum(['location', 'itemNumber', 'type', 'nextInspection', 'updated']).optional(),
  page: z.number().int().min(1).optional(),
});
export type ItemsSearch = z.infer<typeof itemsSearchSchema>;

export const itemsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/artikly',
  validateSearch: itemsSearchSchema,
  component: ItemsPage,
});
const importRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/import',
  component: ImportPage,
});
const usersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/uzivatele',
  component: UsersPage,
});
const inspectionsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/kontroly',
  component: InspectionsPage,
});
export const inspectionDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/kontroly/$inspectionId',
  component: InspectionDetailPage,
});
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/nastaveni',
  component: SettingsPage,
});

const accountRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/ucet',
  component: AccountPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  indexRoute,
  fieldRoute.addChildren([fieldHomeRoute, fieldInspectionRoute]),
  appRoute.addChildren([
    customersRoute,
    customerRoute,
    siteRoute,
    typesRoute,
    typeRoute,
    itemsRoute,
    importRoute,
    usersRoute,
    inspectionsRoute,
    inspectionDetailRoute,
    settingsRoute,
    accountRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  basepath: import.meta.env.BASE_URL,
  context: { queryClient: undefined! },
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
