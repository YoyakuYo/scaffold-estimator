import apiClient from './client';

export interface BillOfMaterials {
  scaffoldingType: string;
  components: Array<{
    componentId: string;
    componentName: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    manualOverride: boolean;
  }>;
  totalArea: number;
  totalHeight: number;
  adjustmentCoefficient: number;
  confidence: number;
}

export interface CostLineItem {
  id: string;
  code: string;
  name: string;
  category: string;
  computedValue: number;
  userEditedValue?: number;
  isLocked: boolean;
  formulaExpression: string;
}

export interface Estimate {
  id: string;
  projectId: string;
  drawingId: string;
  structureType: '改修工事' | 'S造' | 'RC造';
  rentalStartDate: string;
  rentalEndDate: string;
  rentalType: 'weekly' | 'monthly' | 'custom';
  billOfMaterials: BillOfMaterials;
  costBreakdown?: CostLineItem[];
  totalEstimatedCost?: number;
  status: string;
  createdAt: string;
}

export interface CreateEstimateDto {
  drawingId: string;
  projectId: string;
  structureType: '改修工事' | 'S造' | 'RC造';
  rentalStartDate: string;
  rentalEndDate: string;
  rentalType: 'weekly' | 'monthly' | 'custom';
}

export const estimatesApi = {
  list: async (projectId?: string): Promise<Estimate[]> => {
    const params = projectId ? { projectId } : {};
    const response = await apiClient.get<Estimate[]>('/estimates', { params });
    return response.data;
  },

  create: async (data: CreateEstimateDto): Promise<Estimate> => {
    const response = await apiClient.post<Estimate>('/estimates', data);
    return response.data;
  },

  get: async (id: string): Promise<Estimate> => {
    const response = await apiClient.get<Estimate>(`/estimates/${id}`);
    return response.data;
  },

  updateBOM: async (
    id: string,
    componentId: string,
    quantity: number,
    reason?: string
  ): Promise<Estimate> => {
    const response = await apiClient.patch(`/estimates/${id}/bom`, {
      componentId,
      quantity,
      reason,
    });
    return response.data;
  },
};
