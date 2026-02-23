'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { companyApi, Branch, UpdateCompanyPayload, CreateBranchPayload } from '@/lib/api/company';
import { AddressForm, AddressFields } from '@/components/address-form';
import { useI18n } from '@/lib/i18n';
import {
  Building2,
  MapPin,
  Plus,
  Pencil,
  Trash2,
  Save,
  X,
  Star,
  Phone,
  Printer,
  Loader2,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';

const emptyAddress: AddressFields = {
  postalCode: '',
  prefecture: '',
  city: '',
  town: '',
  addressLine: '',
  building: '',
};

export default function CompanyPage() {
  const { locale } = useI18n();
  const ja = locale === 'ja';
  const queryClient = useQueryClient();

  // ─── Company data ──────────────────────────────────────────
  const { data: company, isLoading: companyLoading } = useQuery({
    queryKey: ['company'],
    queryFn: companyApi.getCompany,
  });

  const { data: branches, isLoading: branchesLoading } = useQuery({
    queryKey: ['company-branches'],
    queryFn: companyApi.listBranches,
  });

  // ─── Company edit state ────────────────────────────────────
  const [editingCompany, setEditingCompany] = useState(false);
  const [companyForm, setCompanyForm] = useState<UpdateCompanyPayload>({});
  const [companyAddress, setCompanyAddress] = useState<AddressFields>(emptyAddress);

  const startEditCompany = () => {
    if (!company) return;
    setCompanyForm({
      name: company.name,
      taxId: company.taxId || '',
      phone: company.phone || '',
      email: company.email || '',
    });
    setCompanyAddress({
      postalCode: company.postalCode || '',
      prefecture: company.prefecture || '',
      city: company.city || '',
      town: company.town || '',
      addressLine: company.addressLine || '',
      building: company.building || '',
    });
    setEditingCompany(true);
  };

  const updateCompanyMutation = useMutation({
    mutationFn: (data: UpdateCompanyPayload) => companyApi.updateCompany(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company'] });
      setEditingCompany(false);
    },
  });

  const saveCompany = () => {
    updateCompanyMutation.mutate({
      ...companyForm,
      ...companyAddress,
    });
  };

  // ─── Branch edit state ─────────────────────────────────────
  const [editingBranch, setEditingBranch] = useState<string | 'new' | null>(null);
  const [branchForm, setBranchForm] = useState<CreateBranchPayload>({ name: '' });
  const [branchAddress, setBranchAddress] = useState<AddressFields>(emptyAddress);

  const startNewBranch = () => {
    setBranchForm({ name: '', isHeadquarters: false, phone: '', fax: '' });
    setBranchAddress(emptyAddress);
    setEditingBranch('new');
  };

  const startEditBranch = (b: Branch) => {
    setBranchForm({
      name: b.name,
      isHeadquarters: b.isHeadquarters,
      phone: b.phone || '',
      fax: b.fax || '',
    });
    setBranchAddress({
      postalCode: b.postalCode || '',
      prefecture: b.prefecture || '',
      city: b.city || '',
      town: b.town || '',
      addressLine: b.addressLine || '',
      building: b.building || '',
    });
    setEditingBranch(b.id);
  };

  const createBranchMutation = useMutation({
    mutationFn: (data: CreateBranchPayload) => companyApi.createBranch(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-branches'] });
      setEditingBranch(null);
    },
  });

  const updateBranchMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: CreateBranchPayload }) =>
      companyApi.updateBranch(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-branches'] });
      setEditingBranch(null);
    },
  });

  const deleteBranchMutation = useMutation({
    mutationFn: (id: string) => companyApi.deleteBranch(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-branches'] });
    },
  });

  const saveBranch = () => {
    const data: CreateBranchPayload = { ...branchForm, ...branchAddress };
    if (editingBranch === 'new') {
      createBranchMutation.mutate(data);
    } else if (editingBranch) {
      updateBranchMutation.mutate({ id: editingBranch, data });
    }
  };

  const handleDeleteBranch = (b: Branch) => {
    const msg = ja
      ? `「${b.name}」を削除してもよろしいですか？`
      : `Delete "${b.name}"?`;
    if (confirm(msg)) {
      deleteBranchMutation.mutate(b.id);
    }
  };

  const formatFullAddress = (item: {
    postalCode?: string;
    prefecture?: string;
    city?: string;
    town?: string;
    addressLine?: string;
    building?: string;
  }) => {
    const parts = [
      item.postalCode ? `〒${item.postalCode}` : '',
      item.prefecture || '',
      item.city || '',
      item.town || '',
      item.addressLine || '',
      item.building || '',
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : (ja ? '未設定' : 'Not set');
  };

  if (companyLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Building2 className="h-6 w-6 text-blue-600" />
          {ja ? '会社情報' : 'Company Information'}
        </h1>
        <p className="mt-1 text-gray-500">
          {ja ? '会社の基本情報と支店を管理します' : 'Manage company details and branch offices'}
        </p>
      </div>

      {/* ─── Company Info Card ─────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            {ja ? '基本情報' : 'Company Details'}
          </h2>
          {!editingCompany && (
            <button
              onClick={startEditCompany}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            >
              <Pencil className="h-4 w-4" />
              {ja ? '編集' : 'Edit'}
            </button>
          )}
        </div>

        {editingCompany ? (
          <div className="p-6 space-y-4">
            {updateCompanyMutation.isError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2 text-sm">
                <AlertCircle className="h-4 w-4" />
                {ja ? '保存に失敗しました' : 'Failed to save'}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {ja ? '会社名' : 'Company Name'} *
                </label>
                <input
                  type="text"
                  required
                  value={companyForm.name || ''}
                  onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {ja ? '法人番号' : 'Tax ID'}
                </label>
                <input
                  type="text"
                  value={companyForm.taxId || ''}
                  onChange={(e) => setCompanyForm({ ...companyForm, taxId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {ja ? '電話番号' : 'Phone'}
                </label>
                <input
                  type="tel"
                  value={companyForm.phone || ''}
                  onChange={(e) => setCompanyForm({ ...companyForm, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {ja ? 'メールアドレス' : 'Email'}
                </label>
                <input
                  type="email"
                  value={companyForm.email || ''}
                  onChange={(e) => setCompanyForm({ ...companyForm, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-gray-400" />
                {ja ? '住所' : 'Address'}
              </h3>
              <AddressForm value={companyAddress} onChange={setCompanyAddress} />
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
              <button
                onClick={() => setEditingCompany(false)}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="h-4 w-4 inline mr-1" />
                {ja ? 'キャンセル' : 'Cancel'}
              </button>
              <button
                onClick={saveCompany}
                disabled={updateCompanyMutation.isPending}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
              >
                {updateCompanyMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {ja ? '保存' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-6">
            {company ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-8">
                <div>
                  <dt className="text-xs text-gray-500 uppercase tracking-wider">{ja ? '会社名' : 'Name'}</dt>
                  <dd className="mt-1 text-gray-900 font-medium">{company.name}</dd>
                </div>
                {company.taxId && (
                  <div>
                    <dt className="text-xs text-gray-500 uppercase tracking-wider">{ja ? '法人番号' : 'Tax ID'}</dt>
                    <dd className="mt-1 text-gray-900">{company.taxId}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-gray-500 uppercase tracking-wider">{ja ? '電話番号' : 'Phone'}</dt>
                  <dd className="mt-1 text-gray-900">{company.phone || (ja ? '未設定' : 'Not set')}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500 uppercase tracking-wider">{ja ? 'メール' : 'Email'}</dt>
                  <dd className="mt-1 text-gray-900">{company.email || (ja ? '未設定' : 'Not set')}</dd>
                </div>
                <div className="md:col-span-2">
                  <dt className="text-xs text-gray-500 uppercase tracking-wider flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {ja ? '住所' : 'Address'}
                  </dt>
                  <dd className="mt-1 text-gray-900">{formatFullAddress(company)}</dd>
                </div>
              </div>
            ) : (
              <p className="text-gray-500">{ja ? 'データがありません' : 'No data'}</p>
            )}
          </div>
        )}
      </div>

      {/* ─── Branches Section ─────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {ja ? '支店・事業所' : 'Branch Offices'}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {ja ? '支店ごとに住所・電話番号を管理' : 'Manage addresses and phone numbers per branch'}
            </p>
          </div>
          <button
            onClick={startNewBranch}
            disabled={editingBranch !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <Plus className="h-4 w-4" />
            {ja ? '支店を追加' : 'Add Branch'}
          </button>
        </div>

        <div className="divide-y divide-gray-100">
          {/* New Branch Form */}
          {editingBranch === 'new' && (
            <BranchEditor
              form={branchForm}
              address={branchAddress}
              onFormChange={setBranchForm}
              onAddressChange={setBranchAddress}
              onSave={saveBranch}
              onCancel={() => setEditingBranch(null)}
              saving={createBranchMutation.isPending}
              error={createBranchMutation.isError}
              ja={ja}
              isNew
            />
          )}

          {/* Branch List */}
          {branchesLoading ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : !branches?.length && editingBranch !== 'new' ? (
            <div className="p-8 text-center text-gray-500">
              <MapPin className="h-8 w-8 mx-auto mb-2 text-gray-300" />
              <p>{ja ? '支店がまだありません' : 'No branches yet'}</p>
              <p className="text-sm mt-1">
                {ja ? '「支店を追加」ボタンで最初の支店を登録してください' : 'Click "Add Branch" to create your first branch'}
              </p>
            </div>
          ) : (
            branches?.map((b) =>
              editingBranch === b.id ? (
                <BranchEditor
                  key={b.id}
                  form={branchForm}
                  address={branchAddress}
                  onFormChange={setBranchForm}
                  onAddressChange={setBranchAddress}
                  onSave={saveBranch}
                  onCancel={() => setEditingBranch(null)}
                  saving={updateBranchMutation.isPending}
                  error={updateBranchMutation.isError}
                  ja={ja}
                />
              ) : (
                <BranchCard
                  key={b.id}
                  branch={b}
                  onEdit={() => startEditBranch(b)}
                  onDelete={() => handleDeleteBranch(b)}
                  deleting={deleteBranchMutation.isPending}
                  formatAddress={formatFullAddress}
                  ja={ja}
                  disabled={editingBranch !== null}
                />
              ),
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Branch Card (read-only view) ──────────────────────────────

function BranchCard({
  branch,
  onEdit,
  onDelete,
  deleting,
  formatAddress,
  ja,
  disabled,
}: {
  branch: Branch;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
  formatAddress: (item: any) => string;
  ja: boolean;
  disabled: boolean;
}) {
  return (
    <div className="px-6 py-4 hover:bg-gray-50 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-gray-900">{branch.name}</h3>
            {branch.isHeadquarters && (
              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                <Star className="h-3 w-3" />
                {ja ? '本社' : 'HQ'}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-600">{formatAddress(branch)}</p>
          <div className="mt-1 flex items-center gap-4 text-sm text-gray-500">
            {branch.phone && (
              <span className="flex items-center gap-1">
                <Phone className="h-3.5 w-3.5" />
                {branch.phone}
              </span>
            )}
            {branch.fax && (
              <span className="flex items-center gap-1">
                <Printer className="h-3.5 w-3.5" />
                {branch.fax}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 ml-4">
          <button
            onClick={onEdit}
            disabled={disabled}
            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg disabled:opacity-30 transition-colors"
            title={ja ? '編集' : 'Edit'}
          >
            <Pencil className="h-4 w-4" />
          </button>
          {!branch.isHeadquarters && (
            <button
              onClick={onDelete}
              disabled={disabled || deleting}
              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-30 transition-colors"
              title={ja ? '削除' : 'Delete'}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Branch Editor (inline form) ───────────────────────────────

function BranchEditor({
  form,
  address,
  onFormChange,
  onAddressChange,
  onSave,
  onCancel,
  saving,
  error,
  ja,
  isNew,
}: {
  form: CreateBranchPayload;
  address: AddressFields;
  onFormChange: (f: CreateBranchPayload) => void;
  onAddressChange: (a: AddressFields) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: boolean;
  ja: boolean;
  isNew?: boolean;
}) {
  return (
    <div className="px-6 py-5 bg-blue-50/30 border-l-4 border-blue-500">
      <h3 className="font-semibold text-gray-900 mb-4">
        {isNew ? (ja ? '新しい支店を追加' : 'Add New Branch') : (ja ? '支店を編集' : 'Edit Branch')}
      </h3>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
          <AlertCircle className="h-4 w-4" />
          {ja ? '保存に失敗しました' : 'Failed to save'}
        </div>
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {ja ? '支店名' : 'Branch Name'} *
            </label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => onFormChange({ ...form, name: e.target.value })}
              placeholder={ja ? '例: 大阪支店' : 'e.g. Osaka Branch'}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isHeadquarters || false}
                onChange={(e) => onFormChange({ ...form, isHeadquarters: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">
                {ja ? '本社として設定' : 'Set as headquarters'}
              </span>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {ja ? '電話番号' : 'Phone'}
            </label>
            <input
              type="tel"
              value={form.phone || ''}
              onChange={(e) => onFormChange({ ...form, phone: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {ja ? 'FAX' : 'Fax'}
            </label>
            <input
              type="tel"
              value={form.fax || ''}
              onChange={(e) => onFormChange({ ...form, fax: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        <div className="border-t border-gray-200 pt-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
            <MapPin className="h-4 w-4 text-gray-400" />
            {ja ? '住所' : 'Address'}
          </h4>
          <AddressForm value={address} onChange={onAddressChange} />
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-gray-200">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            {ja ? 'キャンセル' : 'Cancel'}
          </button>
          <button
            onClick={onSave}
            disabled={saving || !form.name.trim()}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle className="h-4 w-4" />
            )}
            {ja ? '保存' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
