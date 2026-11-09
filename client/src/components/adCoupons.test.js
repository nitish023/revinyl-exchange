// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PHOTO_BYTES } from '../../../shared/index.js';
import { api, ApiError } from '../lib/api.js';
import { adCoupons } from './adCoupons.js';
import { minGradeText, photoProblem } from './adForms.js';

vi.mock('../lib/api.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    api: {
      crate: vi.fn(),
      wallet: vi.fn(),
      orders: vi.fn(),
      addCopy: vi.fn(),
      uploadPhoto: vi.fn(),
      placeOrder: vi.fn(),
      cancelOrder: vi.fn(),
    },
  };
});

const release = { id: 249504, title: 'Never Gonna Give You Up', artist: 'Rick Astley' };
const user = { id: 1, displayName: 'alice' };
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const inCrate = { id: 11, status: 'in_crate', condition: 'VG+/VG', headline: 'Plays clean.' };
const listed = { id: 12, status: 'listed', condition: 'NM/NM', headline: '' };
const openBid = { id: 21, side: 'bid', price: '40.00', minGrade: 6, releaseId: release.id };

beforeEach(() => {
  vi.clearAllMocks();
  api.crate.mockResolvedValue({ copies: [inCrate, listed] });
  api.wallet.mockResolvedValue({
    wallet: { cash: '2000.00', held: '40.00', spendable: '1960.00' },
  });
  api.orders.mockResolvedValue({ orders: [openBid] });
});

async function render(onPosted = vi.fn()) {
  const element = adCoupons({ release, user, onPosted });
  document.body.replaceChildren(element);
  await settle();
  return { element, onPosted };
}

