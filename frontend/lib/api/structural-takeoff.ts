import apiClient from './client';

export type StructuralElementType =
  | 'hashira'
  | 'oobari'
  | 'kobari'
  | 'magobari'
  | 'katamochibari'
  | 'taifubari'
  | 'brace'
  | 'kaidan'
  | 'elevator';

export const STRUCTURAL_ELEMENT_TYPES: readonly StructuralElementType[] = [
  'hashira',
  'oobari',
  'kobari',
  'magobari',
  'katamochibari',
  'taifubari',
  'brace',
  'kaidan',
  'elevator',
] as const;

export type DrawingKind =
  | 'framing_plan'
  | 'column_list'
  | 'beam_list'
  | 'stair_detail'
  | 'elevator_shaft'
  | 'level_diagram'
  | 'general'
  | 'unknown';

export const DRAWING_KINDS: readonly DrawingKind[] = [
  'framing_plan',
  'column_list',
  'beam_list',
  'stair_detail',
  'elevator_shaft',
  'level_diagram',
  'general',
  'unknown',
] as const;

export type ExtractionSource = 'manual' | 'excel' | 'dxf' | 'ai' | 'ifc';

export type ElementLineKind = 'member' | 'bolt' | 'connection' | 'misc';

export const ELEMENT_LINE_KINDS: readonly ElementLineKind[] = [
  'member',
  'bolt',
  'connection',
  'misc',
] as const;
export type ClassificationSource = 'auto' | 'manual';

