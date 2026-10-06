import axios from 'axios';

import { API_BASE } from './base';
import { ensureBackend, markApiAlive, markApiUnreachable } from './warmup';

const TOKEN_KEY = 'tsv.token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token) => {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
};

const client = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use(async (config) => {
  // A sleeping backend takes up to a minute to wake. Wait for it here, once,
  // rather than let the request fail and the user try again.
  await ensureBackend();
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Callbacks the auth provider registers so an expired session can log out the
// app from anywhere, without this module importing React.
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

client.interceptors.response.use(
  (response) => {
    markApiAlive();
    return response;
  },
  (error) => {
    const status = error.response?.status;
    // Any answer at all, even an error, means the backend is awake. No answer
    // means it may have gone back to sleep, so the next call checks first.
    if (error.response) markApiAlive();
    else markApiUnreachable();
    // A 401 on any call but the login attempt itself means the token is dead.
    if (status === 401 && !error.config?.url?.includes('/auth/login')) {
      setToken(null);
      onUnauthorized();
    }
    return Promise.reject(error);
  },
);

/**
 * Pulls a human-readable message out of an axios error, preferring the API's
 * own message and its per-field validation detail.
 */
export const errorMessage = (error, fallback = 'Something went wrong') => {
  const data = error?.response?.data;
  if (!data) {
    return error?.message === 'Network Error'
      ? 'Cannot reach the server. Is the API running?'
      : fallback;
  }
  if (data.details?.length) {
    return data.details.map((d) => d.message).join('. ');
  }
  return data.error || fallback;
};

export const api = {
  login: (credentials) => client.post('/auth/login', credentials).then((r) => r.data),
  register: (payload) => client.post('/auth/register', payload).then((r) => r.data),
  signupToken: () => client.get('/auth/signup-token').then((r) => r.data.token),
  me: () => client.get('/auth/me').then((r) => r.data.user),
  // Returns the whole body, not just the user: a changed email address comes
  // back with a replacement token.
  updateProfile: (payload) => client.patch('/auth/me', payload).then((r) => r.data),
  changePassword: (payload) => client.post('/auth/change-password', payload).then((r) => r.data),
  forgotPassword: (email) => client.post('/auth/forgot-password', { email }).then((r) => r.data),
  resetPassword: (payload) => client.post('/auth/reset-password', payload).then((r) => r.data),

  meta: () => client.get('/meta').then((r) => r.data),

  listTickets: (params) => client.get('/tickets', { params }).then((r) => r.data),
  createTicket: (payload) => client.post('/tickets', payload).then((r) => r.data.ticket),
  getTicket: (id) => client.get(`/tickets/${id}`).then((r) => r.data.ticket),
  updateTicket: (id, payload) => client.patch(`/tickets/${id}`, payload).then((r) => r.data.ticket),
  assignTicket: (id, assignedTo) => client.post(`/tickets/${id}/assign`, { assignedTo }).then((r) => r.data.ticket),
  deleteTicket: (id) => client.delete(`/tickets/${id}`).then(() => undefined),

  listComments: (id) => client.get(`/tickets/${id}/comments`).then((r) => r.data.comments),
  addComment: (id, payload) => client.post(`/tickets/${id}/comments`, payload).then((r) => r.data.comment),
  listActivity: (id) => client.get(`/tickets/${id}/activity`).then((r) => r.data.activity),

  assignableUsers: () => client.get('/users/assignable').then((r) => r.data.users),
  listUsers: (params) => client.get('/users', { params }).then((r) => r.data),
  updateUser: (id, payload) => client.patch(`/users/${id}`, payload).then((r) => r.data.user),
  deleteUser: (id) => client.delete(`/users/${id}`).then(() => undefined),
  resetUserPassword: (id) => client.post(`/users/${id}/reset-password`).then((r) => r.data),

  reportSummary: () => client.get('/reports/summary').then((r) => r.data),
};

export default client;
