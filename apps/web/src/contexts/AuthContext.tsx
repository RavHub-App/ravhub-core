/*
 * Copyright (C) 2026 Rubén Santibáñez Acosta
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 */

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

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    delete axios.defaults.headers.common['Authorization'];
    if (!window.location.pathname.startsWith('/login')) {
      setTimeout(() => (window.location.href = '/login'), 50);
    }
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      const storedToken = localStorage.getItem('token');
      if (storedToken) {
        setToken(storedToken);
        axios.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
        try {
          try {
            const me = await axios.get('/api/auth/me');
            if (me.data?.ok && me.data.user) {
              setUser(me.data.user as User);
              localStorage.setItem('user', JSON.stringify(me.data.user));
            } else {
              const storedUser = localStorage.getItem('user');
              if (storedUser) setUser(JSON.parse(storedUser));
            }
          } catch (_fallbackError) {
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
              const res = await axios.post('/api/auth/refresh', { refreshToken }, { _retry: true } as any);
              if (res.data.ok) {
                const { token: newToken, refreshToken: newRefreshToken } = res.data;

                localStorage.setItem('token', newToken);
                if (newRefreshToken) localStorage.setItem('refreshToken', newRefreshToken);

                setToken(newToken);
                axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;

                originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
                return axios(originalRequest);
              }
            } catch (refreshErr) {
              console.error('Token refresh failed:', refreshErr);
              logout();
              return Promise.reject(refreshErr);
            }
          }

          logout();
        }
        return Promise.reject(err);
      }
    );

    return () => {
      axios.interceptors.response.eject(interceptorId);
    };
  }, [logout]);

  const login = useCallback(async (newToken: string, newUser: User, newRefreshToken?: string) => {
    localStorage.setItem('token', newToken);
    if (newRefreshToken) localStorage.setItem('refreshToken', newRefreshToken);
    setToken(newToken);
    axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
    try {
      const me = await axios.get('/api/auth/me');
      if (me.data?.ok && me.data.user) {
        setUser(me.data.user as User);
        localStorage.setItem('user', JSON.stringify(me.data.user));
        return;
      }
    } catch (_fallbackError) {
      void _fallbackError;
    }
    localStorage.setItem('user', JSON.stringify(newUser));
    setUser(newUser);
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
