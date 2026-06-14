export const API = '/api';
export const TOKEN_KEY = 'devtasks_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY) || '';

export async function api(path, opts = {}) {
  const token = getToken();
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {})
    }
  });
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    window.dispatchEvent(new Event('devtasks-unauthorized'));
    throw new Error('unauthorized');
  }
  return res.json();
}
