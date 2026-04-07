import apiClient from './client';

export async function submitPublicContact(payload: {
  name: string;
  email: string;
  message: string;
  /** Honeypot — leave empty */
  company?: string;
}): Promise<void> {
  await apiClient.post('/messages/public-contact', payload);
}
