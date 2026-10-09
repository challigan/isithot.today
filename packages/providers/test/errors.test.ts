import { describe, expect, it } from 'vitest';
import { MODELS } from '@isithot/core';
import {
  FORECAST_TIMING,
  OPEN_METEO_FREE,
  ProviderError,
  errorMessage,
  fetchClimateNormals,
  fetchForecast,
  fetchJson,
  sanitise,
  type FetchLike,
} from '../src';

const URL_ = 'https://api.test/v1/forecast?latitude=1&longitude=2&apikey=s3cret';
const json = (body: unknown, status = 200, statusText = '') =>
  new Response(JSON.stringify(body), { status, statusText });
/** Never answers, and ignores the abort signal (the deadline must hold anyway). */
const stall = () => new Promise<Response>(() => {});
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fetch that answers call n with replies[n] (the last reply repeats), recording each call. */
function scripted(...replies: Array<(init?: RequestInit) => Promise<Response>>) {
  const signals: Array<AbortSignal | undefined> = [];
  const fetcher: FetchLike = (_url, init) => {
    signals.push(init?.signal ?? undefined);
    const reply = replies[Math.min(signals.length, replies.length) - 1]!;
    return reply(init);
  };
  return { fetcher, signals };
}

const failure = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: ProviderError) => e,
  );

describe('sanitise and errorMessage', () => {
  it('drops the API key and control characters, and keeps the end of long text', () => {
    expect(sanitise('bad request: apikey=s3cret&x=1\n\tend')).toBe(
      'bad request: apikey=***&x=1 end',
    );
    expect(sanitise('{"APIKEY": "s3cret"}')).toBe('{"apikey=***"}');
    const long = `{"hourly":{"time":[${'1,'.repeat(200)}Unexpected error while streaming data: timeoutReached`;
    const short = sanitise(long, 60);
    expect(short).toHaveLength(60);
    expect(short.startsWith('…')).toBe(true);
    expect(short.endsWith('Unexpected error while streaming data: timeoutReached')).toBe(true);
  });

  it("gives an Error's own message, or the value as text", () => {
    expect(errorMessage(new ProviderError('p', 'went wrong'))).toBe('p: went wrong');
    expect(errorMessage('plain')).toBe('plain');
  });
});

