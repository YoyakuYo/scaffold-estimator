import apiClient from './client';

// ─── Types ──────────────────────────────────────────────────────

export interface QuotationItem {
  id: string;
  quotationId: string;
  componentType: string;
  componentName: string;
  sizeSpec: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  sortOrder: number;
}

export interface QuotationCostItem {
  id: string;
  quotationId: string;
  code: string;
  name: string;
  category: string;
  formulaExpression?: string;
  formulaVariables?: Record<string, any>;
  calculatedValue: number;
  userEditedValue?: number;
  isLocked: boolean;
  sortOrder: number;
}

export interface Quotation {
  id: string;
  projectId: string;
  configId: string;
  title?: string;
  rentalStartDate: string;
  rentalEndDate: string;
  rentalType: string;
  items: QuotationItem[];
  costItems?: QuotationCostItem[];
  materialSubtotal: number;
  costSubtotal: number;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  status: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'finalized';
  createdAt: string;
  config?: {
    id: string;
    structureType: string;
    scaffoldType: string;
    drawing?: {
      id: string;
      filename: string;
    };
  };
}

export interface CreateQuotationDto {
  configId: string;
  projectId: string;
  rentalStartDate: string;
  rentalEndDate: string;
  rentalType: string;
}

// ─── API ────────────────────────────────────────────────────────

export const quotationsApi = {
  create: async (dto: CreateQuotationDto): Promise<Quotation> => {
    const response = await apiClient.post<Quotation>('/quotations', dto, { timeout: 60000 });
    return response.data;
  },

  list: async (projectId?: string): Promise<Quotation[]> => {
    const params = projectId ? { projectId } : {};
    const response = await apiClient.get<Quotation[]>('/quotations', { params });
    return response.data;
  },

  get: async (id: string): Promise<Quotation> => {
    const response = await apiClient.get<Quotation>(`/quotations/${id}`);
    return response.data;
  },

  updateItemPrice: async (itemId: string, unitPrice: number): Promise<QuotationItem> => {
    const response = await apiClient.patch<QuotationItem>(`/quotations/items/${itemId}/price`, { unitPrice });
    return response.data;
  },

  /** Re-populate prices from materials master and recalculate costs */
  repopulatePrices: async (id: string): Promise<Quotation> => {
    const response = await apiClient.post<Quotation>(`/quotations/${id}/repopulate-prices`, {}, { timeout: 120000 });
    return response.data;
  },

  finalize: async (id: string): Promise<Quotation> => {
    const response = await apiClient.post<Quotation>(`/quotations/${id}/finalize`, {}, { timeout: 60000 });
    return response.data;
  },
};
