import axios from 'axios';
import Cookies from 'js-cookie';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3000/api/v1';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000, // 10s timeout — fail fast if backend is down
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests and handle FormData
apiClient.interceptors.request.use((config) => {
  const token = Cookies.get('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  
  // If the data is FormData, remove Content-Type header to let browser set it with boundary
  // The browser will automatically set the correct Content-Type with multipart/form-data boundary
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  
  return config;
});

// Track if we're currently handling a logout to prevent multiple redirects
let isLoggingOut = false;

// Handle token refresh on 401
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Don't redirect on network errors (backend down)
    if (!error.response) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !isLoggingOut) {
      const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
      const publicPages = ['/', '/login', '/register', '/superadmin'];
      const isPublicPage = publicPages.includes(currentPath);
      const requestUrl = error.config?.url || '';
      const isAuthEndpoint = requestUrl.includes('/auth/login');

      if (!isPublicPage && !isAuthEndpoint && error.response) {
        const errorMessage = error.response?.data?.message || '';
        const errorCode = error.response?.data?.error || '';

        const isAuthError =
          errorMessage.includes('Unauthorized') ||
          errorMessage.includes('Invalid token') ||
          errorMessage.includes('Token expired') ||
          errorMessage.includes('authentication') ||
          errorCode === 'Unauthorized';

        const isLoginFailure = errorMessage.includes('Invalid credentials');

        if (isAuthError && !isLoginFailure) {
          isLoggingOut = true;
          const removeOpts: { path: string; domain?: string } = { path: '/' };
          if (process.env.NODE_ENV === 'production' && typeof window !== 'undefined') {
            removeOpts.domain = window.location.hostname;
          }
          Cookies.remove('access_token', removeOpts);
          if (typeof window !== 'undefined') {
            setTimeout(() => {
              window.location.href = '/';
              isLoggingOut = false;
            }, 100);
          } else {
            isLoggingOut = false;
          }
        }
      }
    }
    // For network errors or other errors, just reject without logging out
    return Promise.reject(error);
  }
);

export default apiClient;
