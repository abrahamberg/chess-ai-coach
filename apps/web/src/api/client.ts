import type { ZodType } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Fetches `path`, parsing the JSON body against `schema`. Extra/unknown
 * response fields are tolerated (zod's default "strip" parsing), so the
 * client doesn't break when the API adds fields the UI doesn't use yet. */
export async function apiGet<T>(path: string, schema: ZodType<T>): Promise<T> {
  const response = await fetch(path, { credentials: 'include' });
  if (!response.ok) {
    throw new ApiError(response.status, `GET ${path} failed with ${response.status}`);
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
    throw new ApiError(response.status, `POST ${path} failed with ${response.status}`);
  }
  const body: unknown = await response.json();
  return schema.parse(body);
}
