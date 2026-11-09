/**
 * How the rest of the server tells browsers that something changed. Part 3 (orders)
 * calls these after a transaction commits; Part 4 sends the messages over WebSocket.
 *
 * This base class does nothing, so code can call it before Part 4 is merged, and tests
 * can use RecordingLiveUpdates (server/test/helpers.js) to check what was announced.
 */
export class LiveUpdates {
  /**
   * The ads, wanted ads or sales for a pressing changed. Call once per committed change;
   * several calls close together are sent as one update.
   * @param {number} _releaseId
   */
  marketChanged(_releaseId) {}

  /**
   * Something private to one user changed. Only that user's open tabs get it.
   * @param {number} _userId
   * @param {{ type: 'order' | 'trade' | 'wallet', releaseId?: number, [key: string]: unknown }} _message
   */
  notifyUser(_userId, _message) {}

  /**
   * A session logged out: stop sending its private messages anywhere.
   * @param {string} _sessionId sessionIdFor(token) from server/src/auth/sessions.js
   */
  sessionEnded(_sessionId) {}
}
