/**
 * Sends an API request over the network. The demo build swaps this module for
 * `src/demo/transport.ts` (vite.config.ts), which answers from the API running in the browser.
 */
export function send(path: string, init: RequestInit): Promise<Response> {
  return fetch(`/api${path}`, init);
}

/** Only the demo build has local data to reset. */
export function resetDemo(): Promise<void> {
  return Promise.reject(new Error('Not a demo build'));
}
