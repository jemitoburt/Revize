import { LOCATION_SEPARATOR, newId, outcomeLabel, recordResultSchema } from '@revize/shared';
import type {
  ConversionSummary,
  CurrentUser,
  Customer,
  EquipmentType,
  ImportJob,
  ImportMappingInput,
  ImportReport,
  ImportResult,
  Inspection,
  InspectionItem,
  InspectionResult,
  InspectionStatus,
  Item,
  ItemStatus,
  importSuggestionSchema,
  Location,
  Organization,
  Photo,
  PhotoOwner,
  RecordResultInput,
  Site,
  User,
  createCustomerSchema,
  createEquipmentTypeSchema,
  createItemSchema,
  createLocationSchema,
  createLocationSeriesSchema,
  createSiteSchema,
  createUserRequestSchema,
  bulkUpdateItemsSchema,
  closeInspectionSchema,
  updateOrganizationSchema,
  equipmentTypePresetSchema,
  listItemsQuerySchema,
  startInspectionSchema,
  updateCustomerSchema,
  updateEquipmentTypeSchema,
  updateItemSchema,
  updateLocationSchema,
  updateSiteSchema,
  updateUserRequestSchema,
} from '@revize/shared';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { z } from 'zod';
import { useLiveQuery } from 'dexie-react-hooks';
import { enqueue } from '../offline/outbox.js';
import { applyPending } from '../offline/overlay.js';
import { localDb, type OutboxRow, type PhotoBlobRow } from '../platform/local-db.js';
import {
  ApiRequestError,
  api,
  fetchBlob,
  forgetSnapshot,
  queryString,
  uploadFile,
} from './client.js';

type In<T extends z.ZodType> = z.input<T>;

/**
 * Mutation that refreshes the given queries afterwards. The refresh runs in the background, so
 * forms close and confirm right after the save instead of waiting for every list to reload.
 */
function useApiMutation<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
  invalidate: QueryKey[],
) {
  const client = useQueryClient();
  return useMutation<TResult, ApiRequestError, TVars>({
    mutationFn: fn,
    onSuccess: () => {
      for (const queryKey of invalidate) void client.invalidateQueries({ queryKey });
    },
  });
}

// ---------- auth ----------

export function useMe() {
  return useQuery<CurrentUser | null, ApiRequestError>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<CurrentUser>('/auth/me');
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
  });
}

export function useLogin() {
  const client = useQueryClient();
  return useMutation<{ user: CurrentUser }, ApiRequestError, { email: string; password: string }>({
    mutationFn: (body) => api.post('/auth/login', { ...body, deviceLabel: 'Kancelář (prohlížeč)' }),
    onSuccess: (data) => client.setQueryData(['me'], data.user),
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSettled: () => {
      // Without this the stored copy would keep the device "signed in" while offline.
      void forgetSnapshot('/auth/me');
      client.setQueryData(['me'], null);
      client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    },
  });
}

export function useChangePassword() {
  return useApiMutation(
    (body: { currentPassword: string; newPassword: string }) =>
      api.post<void>('/auth/password', body),
    [],
  );
}

// ---------- users ----------

export const useUsers = () =>
  useQuery<User[], ApiRequestError>({ queryKey: ['users'], queryFn: () => api.get('/users') });
export const useCreateUser = () =>
  useApiMutation(
    (body: In<typeof createUserRequestSchema>) => api.post<User>('/users', body),
    [['users']],
  );
export const useUpdateUser = () =>
  useApiMutation(
    ({ id, ...body }: In<typeof updateUserRequestSchema> & { id: string }) =>
      api.patch<User>(`/users/${id}`, body),
    [['users']],
  );
export const useDeleteUser = () =>
  useApiMutation((id: string) => api.delete(`/users/${id}`), [['users']]);

// ---------- customers & sites ----------

export const useCustomers = (includeArchived = false) =>
  useQuery<Customer[], ApiRequestError>({
    queryKey: ['customers', { includeArchived }],
    queryFn: () => api.get(`/customers${queryString({ includeArchived })}`),
  });
export const useCustomer = (id: string) =>
  useQuery<Customer, ApiRequestError>({
    queryKey: ['customers', id],
    queryFn: () => api.get(`/customers/${id}`),
  });
export const useCreateCustomer = () =>
  useApiMutation(
    (body: In<typeof createCustomerSchema>) => api.post<Customer>('/customers', body),
    [['customers']],
  );
