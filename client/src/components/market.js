/**
 * A pressing's market (Part 4): the CLASSIFIEDS column (FOR SALE ads by grade, then the
 * WANTED ads) and the MARKET REPORT under the record. The page creates it once and calls
 * show() with every new market, from the API first and then from the live connection.
 * Ads that weren't there last time are marked .is-new, so a new listing is noticeable.
 */
import { gradeByRank } from '../../../shared/index.js';
import { h, replaceChildren } from '../dom.js';
import {
  adCount,
  adLead,
  adText,
  buyerLine,
  gradeSection,
  money,
  orderIds,
  priceChange,
  sellerLine,
  shortDate,
  shortMoney,
  wantedLead,
} from '../lib/market.js';
import { adActions } from './adActions.js';
import { adCoupons } from './adCoupons.js';
import { gradeScale } from './gradeScale.js';
import { errorState, loadingState } from './states.js';

const STATUS_TEXT = {
  idle: '',
  connecting: 'Connecting to the newsroom…',
  live: 'Live: new ads appear as they’re placed',
  reconnecting: 'Reconnecting… prices may be a moment old',
};

function adArticle({ orderId, lead, text, who, price, mine, fresh, actions }) {
  return h(
    'article',
    {
      class: ['ad', mine ? 'ad--mine' : null, fresh ? 'is-new' : null].filter(Boolean).join(' '),
      'data-order-id': orderId,
    },
    h(
      'p',
      { class: 'ad-body' },
      h('b', { class: 'ad-lead' }, lead),
      text ? ` ${text} ` : ' ',
      h('i', {}, who),
    ),
    h(
      'p',
      { class: 'ad-foot' },
      h('span', { class: 'ad-price' }, price),
      mine ? h('span', { class: 'ad-tag' }, 'Your ad') : actions,
    ),
  );
}

function sectionHead(code, name, meaning) {
  return h(
    'div',
    { class: 'ad-section' },
    h('h3', {}, h('span', { class: 'ad-section-code' }, code), ' ', name),
    h('p', {}, meaning),
  );
}

/**
 * `actionsFor(ad, kind, mine)` gives the buttons for one ad (Part 5's adActions), or null.
 */
function classifiedColumns(market, mine, isFresh, actionsFor) {
  const forSale = market.forSale.flatMap(({ grade, ads }) => {
    const { code, name, meaning } = gradeSection(grade);
    return [
      sectionHead(code, name, meaning),
      ...ads.map((ad) =>
        adArticle({
          orderId: ad.orderId,
          lead: adLead(ad),
          text: adText(ad),
          who: sellerLine(ad.seller),
          price: money(ad.price),
          mine: mine.has(ad.orderId),
          fresh: isFresh(ad.orderId),
          actions: actionsFor(ad, 'forSale', mine.has(ad.orderId)),
        }),
      ),
    ];
  });
  const wanted = market.wanted.length
    ? [
        sectionHead('★', 'WANTED TO BUY', 'Money set aside. Sell to them right away.'),
        ...market.wanted.map((ad) =>
          adArticle({
            orderId: ad.orderId,
            lead: wantedLead(ad.minGrade),
            text: ad.note.trim(),
            who: buyerLine(ad.buyer),
            price: `Up to ${money(ad.price)}`,
            mine: mine.has(ad.orderId),
            fresh: isFresh(ad.orderId),
            actions: actionsFor(ad, 'wanted', mine.has(ad.orderId)),
          }),
        ),
      ]
    : [];
  return [...forSale, ...wanted];
}

function emptyMarket() {
  return h(
    'div',
    { class: 'market-empty' },
    h('p', { class: 'state-title' }, 'No copies on the shelf yet'),
    h(
      'p',
      { class: 'state-hint' },
      'Copies for sale and wanted ads for this pressing will run here, cheapest first.',
    ),
  );
}

function reportFigures(report) {
  if (report.byGrade.length === 0) {
    return h('p', { class: 'report-none' }, 'No sales on reVINYL in the past 30 days.');
  }
  return h(
    'div',
    { class: 'report-figures' },
    report.byGrade.map((row) =>
      h(
        'div',
        { class: 'report-figure' },
        h('span', { class: 'label' }, gradeByRank(row.grade).label),
        h(
          'div',
          { class: 'report-numbers' },
          h('span', { class: 'report-price' }, shortMoney(row.last)),
          row.change ? h('span', { class: 'report-change' }, priceChange(row.change)) : null,
        ),
        h(
          'span',
          { class: 'report-range' },
          row.sales === 1
            ? 'Last sale · only one this month'
            : `Last sale · range ${shortMoney(row.low)} to ${shortMoney(row.high)}`,
        ),
      ),
    ),
  );
}