export interface ConstructionPlanProject {
  id: string;
  companyId: string | null;
  createdBy: string | null;
  name: string;
  siteAddress: string | null;
  notes: string | null;
  blocks: string[];
  levels: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DrawingSet {
  id: string;
  projectId: string;
  uploadedBy: string | null;
  name: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface DrawingSetFile {
  id: string;
  setId: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | string | null;
  storagePath: string | null;
  kind: DrawingKind | null;
  level: string | null;
  block: string | null;
  classificationSource: ClassificationSource;
  classificationConfidence: number | null;
  createdAt: string;
}

export interface ExtractedElement {
  id: string;
  setId: string;
  level: string;
  block: string | null;
  elementType: StructuralElementType;
  label: string | null;
  section: string | null;
  qty: number;
  /** Single-member length (mm); omit or null → type default for weight / steel rollup. */
  pieceLengthMm?: number | null;
  phase?: string | null;
  shop?: string | null;
  lineKind?: ElementLineKind | null;
  extractionConfidence?: number | null;
  needsReview?: boolean | null;
  grid: string | null;
  source: ExtractionSource;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SetReviewPayload {
  project: ConstructionPlanProject;
  set: DrawingSet;
  files: DrawingSetFile[];
  elements: ExtractedElement[];
}

export interface CreateProjectPayload {
  name: string;
  siteAddress?: string;
  notes?: string;
  blocks?: string[];
  levels?: string[];
}

export interface UpdateProjectPayload {
  name?: string;
  siteAddress?: string;
  notes?: string;
  blocks?: string[];
  levels?: string[];
}

export interface UpsertElementsPayload {
  rows: Array<{
    id?: string;
    level: string;
    block?: string | null;
    elementType: StructuralElementType;
    label?: string | null;
    section?: string | null;
    qty: number;
    pieceLengthMm?: number | null;
    phase?: string | null;
    shop?: string | null;
    lineKind?: ElementLineKind | null;
    extractionConfidence?: number | null;
    needsReview?: boolean | null;
    grid?: string | null;
    notes?: string | null;
  }>;
}

export interface PatchClassificationPayload {
  kind?: DrawingKind;
  level?: string | null;
  block?: string | null;
}

export const structuralTakeoffApi = {
  // Projects
  listProjects: async (): Promise<ConstructionPlanProject[]> => {
    const res = await apiClient.get<ConstructionPlanProject[]>('/structural-takeoff/projects');
    return res.data;
  },
  createProject: async (payload: CreateProjectPayload): Promise<ConstructionPlanProject> => {
    const res = await apiClient.post<ConstructionPlanProject>('/structural-takeoff/projects', payload);
    return res.data;
  },
  loadSampleProject: async (): Promise<{
    project: ConstructionPlanProject;
    set: DrawingSet;
    elementCount: number;
  }> => {
    const res = await apiClient.post<{
      project: ConstructionPlanProject;
      set: DrawingSet;
      elementCount: number;
    }>('/structural-takeoff/projects/load-sample', {});
    return res.data;
  },
  getProject: async (projectId: string): Promise<ConstructionPlanProject> => {
    const res = await apiClient.get<ConstructionPlanProject>(`/structural-takeoff/projects/${projectId}`);
    return res.data;
  },
  updateProject: async (projectId: string, payload: UpdateProjectPayload): Promise<ConstructionPlanProject> => {
    const res = await apiClient.put<ConstructionPlanProject>(`/structural-takeoff/projects/${projectId}`, payload);
    return res.data;
  },
  deleteProject: async (projectId: string): Promise<{ ok: true }> => {
    const res = await apiClient.delete<{ ok: true }>(`/structural-takeoff/projects/${projectId}`);
    return res.data;
  },

  // Drawing sets
  listSets: async (projectId: string): Promise<DrawingSet[]> => {
    const res = await apiClient.get<DrawingSet[]>(`/structural-takeoff/projects/${projectId}/sets`);
    return res.data;
  },
  createSet: async (
    projectId: string,
    payload: { name?: string; notes?: string },
  ): Promise<DrawingSet> => {
    const res = await apiClient.post<DrawingSet>(
      `/structural-takeoff/projects/${projectId}/sets`,
      payload,
    );
    return res.data;
  },
  getSetReview: async (setId: string): Promise<SetReviewPayload> => {
    const res = await apiClient.get<SetReviewPayload>(`/structural-takeoff/sets/${setId}`);
    return res.data;
  },

  // Files
  uploadFiles: async (setId: string, files: File[]): Promise<DrawingSetFile[]> => {
    if (!files.length) return [];
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    const res = await apiClient.post<DrawingSetFile[]>(
      `/structural-takeoff/sets/${setId}/files`,
      fd,
    );
    return res.data;
  },
  patchFile: async (
    setId: string,
    fileId: string,
    patch: PatchClassificationPayload,
  ): Promise<DrawingSetFile> => {
    const res = await apiClient.patch<DrawingSetFile>(
      `/structural-takeoff/sets/${setId}/files/${fileId}`,
      patch,
    );
    return res.data;
  },
  deleteFile: async (setId: string, fileId: string): Promise<{ ok: true }> => {
    const res = await apiClient.delete<{ ok: true }>(
      `/structural-takeoff/sets/${setId}/files/${fileId}`,
    );
    return res.data;
  },
  getFileSignedUrl: async (
    setId: string,
    fileId: string,
  ): Promise<{ url: string; expiresInSeconds: number; filename: string }> => {
    const res = await apiClient.get<{ url: string; expiresInSeconds: number; filename: string }>(
      `/structural-takeoff/sets/${setId}/files/${fileId}/url`,
    );
    return res.data;
  },
  reclassifyFromContent: async (
    setId: string,
    fileId: string,
  ): Promise<{
    file: DrawingSetFile;
    suggestion: { kind: string | null; level: string | null; block: string | null; confidence: number };
  }> => {
    const res = await apiClient.post<{
      file: DrawingSetFile;
      suggestion: { kind: string | null; level: string | null; block: string | null; confidence: number };
    }>(`/structural-takeoff/sets/${setId}/files/${fileId}/reclassify-from-content`);
    return res.data;
  },
  extractElementsAi: async (
    setId: string,
    fileId: string,
  ): Promise<{ saved: ExtractedElement[]; proposalCount: number; warnings: string[] }> => {
    const res = await apiClient.post<{
      saved: ExtractedElement[];
      proposalCount: number;
      warnings: string[];
    }>(`/structural-takeoff/sets/${setId}/files/${fileId}/extract-elements-ai`);
    return res.data;
  },

  // Elements
  upsertElements: async (
    setId: string,
    payload: UpsertElementsPayload,
  ): Promise<ExtractedElement[]> => {
    const res = await apiClient.post<ExtractedElement[]>(
      `/structural-takeoff/sets/${setId}/elements`,
      payload,
    );
    return res.data;
  },
  deleteElement: async (setId: string, elementId: string): Promise<{ ok: true }> => {
    const res = await apiClient.delete<{ ok: true }>(
      `/structural-takeoff/sets/${setId}/elements/${elementId}`,
    );
    return res.data;
  },

  // Phase 4: schedule + delivery + Excel
  getSchedule: async (
    setId: string,
    params?: { startDate?: string; workSaturday?: boolean },
  ): Promise<{
    project: ConstructionPlanProject;
    set: DrawingSet;
    activities: Array<{
      block: string | null;
      level: string;
      elementType: StructuralElementType;
      startIso: string;
      endIso: string;
      workingDays: number;
      totalPieces: number;
      totalWeightKg: number;
    }>;
    workingDays: string[];
    endIso: string;
    startDateIso: string;
  }> => {
    const res = await apiClient.get(`/structural-takeoff/sets/${setId}/schedule`, {
      params: {
        startDate: params?.startDate,
        workSaturday: params?.workSaturday === false ? 'false' : undefined,
      },
    });
    return res.data;
  },
  getDeliveryPlan: async (
    setId: string,
    params?: { startDate?: string; workSaturday?: boolean },
  ): Promise<{
    project: ConstructionPlanProject;
    set: DrawingSet;
    startDateIso: string;
    days: Array<{
      date: string;
      dow: number;
      totalPieces: number;
      totalKg: number;
      trucks: Array<{
        truckType: string;
        truckLabel: string;
        payloadKg: number;
        bedLengthMm: number;
        totalKg: number;
        totalLengthMm: number;
        items: Array<{
          block: string | null;
          level: string;
          elementType: StructuralElementType;
          pieces: number;
          pieceLengthMm: number;
          kg: number;
        }>;
        notes: string[];
      }>;
    }>;
    trucks: Array<{
      date: string;
      dow: number;
      binNo: number;
      load: {
        truckType: string;
        truckLabel: string;
        totalKg: number;
        totalLengthMm: number;
        items: Array<{ block: string | null; level: string; elementType: StructuralElementType; pieces: number; pieceLengthMm: number; kg: number }>;
        notes: string[];
      };
    }>;
    monthly: Array<{ month: string; pieces: number; kg: number; trucks: number; days: number }>;
    weekly: Array<{ isoWeek: string; pieces: number; kg: number; trucks: number; days: number }>;
    byType: Record<StructuralElementType, { pieces: number; kg: number }>;
  }> => {
    const res = await apiClient.get(`/structural-takeoff/sets/${setId}/delivery-plan`, {
      params: {
        startDate: params?.startDate,
        workSaturday: params?.workSaturday === false ? 'false' : undefined,
      },
    });
    return res.data;
  },
  downloadExcel: async (
    setId: string,
    params?: { startDate?: string; workSaturday?: boolean; includeTruckPlan?: boolean },
  ): Promise<Blob> => {
    const res = await apiClient.get(`/structural-takeoff/sets/${setId}/excel`, {
      responseType: 'blob',
      params: {
        startDate: params?.startDate,
        workSaturday: params?.workSaturday === false ? 'false' : undefined,
        includeTruckPlan: params?.includeTruckPlan === true ? 'true' : undefined,
      },
    });
    return res.data as Blob;
  },

  getDeliveryOverrides: async (
    setId: string,
  ): Promise<{ trucks?: Array<{ date: string; binNo: number; truckType?: string; note?: string }> }> => {
    const res = await apiClient.get<{
      trucks?: Array<{ date: string; binNo: number; truckType?: string; note?: string }>;
    }>(`/structural-takeoff/sets/${setId}/delivery-plan/overrides`);
    return res.data;
  },
  saveDeliveryOverrides: async (
    setId: string,
    payload: { trucks: Array<{ date: string; binNo: number; truckType?: string; note?: string }> },
  ): Promise<{ trucks: Array<{ date: string; binNo: number; truckType?: string; note?: string }> }> => {
    const res = await apiClient.post<{
      trucks: Array<{ date: string; binNo: number; truckType?: string; note?: string }>;
    }>(`/structural-takeoff/sets/${setId}/delivery-plan/overrides`, payload);
    return res.data;
  },

  // Phase 3 follow-ups: Excel/CSV + DXF layer imports
  importExcel: async (
    setId: string,
    file: File,
  ): Promise<{
    saved: ExtractedElement[];
    proposals: unknown[];
    warnings: string[];
  }> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await apiClient.post(`/structural-takeoff/sets/${setId}/import/excel`, fd);
    return res.data;
  },
  importDxfLayers: async (
    setId: string,
    file: File,
    fallbackLevel?: string,
  ): Promise<{
    saved: ExtractedElement[];
    proposals: unknown[];
    warnings: string[];
    layers: string[];
  }> => {
    const fd = new FormData();
    fd.append('file', file);
    const params = fallbackLevel ? { fallbackLevel } : undefined;
    const res = await apiClient.post(
      `/structural-takeoff/sets/${setId}/import/dxf-layers`,
      fd,
      { params },
    );
    return res.data;
  },

  importIfc: async (
    setId: string,
    file: File,
  ): Promise<{ saved: ExtractedElement[]; warnings: string[] }> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await apiClient.post<{ saved: ExtractedElement[]; warnings: string[] }>(
      `/structural-takeoff/sets/${setId}/import/ifc`,
      fd,
    );
    return res.data;
  },

  confirmElementsReview: async (
    setId: string,
    ids: string[],
  ): Promise<{ updated: number }> => {
    const res = await apiClient.post<{ updated: number }>(
      `/structural-takeoff/sets/${setId}/elements/confirm-review`,
      { ids },
    );
    return res.data;
  },
};