export const useUpdateCustomer = () =>
  useApiMutation(
    ({ id, ...body }: In<typeof updateCustomerSchema> & { id: string }) =>
      api.patch<Customer>(`/customers/${id}`, body),
    [['customers']],
  );

export const useSites = (customerId: string | null | undefined, includeArchived = false) =>
  useQuery<Site[], ApiRequestError>({
    queryKey: ['sites', customerId, { includeArchived }],
    queryFn: () => api.get(`/customers/${customerId}/sites${queryString({ includeArchived })}`),
    enabled: !!customerId,
  });
export const useSite = (id: string) =>
  useQuery<Site, ApiRequestError>({
    queryKey: ['site', id],
    queryFn: () => api.get(`/sites/${id}`),
  });
export const useCreateSite = () =>
  useApiMutation(
    ({ customerId, ...body }: In<typeof createSiteSchema> & { customerId: string }) =>
      api.post<Site>(`/customers/${customerId}/sites`, body),
    [['sites'], ['customers']],
  );
export const useUpdateSite = () =>
  useApiMutation(
    ({ id, ...body }: In<typeof updateSiteSchema> & { id: string }) =>
      api.patch<Site>(`/sites/${id}`, body),
    [['sites'], ['site'], ['customers']],
  );

// ---------- locations ----------

export const useLocations = (siteId: string | null | undefined) =>
  useQuery<Location[], ApiRequestError>({
    queryKey: ['locations', siteId],
    queryFn: () => api.get(`/sites/${siteId}/locations`),
    enabled: !!siteId,
  });
export const useCreateLocation = () =>
  useApiMutation(
    ({ siteId, ...body }: In<typeof createLocationSchema> & { siteId: string }) =>
      api.post<Location>(`/sites/${siteId}/locations`, body),
    [['locations']],
  );
export const useCreateLocationSeries = () =>
  useApiMutation(
    ({ siteId, ...body }: In<typeof createLocationSeriesSchema> & { siteId: string }) =>
      api.post<Location[]>(`/sites/${siteId}/locations/series`, body),
    [['locations']],
  );
export const useUpdateLocation = () =>
  useApiMutation(
    ({ id, ...body }: In<typeof updateLocationSchema> & { id: string }) =>
      api.patch<Location>(`/locations/${id}`, body),
    [['locations'], ['items']],
  );

// ---------- equipment types ----------

export const useEquipmentTypes = (includeArchived = false) =>
  useQuery<EquipmentType[], ApiRequestError>({
    queryKey: ['equipment-types', { includeArchived }],
    queryFn: () => api.get(`/equipment-types${queryString({ includeArchived })}`),
  });
export const useEquipmentType = (id: string) =>
  useQuery<EquipmentType, ApiRequestError>({
    queryKey: ['equipment-types', id],
    queryFn: () => api.get(`/equipment-types/${id}`),
  });
export const useEquipmentTypePresets = () =>
  useQuery<z.infer<typeof equipmentTypePresetSchema>[], ApiRequestError>({
    queryKey: ['equipment-type-presets'],
    queryFn: () => api.get('/equipment-type-presets'),
    staleTime: Infinity,
  });
export const useCreateEquipmentType = () =>
  useApiMutation(
    (body: In<typeof createEquipmentTypeSchema>) =>
      api.post<EquipmentType>('/equipment-types', body),
    [['equipment-types']],
  );
/** What changing field kinds would do to the stored values (nothing is saved). */
export const useConversionPreview = () =>
  useMutation<ConversionSummary[], ApiRequestError, { id: string; fieldDefinitions: unknown }>({
    mutationFn: ({ id, fieldDefinitions }) =>
      api.post(`/equipment-types/${id}/conversion-preview`, { fieldDefinitions }),
  });
export const useUpdateEquipmentType = () =>
  useApiMutation(
    ({ id, ...body }: In<typeof updateEquipmentTypeSchema> & { id: string }) =>
      api.patch<EquipmentType>(`/equipment-types/${id}`, body),
    [['equipment-types'], ['items']],
  );

// ---------- items ----------

export type ItemQuery = {
  customerId?: string;
  siteId?: string;
  equipmentTypeId?: string;
  locationId?: string;
  status?: ItemStatus;
  q?: string;
  includeRetired?: boolean;
  sort?: z.output<typeof listItemsQuerySchema>['sort'];
  limit?: number;
  offset?: number;
};

