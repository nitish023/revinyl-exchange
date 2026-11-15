import { describe, expect, it } from 'vitest';
import {
  counterText,
  ledgerRow,
  numberWord,
  roomByline,
  roomHeadline,
  roomLead,
  shelfStatus,
  wantedLine,
  wantedNote,
} from './room.js';

const release = { id: 1, title: 'Night Ferry', artist: 'The Lanterns', year: 1979, thumbUrl: null };
const copy = (overrides = {}) => ({
  kind: 'copy',
  copyId: 1,
  release,
  grade: 6,
  condition: 'VG+/VG+',
  status: 'in_crate',
  imported: false,
  photos: 0,
  ask: null,
  tradeId: null,
  tradeStatus: null,
  ...overrides,
});
const incoming = (tradeStatus = 'awaiting_shipment') => ({
  kind: 'incoming',
  release,
  grade: 7,
  condition: 'NM/NM',
  tradeId: 3,
  tradeStatus,
  price: '64.00',
});
const room = (overrides = {}) => ({
  user: { displayName: 'nitish', memberSince: '2026-09-14T12:00:00Z' },
  wallet: { cash: '1537.00', held: '125.00', spendable: '1412.00' },
  shelf: [],
  wanted: [],
  ledger: [],
  counter: null,
  value: null,
  ...overrides,
});
const text = (parts) => parts.map((part) => part.text ?? part.bold).join('');

describe('headline', () => {
  it('counts the shelf and what’s on the way, in words', () => {
    const six = Array.from({ length: 6 }, () => copy());
    expect(roomHeadline(room({ shelf: [...six, incoming(), incoming(), incoming()] }))).toBe(
      'Six Records on the Shelf, Three More on the Way',
    );
    expect(roomHeadline(room({ shelf: [copy()] }))).toBe('One Record on the Shelf');
    expect(roomHeadline(room({ shelf: [incoming()] }))).toBe('One Record on the Way');
    expect(roomHeadline(room())).toBe('An Empty Shelf, For Now');
    expect(numberWord(40)).toBe('40');
  });

  it('says whose edition it is and since when', () => {
    expect(roomByline(room(), new Date('2026-11-11'))).toBe(
      'nitish’s edition · Member since September',
    );
    expect(roomByline(room(), new Date('2027-02-01'))).toBe(
      'nitish’s edition · Member since September 2026',
    );
  });
});

describe('lead', () => {
  it('sets the money in bold and values the shelf', () => {
    const lead = roomLead(
      room({
        shelf: Array.from({ length: 6 }, () => copy()),
        wanted: [{}, {}, {}],
        value: { total: '238.40', copies: 6 },
      }),
    );
    expect(text(lead)).toBe(
      'You have $1412.00 to spend and $125.00 set aside in three wanted ads. Your six records are worth about $238 at today’s best offers.',
    );
    expect(lead.filter((part) => part.bold).map((part) => part.bold)).toEqual([
      '$1412.00',
      '$125.00',
      '$238',
    ]);
  });

  it('says when only some records have a buyer, or none do, or the shelf is empty', () => {
    const shelf = [copy(), copy(), copy()];
    expect(text(roomLead(room({ shelf, value: { total: '10.00', copies: 1 } })))).toContain(
      'One of your records is worth about $10',
    );
    expect(text(roomLead(room({ shelf })))).toContain('Nobody has a wanted ad out');
    expect(text(roomLead(room()))).toContain('with nothing set aside. Bring in your Discogs');
  });
});

it('writes the counter tip', () => {
  const counter = { orderId: 9, release, price: '38.00', minGrade: 6, myGrade: 6 };
  expect(counterText(counter)).toBe(
    'Someone just asked for Night Ferry at $38.00, VG+ or better. Yours is VG+. Maybe one more listen before you let it go.',
  );
});

describe('shelf status', () => {
  it('describes every state a record can be in', () => {
    expect(shelfStatus(copy())).toBe('In your crate');
    expect(shelfStatus(copy({ imported: true }))).toBe('In your crate · from Discogs');
    expect(shelfStatus(copy({ status: 'listed', ask: { orderId: 2, price: '44.00' } }))).toBe(
      'Listed at $44.00',
    );
    expect(shelfStatus(copy({ status: 'in_trade', tradeStatus: 'awaiting_shipment' }))).toBe(
      'Sold: ship it',
    );
    expect(shelfStatus(copy({ status: 'in_trade', tradeStatus: 'shipped' }))).toBe(
      'Sold: on its way to the buyer',
    );
    expect(shelfStatus(incoming())).toBe('Bought: waiting for the seller to ship');
    expect(shelfStatus(incoming('shipped'))).toBe('On its way to you');
  });
});

describe('wanted ads', () => {
  const ad = (overrides = {}) => ({
    orderId: 1,
    release,
    price: '40.00',
    minGrade: 6,
    note: '',
    cheapest: '42.00',
    otherBuyers: 2,
    ...overrides,
  });

  it('reads like a classified', () => {
    expect(wantedLine(ad())).toBe('Night Ferry, 1979, VG+ or better. Up to $40.00.');
    expect(wantedLine(ad({ minGrade: 8, release: { ...release, year: null } }))).toBe(
      'Night Ferry, Mint only. Up to $40.00.',
    );
  });

  it('says how the market looks for it', () => {
    expect(wantedNote(ad())).toBe(
      'Cheapest VG+ or better copy is $42.00. Two others are waiting too.',
    );
    expect(wantedNote(ad({ cheapest: null, otherBuyers: 0 }))).toBe(
      'No copies yet. You’d be first in line.',
    );
    expect(wantedNote(ad({ otherBuyers: 1 }))).toContain('One other buyer is waiting too.');
  });
});

describe('ledger', () => {
  const trade = (overrides = {}) => ({
    id: 1,
    role: 'buyer',
    status: 'completed',
    grade: 6,
    price: '31.00',
    createdAt: '2026-10-27T15:00:00Z',
    release,
    ...overrides,
  });

  it('shows money out for a purchase and in for a sale', () => {
    expect(ledgerRow(trade())).toEqual({
      date: 'Oct 27',
      side: 'bought',
      amount: '−$31.00',
      status: 'Done',
      pending: false,
    });
    expect(ledgerRow(trade({ role: 'seller', status: 'awaiting_shipment' }))).toMatchObject({
      side: 'sold',
      amount: '+$31.00',
      status: 'Ship it',
      pending: true,
    });
  });

  it('shows a refund as money back to the buyer and nothing for the seller', () => {
    expect(ledgerRow(trade({ status: 'refunded' }))).toMatchObject({
      side: 'refund',
      amount: '+$31.00',
      status: 'Refunded',
    });
    expect(ledgerRow(trade({ role: 'seller', status: 'refunded' }))).toMatchObject({
      amount: '$0.00',
      pending: false,
    });
    expect(ledgerRow(trade({ status: 'awaiting_shipment' })).status).toBe('Waiting to ship');
  });
});
