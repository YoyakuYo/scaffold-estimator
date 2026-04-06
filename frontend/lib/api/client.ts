import axios from 'axios';
import Cookies from 'js-cookie';

// Set NEXT_PUBLIC_BACKEND_URL to your API base including /api/v1 (e.g. https://your-api.onrender.com/api/v1).
// If unset in production, the browser uses same-origin /api/v1 — set BACKEND_PROXY_TARGET on the Next host (see next.config.js)
// or set NEXT_PUBLIC_BACKEND_URL at build time so requests reach Nest.
//
// Important: Next.js replaces process.env.NEXT_PUBLIC_* at **build** time in the browser bundle.
// Changing the var on the host without a new frontend build leaves the old URL in the deployed JS.
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === 'production' ? '/api/v1' : 'http://localhost:3000/api/v1');

const DEFAULT_TIMEOUT_MS = 30000;
const API_TIMEOUT_MS = (() => {
  const raw = process.env.NEXT_PUBLIC_API_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
})();

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT_MS,
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
      const publicPages = [
        '/',
        '/login',
        '/register',
        '/superadmin',
        '/forgot-password',
        '/reset-password',
        '/join-team',
      ];
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

    // 403 subscription: show friendly message instead of "Request failed with status code 403"
    if (error.response?.status === 403) {
      const msg = error.response?.data?.message as string | undefined;
      const isSubscription =
        msg &&
        (msg.includes('Subscription') ||
          msg.includes('trial') ||
          msg.includes('Billing') ||
          msg.toLowerCase().includes('subscribe'));
      if (isSubscription) {
        error.message = msg || 'Subscribe to continue. Open Billing to upgrade your plan.';
      }
    }

    // For network errors or other errors, just reject without logging out
    return Promise.reject(error);
  }
);

export default apiClient;
