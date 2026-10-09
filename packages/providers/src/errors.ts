export class ProviderError extends Error {
  readonly provider: string;
  readonly status: number | null;
  /** What went wrong, without the provider's name. */
  readonly reason: string;

  constructor(provider: string, message: string, status: number | null = null) {
    super(`${provider}: ${message}`);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
    this.reason = message;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** An error's message (an Error's own message, without its class name). */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Upstream text made safe for logs and error bodies: no API key (the paid plan sends it in the
 * query string), no control characters, and at most `max` characters. A long text keeps its
 * end, where a response that broke off part way says why.
 */
export function sanitise(text: string, max = 160): string {
  const clean = text
    .replace(/apikey["']?\s*[=:]\s*["']?[^&\s"',}]*/gi, 'apikey=***')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim();
  return clean.length <= max ? clean : `…${clean.slice(1 - max)}`;
}

function networkReason(err: unknown): string {
  const cause = (err as { cause?: { code?: unknown; message?: unknown } } | null)?.cause;
  const detail = cause?.code ?? cause?.message;
  return sanitise(
    `network error: ${String(err)}${typeof detail === 'string' ? ` (${detail})` : ''}`,
  );
}

/** Open-Meteo's `reason` (or another API's `message`) from a JSON error body. */
function reasonIn(text: string): string | null {
  try {
    const body = JSON.parse(text) as { reason?: unknown; message?: unknown } | null;
    const reason = body?.reason ?? body?.message;
    return typeof reason === 'string' ? sanitise(reason) : null;
  } catch {
    return null;
  }
}

/** A promise that rejects once `signal` aborts (and never counts as unhandled). */
function whenAborted(signal: AbortSignal): Promise<never> {
  const aborted = new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  aborted.catch(() => {});
  return aborted;
}

/** One request, read to the end. Rejects with a ProviderError, or with the abort reason. */
async function attempt(
  provider: string,
  fetcher: FetchLike,
  url: string,
  signal: AbortSignal,
): Promise<unknown> {
  // Raced against the signal too, so the deadline holds even for a fetch that ignores it.
  const aborted = whenAborted(signal);
  let response: Response;
  try {
    response = await Promise.race([
      fetcher(url, {
        signal,
        headers: { accept: 'application/json', 'user-agent': 'isithot.today/1.0' },
      }),
      aborted,
    ]);
  } catch (err) {
    if (signal.aborted) throw signal.reason;
    throw new ProviderError(provider, networkReason(err));
  }
  // The deadline covers the body as well: a server can send its headers and then stall.
  let text: string;
  try {
    text = await Promise.race([response.text(), aborted]);
  } catch (err) {
    if (signal.aborted) throw signal.reason;
    throw new ProviderError(
      provider,
      `${networkReason(err)} reading HTTP ${response.status}`,
      response.status,
    );
  }
  if (!response.ok) {
    const reason = reasonIn(text) ?? sanitise(response.statusText);
    throw new ProviderError(provider, `HTTP ${response.status} ${reason}`.trim(), response.status);
  }
  try {
    return JSON.parse(text);
  } catch {
    // Open-Meteo streams its JSON: a failure on its side after the 200 has gone out arrives
    // as plain text, e.g. "Unexpected error while streaming data: timeoutReached".
    throw new ProviderError(
      provider,
      `invalid JSON (HTTP ${response.status}): "${sanitise(text)}"`,
      response.status,
    );
  }
}

/** A 4xx (bad request, bad key, rate limited) will not change on a second try. */
const isClientError = (err: unknown): boolean =>
  err instanceof ProviderError && err.status !== null && err.status >= 400 && err.status < 500;

interface Failed {
  /** What each finished attempt failed with, in order. */
  failures: unknown[];
  /** How many attempts were started. */
  attempts: number;
}

/**
 * Starts `run`, and starts it a second time if the first has not succeeded `hedgeAfterMs` in
 * (or sooner, if it fails first with an error worth retrying). The first success wins. Rejects
 * with a `Failed` once nothing is left running, or at once on an error not worth retrying.
 */
function hedged<T>(
  run: () => Promise<T>,
  hedgeAfterMs: number | undefined,
  retryable: (err: unknown) => boolean,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const failures: unknown[] = [];
    let started = 0;
    let running = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = (): void => {
      clearTimeout(timer);
      started++;
      running++;
      run().then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err: unknown) => {
          running--;
          failures.push(err);
          const again = retryable(err);
          if (again && started < 2 && hedgeAfterMs !== undefined) return start();
          if (!again || running === 0) {
            // Settled: the hedge must not start now.
            clearTimeout(timer);
            reject({ failures, attempts: started } satisfies Failed);
          }
        },
      );
    };
    start();
    if (hedgeAfterMs !== undefined) timer = setTimeout(start, hedgeAfterMs);
  });
}

/**
 * fetch with a deadline; throws ProviderError on network failure, timeout, non-2xx or a body
 * that is not JSON, saying which.
 *
 * `timeoutMs` covers everything, the body included. With `hedgeAfterMs`, a second identical
 * request starts if the first has not answered by then (or has already failed with anything but
 * a 4xx), and whichever succeeds first wins: one slow or broken response no longer decides the
 * outcome on its own.
 */
export async function fetchJson(
  provider: string,
  fetcher: FetchLike,
  url: string,
  timeoutMs: number,
  hedgeAfterMs?: number,
): Promise<unknown> {
  const controllers: AbortController[] = [];
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    for (const c of controllers) c.abort();
  }, timeoutMs);
  const run = (): Promise<unknown> => {
    const controller = new AbortController();
    controllers.push(controller);
    return attempt(provider, fetcher, url, controller.signal);
  };
  try {
    return await hedged(run, hedgeAfterMs, (err) => !timedOut && !isClientError(err));
  } catch (failed) {
    const { failures, attempts } = failed as Failed;
    const errors = failures.filter((e): e is ProviderError => e instanceof ProviderError);
    const reasons = errors.map((e) => e.reason);
    if (timedOut) reasons.push(`timed out after ${timeoutMs}ms`);
    // The same failure twice reads once: "HTTP 503 (2 attempts)".
    throw new ProviderError(
      provider,
      [...new Set(reasons)].join(', then ') + (attempts > 1 ? ` (${attempts} attempts)` : ''),
      errors.at(-1)?.status ?? null,
    );
  } finally {
    clearTimeout(timer);
    // Stop whichever request lost the race.
    for (const c of controllers) c.abort();
  }
}
