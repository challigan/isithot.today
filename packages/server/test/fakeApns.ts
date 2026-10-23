import {
  createServer,
  type Http2Server,
  type IncomingHttpHeaders,
  type ServerHttp2Session,
  type Settings,
} from 'node:http2';
import type { AddressInfo } from 'node:net';

export interface Seen {
  headers: IncomingHttpHeaders;
  body: string;
  /** How many pushes were waiting for an answer when this one arrived, itself included. */
  inFlight: number;
}

export type FakeReply = { status: number; body?: object | string } | 'hang';

/** Every fake started, for the tests' `afterEach` to close. */
export const servers: Http2Server[] = [];
const open = new WeakMap<Http2Server, Set<ServerHttp2Session>>();

/**
 * A fake APNs over h2c: answers each push with `answer(headers, body)`, as Apple does (a JSON
 * body only for refusals), and keeps what it was sent. `settings` are the server's HTTP/2 settings
 * (its maximum concurrent streams, say); `delayMs` holds each answer back, so pushes overlap.
 */
export async function fakeApns(
  answer: (headers: IncomingHttpHeaders, body: string) => FakeReply | Promise<FakeReply>,
  { settings, delayMs = 0 }: { settings?: Settings; delayMs?: number } = {},
) {
  const seen: Seen[] = [];
  const stats = { inFlight: 0, maxInFlight: 0, sessions: 0 };
  const server: Http2Server = createServer(settings ? { settings } : {});
  const sessions = new Set<ServerHttp2Session>();
  open.set(server, sessions);
  server.on('session', (session) => {
    stats.sessions++;
    sessions.add(session);
    session.on('close', () => sessions.delete(session));
  });
  server.on('stream', (stream, headers) => {
    stats.inFlight++;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    const inFlight = stats.inFlight;
    let answered = false;
    const done = () => {
      if (!answered) stats.inFlight--;
      answered = true;
    };
    stream.on('close', done);
    let body = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => (body += chunk));
    stream.on('end', async () => {
      seen.push({ headers, body, inFlight });
      const reply = await answer(headers, body);
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (reply === 'hang' || stream.destroyed || stream.closed) return;
      done();
      stream.respond({ ':status': reply.status, 'apns-id': headers['apns-id'] });
      stream.end(
        reply.body === undefined
          ? undefined
          : typeof reply.body === 'string'
            ? reply.body
            : JSON.stringify(reply.body),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  servers.push(server);
  return { origin: `http://localhost:${(server.address() as AddressInfo).port}`, seen, stats };
}

/** Closes every fake, ending the sessions still open on them. */
export async function closeFakes(): Promise<void> {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.close(() => resolve());
          for (const session of open.get(s) ?? []) session.destroy();
        }),
    ),
  );
}
