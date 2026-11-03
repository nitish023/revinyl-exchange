/**
 * Every page is a function that gets a context and returns the element to show.
 *
 * @typedef {object} PageContext
 * @property {Record<string, string>} params route parameters, e.g. { id: '249504' }
 * @property {URLSearchParams} query the address bar's ?query
 * @property {AbortSignal} signal aborted when the user leaves the page, so late
 *   responses don't paint the wrong page
 * @property {(to: string, options?: { replace?: boolean }) => void} navigate
 *
 * @typedef {(ctx: PageContext) => HTMLElement} Page
 */
export {};
