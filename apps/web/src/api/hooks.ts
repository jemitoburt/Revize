import type {
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
import { ApiRequestError, api, fetchBlob, queryString, uploadFile } from './client.js';

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
export const useInspectionItems = (id: string) =>
  useQuery<InspectionItem[], ApiRequestError>({
    queryKey: ['inspection-items', id],
    queryFn: () => api.get(`/inspections/${id}/items`),
  });
export const useStartInspection = () =>
  useApiMutation(
    ({ id, ...body }: In<typeof startInspectionSchema> & { id: string }) =>
      api.put<Inspection>(`/inspections/${id}`, body),
    [['inspections']],
  );

/** Saves a result and puts it straight into the cached working list (no reload of the list). */
export function useRecordResult(inspectionId: string) {
  const client = useQueryClient();
  return useMutation<
    InspectionResult,
    ApiRequestError,
    { itemId: string; body: RecordResultInput }
  >({
    mutationFn: ({ itemId, body }) =>
      api.put(`/inspections/${inspectionId}/results/${itemId}`, body),
    onSuccess: (result, { itemId }) => {
      setItemResult(client, inspectionId, itemId, result);
      void client.invalidateQueries({ queryKey: ['inspections'] });
      // Taking out of service changes the item in the office lists too.
      if (result.takenOutOfService) void client.invalidateQueries({ queryKey: ['items'] });
    },
  });
}

export function useDeleteResult(inspectionId: string) {
  const client = useQueryClient();
  return useMutation<void, ApiRequestError, { itemId: string }>({
    mutationFn: ({ itemId }) => api.delete(`/inspections/${inspectionId}/results/${itemId}`),
    onSuccess: (_, { itemId }) => {
      setItemResult(client, inspectionId, itemId, null);
      void client.invalidateQueries({ queryKey: ['inspections'] });
    },
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
            result,
            ...(result?.takenOutOfService ? { status: 'out_of_service' as const } : {}),
          }
        : i,
    ),
  );
}

export const usePhotos = (query: { itemId?: string; inspectionId?: string }) =>
  useQuery<Photo[], ApiRequestError>({
    queryKey: ['photos', query],
    queryFn: () => api.get(`/photos${queryString(query)}`),
    enabled: Boolean(query.itemId || query.inspectionId),
  });

export interface PhotoUpload {
  id: string;
  file: Blob;
  owner: PhotoOwner;
  itemId?: string;
  inspectionId?: string;
  takenAt?: string;
}

export function useUploadPhoto() {
  const client = useQueryClient();
  return useMutation<Photo, ApiRequestError, PhotoUpload>({
    mutationFn: ({ id, file, ...fields }) =>
      uploadFile<Photo>(
        `/photos/${id}`,
        file,
        Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Record<
          string,
          string
        >,
        { method: 'PUT', fileName: `${id}.jpg` },
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['photos'] });
      void client.invalidateQueries({ queryKey: ['inspection-items'] });
    },
  });
}

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
