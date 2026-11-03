import { h } from '../dom.js';

/**
 * A record: the sleeve (album art from Discogs, or a drawn sleeve when there's
 * no image or it fails to load) with the disc behind it. The sleeve prints in
 * black and white until its card is hovered or focused; then it comes into
 * color and the record slides out (see .cover in styles.css).
 * Images only ever come from i.discogs.com; the server filters URLs and the CSP enforces it.
 */
export function cover(url, alt, options) {
  const sleeve = h('div', { class: 'cover-sleeve halftone' });
  const drawn = () => {
    sleeve.classList.add('cover-sleeve--drawn');
    sleeve.setAttribute('role', 'img');
    sleeve.setAttribute('aria-label', `${alt} (no cover art)`);
  };
  if (url) {
    const image = h('img', {
      src: url,
      alt,
      loading: options.size === 'thumb' ? 'lazy' : 'eager',
      referrerpolicy: 'no-referrer',
      decoding: 'async',
    });
    image.addEventListener(
      'error',
      () => {
        image.remove();
        drawn();
      },
      { once: true },
    );
    sleeve.append(image);
  } else {
    drawn();
  }
  const frame = h(
    'div',
    { class: `cover cover--${options.size}` },
    h('span', { class: 'cover-disc', 'aria-hidden': 'true' }),
    sleeve,
  );
  if (options.labelColor) frame.style.setProperty('--label-color', options.labelColor);
  return frame;
}
