/**
 * Turns a Zod error into { field: message }, one message per field (the first),
 * so the browser can show each problem next to the right input. The server sends
 * the same shape in error responses, so forms show server and browser errors alike.
 *
 * Every API error looks like:
 *   { "error": { "code": "VALIDATION_ERROR", "message": "…", "fields": { "email": "…" } } }
 *
 * @param {import('zod').ZodError} error
 * @returns {Record<string, string>}
 */
export function fieldErrors(error) {
  /** @type {Record<string, string>} */
  const fields = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : 'form';
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}
