import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';

interface User {
  id: string;
  username: string;
  displayName?: string;
  roles?: string[];
  permissions?: string[];
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User, refreshToken?: string) => void;
  logout: () => void;
  isAuthenticated: boolean;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      // Do not change axios.defaults.baseURL here. The app prefixes all
      // API routes with /api and the Vite dev proxy will map /api -> backend.
      const storedToken = localStorage.getItem('token');
      if (storedToken) {
        setToken(storedToken);
        axios.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
        try {
          // If the API exposes the /auth/me endpoint, prefer that to fetch current user + roles
          try {
            const me = await axios.get('/api/auth/me');
            if (me.data?.ok && me.data.user) {
              setUser(me.data.user as User);
              localStorage.setItem('user', JSON.stringify(me.data.user));
            } else {
              const storedUser = localStorage.getItem('user');
              if (storedUser) setUser(JSON.parse(storedUser));
            }
          } catch (e) {
            // fallback to stored user if /me fails
            const storedUser = localStorage.getItem('user');
            if (storedUser) setUser(JSON.parse(storedUser));
          }
        } catch (error) {
          console.error("Failed to restore auth state", error);
          logout();
        }
      }
      setIsLoading(false);
    };
    initAuth();

    // Setup axios response interceptor to auto-logout on 401 / JWT expiry
    const interceptorId = axios.interceptors.response.use(
      (resp) => resp,
      async (err) => {
        const originalRequest = err.config;
        const status = err?.response?.status;
        const message = err?.response?.data?.message || err?.response?.data?.error || '';
        const isRefreshRequest = originalRequest.url?.includes('/auth/refresh');

        if ((status === 401 || /jwt\s*expired|token\s*expired/i.test(String(message))) && !originalRequest._retry && !isRefreshRequest) {
          originalRequest._retry = true;
          const refreshToken = localStorage.getItem('refreshToken');

          if (refreshToken) {
            try {
              // Use _retry: true to avoid interceptor loops if the refresh itself fails
              const res = await axios.post('/api/auth/refresh', { refreshToken }, { _retry: true } as any);
              if (res.data.ok) {
                const { token: newToken, refreshToken: newRefreshToken } = res.data;

                localStorage.setItem('token', newToken);
                if (newRefreshToken) localStorage.setItem('refreshToken', newRefreshToken);

                setToken(newToken);
                axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;

                // Update the original request header
                originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
                return axios(originalRequest);
              }
            } catch (refreshErr) {
              console.error('Token refresh failed:', refreshErr);
              // If refresh fails, we must logout to avoid loops
              logout();
              return Promise.reject(refreshErr);
            }
          }

          // call logout and redirect to login page
          logout();
        }
        return Promise.reject(err);
      }
    );

    return () => {
      axios.interceptors.response.eject(interceptorId);
    };
  }, []);

  const login = useCallback(async (newToken: string, newUser: User, newRefreshToken?: string) => {
    localStorage.setItem('token', newToken);
    if (newRefreshToken) localStorage.setItem('refreshToken', newRefreshToken);
    setToken(newToken);
    axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
    // try to fetch /auth/me for a richer user payload (roles/permissions)
    try {
      const me = await axios.get('/api/auth/me');
      if (me.data?.ok && me.data.user) {
        setUser(me.data.user as User);
        localStorage.setItem('user', JSON.stringify(me.data.user));
        return;
      }
    } catch (e) {
      // fallback to provided user if /me isn't available
    }
    localStorage.setItem('user', JSON.stringify(newUser));
    setUser(newUser);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    delete axios.defaults.headers.common['Authorization'];
    // ensure UI navigates to login if not already there
    if (!window.location.pathname.startsWith('/login')) {
      setTimeout(() => (window.location.href = '/login'), 50);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isAuthenticated: !!token, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
