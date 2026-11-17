import { getGoogleAccessToken } from './firebaseAuth';

const SESSION_KEY = 'reclaim_it_session_token';

export function getStoredSessionToken(): string | null {
  return sessionStorage.getItem(SESSION_KEY);
}

export function setStoredSessionToken(token: string | null): void {
  if (token) {
    sessionStorage.setItem(SESSION_KEY, token);
  } else {
    sessionStorage.removeItem(SESSION_KEY);
  }
}

export async function apiFetch<T>(
  url: string,
  options: RequestInit = {},
  includeWorkspaceBearer = false
): Promise<T> {
  const headers = new Headers(options.headers || {});
  const sessionToken = getStoredSessionToken();
  if (sessionToken) {
    headers.set('x-session-token', sessionToken);
  }

  if (includeWorkspaceBearer) {
    const googleToken = getGoogleAccessToken();
    if (googleToken) {
      headers.set('Authorization', `Bearer ${googleToken}`);
    }
  }

  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data as T;
}
