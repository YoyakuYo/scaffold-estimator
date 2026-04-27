import apiClient from './client';

export type StructuralElementType =
  | 'hashira'
  | 'oobari'
  | 'kobari'
  | 'taifubari'
  | 'brace'
  | 'kaidan'
  | 'elevator'
  | 'deck';

export const STRUCTURAL_ELEMENT_TYPES: readonly StructuralElementType[] = [
  'hashira',
  'oobari',
  'kobari',
  'taifubari',
  'brace',
  'kaidan',
  'elevator',
  'deck',
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

export type ExtractionSource = 'manual' | 'excel' | 'dxf' | 'ai';
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
};
