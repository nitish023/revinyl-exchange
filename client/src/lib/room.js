/**
 * Words for the Listening Room: the headline, the lead, the counter tip, and how each
 * record, wanted ad and trade is described. Pure, tested in room.test.js; pages/room.js
 * lays them out.
 */
import { gradeByRank } from '../../../shared/index.js';

const WORDS = [
  'No',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
];

/** Headlines spell small numbers out, like a paper would: 6 -> "Six", 40 -> "40". */
export const numberWord = (count) => WORDS[count] ?? String(count);

const records = (count) => `${numberWord(count)} ${count === 1 ? 'Record' : 'Records'}`;

/** The copies on the shelf and the records on their way, counted. */
export function shelfCounts(room) {
  return {
    onShelf: room.shelf.filter((item) => item.kind === 'copy').length,
    onTheWay: room.shelf.filter((item) => item.kind === 'incoming').length,
  };
}

/** "Six Records on the Shelf, Three More on the Way" */
export function roomHeadline(room) {
  const { onShelf, onTheWay } = shelfCounts(room);
  if (onShelf === 0 && onTheWay === 0) return 'An Empty Shelf, For Now';
  if (onTheWay === 0) return `${records(onShelf)} on the Shelf`;
  if (onShelf === 0) return `${records(onTheWay)} on the Way`;
  return `${records(onShelf)} on the Shelf, ${numberWord(onTheWay)} More on the Way`;
}

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long' });
const MONTH_YEAR = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });

/** "groovegarden’s edition · Member since September" (the year too, if it isn't this year). */
export function roomByline(room, now = new Date()) {
  const since = new Date(room.user.memberSince);
  const when =
    since.getFullYear() === now.getFullYear() ? MONTH.format(since) : MONTH_YEAR.format(since);
  return `${room.user.displayName}’s edition · Member since ${when}`;
}

const plural = (count, word, many = `${word}s`) =>
  `${numberWord(count).toLowerCase()} ${count === 1 ? word : many}`;

/**
 * The opening paragraph, as pieces so the page can set the money in bold:
 * [{ text }, { bold }, ...]
 */
export function roomLead(room) {
  const { onShelf } = shelfCounts(room);
  const ads = room.wanted.length;
  const parts = [
    { text: 'You have ' },
    { bold: `$${room.wallet.spendable}` },
    { text: ' to spend' },
  ];
  if (ads > 0) {
    parts.push(
      { text: ' and ' },
      { bold: `$${room.wallet.held}` },
      { text: ` set aside in ${plural(ads, 'wanted ad')}.` },
    );
  } else {
    parts.push({ text: ', with nothing set aside.' });
  }
  if (room.value) {
    const which =
      room.value.copies === onShelf
        ? `Your ${plural(onShelf, 'record')} ${onShelf === 1 ? 'is' : 'are'}`
        : `${numberWord(room.value.copies)} of your records ${room.value.copies === 1 ? 'is' : 'are'}`;
    parts.push(
      { text: ` ${which} worth about ` },
      { bold: `$${Math.round(Number(room.value.total))}` },
      { text: ' at today’s best offers.' },
    );
  } else if (onShelf > 0) {
    parts.push({ text: ' Nobody has a wanted ad out for what’s on your shelf yet.' });
  } else {
    parts.push({
      text: ' Bring in your Discogs collection, or add a copy from any pressing’s page.',
    });
  }
  return parts;
}

const code = (grade) => gradeByRank(grade).code;

/** The tip in the corner box: a wanted ad you could fill. */
export function counterText(counter) {
  const { title } = counter.release;
  return `Someone just asked for ${title} at $${counter.price}, ${code(counter.minGrade)} or better. Yours is ${code(counter.myGrade)}. Maybe one more listen before you let it go.`;
}

/** The line under each record on the shelf. */
export function shelfStatus(item) {
  if (item.kind === 'incoming') {
    return item.tradeStatus === 'shipped'
      ? 'On its way to you'
      : 'Bought: waiting for the seller to ship';
  }
  if (item.status === 'in_trade') {
    return item.tradeStatus === 'shipped' ? 'Sold: on its way to the buyer' : 'Sold: ship it';
  }
  if (item.ask) return `Listed at $${item.ask.price}`;
  return item.imported ? 'In your crate · from Discogs' : 'In your crate';
}

/** "Night Ferry, 1979, VG+ or better. Up to $40.00." */
export function wantedLine(ad) {
  const { title, year } = ad.release;
  const grade = ad.minGrade === 8 ? 'Mint only' : `${code(ad.minGrade)} or better`;
  return `${year ? `${title}, ${year}` : title}, ${grade}. Up to $${ad.price}.`;
}

/** "Cheapest VG+ or better copy is $42.00. Two others are waiting too." */
export function wantedNote(ad) {
  const market =
    ad.cheapest === null
      ? 'No copies yet. You’d be first in line.'
      : `Cheapest ${ad.minGrade === 8 ? 'Mint' : `${code(ad.minGrade)} or better`} copy is $${ad.cheapest}.`;
  if (ad.otherBuyers === 0) return market;
  const others =
    ad.otherBuyers === 1
      ? 'One other buyer is waiting too.'
      : `${numberWord(ad.otherBuyers)} others are waiting too.`;
  return `${market} ${others}`;
}

const SHORT_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit' });

/** One ledger row: what happened, the money, and where it stands. */
export function ledgerRow(trade) {
  const refunded = trade.status === 'refunded';
  const side = refunded ? 'refund' : trade.role === 'buyer' ? 'bought' : 'sold';
  let amount;
  if (trade.role === 'buyer') amount = refunded ? `+$${trade.price}` : `−$${trade.price}`;
  else amount = refunded ? '$0.00' : `+$${trade.price}`;
  const status = {
    awaiting_shipment: trade.role === 'seller' ? 'Ship it' : 'Waiting to ship',
    shipped: 'Shipped',
    completed: 'Done',
    refunded: 'Refunded',
  }[trade.status];
  return {
    date: SHORT_DATE.format(new Date(trade.createdAt)),
    side,
    amount,
    status,
    // A sale isn't money in hand until the buyer has the record.
    pending: trade.role === 'seller' && !refunded && trade.status !== 'completed',
  };
}
