/**
 * Where Dota 2's Game State Integration posts to: a tiny HTTP server on
 * 127.0.0.1 only, never on the network. It is open only while some rule or
 * script waits for a game event and the user has switched game events on.
 *
 * Every request has to be a small JSON POST carrying the token Dota was
 * given in its cfg; anything else gets a bare error and is otherwise ignored.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dotaPayloadSchema, tokenMatches, type DotaPayload } from '../engine/dotaState';

/** Plenty for what the cfg asks for (provider, map, player, hero), small enough to never matter. */
export const MAX_BODY_BYTES = 64 * 1024;
const HOST = '127.0.0.1';

export interface GsiListenerOptions {
  port: number;
  token: string;
  onPayload: (payload: DotaPayload) => void;
  /** It could not open (the port is taken) or stopped working. */
  onError: (message: string) => void;
  /** It is open and listening. */
  onListening?: (port: number) => void;
}

export interface GsiListener {
  close(): void;
}

export function startGsiListener(options: GsiListenerOptions): GsiListener {
  const server: Server = createServer((req, res) => handle(req, res, options));
  // Dota answers in well under a second; a connection that dawdles is not Dota.
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 10_000;
  server.maxHeadersCount = 32;
  server.on('error', (err: NodeJS.ErrnoException) => {
    options.onError(err.code === 'EADDRINUSE' ? `port ${options.port} is taken by another program` : err.message);
  });
  server.listen(options.port, HOST, () => {
    const address = server.address();
    options.onListening?.(typeof address === 'object' && address ? address.port : options.port);
  });
  server.unref();
  return {
    close: () => {
      server.close();
      server.closeAllConnections();
    }
  };
}

function handle(req: IncomingMessage, res: ServerResponse, options: GsiListenerOptions): void {
  const reply = (status: number): void => {
    if (res.headersSent) return;
    res.writeHead(status, { 'Content-Type': 'text/plain', Connection: status === 200 ? 'keep-alive' : 'close' });
    res.end();
  };
  if (req.method !== 'POST' || (req.url ?? '/') !== '/') {
    req.resume();
    return reply(404);
  }
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > MAX_BODY_BYTES) {
    reply(413);
    return void req.destroy();
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let refused = false;
  req.on('data', (chunk: Buffer) => {
    if (refused) return;
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      refused = true;
      reply(413);
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('error', () => undefined);
  req.on('end', () => {
    if (refused) return;
    const payload = parse(Buffer.concat(chunks).toString('utf8'));
    if (!payload || !tokenMatches(payload.auth?.token, options.token)) return reply(401);
    // Answered first: Dota waits for the reply before it sends the next state.
    reply(200);
    try {
      options.onPayload(payload);
    } catch (err) {
      options.onError(`could not take in a game update: ${String(err)}`);
    }
  });
}

function parse(text: string): DotaPayload | null {
  try {
    const parsed = dotaPayloadSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
