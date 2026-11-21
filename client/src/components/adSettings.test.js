// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { adSettings, adSettingsLine } from './adSettings.js';

describe('adSettings', () => {
  it('starts a WANTED ad at 30 days and a FOR SALE ad at until-cancelled, with no rule', () => {
    expect(adSettings('bid').collect()).toEqual({
      expiresInDays: 30,
      repriceStep: '',
      repriceLimit: '',
    });
    expect(adSettings('ask').collect()).toEqual({
      expiresInDays: null,
      repriceStep: '',
      repriceLimit: '',
    });
  });

  it('collects a chosen length and a rule', () => {
    const { fields, collect } = adSettings('ask');
    const [runsFor, step, limit] = fields.map((field) => field.control);
    runsFor.value = '7';
    step.value = '1.00';
    limit.value = '30';
    expect(collect()).toEqual({ expiresInDays: 7, repriceStep: '1.00', repriceLimit: '30' });
    expect(fields.map((field) => field.name)).toEqual([
      'expiresInDays',
      'repriceStep',
      'repriceLimit',
    ]);
  });
});

describe('adSettingsLine', () => {
  it('describes an ad’s expiry and rule in a line', () => {
    expect(
      adSettingsLine({
        side: 'ask',
        expiresAt: '2026-12-20T12:00:00.000Z',
        reprice: { step: '1.00', limit: '30.00' },
      }),
    ).toBe('Runs to Dec 20 · stays $1.00 under cheaper copies, down to $30.00');
    expect(
      adSettingsLine({ side: 'bid', expiresAt: null, reprice: { step: '0.50', limit: '60.00' } }),
    ).toBe('Stays $0.50 over higher offers, up to $60.00');
    expect(adSettingsLine({ side: 'ask', expiresAt: null, reprice: null })).toBe('');
  });
});
