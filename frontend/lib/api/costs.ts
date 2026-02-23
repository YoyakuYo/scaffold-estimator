import apiClient from './client';
import { CostLineItem } from './estimates';

export const costsApi = {
  calculate: async (estimateId: string): Promise<CostLineItem[]> => {
    const response = await apiClient.post<CostLineItem[]>(
      `/costs/estimates/${estimateId}/calculate`
    );
    return response.data;
  },

  getBreakdown: async (estimateId: string): Promise<CostLineItem[]> => {
    const response = await apiClient.get<CostLineItem[]>(
      `/costs/estimates/${estimateId}`
    );
    return response.data;
  },

  updateLineItem: async (
    lineItemId: string,
    data: {
      userEditedValue?: number;
      isLocked?: boolean;
      editReason?: string;
    }
  ): Promise<CostLineItem> => {
    const response = await apiClient.patch(`/costs/line-items/${lineItemId}`, data);
    return response.data;
  },
};
