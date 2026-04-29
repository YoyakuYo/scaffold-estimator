import apiClient from './client';

export interface StructuralModelJson {
  gridX: Array<{ label: string; positionMm: number }>;
  gridY: Array<{ label: string; positionMm: number }>;
  storeys: Array<{
    id: string;
    name: string;
    elevationBottomMm: number;
    elevationTopMm: number;
  }>;
  options?: { slabs?: boolean; connections?: boolean };
  members: Array<{
    id: string;
    mark: string;
    category: 'column' | 'beam';
    profileName: string;
    storeyId: string;
    start: { xLabel: string; yLabel: string };
    end?: { xLabel: string; yLabel: string };
    phaseColor?: string;
  }>;
}

export interface StructuralBimProject {
  id: string;
  companyId: string | null;
  createdBy: string | null;
  name: string;
  modelJson: StructuralModelJson;
  jobStatus: string;
  jobError: string | null;
  outputModelId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const structuralBimApi = {
  createProject: async (name?: string): Promise<StructuralBimProject> => {
    const res = await apiClient.post<StructuralBimProject>('/structural-bim/projects', { name });
    return res.data;
  },

  listProjects: async (): Promise<StructuralBimProject[]> => {
    const res = await apiClient.get<StructuralBimProject[]>('/structural-bim/projects');
    return res.data;
  },

  getProject: async (id: string): Promise<StructuralBimProject> => {
    const res = await apiClient.get<StructuralBimProject>(`/structural-bim/projects/${id}`);
    return res.data;
  },

  patchModel: async (id: string, modelJson: StructuralModelJson): Promise<StructuralBimProject> => {
    const res = await apiClient.patch<StructuralBimProject>(`/structural-bim/projects/${id}/model`, {
      modelJson: JSON.stringify(modelJson),
    });
    return res.data;
  },

  importMembersCsv: async (id: string, csvText: string): Promise<StructuralBimProject> => {
    const res = await apiClient.post<StructuralBimProject>(
      `/structural-bim/projects/${id}/import-members-csv`,
      { csvText },
    );
    return res.data;
  },

  generateIfc: async (
    id: string,
  ): Promise<{ project: StructuralBimProject; bimModel: { id: string; filename: string } }> => {
    const res = await apiClient.post<{
      project: StructuralBimProject;
      bimModel: { id: string; filename: string };
    }>(`/structural-bim/projects/${id}/generate-ifc`, {});
    return res.data;
  },

  deleteProject: async (id: string): Promise<void> => {
    await apiClient.delete(`/structural-bim/projects/${id}`);
  },
};
