import { describe, expect, it } from 'vitest';
import { fieldErrors } from './validation.js';
import {
  addCopySchema,
  crateQuerySchema,
  idParamSchema,
  isPhotoType,
  photoParamSchema,
  photoTypeFromBytes,
} from './crate.js';

const bytes = (...values) => Uint8Array.from(values);
const ascii = (text) => [...text].map((char) => char.charCodeAt(0));

describe('photoTypeFromBytes', () => {
  it('knows JPEG, PNG and WebP by their first bytes', () => {
    expect(photoTypeFromBytes(bytes(0xff, 0xd8, 0xff, 0xe0, 0))).toBe('image/jpeg');
    expect(photoTypeFromBytes(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(
      'image/png',
    );
    expect(photoTypeFromBytes(bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBPVP8 ')))).toBe(
      'image/webp',
    );
  });

  it('refuses anything else, including look-alikes and files too short to tell', () => {
    expect(photoTypeFromBytes(bytes(...ascii('GIF89a')))).toBeNull();
    expect(photoTypeFromBytes(bytes(...ascii('<svg xmlns=')))).toBeNull();
    expect(photoTypeFromBytes(bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WAVE')))).toBeNull();
    expect(photoTypeFromBytes(bytes(0x89, 0x50, 0x4e))).toBeNull();
    expect(photoTypeFromBytes(bytes())).toBeNull();
  });

  it('accepts only the three photo types from a form', () => {
    expect(isPhotoType('image/webp')).toBe(true);
    expect(isPhotoType('image/gif')).toBe(false);
    expect(isPhotoType('image/svg+xml')).toBe(false);
  });
});

describe('addCopySchema', () => {
  const copy = { releaseId: 249504, grade: 6, sleeveGrade: null };
  const problems = (input) => {
    const result = addCopySchema.safeParse(input);
    return result.success ? {} : fieldErrors(result.error);
  };

  it('fills in defaults and treats a null sleeve as a generic sleeve', () => {
    expect(addCopySchema.parse(copy)).toEqual({
      ...copy,
      flags: [],
      headline: '',
      notes: '',
    });
  });

  it('needs the sleeve to be chosen, even if the choice is "generic"', () => {
    expect(problems({ releaseId: 249504, grade: 6 }).sleeveGrade).toBe(
      'Pick the sleeve’s grade, or choose generic sleeve',
    );
  });

  it('keeps flags in the form’s order, without repeats', () => {
    const parsed = addCopySchema.parse({ ...copy, flags: ['skips', 'warp', 'skips'] });
    expect(parsed.flags).toEqual(['warp', 'skips']);
  });

  it('refuses text Postgres can’t store, and text that is too long', () => {
    expect(problems({ ...copy, notes: 'fine\u0000then not' }).notes).toBe(
      'The notes has a character we can’t store',
    );
    expect(problems({ ...copy, headline: 'x'.repeat(41) }).headline).toBe(
      'Keep the headline under 40 characters',
    );
    expect(problems({ ...copy, headline: `  ${'x'.repeat(40)}  ` })).toEqual({});
  });

  it('refuses a missing pressing and grades off the scale', () => {
    expect(Object.keys(problems({ grade: 0, sleeveGrade: 9 })).sort()).toEqual([
      'grade',
      'releaseId',
      'sleeveGrade',
    ]);
  });
});

describe('query and path schemas', () => {
  it('reads ids from the address bar and treats a blank filter as none', () => {
    expect(crateQuerySchema.parse({ releaseId: '12' })).toEqual({ releaseId: 12 });
    expect(crateQuerySchema.parse({ releaseId: '' })).toEqual({});
    expect(crateQuerySchema.safeParse({ releaseId: 'abc' }).success).toBe(false);
    expect(idParamSchema.safeParse({ id: '0' }).success).toBe(false);
    expect(idParamSchema.safeParse({ id: '1.5' }).success).toBe(false);
  });

  it('only has photo positions 1 to 6', () => {
    expect(photoParamSchema.parse({ id: '3', position: '6' })).toEqual({ id: 3, position: 6 });
    expect(photoParamSchema.safeParse({ id: '3', position: '0' }).success).toBe(false);
    expect(photoParamSchema.safeParse({ id: '3', position: '7' }).success).toBe(false);
  });
});
