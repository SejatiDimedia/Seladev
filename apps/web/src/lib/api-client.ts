import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../stores/auth.store';
import { useOrgStore } from '../stores/org.store';

export const apiClient = axios.create({
  baseURL: '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Crucial for receiving/sending HTTP-Only refresh cookies
});

// Request Interceptor
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = useAuthStore.getState().accessToken;
    const activeOrgId = useOrgStore.getState().activeOrgId;

    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (activeOrgId && config.headers) {
      config.headers['X-Org-Id'] = activeOrgId;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

let refreshPromise: Promise<{ accessToken: string; user: any }> | null = null;

export const refreshSession = async (): Promise<{ accessToken: string; user: any }> => {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const response = await axios.post(
        '/api/v1/auth/refresh',
        {},
        { withCredentials: true }
      );
      const { accessToken, user } = response.data.data;
      useAuthStore.getState().setAuth(accessToken, user);
      return { accessToken, user };
    } catch (err) {
      useAuthStore.getState().clearAuth();
      useOrgStore.getState().clearOrgs();
      throw err;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
};

// Response Interceptor
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // If unauthorized and not already retrying
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      // Don't refresh on login or password change or actual refresh routes
      const url = originalRequest.url || '';
      if (url.includes('/auth/login') || url.includes('/auth/refresh') || url.includes('/auth/register')) {
        const responseData = error.response?.data as any;
        const apiError = {
          message: responseData?.error?.message || responseData?.message || error.message || 'An unknown error occurred',
          code: responseData?.error?.code || responseData?.code || 'UNKNOWN_ERROR',
          status: error.response?.status || 500,
          details: responseData?.error?.details || responseData?.details || null,
          fields: responseData?.error?.fields || null,
        };
        return Promise.reject(apiError);
      }

      originalRequest._retry = true;

      try {
        const { accessToken } = await refreshSession();
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        }
        return apiClient(originalRequest);
      } catch (refreshError) {
        return Promise.reject(refreshError);
      }
    }

    // Map error to custom structured format
    const responseData = error.response?.data as any;
    const apiError = {
      message: responseData?.error?.message || responseData?.message || error.message || 'An unknown error occurred',
      code: responseData?.error?.code || responseData?.code || 'UNKNOWN_ERROR',
      status: error.response?.status || 500,
      details: responseData?.error?.details || responseData?.details || null,
      fields: responseData?.error?.fields || null, // Capture validation fields if present
    };

    return Promise.reject(apiError);
  }
);
