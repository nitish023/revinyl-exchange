/**
 * Errors that are safe to show users, and the one middleware that turns any
 * error into an HTTP response. Unexpected errors are logged and the user gets a
 * generic message: never a stack trace or a SQL error.
 */
import { ZodError } from 'zod';
import { fieldErrors } from '../../shared/index.js';

export class AppError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} code machine-readable, e.g. "EMAIL_TAKEN"
   * @param {string} message shown to the user
   * @param {Record<string, string>} [fields] per-field messages for forms
   */
  constructor(status, code, message, fields) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const notFound = (what) => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const unauthorized = () => new AppError(401, 'UNAUTHORIZED', 'Please log in to continue');

function body(code, message, fields) {
  return { error: fields ? { code, message, fields } : { code, message } };
}

/** @type {import('express').ErrorRequestHandler} */
export function errorHandler(error, _req, res, _next) {
  if (error instanceof AppError) {
    res.status(error.status).json(body(error.code, error.message, error.fields));
    return;
  }
  if (error instanceof ZodError) {
    const fields = fieldErrors(error);
    res
      .status(400)
      .json(body('VALIDATION_ERROR', Object.values(fields)[0] ?? 'Invalid request', fields));
    return;
  }
  if (error?.type === 'entity.parse.failed') {
    res.status(400).json(body('INVALID_JSON', 'Request body must be valid JSON'));
    return;
  }
  if (error?.type === 'entity.too.large') {
    res.status(413).json(body('TOO_LARGE', 'That request is too large'));
    return;
  }
  console.error('[http] unexpected error:', error);
  res
    .status(500)
    .json(body('INTERNAL_ERROR', 'Something went wrong on our side. Please try again.'));
}
