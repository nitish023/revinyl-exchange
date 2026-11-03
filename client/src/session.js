/** Who is logged in. Pages and the nav bar subscribe to changes. */

import { api } from './lib/api.js';

class Session {
  current = null;
  listeners = new Set();

  get user() {
    return this.current;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Ask the server who we are. A failure just means "not logged in". */
  async load() {
    try {
      this.set((await api.me()).user);
    } catch {
      this.set(null);
    }
  }

  async login(input) {
    this.set((await api.login(input)).user);
  }

  async register(input) {
    this.set((await api.register(input)).user);
  }

  async logout() {
    await api.logout();
    this.set(null);
  }

  set(user) {
    this.current = user;
    for (const listener of this.listeners) listener(user);
  }
}

export const session = new Session();
