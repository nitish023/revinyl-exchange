import { fieldErrors } from '../../../shared/index.js';

import { ApiError } from './api.js';

export const NO_ERRORS = { fields: {}, message: null };

export function errorsFromZod(error) {
  return { fields: fieldErrors(error), message: null };
}

/** Any thrown value -> something we can show next to the form. Never a raw error. */
export function errorsFromUnknown(error) {
  if (error instanceof ApiError) {
    const hasFields = Object.keys(error.fields).length > 0;
    return { fields: error.fields, message: hasFields ? null : error.message };
  }
  return { fields: {}, message: 'Something went wrong. Please try again.' };
}