export const useItems = (query: ItemQuery, enabled = true) =>
  useQuery<{ items: Item[]; total: number }, ApiRequestError>({
    queryKey: ['items', query],
    queryFn: () => api.get(`/items${queryString(query)}`),
    enabled,
    placeholderData: (previous) => previous,
  });
export const useCreateItem = () =>
  useApiMutation(
    (body: In<typeof createItemSchema>) => api.post<Item>('/items', body),
    [['items'], ['customers'], ['sites'], ['locations'], ['equipment-types']],
  );
export const useUpdateItem = () =>
  useApiMutation(
    ({ id, ...body }: In<typeof updateItemSchema> & { id: string }) =>
      api.patch<Item>(`/items/${id}`, body),
    [['items'], ['locations']],
  );
export const useBulkUpdateItems = () =>
  useApiMutation(
    (body: In<typeof bulkUpdateItemsSchema>) =>
      api.post<{ updated: number }>('/items/bulk-update', body),
    [['items'], ['locations']],
  );

// ---------- import ----------

export const useUploadImport = () =>
  useMutation<ImportJob, ApiRequestError, { file: File; sheet?: string }>({
    mutationFn: ({ file, sheet }) =>
      uploadFile<ImportJob>('/imports', file, sheet ? { sheet } : {}),
  });
export const useImportSuggestion = () =>
  useMutation<
    z.infer<typeof importSuggestionSchema>,
    ApiRequestError,
    { jobId: string; equipmentTypeId: string }
  >({
    mutationFn: ({ jobId, equipmentTypeId }) =>
      api.get(`/imports/${jobId}/suggestion${queryString({ equipmentTypeId })}`),
  });
export const useValidateImport = () =>
  useMutation<ImportReport, ApiRequestError, { jobId: string; mapping: ImportMappingInput }>({
    mutationFn: ({ jobId, mapping }) => api.post(`/imports/${jobId}/validate`, { mapping }),
  });
export const useCommitImport = () =>
  useApiMutation(
    ({
      jobId,
      mapping,
      skipErrors,
    }: {
      jobId: string;
      mapping: ImportMappingInput;
      skipErrors: boolean;
    }) => api.post<ImportResult>(`/imports/${jobId}/commit`, { mapping, skipErrors }),
    [['items'], ['locations'], ['customers'], ['sites'], ['equipment-types']],
  );

// ---------- inspections (field mode) ----------

export const useInspections = (query: { status?: InspectionStatus; siteId?: string } = {}) =>
  useQuery<Inspection[], ApiRequestError>({
    queryKey: ['inspections', query],
    queryFn: () => api.get(`/inspections${queryString(query)}`),
  });
export const useInspection = (id: string) =>
  useQuery<Inspection, ApiRequestError>({
    queryKey: ['inspections', id],
    queryFn: () => api.get(`/inspections/${id}`),
  });
/** The working list with the writes still waiting on this device applied (ADR-0004). */
export const useInspectionItems = (id: string) =>
  useQuery<InspectionItem[], ApiRequestError>({
    queryKey: ['inspection-items', id],
    queryFn: async () =>
      applyPending(
        await api.get<InspectionItem[]>(`/inspections/${id}/items`),
        id,
        await localDb.outbox.toArray(),
      ),
  });
/**
 * Office: print a defect's photos in the protocol or not. Online like other office edits; the
 * checkbox changes at once and goes back when the server refuses.
 */
export function useSetPhotosInProtocol(inspectionId: string) {
  const client = useQueryClient();
  const key = ['inspection-items', inspectionId];
  const apply = (itemId: string, photosInProtocol: boolean) =>
    client.setQueryData<InspectionItem[]>(key, (items) =>
      items?.map((i) =>
        i.id === itemId && i.result ? { ...i, result: { ...i.result, photosInProtocol } } : i,
      ),
    );
  return useMutation<
    InspectionResult,
    ApiRequestError,
    { itemId: string; photosInProtocol: boolean }
  >({
    mutationFn: ({ itemId, photosInProtocol }) =>
      api.put<InspectionResult>(
        `/inspections/${inspectionId}/results/${itemId}/photos-in-protocol`,
        { photosInProtocol },
      ),
    onMutate: ({ itemId, photosInProtocol }) => apply(itemId, photosInProtocol),
    onError: (_error, { itemId, photosInProtocol }) => apply(itemId, !photosInProtocol),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({ queryKey: ['protocol', inspectionId] });
    },
  });
}

