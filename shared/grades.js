/**
 * Media condition grades (the Goldmine scale used by Discogs and record shops).
 * Stored as a number so "VG+ or better" is a simple `rank >= minRank` check.
 * Matching only looks at the record's grade. A copy's sleeve is graded on the same scale
 * (copies.sleeve_grade, see shared/copies.js) but only shown to buyers, never matched on.
 */
export const GRADES = Object.freeze([
  { code: 'P', rank: 1, label: 'Poor' },
  { code: 'F', rank: 2, label: 'Fair' },
  { code: 'G', rank: 3, label: 'Good' },
  { code: 'G+', rank: 4, label: 'Good Plus' },
  { code: 'VG', rank: 5, label: 'Very Good' },
  { code: 'VG+', rank: 6, label: 'Very Good Plus' },
  { code: 'NM', rank: 7, label: 'Near Mint' },
  { code: 'M', rank: 8, label: 'Mint' },
]);

export const GRADE_CODES = GRADES.map((grade) => grade.code);

export const MIN_GRADE_RANK = 1;
export const MAX_GRADE_RANK = 8;

export function gradeByCode(code) {
  return GRADES.find((grade) => grade.code === code);
}

export function gradeByRank(rank) {
  return GRADES.find((grade) => grade.rank === rank);
}

/** True when a copy graded `copyRank` satisfies a bid asking for at least `minRank`. */
export function meetsMinimumGrade(copyRank, minRank) {
  return copyRank >= minRank;
}
