import apiClient from './client';

// ─── Types ──────────────────────────────────────────────────

export interface CompanyAddress {
  postalCode?: string;
  prefecture?: string;
  city?: string;
  town?: string;
  addressLine?: string;
  building?: string;
}

export interface CompanyInfo extends CompanyAddress {
  id: string;
  name: string;
  taxId?: string;
  phone?: string;
  email?: string;
  address?: string;
  branches?: Branch[];
  createdAt: string;
  updatedAt: string;
}

export interface Branch extends CompanyAddress {
  id: string;
  companyId: string;
  name: string;
  isHeadquarters: boolean;
  phone?: string;
  fax?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateCompanyPayload extends CompanyAddress {
  name?: string;
  taxId?: string;
  phone?: string;
  email?: string;
}

export interface CreateBranchPayload extends CompanyAddress {
  name: string;
  isHeadquarters?: boolean;
  phone?: string;
  fax?: string;
}

export interface UpdateBranchPayload extends Partial<CreateBranchPayload> {}

// ─── API Client ─────────────────────────────────────────────

export const companyApi = {
  getCompany: async (): Promise<CompanyInfo> => {
    const res = await apiClient.get<CompanyInfo>('/company');
    return res.data;
  },

  updateCompany: async (data: UpdateCompanyPayload): Promise<CompanyInfo> => {
    const res = await apiClient.put<CompanyInfo>('/company', data);
    return res.data;
  },

  listBranches: async (): Promise<Branch[]> => {
    const res = await apiClient.get<Branch[]>('/company/branches');
    return res.data;
  },

  getBranch: async (branchId: string): Promise<Branch> => {
    const res = await apiClient.get<Branch>(`/company/branches/${branchId}`);
    return res.data;
  },

  createBranch: async (data: CreateBranchPayload): Promise<Branch> => {
    const res = await apiClient.post<Branch>('/company/branches', data);
    return res.data;
  },

  updateBranch: async (branchId: string, data: UpdateBranchPayload): Promise<Branch> => {
    const res = await apiClient.put<Branch>(`/company/branches/${branchId}`, data);
    return res.data;
  },

  deleteBranch: async (branchId: string): Promise<{ success: boolean }> => {
    const res = await apiClient.delete<{ success: boolean }>(`/company/branches/${branchId}`);
    return res.data;
  },
};