export const useStartInspection = () =>
  useApiMutation(
    ({ id, ...body }: In<typeof startInspectionSchema> & { id: string }) =>
      api.put<Inspection>(`/inspections/${id}`, body),
    [['inspections']],
  );

/** The current user from the cache (field writes record who made them). */
function currentUser(client: ReturnType<typeof useQueryClient>): CurrentUser {
  const me = client.getQueryData<CurrentUser | null>(['me']);
  if (!me) throw new Error('Nejste přihlášeni.');
  return me;
}

/**
 * Records a result on the device (outbox, ADR-0004) and shows it in the working list at once;
 * it is sent to the server in the background, also later when there is no connection now.
 */
export function useRecordResult(inspectionId: string) {
  const client = useQueryClient();
  return useMutation<InspectionResult, Error, { itemId: string; body: RecordResultInput }>({
    mutationFn: async ({ itemId, body }) => {
      const me = currentUser(client);
      const parsed = recordResultSchema.parse(body);
      const preview: InspectionResult = {
        id: parsed.id,
        itemId,
        outcome: parsed.outcome,
        defectDescription: parsed.outcome === 'defect' ? parsed.defectDescription : null,
        takenOutOfService: parsed.takenOutOfService,
        severity: parsed.severity,
        includeInProtocol: parsed.includeInProtocol,
        photosInProtocol: parsed.photosInProtocol,
        recordedAt: parsed.recordedAt,
        recordedBy: me.id,
        recordedByName: me.displayName,
        photoCount: 0,
        version: 0,
      };
      await enqueue({
        id: newId(),
        kind: 'result',
        method: 'PUT',
        path: `/inspections/${inspectionId}/results/${itemId}`,
        body: parsed,
        group: `item:${itemId}`,
        preview,
        label: `Výsledek: ${outcomeLabel(preview)}`,
        inspectionId,
        itemId,
      });
      return preview;
    },
    onSuccess: (result, { itemId }) => setItemResult(client, inspectionId, itemId, result),
  });
}

export function useDeleteResult(inspectionId: string) {
  const client = useQueryClient();
  return useMutation<void, Error, { itemId: string }>({
    mutationFn: ({ itemId }) =>
      enqueue({
        id: newId(),
        kind: 'result-delete',
        method: 'DELETE',
        path: `/inspections/${inspectionId}/results/${itemId}`,
        body: null,
        group: `item:${itemId}`,
        preview: null,
        label: 'Zrušení výsledku',
        inspectionId,
        itemId,
      }),
    onSuccess: (_, { itemId }) => setItemResult(client, inspectionId, itemId, null),
  });
}

function setItemResult(
  client: ReturnType<typeof useQueryClient>,
  inspectionId: string,
  itemId: string,
  result: InspectionResult | null,
) {
  client.setQueryData<InspectionItem[]>(['inspection-items', inspectionId], (items) =>
    items?.map((i) =>
      i.id === itemId
        ? {
            ...i,
            result: result && { ...result, photoCount: i.result?.photoCount ?? 0 },
            ...(result?.takenOutOfService ? { status: 'out_of_service' as const } : {}),
          }
        : i,
    ),
  );
}

/** Creates an item in the field (outbox) and adds it to the working list of the inspection. */
export function useCreateFieldItem(inspectionId: string) {
  const client = useQueryClient();
  return useMutation<
    InspectionItem,
    Error,
    { body: In<typeof createItemSchema> & { id: string }; preview: InspectionItem }
  >({
    mutationFn: async ({ body, preview }) => {
      // A location created in the field (still on the device) has to reach the server first.
      const newLocation = body.locationId
        ? await localDb.outbox
            .filter(
              (c) => c.kind === 'location' && (c.body as { id: string }).id === body.locationId,
            )
            .first()
        : undefined;
      await enqueue({
        id: newId(),
        kind: 'item',
        method: 'POST',
        path: '/items',
        body,
        group: `item:${body.id}`,
        ...(newLocation ? { dependsOn: [newLocation.group] } : {}),
        preview,
        label: `Nový artikl ${preview.itemNumber}`,
        inspectionId,
        itemId: body.id,
      });
      return preview;
    },
    onSuccess: (item) =>
      client.setQueryData<InspectionItem[]>(['inspection-items', inspectionId], (items) =>
        items && !items.some((i) => i.id === item.id) ? [...items, item] : items,
      ),
  });
}

