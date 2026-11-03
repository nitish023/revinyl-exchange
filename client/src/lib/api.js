/**
 * Small wrapper around fetch. Every failure becomes an ApiError with a
 * message that is safe to show the user — network errors included.
 */

export class ApiError extends Error {
  status;
  code;
  fields;

  constructor(status, code, message, fields = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

function isApiErrorBody(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error?.message === 'string'
  );
}

export function isAbortError(error) {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function request(method, path, options = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal ?? null,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection.');
  }

  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (isApiErrorBody(data)) {
      throw new ApiError(response.status, data.error.code, data.error.message, data.error.fields);
    }
    throw new ApiError(response.status, 'UNKNOWN', 'Something went wrong. Please try again.');
  }
  return data;
}

export const api = {
  me: () => request('GET', '/auth/me'),
  login: (input) => request('POST', '/auth/login', { body: input }),
  register: (input) => request('POST', '/auth/register', { body: input }),
  logout: () => request('POST', '/auth/logout', { body: {} }),
  searchCatalog: (q, page, filters, signal) => {
    const params = new URLSearchParams({ q, page: String(page) });
    if (filters.format) params.set('format', filters.format);
    if (filters.year !== undefined) params.set('year', String(filters.year));
    return request('GET', `/catalog/search?${params}`, signal ? { signal } : {});
  },
  release: (id, signal) => request('GET', `/releases/${id}`, signal ? { signal } : {}),
};
