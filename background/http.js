// fetch with a timeout and readable errors ("Genius search: HTTP 403").

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} from ${new URL(url).host}`);
    this.status = status;
  }
}

// Temporary server trouble (LRCLIB sometimes answers 503 and then works a moment later).
const RETRYABLE = new Set([429, 502, 503, 504]);

export function createHttp(fetchImpl = (...a) => fetch(...a), { timeoutMs = 8000, retryDelayMs = 600 } = {}) {
  async function request(url, opts = {}) {
    try {
      return await attempt(url, opts);
    } catch (err) {
      if (!RETRYABLE.has(err.status)) throw err;
      await new Promise((r) => setTimeout(r, retryDelayMs));
      return attempt(url, opts); // one retry
    }
  }

  async function attempt(url, opts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { ...opts, signal: ctrl.signal });
      if (!res.ok) throw new HttpError(res.status, url);
      return res;
    } catch (err) {
      if (err?.name === "AbortError") throw new Error(`timed out after ${timeoutMs / 1000}s (${new URL(url).host})`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    request,
    json: async (url, opts) => (await request(url, opts)).json(),
    text: async (url, opts) => (await request(url, opts)).text(),
    blob: async (url, opts) => (await request(url, opts)).blob(),
  };
}