export const usePhotos = (query: { itemId?: string; inspectionId?: string }) =>
  useQuery<Photo[], ApiRequestError>({
    queryKey: ['photos', query],
    queryFn: () => api.get(`/photos${queryString(query)}`),
    enabled: Boolean(query.itemId || query.inspectionId),
  });

/** Photos taken on this device that are not on the server yet. */
export function usePendingPhotos(filter: {
  owner: PhotoOwner;
  itemId?: string;
  inspectionId?: string;
}): PhotoBlobRow[] {
  return (
    useLiveQuery(
      () =>
        localDb.photos
          .filter(
            (p) =>
              p.owner === filter.owner &&
              (filter.itemId === undefined || p.itemId === filter.itemId) &&
              (filter.inspectionId === undefined || p.inspectionId === filter.inspectionId),
          )
          .sortBy('createdAt'),
      [filter.owner, filter.itemId, filter.inspectionId],
    ) ?? []
  );
}

export interface PhotoUpload {
  id: string;
  file: Blob;
  owner: PhotoOwner;
  itemId?: string;
  inspectionId?: string;
  takenAt?: string;
}

const PHOTO_LABELS: Record<PhotoOwner, string> = {
  item: 'Fotka artiklu',
  result: 'Fotka závady',
  inspection: 'Fotka kontroly',
};

/** Stores the photo on the device and sends it in the background (after its result). */
export function useUploadPhoto() {
  return useMutation<void, Error, PhotoUpload>({
    mutationFn: async ({ id, file, ...fields }) => {
      const textFields = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined),
      ) as Record<string, string>;
      await enqueue(
        {
          id,
          kind: 'photo',
          method: 'PUT',
          path: `/photos/${id}`,
          body: textFields,
          group: fields.itemId ? `item:${fields.itemId}` : `inspection:${fields.inspectionId}`,
          preview: null,
          label: PHOTO_LABELS[fields.owner],
          inspectionId: fields.inspectionId ?? null,
          itemId: fields.itemId ?? null,
        },
        {
          id,
          blob: file,
          owner: fields.owner,
          itemId: fields.itemId ?? null,
          inspectionId: fields.inspectionId ?? null,
          draft: false,
          createdAt: new Date().toISOString(),
        },
      );
    },
  });
}

