import { describe, expect, it } from 'vitest';
import { editionDate, issueNumber } from './edition.js';

describe('editionDate', () => {
  it('spells the date out like a newspaper folio', () => {
    expect(editionDate(new Date(2026, 10, 8, 15, 30))).toBe('Sunday, November 8, 2026');
  });
});

describe('issueNumber', () => {
  it('starts at No. 1 on launch day, whatever the time', () => {
    expect(issueNumber(new Date(2026, 10, 1, 0, 1))).toBe(1);
    expect(issueNumber(new Date(2026, 10, 1, 23, 59))).toBe(1);
  });

  it('adds one issue per calendar day', () => {
    expect(issueNumber(new Date(2026, 10, 8, 9))).toBe(8);
    expect(issueNumber(new Date(2027, 0, 1, 9))).toBe(62);
  });

  it('never goes below No. 1', () => {
    expect(issueNumber(new Date(2026, 9, 20))).toBe(1);
  });
});
