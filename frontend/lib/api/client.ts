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

    // Skip auth redirect in dev mode
    const token = Cookies.get('access_token');
    if (token === 'dev-mode-token') {
      return Promise.reject(error);
    }

    // Only handle 401 errors (authentication failures)
    if (error.response?.status === 401 && !isLoggingOut) {
      const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
      const isLoginPage = currentPath === '/login';
      const requestUrl = error.config?.url || '';
      const isAuthEndpoint = requestUrl.includes('/auth/login');
      const isUploadEndpoint = requestUrl.includes('/drawings/upload');
      
      // Don't logout if:
      // 1. We're already on the login page
      // 2. It's the login endpoint itself (login failure, not logout)
      // 3. It's a network error (no response)
      // 4. We're already in the process of logging out
      if (!isLoginPage && !isAuthEndpoint && error.response && !isLoggingOut) {
        const errorMessage = error.response?.data?.message || '';
        const errorCode = error.response?.data?.error || '';
        
        // Only logout on actual authentication errors, not other 401s
        // Check if it's an auth-related error message
        const isAuthError = 
          errorMessage.includes('Unauthorized') || 
          errorMessage.includes('Invalid token') || 
          errorMessage.includes('Token expired') ||
          errorMessage.includes('authentication') ||
          errorCode === 'Unauthorized';
        
        // Don't logout on login credential failures
        const isLoginFailure = errorMessage.includes('Invalid credentials');
        
        // For upload errors, be more lenient - don't logout immediately
        // unless it's clearly an auth issue
        if (isAuthError && !isLoginFailure) {
          // Only clear token and redirect if it's a real auth error
          isLoggingOut = true;
          Cookies.remove('access_token', { path: '/' });
          if (currentPath !== '/login' && typeof window !== 'undefined') {
            // Small delay to prevent multiple redirects
            setTimeout(() => {
              window.location.href = '/login';
              isLoggingOut = false;
            }, 100);
          } else {
            isLoggingOut = false;
          }
        } else if (isUploadEndpoint) {
          // For upload errors that aren't clearly auth-related, don't logout
          // Just let the error bubble up to the component
          console.warn('Upload failed with 401, but not logging out:', errorMessage);
        }
      }
    }
    // For network errors or other errors, just reject without logging out
    return Promise.reject(error);
  }
);

export default apiClient;