function submit(form) {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

describe('adCoupons', () => {
  it('asks a logged-out visitor to log in, and comes back to this pressing after', () => {
    const element = adCoupons({ release, user: null, onPosted: vi.fn() });

    const login = element.querySelector('a[href^="/login"]');
    expect(login.getAttribute('href')).toBe('/login?next=%2Frelease%2F249504');
    expect(element.querySelector('form')).toBeNull();
  });

  it('shows the three coupons and only offers copies that are in the crate', async () => {
    const { element } = await render();

    expect([...element.querySelectorAll('.coupon-title')].map((node) => node.textContent)).toEqual([
      'Add a copy to your crate',
      'Sell your copy',
      'Run your own ad',
    ]);
    const options = [...element.querySelectorAll('#sell-copy-copyId option')];
    expect(options.map((option) => option.textContent)).toEqual(['VG+/VG · Plays clean.']);
    expect(api.crate).toHaveBeenCalledWith(release.id);
  });

  it('says how much a wanted ad will hold as the price is typed', async () => {
    const { element } = await render();
    const price = element.querySelector('#wanted-ad-price');
    const note = element.querySelector('form[aria-labelledby="wanted-ad-title"] .coupon-footnote');

    price.value = '40.5';
    price.dispatchEvent(new Event('input'));

    expect(note.textContent).toBe('We’ll hold $40.50 of your $1960.00 while the ad runs.');
  });

  it('checks a wanted ad in the browser first and sends nothing when it is wrong', async () => {
    const { element } = await render();
    const form = element.querySelector('form[aria-labelledby="wanted-ad-title"]');
    element.querySelector('#wanted-ad-price').value = '40.505';

    submit(form);
    await settle();

    expect(element.querySelector('#wanted-ad-price-feedback').textContent).toBe(
      'Enter a price like 40.50',
    );
    expect(element.querySelector('#wanted-ad-price').getAttribute('aria-invalid')).toBe('true');
    expect(api.placeOrder).not.toHaveBeenCalled();
  });

  it('places a wanted ad, says what happened, and tells the market', async () => {
    api.placeOrder.mockResolvedValue({ order: { price: '40.00' }, trade: null });
    const { element, onPosted } = await render();
    element.querySelector('#wanted-ad-price').value = '40';
    element.querySelector('input[name="wanted-min-grade"][value="7"]').checked = true;

    submit(element.querySelector('form[aria-labelledby="wanted-ad-title"]'));
    await settle();

    expect(api.placeOrder).toHaveBeenCalledWith({
      side: 'bid',
      releaseId: release.id,
      price: '40',
      minGrade: 7,
      note: '',
    });
    expect(element.querySelector('.coupon-flash').textContent).toMatch(/\$40\.00 is held/);
    expect(onPosted).toHaveBeenCalledOnce();
  });

  it('shows a server error next to the right field', async () => {
    const message = 'This ad needs $40.00 held, and you have $20.00 to spend.';
    api.placeOrder.mockRejectedValue(
      new ApiError(400, 'INSUFFICIENT_FUNDS', message, { price: message }),
    );
    const { element, onPosted } = await render();
    element.querySelector('#wanted-ad-price').value = '40';

    submit(element.querySelector('form[aria-labelledby="wanted-ad-title"]'));
    await settle();

    expect(element.querySelector('#wanted-ad-price-feedback').textContent).toBe(message);
    expect(onPosted).not.toHaveBeenCalled();
  });

  it('lists a copy for sale and reports a straight-away sale', async () => {
    api.placeOrder.mockResolvedValue({ order: { price: '45.00' }, trade: { price: '45.00' } });
    const { element } = await render();
    element.querySelector('#sell-copy-price').value = '30';

    submit(element.querySelector('form[aria-labelledby="sell-copy-title"]'));
    await settle();

    expect(api.placeOrder).toHaveBeenCalledWith({ side: 'ask', copyId: 11, price: '30' });
    expect(element.querySelector('.coupon-flash').textContent).toMatch(/^Sold for \$45\.00/);
  });

  it('needs a grade before adding a copy', async () => {
    const { element } = await render();

    submit(element.querySelector('form[aria-labelledby="add-copy-title"]'));
    await settle();

    expect(element.querySelector('#add-copy-grade-feedback').textContent).toBe(
      'Pick the record’s grade',
    );
    expect(api.addCopy).not.toHaveBeenCalled();
  });

  it('adds a copy with a generic sleeve and the ticked flags', async () => {
    api.addCopy.mockResolvedValue({ copy: { id: 30, condition: 'VG+, generic sleeve' } });
    const { element, onPosted } = await render();
    element.querySelector('#add-copy-grade').value = '6';
    element.querySelector('#add-copy-sleeveGrade').value = 'generic';
    element.querySelector('input[type="checkbox"][value="warp"]').checked = true;
    element.querySelector('#add-copy-headline').value = 'Played twice.';

    submit(element.querySelector('form[aria-labelledby="add-copy-title"]'));
    await settle();

    expect(api.addCopy).toHaveBeenCalledWith({
      releaseId: release.id,
      grade: 6,
      sleeveGrade: null,
      flags: ['warp'],
      headline: 'Played twice.',
      notes: '',
    });
    expect(element.querySelector('.coupon-flash').textContent).toBe(
      'Added a VG+, generic sleeve copy to your crate.',
    );
    expect(onPosted).not.toHaveBeenCalled(); // a copy in a crate isn't on the market
  });

  it('cancels one of your ads', async () => {
    api.cancelOrder.mockResolvedValue({ order: { id: 21 } });
    const { element, onPosted } = await render();
    const line = element.querySelector('.your-ads li');
    expect(line.textContent).toContain('VG+ or better');

    line.querySelector('button').click();
    await settle();

    expect(api.cancelOrder).toHaveBeenCalledWith(21);
    expect(element.querySelector('.coupon-flash').textContent).toMatch(/\$40\.00 is back/);
    expect(onPosted).toHaveBeenCalledOnce();
  });

  it('shows a retry when the crate can’t be loaded', async () => {
    api.crate.mockRejectedValueOnce(
      new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server.'),
    );
    const { element } = await render();

    expect(element.querySelector('.state-error').textContent).toContain(
      'Could not reach the server.',
    );
    element.querySelector('.state-error button').click();
    await settle();
    expect(element.querySelectorAll('form')).toHaveLength(3);
  });
});

describe('ad form helpers', () => {
  it('says the grade range in words', () => {
    expect(minGradeText(8)).toBe('Mint only');
    expect(minGradeText(6)).toBe('VG+ or better');
    expect(minGradeText(1)).toBe('Any grade');
  });

  it('refuses too many, wrong-type or too-big photos before uploading', () => {
    const file = (name, type, size = 10) => ({ name, type, size });
    expect(photoProblem([file('a.jpg', 'image/jpeg')])).toBeNull();
    expect(photoProblem(Array.from({ length: 7 }, (_, i) => file(`${i}.png`, 'image/png')))).toBe(
      'Choose up to 6 photos.',
    );
    expect(photoProblem([file('a.gif', 'image/gif')])).toMatch(/a\.gif isn’t a JPEG/);
    expect(photoProblem([file('big.png', 'image/png', MAX_PHOTO_BYTES + 1)])).toMatch(/over 2 MB/);
  });
});
