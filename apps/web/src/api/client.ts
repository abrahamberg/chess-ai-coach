import type { ZodType } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Fetches `path`, parsing the JSON body against `schema`. Extra/unknown
 * response fields are tolerated (zod's default "strip" parsing), so the
 * client doesn't break when the API adds fields the UI doesn't use yet.
 *
 * `signal` should be forwarded from React Query's queryFn context
 * (`({signal}) => apiGet(path, schema, signal)`) — otherwise React 18
 * StrictMode's dev-only double-mount cancels the first fetch without this
 * function ever seeing it, leaving the query stuck pending/paused forever. */
export async function apiGet<T>(path: string, schema: ZodType<T>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { credentials: 'include', signal });
  if (!response.ok) {
    throw new ApiError(response.status, `GET ${path} failed with ${response.status}`, await safeJson(response));
  }
  const body: unknown = await response.json();
  return schema.parse(body);
}

export async function apiPost<T>(path: string, payload: unknown, schema: ZodType<T>): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new ApiError(response.status, `POST ${path} failed with ${response.status}`, await safeJson(response));
  }
  const body: unknown = await response.json();
  return schema.parse(body);
}

export async function apiPatch<T>(path: string, payload: unknown, schema: ZodType<T>): Promise<T> {
  const response = await fetch(path, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new ApiError(response.status, `PATCH ${path} failed with ${response.status}`, await safeJson(response));
  }
  const body: unknown = await response.json();
  return schema.parse(body);
}

/** PUT/DELETE endpoints in this app return 204 No Content (e.g. llm-keys) — no schema to parse. */
export async function apiPut(path: string, payload: unknown): Promise<void> {
  const response = await fetch(path, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new ApiError(response.status, `PUT ${path} failed with ${response.status}`, await safeJson(response));
  }
}

export async function apiDelete(path: string): Promise<void> {
  const response = await fetch(path, { method: 'DELETE', credentials: 'include' });
  if (!response.ok) {
    throw new ApiError(response.status, `DELETE ${path} failed with ${response.status}`, await safeJson(response));
  }
}

/** Problem+json error bodies (e.g. {missing: 'userColor'}) carry data callers
 * need; best-effort since not every error response has a JSON body. */
async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
