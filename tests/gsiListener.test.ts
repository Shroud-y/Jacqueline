import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { DotaPayload } from '@main/engine/dotaState';
import { MAX_BODY_BYTES, startGsiListener, type GsiListener } from '@main/sensors/gsiListener';

let listener: GsiListener | null = null;
afterEach(() => listener?.close());

/** A listener on a port the system picks, and what it took in. */
async function start(): Promise<{ port: number; got: DotaPayload[] }> {
  const got: DotaPayload[] = [];
  const port = await new Promise<number>((resolve, reject) => {
    listener = startGsiListener({ port: 0, token: 'secret', onPayload: (payload) => got.push(payload), onError: reject, onListening: resolve });
  });
  return { port, got };
}

function send(port: number, body: string, options: { method?: string; path?: string } = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: options.method ?? 'POST', path: options.path ?? '/', headers: { 'Content-Type': 'application/json' } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', (err: NodeJS.ErrnoException) => (err.code === 'ECONNRESET' || err.code === 'EPIPE' ? resolve(413) : reject(err)));
    req.end(body);
  });
}

const payload = { provider: { appid: 570 }, map: { matchid: '1', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS' }, auth: { token: 'secret' } };

describe('the GSI listener', () => {
  it('takes a Dota update that carries the token', async () => {
    const { port, got } = await start();
    expect(await send(port, JSON.stringify(payload))).toBe(200);
    expect(got).toHaveLength(1);
    expect(got[0]?.map?.matchid).toBe('1');
  });

  it('turns away a wrong token, no token, and what is not JSON', async () => {
    const { port, got } = await start();
    expect(await send(port, JSON.stringify({ ...payload, auth: { token: 'guess' } }))).toBe(401);
    expect(await send(port, JSON.stringify({ ...payload, auth: undefined }))).toBe(401);
    expect(await send(port, 'not json')).toBe(401);
    expect(got).toEqual([]);
  });

  it('answers nothing but a POST to /', async () => {
    const { port, got } = await start();
    expect(await send(port, '', { method: 'GET' })).toBe(404);
    expect(await send(port, JSON.stringify(payload), { path: '/other' })).toBe(404);
    expect(got).toEqual([]);
  });

  it('refuses a body that is too big', async () => {
    const { port, got } = await start();
    const big = JSON.stringify({ ...payload, padding: 'x'.repeat(MAX_BODY_BYTES) });
    expect(await send(port, big)).toBe(413);
    expect(got).toEqual([]);
  });

  it('says so when the port is taken', async () => {
    const { port } = await start();
    const error = await new Promise<string>((resolve) => {
      const second = startGsiListener({ port, token: 'x', onPayload: () => undefined, onError: resolve });
      setTimeout(() => second.close(), 2000).unref();
    });
    expect(error).toContain(`port ${port} is taken`);
  });
});
