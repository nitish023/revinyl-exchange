import { GRADES } from '../../../shared/index.js';
import { h } from '../dom.js';

/** VG+ and up: what most collectors look for, shown in solid ink on the scale. */
export const COLLECTIBLE_RANK = 6;

/** The eight-notch condition scale, Poor to Mint. */
export function gradeScale() {
  return h(
    'ol',
    { class: 'grade-scale', 'aria-label': 'Condition grades from Poor to Mint' },
    GRADES.map((grade) =>
      h(
        'li',
        {
          class: grade.rank >= COLLECTIBLE_RANK ? 'grade-collectible' : null,
          title: grade.label,
        },
        h('abbr', { title: grade.label }, grade.code),
      ),
    ),
  );
}