function reportSales(report) {
  const summary = h(
    'dl',
    { class: 'report-summary' },
    h('dt', {}, 'Best wanted ad'),
    h(
      'dd',
      {},
      report.highestBid
        ? `${money(report.highestBid.price)}, ${gradeByRank(report.highestBid.minGrade).code} or better`
        : 'None running',
    ),
    h('dt', {}, 'Cheapest copy'),
    h(
      'dd',
      {},
      report.lowestAsk
        ? `${money(report.lowestAsk.price)}, ${gradeByRank(report.lowestAsk.grade).code}`
        : 'None for sale',
    ),
  );
  const sales = report.recentSales.length
    ? h(
        'table',
        { class: 'sales-table' },
        h('caption', { class: 'visually-hidden' }, 'Recent sales of this pressing'),
        h(
          'thead',
          { class: 'visually-hidden' },
          h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Grade'), h('th', {}, 'Price')),
        ),
        h(
          'tbody',
          {},
          report.recentSales.map((sale) =>
            h(
              'tr',
              {},
              h('td', {}, shortDate(sale.soldAt)),
              h('td', {}, gradeByRank(sale.grade).code),
              h('td', {}, money(sale.price)),
            ),
          ),
        ),
      )
    : h('p', { class: 'report-none' }, 'Nothing has sold yet.');
  return h(
    'div',
    { class: 'report-sales' },
    h('span', { class: 'label' }, 'Recent sales'),
    sales,
    summary,
  );
}

/**
 * @param {{ release: { id: number, title: string, artist: string },
 *   user: () => ({ id: number, displayName: string } | null), onPosted: () => void }} options
 */
export function marketSection({ release, user, onPosted }) {
  const count = h('p', {}, 'Cheapest first in each grade');
  const status = h('p', { class: 'live-status', role: 'status' });
  // What the last Buy / Sell to them did (Part 5's adActions report it here).
  const flash = h('p', { class: 'coupon-flash', role: 'status' });
  const body = h('div', { class: 'market-body' }, loadingState('Reading the classifieds…'));
  const coupons = h('div', { class: 'market-coupons' });

  const classifieds = h(
    'section',
    { class: 'release-market', 'aria-labelledby': 'classifieds-title' },
    h('div', { class: 'section-head' }, h('h2', { id: 'classifieds-title' }, 'Classifieds'), count),
    h(
      'div',
      { class: 'market-guide' },
      gradeScale(),
      h(
        'p',
        {},
        'Grades run Poor to Mint. Most collectors buy ',
        h('b', {}, 'VG+'),
        ' or better: marks you can see but not hear.',
      ),
    ),
    status,
    flash,
    body,
    coupons,
  );

  const actionsFor = (ad, kind, mine) =>
    adActions({
      release,
      ad,
      kind,
      user: user(),
      mine,
      onDone: (message) => {
        flash.textContent = message;
        onPosted();
      },
    });

  const reportBody = h('div', { class: 'report-grid' });
  const report = h(
    'section',
    { class: 'market-report', 'aria-labelledby': 'report-title', hidden: true },
    h(
      'div',
      { class: 'section-head' },
      h('h2', { id: 'report-title' }, 'Market Report'),
      h('p', {}, `What ${release.title} really sold for on reVINYL, past 30 days`),
    ),
    reportBody,
  );

  let shown = null;

  return {
    classifieds,
    report,

    /** Draw a market. `mine` is the ids of your own open orders. */
    show(market, mine = new Set()) {
      const before = shown ? orderIds(shown) : null;
      const isFresh = (orderId) => before !== null && !before.has(orderId);
      shown = market;
      count.textContent = adCount(market);
      const columns = classifiedColumns(market, mine, isFresh, actionsFor);
      replaceChildren(
        body,
        columns.length ? h('div', { class: 'classifieds' }, columns) : emptyMarket(),
      );
      replaceChildren(reportBody, reportFigures(market.report), reportSales(market.report));
      report.hidden = false;
    },

    /** The ad forms (Part 3). Redrawn when you log in or out. */
    showCoupons() {
      replaceChildren(coupons, adCoupons({ release, user: user(), onPosted }));
    },

    showError(message, retry) {
      count.textContent = 'Cheapest first in each grade';
      replaceChildren(body, errorState(message, retry));
    },

    setStatus(value) {
      status.textContent = STATUS_TEXT[value] ?? '';
      status.dataset.status = value;
    },
  };
}
