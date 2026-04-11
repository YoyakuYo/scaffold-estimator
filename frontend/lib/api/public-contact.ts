import apiClient from './client';

export type PublicContactResult = {
  ok: boolean;
  inAppDelivered: boolean;
  emailSent: boolean;
};

export async function submitPublicContact(payload: {
  name: string;
  email: string;
  message: string;
  /** Honeypot — leave empty (do not use `company`; autofill fills it) */
  hp?: string;
  /** Optional drawings / plans for per-project estimates (PDF, images, CAD). */
  file?: File | null;
}): Promise<PublicContactResult> {
  const form = new FormData();
  form.append('name', payload.name);
  form.append('email', payload.email);
  form.append('message', payload.message);
  if (payload.hp) form.append('hp', payload.hp);
  if (payload.file) form.append('file', payload.file);
  const { data } = await apiClient.post<PublicContactResult>('/messages/public-contact', form, {
    timeout: 120000,
  });
  return data;
}
