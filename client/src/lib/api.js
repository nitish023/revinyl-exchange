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

/** The headers and body for a request: JSON for `body`, or a file sent as itself for `file`. */
function payload(options) {
  if (options.file !== undefined) {
    return { headers: { 'Content-Type': options.file.type }, body: options.file };
  }
  if (options.body !== undefined) {
    return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body) };
  }
  return { headers: undefined, body: undefined };
}

async function request(method, path, options = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      ...payload(options),
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
  market: (id, signal) => request('GET', `/releases/${id}/market`, signal ? { signal } : {}),

  wallet: (signal) => request('GET', '/wallet', signal ? { signal } : {}),
  crate: (releaseId, signal) =>
    request(
      'GET',
      releaseId ? `/crate?releaseId=${releaseId}` : '/crate',
      signal ? { signal } : {},
    ),
  addCopy: (input) => request('POST', '/crate', { body: input }),
  removeCopy: (copyId) => request('DELETE', `/crate/${copyId}`),
  uploadPhoto: (copyId, file) => request('POST', `/crate/${copyId}/photos`, { file }),
  /** @param {{ status?: string, releaseId?: number }} filters */
  orders: (filters = {}, signal) => {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.releaseId) params.set('releaseId', String(filters.releaseId));
    return request('GET', `/orders?${params}`, signal ? { signal } : {});
  },
  placeOrder: (input) => request('POST', '/orders', { body: input }),
  cancelOrder: (orderId) => request('DELETE', `/orders/${orderId}`),
};