/** Deletes a photo on the server (needs a connection; unsent photos use `cancelPhoto`). */
export function useDeletePhoto() {
  const client = useQueryClient();
  return useMutation<void, ApiRequestError, { id: string }>({
    mutationFn: ({ id }) => api.delete(`/photos/${id}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['photos'] });
      void client.invalidateQueries({ queryKey: ['inspection-items'] });
    },
  });
}

/** Object URL of a photo (or its thumbnail), fetched through the API transport. */
export function usePhotoUrl(id: string, variant: 'thumbnail' | 'original') {
  const query = useQuery<string, ApiRequestError>({
    queryKey: ['photo-file', id, variant],
    queryFn: async () => URL.createObjectURL(await fetchBlob(`/photos/${id}/${variant}`)),
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  });
  return query.data;
}

/** Number of field writes on this device not yet accepted by the server. */
export function useOutbox(): OutboxRow[] {
  return useLiveQuery(() => localDb.outbox.orderBy('seq').toArray(), []) ?? [];
}

/** Locations of a site including the ones created in the field and not sent yet. */
export function useFieldLocations(siteId: string | null | undefined) {
  const query = useLocations(siteId);
  const outbox = useOutbox();
  const pending = outbox
    .filter((c) => c.kind === 'location' && (c.preview as Location).siteId === siteId)
    .map((c) => c.preview as Location)
    .filter((l) => !query.data?.some((existing) => existing.id === l.id));
  return { ...query, data: query.data ? [...query.data, ...pending] : pending };
}

/**
 * A new location from the field (e.g. a rack found in another row): stored on the device first
 * and sent through the outbox like every field write (ADR-0004).
 */
export function useCreateFieldLocation(siteId: string, inspectionId: string) {
  const client = useQueryClient();
  return useMutation<Location, Error, { parent: Location | null; name: string }>({
    mutationFn: async ({ parent, name }) => {
      const id = newId();
      const preview: Location = {
        id,
        siteId,
        parentId: parent?.id ?? null,
        name,
        sortOrder: 9999,
        pathNames: [...(parent?.pathNames ?? []), name],
        depth: parent ? parent.depth + 1 : 0,
        archived: false,
        itemCount: 0,
        version: 1,
      };
      const parentCommand = parent
        ? await localDb.outbox
            .filter((c) => c.kind === 'location' && (c.body as { id: string }).id === parent.id)
            .first()
        : undefined;
      await enqueue({
        id: newId(),
        kind: 'location',
        method: 'POST',
        path: `/sites/${siteId}/locations`,
        body: { id, parentId: preview.parentId, name },
        group: `location:${id}`,
        ...(parentCommand ? { dependsOn: [parentCommand.group] } : {}),
        preview,
        label: `Nové umístění ${preview.pathNames.join(LOCATION_SEPARATOR)}`,
        inspectionId,
        itemId: null,
      });
      return preview;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['locations', siteId] }),
  });
}

// ---------- office: closing inspections, protocol, settings (M7) ----------

export const useCloseInspection = () =>
  useApiMutation(
    ({ id, ...body }: In<typeof closeInspectionSchema> & { id: string }) =>
      api.post<Inspection>(`/inspections/${id}/close`, body),
    [['inspections'], ['inspection-items'], ['items']],
  );
export const useReopenInspection = () =>
  useApiMutation(
    ({ id, reason }: { id: string; reason: string }) =>
      api.post<Inspection>(`/inspections/${id}/reopen`, { reason }),
    [['inspections'], ['inspection-items']],
  );

/** The protocol as HTML (preview in an iframe, printing in the demo). */
export const useProtocolHtml = (
  inspectionId: string,
  equipmentTypeId: string | null,
  enabled: boolean,
  /** Columns of the appendix (equipment list for the customer); empty = no appendix. */
  columns: readonly string[] = [],
  /** The equipment table as Příloha 1 even when it fits on the first page. */
  forceAppendix = false,
  /** Defects with cards and photos. */
  defects: 'all' | 'red-amber' | 'red' = 'all',
) =>
  useQuery<string, ApiRequestError>({
    queryKey: [
      'protocol',
      inspectionId,
      equipmentTypeId,
      columns.join(','),
      forceAppendix,
      defects,
    ],
    queryFn: async () =>
      (
        await fetchBlob(
          `/inspections/${inspectionId}/protocol.html${queryString({
            equipmentTypeId,
            columns: columns.join(',') || undefined,
            appendix: forceAppendix ? 'always' : undefined,
            defects: defects === 'all' ? undefined : defects,
          })}`,
        )
      ).text(),
    enabled,
    staleTime: 0,
    gcTime: 0,
  });

/** Columns that can be chosen for the protocol appendix. */
export const useProtocolColumns = (inspectionId: string, enabled: boolean) =>
  useQuery<{ key: string; label: string }[], ApiRequestError>({
    queryKey: ['protocol-columns', inspectionId],
    queryFn: () => api.get(`/inspections/${inspectionId}/protocol-columns`),
    enabled,
  });

export const useOrganization = () =>
  useQuery<Organization, ApiRequestError>({
    queryKey: ['organization'],
    queryFn: () => api.get('/organization'),
  });
export const useUpdateOrganization = () =>
  useApiMutation(
    (body: In<typeof updateOrganizationSchema>) => api.put<Organization>('/organization', body),
    [['organization']],
  );
export const useUploadLogo = () =>
  useApiMutation(
    (file: File) => uploadFile<Organization>('/organization/logo', file, {}, { method: 'PUT' }),
    [['organization'], ['organization-logo']],
  );
export const useDeleteLogo = () =>
  useApiMutation(() => api.delete('/organization/logo'), [['organization'], ['organization-logo']]);

/** Object URL of the company logo, or undefined when there is none. */
export function useLogoUrl(hasLogo: boolean, version: string) {
  return useQuery<string, ApiRequestError>({
    queryKey: ['organization-logo', version],
    queryFn: async () => URL.createObjectURL(await fetchBlob('/organization/logo')),
    enabled: hasLogo,
    staleTime: Infinity,
  }).data;
}

/** Distinct values of a column of an uploaded import file (for value replacements). */
export const useColumnValues = (jobId: string, column: number | null) =>
  useQuery<{ value: string; count: number }[], ApiRequestError>({
    queryKey: ['import-values', jobId, column],
    queryFn: () => api.get(`/imports/${jobId}/columns/${column}/values`),
    enabled: column !== null,
  });