describe('fetchJson', () => {
  it('says why a response failed: reason, message, status text or network cause', async () => {
    const reason = await failure(
      fetchJson(
        'p',
        async () => json({ error: true, reason: 'Bad apikey=s3cret' }, 400),
        URL_,
        100,
      ),
    );
    expect(reason?.message).toBe('p: HTTP 400 Bad apikey=***');
    expect(reason?.status).toBe(400);
    expect(reason?.reason).toBe('HTTP 400 Bad apikey=***');

    const message = await failure(
      fetchJson('p', async () => json({ message: 'Too many requests' }, 429), URL_, 100),
    );
    expect(message?.message).toBe('p: HTTP 429 Too many requests');

    const page = async () =>
      new Response('<html>oops</html>', { status: 502, statusText: 'Bad Gateway' });
    expect((await failure(fetchJson('p', page, URL_, 100)))?.message).toBe(
      'p: HTTP 502 Bad Gateway',
    );
    // A JSON body without a usable reason falls back to the status text too.
    const odd = async () => json({ reason: 42 }, 500, 'Internal Server Error');
    expect((await failure(fetchJson('p', odd, URL_, 100)))?.message).toBe(
      'p: HTTP 500 Internal Server Error',
    );
    const nothing = async () => json(null, 503);
    expect((await failure(fetchJson('p', nothing, URL_, 100)))?.message).toBe('p: HTTP 503');

    const refused = async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    };
    expect((await failure(fetchJson('p', refused, URL_, 100)))?.message).toBe(
      'p: network error: TypeError: fetch failed (ECONNREFUSED)',
    );
    const tls = async () => {
      throw new TypeError('fetch failed', { cause: new Error('certificate has expired') });
    };
    expect((await failure(fetchJson('p', tls, URL_, 100)))?.message).toBe(
      'p: network error: TypeError: fetch failed (certificate has expired)',
    );
    const odder = async () => {
      throw 'boom';
    };
    expect((await failure(fetchJson('p', odder, URL_, 100)))?.message).toBe(
      'p: network error: boom',
    );
  });

  it("quotes a 200 body that is not JSON, such as Open-Meteo's own timeout", async () => {
    const text = async () => new Response('Unexpected error while streaming data: timeoutReached');
    const err = await failure(fetchJson('open-meteo', text, URL_, 100));
    expect(err?.message).toBe(
      'open-meteo: invalid JSON (HTTP 200): "Unexpected error while streaming data: timeoutReached"',
    );
    expect(err?.status).toBe(200);
  });

  it('reports a body that breaks off part way', async () => {
    const broken = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"hourly":'));
            controller.error(new Error('socket hang up'));
          },
        }),
      );
    expect((await failure(fetchJson('p', broken, URL_, 100)))?.message).toBe(
      'p: network error: Error: socket hang up reading HTTP 200',
    );
  });

  it('times out a stalled request, and a body that stalls after the headers', async () => {
    expect((await failure(fetchJson('p', stall, URL_, 20)))?.message).toBe(
      'p: timed out after 20ms',
    );
    const headersOnly = async () => new Response(new ReadableStream({ start() {} }));
    const err = await failure(fetchJson('p', headersOnly, URL_, 20));
    expect(err?.message).toBe('p: timed out after 20ms');
    expect(err?.status).toBeNull();
  });

  it('makes one request when the first answers in time', async () => {
    const { fetcher, signals } = scripted(async () => json({ ok: 1 }));
    expect(await fetchJson('p', fetcher, URL_, 300, 20)).toEqual({ ok: 1 });
    await wait(40); // past the hedge delay: no second request
    expect(signals).toHaveLength(1);
  });

  it('sends a second request when the first is slow, and takes whichever answers', async () => {
    const { fetcher, signals } = scripted(stall, async () => json({ ok: 2 }));
    expect(await fetchJson('p', fetcher, URL_, 300, 20)).toEqual({ ok: 2 });
    expect(signals).toHaveLength(2);
    // The slow one is cancelled.
    expect(signals[0]!.aborted).toBe(true);
  });

  it('retries at once after a quick failure, without waiting for the hedge delay', async () => {
    const text = async () => new Response('Unexpected error while streaming data: timeoutReached');
    const { fetcher, signals } = scripted(text, async () => json({ ok: 2 }));
    const started = Date.now();
    expect(await fetchJson('p', fetcher, URL_, 1000, 500)).toEqual({ ok: 2 });
    expect(Date.now() - started).toBeLessThan(400);
    expect(signals).toHaveLength(2);
  });

  it('waits for the first request when the second fails', async () => {
    let answer: (r: Response) => void = () => {};
    const first = () => new Promise<Response>((resolve) => (answer = resolve));
    const { fetcher, signals } = scripted(first, async () => {
      setTimeout(() => answer(json({ ok: 1 })), 10);
      return new Response('down', { status: 503 });
    });
    expect(await fetchJson('p', fetcher, URL_, 300, 20)).toEqual({ ok: 1 });
    expect(signals).toHaveLength(2);
  });

  it('gives up on a 4xx without retrying, even with a request still running', async () => {
    const once = scripted(async () => json({ error: true, reason: 'Invalid model' }, 400));
    expect((await failure(fetchJson('p', once.fetcher, URL_, 300, 20)))?.message).toBe(
      'p: HTTP 400 Invalid model',
    );
    await wait(40);
    expect(once.signals).toHaveLength(1);

    const limited = scripted(stall, async () => json({ reason: 'Daily limit exceeded' }, 429));
    const started = Date.now();
    const err = await failure(fetchJson('p', limited.fetcher, URL_, 1000, 20));
    expect(err?.message).toBe('p: HTTP 429 Daily limit exceeded (2 attempts)');
    expect(err?.status).toBe(429);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('lists every failure when both requests fail', async () => {
    const twice = scripted(
      async () => new Response('', { status: 502, statusText: 'Bad Gateway' }),
      async () => new Response('Unexpected error while streaming data: timeoutReached'),
    );
    const err = await failure(fetchJson('open-meteo', twice.fetcher, URL_, 300, 20));
    expect(err?.message).toBe(
      'open-meteo: HTTP 502 Bad Gateway, then invalid JSON (HTTP 200): "Unexpected error while streaming data: timeoutReached" (2 attempts)',
    );
    expect(err?.status).toBe(200);

    const stalled = scripted(stall);
    expect((await failure(fetchJson('p', stalled.fetcher, URL_, 60, 20)))?.message).toBe(
      'p: timed out after 60ms (2 attempts)',
    );
    expect(stalled.signals.every((s) => s!.aborted)).toBe(true);

    const same = scripted(async () => new Response('', { status: 503 }));
    expect((await failure(fetchJson('p', same.fetcher, URL_, 300, 20)))?.message).toBe(
      'p: HTTP 503 (2 attempts)',
    );

    const thenStall = scripted(async () => new Response('', { status: 500 }), stall);
    expect((await failure(fetchJson('p', thenStall.fetcher, URL_, 60, 20)))?.message).toBe(
      'p: HTTP 500, then timed out after 60ms (2 attempts)',
    );
  });

  it('does not hedge requests that do not ask for it', async () => {
    const { fetcher, signals } = scripted(async () => new Response('', { status: 502 }));
    await expect(
      fetchClimateNormals(
        { url: 'https://nasa.test/climatology', fetch: fetcher },
        { lat: 0, lon: 0 },
      ),
    ).rejects.toThrow('nasa-power: HTTP 502');
    expect(signals).toHaveLength(1);
  });
});

describe('fetchForecast timing', () => {
  it('hedges forecasts within the old six-second budget', () => {
    expect(FORECAST_TIMING).toEqual({ timeoutMs: 6000, hedgeAfterMs: 2000 });
  });

  it('sends a second forecast request when the first is slow', async () => {
    const synthetic = scripted(stall, async () => json({ timezone: 'UTC', hourly: { time: [] } }));
    const forecast = await fetchForecast(
      { ...OPEN_METEO_FREE, fetch: synthetic.fetcher, timeoutMs: 300, hedgeAfterMs: 20 },
      { lat: 0, lon: 0 },
      MODELS,
    );
    expect(forecast.timezone).toBe('UTC');
    expect(synthetic.signals).toHaveLength(2);
  });
});
