/**
 * A line over time in the paper's one ink (Part 18): the reVINYL 30 and a portfolio's net
 * worth. Geometry from lib/charts.js (lineLayout); this only draws it.
 */
import { LINE_FRAME, lineLayout } from '../lib/charts.js';

const SVG = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...children) => {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
  for (const child of children.flat()) {
    if (child) element.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return element;
};

/**
 * @param {{ points: { day: string, value: number }[], format: (value: number) => string,
 *   label: string }} options at least one point; `label` is what a screen reader hears
 * @returns {SVGElement}
 */
export function lineChart({ points, format, label }) {
  const frame = LINE_FRAME;
  const { path, ticks, last } = lineLayout(
    points.map((point) => ({ day: point.day, level: point.value })),
    frame,
  );
  const edge = frame.width - frame.right;
  return s(
    'svg',
    {
      class: 'chart',
      viewBox: `0 0 ${frame.width} ${frame.height}`,
      role: 'img',
      'aria-label': label,
    },
    ticks.map((tick) =>
      s(
        'g',
        { class: 'chart-grid' },
        s('line', { x1: frame.left, x2: edge, y1: tick.y, y2: tick.y }),
        s('text', { x: frame.width - 2, y: tick.y + 4, 'text-anchor': 'end' }, format(tick.value)),
      ),
    ),
    s('path', { class: 'index-line', d: path }),
    s('circle', { class: 'index-dot', cx: last.x, cy: last.y, r: 4 }),
    s('text', { class: 'chart-label', x: frame.left, y: frame.height - 8 }, points[0].day),
    s(
      'text',
      { class: 'chart-label', x: edge, y: frame.height - 8, 'text-anchor': 'end' },
      points.at(-1).day,
    ),
  );
}
