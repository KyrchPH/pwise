import { createContext, useContext, useEffect, useState } from 'react';
import * as authService from '../services/auth.service.js';
import { invalidateCache } from '../hooks/useCachedResource.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore session on first load if a token is present.
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }
    authService
      .me()
      .then((u) => setUser(u))
      .catch(() => localStorage.removeItem('token'))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const { user: u, token } = await authService.login(email, password);
    localStorage.setItem('token', token);
    setUser(u);
    return u;
  };

  const register = async (payload) => {
    const { user: u, token } = await authService.register(payload);
    localStorage.setItem('token', token);
    setUser(u);
    return u;
  };

  const logout = async () => {
    try {
      await authService.logout();
    } catch {
      /* ignore — clearing locally is enough */
    }
    localStorage.removeItem('token');
    invalidateCache(); // drop all cached API data so the next user starts clean
    setUser(null);
  };

  const value = {
    user,
    loading,
    login,
    register,
    logout,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin',
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
