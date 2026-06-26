import { createContext, useContext, useCallback, useEffect, useState } from 'react';
import * as authService from '../services/auth.service.js';
import { isServerError } from '../services/api.js';
import { invalidateCache } from '../hooks/useCachedResource.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Set when a server/network error (NOT a bad token) blocks session restore. While
  // true the app shows a retry screen instead of dropping the user onto a login form
  // that can't possibly work against a broken backend.
  const [bootstrapError, setBootstrapError] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // Restore the session from a stored token — on first load and on retry.
  const restoreSession = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const u = await authService.me();
      setUser(u);
      setBootstrapError(false);
    } catch (err) {
      if (isServerError(err)) {
        // Server down/unreachable — keep the token and block behind the retry screen
        // rather than silently logging the user out.
        setBootstrapError(true);
      } else {
        // Genuinely unauthenticated (e.g. expired token) — clear it and show login.
        localStorage.removeItem('token');
        setBootstrapError(false);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  // Re-attempt session restore from the error screen's retry button.
  const retryBootstrap = useCallback(async () => {
    setRetrying(true);
    await restoreSession();
    setRetrying(false);
  }, [restoreSession]);

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

  // Sign out of all OTHER devices and adopt the fresh token this device gets back, so
  // the current session stays valid while every other one is invalidated.
  const logoutOtherDevices = async () => {
    await authService.logoutAll(); // this device's session stays valid — no token swap needed
  };

  const updateProfile = async (payload) => {
    const updated = await authService.updateProfile(payload);
    setUser(updated);
    return updated;
  };

  const updateAvatar = async (payload) => {
    const updated = await authService.updateAvatar(payload);
    setUser(updated);
    return updated;
  };

  const value = {
    user,
    loading,
    bootstrapError,
    retrying,
    retryBootstrap,
    login,
    register,
    logout,
    logoutOtherDevices,
    updateProfile,
    updateAvatar,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin',
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
