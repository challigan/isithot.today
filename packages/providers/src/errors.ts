export class ProviderError extends Error {
  readonly provider: string;
  readonly status: number | null;

  constructor(provider: string, message: string, status: number | null = null) {
    super(`${provider}: ${message}`);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** fetch with a timeout; throws ProviderError on network failure, timeout or non-2xx. */
export async function fetchJson(
  provider: string,
  fetcher: FetchLike,
  url: string,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetcher(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'isithot.today/1.0' },
    });
  } catch (err) {
    const reason = controller.signal.aborted ? `timed out after ${timeoutMs}ms` : String(err);
    throw new ProviderError(provider, reason);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    let detail = '';
    try {
      const body = (await response.json()) as { reason?: string; message?: string };
      detail = body.reason ?? body.message ?? '';
    } catch {
      // Body was not JSON; the status is enough.
    }
    throw new ProviderError(provider, `HTTP ${response.status} ${detail}`.trim(), response.status);
  }
  try {
    return await response.json();
  } catch {
    throw new ProviderError(provider, 'invalid JSON', response.status);
  }
}
