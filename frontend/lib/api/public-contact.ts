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
  /** Honeypot — leave empty */
  company?: string;
}): Promise<PublicContactResult> {
  const { data } = await apiClient.post<PublicContactResult>('/messages/public-contact', payload);
  return data;
}
