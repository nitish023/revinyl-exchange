import { describe, expect, it } from 'vitest';
import { GRADE_CODES, GRADES, gradeByCode, gradeByRank, meetsMinimumGrade } from './grades.js';

describe('grades', () => {
  it('ranks Poor lowest and Mint highest, with no gaps', () => {
    expect(GRADES.map((grade) => grade.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(GRADE_CODES[0]).toBe('P');
    expect(GRADE_CODES.at(-1)).toBe('M');
  });

  it('looks grades up by code and by rank', () => {
    expect(gradeByCode('VG+')?.rank).toBe(6);
    expect(gradeByRank(7)?.code).toBe('NM');
    expect(gradeByCode('vg+')).toBeUndefined();
    expect(gradeByRank(9)).toBeUndefined();
  });

  it('treats a better copy as meeting a lower minimum', () => {
    const vgPlus = gradeByCode('VG+').rank;
    expect(meetsMinimumGrade(gradeByCode('NM').rank, vgPlus)).toBe(true);
    expect(meetsMinimumGrade(vgPlus, vgPlus)).toBe(true);
    expect(meetsMinimumGrade(gradeByCode('VG').rank, vgPlus)).toBe(false);
  });
});
