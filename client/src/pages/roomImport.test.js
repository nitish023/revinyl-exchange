import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../lib/api.js';
import { session } from '../session.js';
import { roomImportPage } from './roomImport.js';

vi.mock('../lib/api.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, api: { collectionPreview: vi.fn(), importCollection: vi.fn() } };
});

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const text = (node) => node.textContent.replace(/\s+/g, ' ').trim();

const item = (instanceId, overrides = {}) => ({
  instanceId,
  addedAt: '2026-10-30T10:54:13-08:00',
  release: {
    id: instanceId,
    title: `Record ${instanceId}`,
    artist: 'Someone',
    year: 1979,
    label: 'Orbit',
    catno: `ORB-${instanceId}`,
    formats: ['Vinyl', 'LP'],
    thumbUrl: null,
  },
  grade: 6,
  sleeveGrade: 5,
  alreadyImported: false,
  ...overrides,
});

function page() {
  const element = roomImportPage({
    params: {},
    query: new URLSearchParams(),
    signal: new AbortController().signal,
    navigate: vi.fn(),
  });
  document.body.replaceChildren(element);
  return element;
}

async function lookUp(element, username = 'digger') {
  element.querySelector('#discogs-username').value = username;
  element.querySelector('.import-lookup').dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  session.set({ id: 1, displayName: 'alice' });
  api.collectionPreview.mockResolvedValue({
    username: 'digger',
    items: [
      item(1),
      item(2, { grade: 7, sleeveGrade: 'generic' }),
      item(3, { grade: null, sleeveGrade: null }),
      item(4, { alreadyImported: true }),
    ],
    skipped: 1,
    more: false,
    crateRoom: 296,
  });
});
afterEach(() => session.set(null));

describe('roomImportPage', () => {
  it('checks the username before asking Discogs', async () => {
    const element = page();
    await lookUp(element, 'not a name');
    expect(api.collectionPreview).not.toHaveBeenCalled();
    expect(text(element.querySelector('#discogs-username-error'))).toMatch(/letters, numbers/);
  });

  it('shows the server’s message when there is no such user', async () => {
    api.collectionPreview.mockRejectedValue(
      new ApiError(404, 'DISCOGS_USER_NOT_FOUND', 'Discogs has no user called digger.', {
        username: 'Discogs has no user called digger.',
      }),
    );
    const element = page();
    await lookUp(element);
    expect(text(element.querySelector('#discogs-username-error'))).toBe(
      'Discogs has no user called digger.',
    );
  });

  it('lists the records with Discogs’ grades filled in and imported ones locked', async () => {
    const element = page();
    await lookUp(element);
    expect(api.collectionPreview).toHaveBeenCalledWith('digger', expect.anything());
    const rows = [...element.querySelectorAll('.import-row')];
    expect(rows).toHaveLength(4);
    const selects = (row) => [...row.querySelectorAll('select')].map((select) => select.value);
    expect(selects(rows[0])).toEqual(['6', '5']);
    expect(selects(rows[1])).toEqual(['7', 'generic']);
    expect(selects(rows[2])).toEqual(['', '']);
    expect(rows[3].querySelector('input').disabled).toBe(true);
    expect(text(element.querySelector('.import-count'))).toBe('3 of 3 ticked');
    expect(text(element.querySelector('.import-summary'))).toContain('left out 1');
  });

  it('asks for the grades that are missing before importing', async () => {
    const element = page();
    await lookUp(element);
    element
      .querySelector('.import-preview')
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(api.importCollection).not.toHaveBeenCalled();
    expect(text(element.querySelector('.import-preview .form-banner'))).toMatch(
      /Pick a record grade for one record/,
    );
    expect(text(element.querySelectorAll('.import-row')[2])).toContain('Pick a grade');
  });

  it('imports the ticked records with the chosen grades', async () => {
    api.importCollection.mockResolvedValue({ imported: 2, alreadyImported: 0 });
    const element = page();
    await lookUp(element);
    const rows = [...element.querySelectorAll('.import-row')];
    rows[2].querySelector('input').checked = false; // leave out the ungraded one
    rows[2].querySelector('input').dispatchEvent(new Event('change'));
    rows[0].querySelector('select').value = '7';

    element
      .querySelector('.import-preview')
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();

    expect(api.importCollection).toHaveBeenCalledWith({
      username: 'digger',
      items: [
        { instanceId: 1, grade: 7, sleeveGrade: 5 },
        { instanceId: 2, grade: 7, sleeveGrade: null },
      ],
    });
    expect(text(element.querySelector('.import-done'))).toContain('2 records are on your shelf.');
    expect(element.querySelector('.import-done a').getAttribute('href')).toBe('/room');
  });
});
