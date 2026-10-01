import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, getToken, setToken, setUnauthorizedHandler } from '../api/client';

const AuthContext = createContext(null);

export const STAFF_ROLES = ['staff', 'management'];

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // Starts true so the app shows a spinner rather than the login page while the
  // stored token is being checked.
  const [loading, setLoading] = useState(Boolean(getToken()));

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api.me()
      .then(setUser)
      // Only a 401 means the stored session is dead, and the client already
      // clears the token for one. Anything else -- the backend still waking,
      // a dropped connection -- says nothing about the session, and throwing
      // it away would sign the resident out for the server being slow.
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (credentials) => {
    const { token, user: loggedIn } = await api.login(credentials);
    setToken(token);
    setUser(loggedIn);
    return loggedIn;
  }, []);

  // Shared by the reset page, which is handed a session by the API once the
  // new password is set.
  const adoptSession = useCallback((token, nextUser) => {
    setToken(token);
    setUser(nextUser);
  }, []);

  const register = useCallback(async (payload) => {
    const { token, user: created } = await api.register(payload);
    setToken(token);
    setUser(created);
    return created;
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    login,
    register,
    logout,
    setUser,
    adoptSession,
    isStaff: Boolean(user) && STAFF_ROLES.includes(user.role),
    isManagement: user?.role === 'management',
  }), [user, loading, login, register, logout, adoptSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
};
