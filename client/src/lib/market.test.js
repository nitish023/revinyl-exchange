import { describe, expect, it } from 'vitest';
import {
  adCount,
  adLead,
  adText,
  buyerLine,
  gradeSection,
  orderIds,
  priceChange,
  sellerLine,
  shortDate,
  shortMoney,
  wantedLead,
} from './market.js';

const ad = (copy = {}, orderId = 1) => ({
  orderId,
  price: '42.00',
  listedAt: '2026-11-01T12:00:00Z',
  copy: {
    id: 1,
    grade: 6,
    sleeveGrade: 5,
    condition: 'VG+/VG',
    flags: [],
    headline: '',
    notes: '',
    photos: 0,
    ...copy,
  },
  seller: { name: 'groovegarden', trades: 54 },
});

describe('ads', () => {
  it('leads with the headline in capitals, ending in a full stop', () => {
    expect(adLead(ad({ headline: 'First press' }))).toBe('FIRST PRESS.');
    expect(adLead(ad({ headline: 'Played twice.' }))).toBe('PLAYED TWICE.');
  });

  it('leads with the condition when there is no headline, and does not repeat it', () => {
    const plain = ad({ notes: 'Plays clean' });
    expect(adLead(plain)).toBe('VG+/VG.');
    expect(adText(plain)).toBe('Plays clean.');
  });

  it('puts condition, notes, flags and photos in the text', () => {
    const full = ad({
      headline: 'Original inner sleeve.',
      notes: 'Corner wear on the jacket.',
      flags: ['seam_split', 'label_writing'],
      photos: 3,
    });
    expect(adText(full)).toBe(
      'VG+/VG. Corner wear on the jacket. Known issues: split seam, writing on the label. 3 photos.',
    );
    expect(adText(ad({ photos: 1 }))).toBe('1 photo.');
  });

  it('ignores a flag it does not know', () => {
    expect(adText(ad({ flags: ['mystery'] }))).toBe('');
  });
});

describe('traders', () => {
  it('signs a seller’s ad with their name and trades', () => {
    expect(sellerLine({ name: 'groovegarden', trades: 54 })).toBe('groovegarden, 54 trades.');
    expect(sellerLine({ name: 'late.side', trades: 1 })).toBe('late.side, 1 trade.');
    expect(sellerLine({ name: 'newbie', trades: 0 })).toBe('newbie, new to reVINYL.');
  });

  it('never names a buyer', () => {
    expect(buyerLine({ trades: 9 })).toBe('Buyer, 9 trades.');
    expect(buyerLine({ trades: 1 })).toBe('Buyer, 1 trade.');
    expect(buyerLine({ trades: 0 })).toBe('New buyer.');
  });
});

describe('WANTED ads', () => {
  it('says the lowest grade the buyer takes', () => {
    expect(wantedLead(6)).toBe('VG+ OR BETTER.');
    expect(wantedLead(7)).toBe('NM OR BETTER.');
    expect(wantedLead(8)).toBe('MINT ONLY.');
  });
});

describe('the report', () => {
  it('writes big prices without zero cents', () => {
    expect(shortMoney('42.00')).toBe('$42');
    expect(shortMoney('42.50')).toBe('$42.50');
  });

  it('shows the change since the previous sale with an arrow', () => {
    expect(priceChange('3.00')).toBe('▲ $3');
    expect(priceChange('-2.50')).toBe('▼ $2.50');
    expect(priceChange('0.00')).toBe('Even');
    expect(priceChange(null)).toBe('');
  });

  it('writes dates like a sales column', () => {
    expect(shortDate('2026-11-01T15:00:00Z')).toBe('Nov 01');
  });
});

describe('the section', () => {
  it('names each grade and says what it means', () => {
    expect(gradeSection(6)).toEqual({
      code: 'VG+',
      name: 'VERY GOOD PLUS',
      meaning: 'Light marks you can see but not hear.',
    });
    for (let grade = 1; grade <= 8; grade += 1) expect(gradeSection(grade).meaning).toBeTruthy();
  });

  it('counts the ads', () => {
    const market = {
      forSale: [{ grade: 6, ads: [ad({}, 1), ad({}, 2)] }],
      wanted: [{ orderId: 3 }],
    };
    expect(adCount(market)).toBe('2 copies for sale · 1 wanted ad');
    expect(adCount({ forSale: [{ grade: 6, ads: [ad()] }], wanted: [] })).toBe(
      '1 copy for sale · 0 wanted ads',
    );
    expect(adCount({ forSale: [], wanted: [] })).toBe('No ads running');
    expect(orderIds(market)).toEqual(new Set([1, 2, 3]));
  });
});
