import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { openStore, type Store } from './store';
import { Vatar } from './vatar';
import { Purchases } from './purchases';
import { Matches } from './matches';
import { Auth } from './auth';
import { startServer } from './server';

let store: Store;
beforeAll(async () => {
  store = await openStore();
}, 30000);
afterAll(async () => {
  await store.close();
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const purchase = (id: string, playerId = 'buyer') => ({
  id,
  playerId,
  productId: 'sunset_board',
  amount: 500,
  currency: 'NGN',
  status: 'paid',
  mode: 'test',
});
const remote = (id: string) => ({
  id,
  status: 'playing',
  stake: 0,
  seats: 2,
  players: [
    { playerId: 'a', name: 'Ada' },
    { playerId: 'b', name: 'Bayo' },
  ],
  nonce: 'round-nonce',
  mode: 'test',
  endsAt: Date.now() + 7200000,
  winner: null,
});

describe('verified cosmetic purchases', () => {
  it('keeps recovery active only for unfinished durable work', async () => {
    const id = randomUUID();
    expect(await store.hasPendingRecovery('test', true)).toBe(false);
    await store.grantPurchase(purchase(id, 'recovery-only') as import('./vatar').Purchase);
    expect(await store.hasPendingRecovery('test', false)).toBe(true);
    await store.deliveredPurchase(id, 'test');
    expect(await store.hasPendingRecovery('test', true)).toBe(false);
  });

  it('grants once across concurrent claims and retains ownership after delivery', async () => {
    const id = randomUUID();
    const provider = new Vatar('vtr_test_secret', undefined, async (url) =>
      String(url).endsWith('/deliver') ? json({ id, status: 'delivered' }) : json(purchase(id)),
    );
    const service = new Purchases(store, provider);
    await Promise.all([service.claim('buyer', id), service.claim('buyer', id)]);
    expect(await service.owned('buyer')).toBe(true);
    expect(await store.pendingPurchases('test')).toEqual([]);
    expect(await store.ownsTheme('buyer', 'live')).toBe(false);
  });
  it('preserves ownership bought at the original price', async () => {
    const id = randomUUID(),
      player = randomUUID();
    const provider = new Vatar('vtr_test_secret', undefined, async (url) =>
      String(url).endsWith('/deliver')
        ? json({ id, status: 'delivered' })
        : json({ ...purchase(id, player), amount: 100 }),
    );
    const service = new Purchases(store, provider);
    await service.claim(player, id);
    expect(await service.owned(player)).toBe(true);
  });
  it('rejects wrong owners, products, amounts, modes and unpaid responses without granting', async () => {
    for (const patch of [
      { playerId: 'intruder' },
      { productId: 'unknown' },
      { amount: 1 },
      { mode: 'live' },
      { status: 'unpaid' },
    ]) {
      const id = randomUUID(),
        player = randomUUID();
      const provider = new Vatar('vtr_test_secret', undefined, async () =>
        json({ ...purchase(id, player), ...patch }),
      );
      await expect(new Purchases(store, provider).claim(player, id)).rejects.toThrow();
      expect(await store.ownsTheme(player, 'test')).toBe(false);
    }
  });
  it('persists the grant before delivery and recovers a failed delivery safely', async () => {
    const id = randomUUID(),
      player = randomUUID();
    let fail = true;
    const provider = new Vatar('vtr_test_secret', undefined, async (url) =>
      String(url).endsWith('/deliver')
        ? fail
          ? json({}, 503)
          : json({ id, status: 'delivered' })
        : json(purchase(id, player)),
    );
    const service = new Purchases(store, provider);
    await expect(service.claim(player, id)).rejects.toThrow();
    expect(await service.owned(player)).toBe(true);
    expect((await store.pendingPurchases('test')).some((p) => p.id === id)).toBe(true);
    fail = false;
    await service.retryPending();
    expect((await store.pendingPurchases('test')).some((p) => p.id === id)).toBe(false);
  });
  it('revokes a confirmed refunded purchase', async () => {
    const id = randomUUID(),
      player = randomUUID();
    let refunded = false;
    const provider = new Vatar('vtr_test_secret', undefined, async (url) =>
      String(url).endsWith('/deliver')
        ? json({ id, status: 'delivered' })
        : json({ ...purchase(id, player), status: refunded ? 'refunded' : 'paid' }),
    );
    const service = new Purchases(store, provider);
    await service.claim(player, id);
    refunded = true;
    await expect(service.claim(player, id)).rejects.toThrow('refunded');
    expect(await service.owned(player)).toBe(false);
  });
  it('authenticates purchase claims through the real HTTP endpoint', async () => {
    const auth = new Auth('local', store);
    const provider = new Vatar('vtr_test_secret', undefined, async () => json({}, 404));
    const server = await startServer({
      store,
      auth,
      matches: new Matches(store, new Set()),
      purchases: new Purchases(store, provider),
    });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/platform/purchases/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchaseId: 'forged' }),
      });
      expect(response.status).toBe(401);
    } finally {
      await server.close();
    }
  });
});

describe('LagosLife match integration', () => {
  it('uses provider membership and prevents unregistered players joining a platform room', async () => {
    const id = randomUUID();
    const provider = new Vatar('vtr_test_secret', 'test_results_secret', async () =>
      json(remote(id)),
    );
    const service = new Matches(store, new Set(), 'test', provider);
    await expect(
      service.importPlatform(id, 'PLAT01', { id: 'outsider', name: 'Eve' }),
    ).rejects.toThrow('not a player');
    const game = await service.importPlatform(id, 'PLAT01', { id: 'a', name: 'Fake name' });
    expect(game.players[0].name).toBe('Ada');
    await expect(service.join(game.code, { id: 'outsider', name: 'Eve' })).rejects.toThrow();
    const again = await service.importPlatform(id, 'OTHER1', { id: 'a', name: 'Ada' });
    expect(again.code).toBe(game.code);
  });
  it('rejects staked, cross-mode, expired and malformed matches', async () => {
    for (const patch of [
      { stake: 100 },
      { mode: 'live' },
      { endsAt: Date.now() - 1 },
      { nonce: null },
      { players: [{ playerId: 'a', name: 'Ada' }] },
    ]) {
      const id = randomUUID();
      const provider = new Vatar('vtr_test_secret', 'test_results_secret', async () =>
        json({ ...remote(id), ...patch }),
      );
      await expect(
        new Matches(store, new Set(), 'test', provider).importPlatform(id, 'BAD001', {
          id: 'a',
          name: 'Ada',
        }),
      ).rejects.toThrow();
    }
  });
  it('never posts an unfinished game and signs the saved final winner with exact request bytes', async () => {
    const id = randomUUID();
    const state = remote(id);
    const requests: { body: string; headers: Headers }[] = [];
    const provider = new Vatar('vtr_test_secret', 'test_results_secret', async (url, options) => {
      if (String(url).endsWith('/result')) {
        requests.push({ body: String(options?.body), headers: new Headers(options?.headers) });
        return json({ ...state, status: 'done', winner: JSON.parse(String(options?.body)).winner });
      }
      return json(state);
    });
    const service = new Matches(store, new Set(), 'test', provider);
    let match = await service.importPlatform(id, 'RESULT', { id: 'a', name: 'Ada' });
    await service.retryResults();
    expect(requests).toHaveLength(0);
    for (let i = 0; i < 6; i++)
      match = await service.act(match.code, match.players[match.game.turn].id, {
        id: randomUUID(),
        revision: match.revision,
        action: { kind: 'pass' },
      });
    expect(match.game.status).toBe('finished');
    await service.retryResults();
    expect(requests).toHaveLength(1);
    const req = requests[0];
    const winner =
      match.game.scores[0] === match.game.scores[1]
        ? 'draw'
        : match.players[match.game.scores[0] > match.game.scores[1] ? 0 : 1].id;
    expect(JSON.parse(req.body)).toEqual({ winner });
    const signature = createHmac('sha256', 'test_results_secret')
      .update(
        [
          'POST',
          `/api/games/v1/matches/${id}/result`,
          req.headers.get('X-Vatar-Timestamp'),
          state.nonce,
          createHash('sha256').update(req.body).digest('hex'),
        ].join('\n'),
      )
      .digest('hex');
    expect(req.headers.get('X-Vatar-Signature')).toBe('v1=' + signature);
    await service.retryResults();
    expect(requests).toHaveLength(1);
  });
  it('keeps failed result delivery pending and retries without changing the game outcome', async () => {
    const id = randomUUID();
    let fail = true;
    const provider = new Vatar('vtr_test_secret', 'test_results_secret', async (url, options) =>
      String(url).endsWith('/result')
        ? fail
          ? json({}, 503)
          : json({
              ...remote(id),
              status: 'done',
              winner: JSON.parse(String(options?.body)).winner,
            })
        : json(remote(id)),
    );
    const service = new Matches(store, new Set(), 'test', provider);
    let match = await service.importPlatform(id, 'RETRY1', { id: 'a', name: 'Ada' });
    for (let i = 0; i < 6; i++)
      match = await service.act(match.code, match.players[match.game.turn].id, {
        id: randomUUID(),
        revision: match.revision,
        action: { kind: 'pass' },
      });
    await service.retryResults();
    expect((await store.get(match.code))?.platform?.result).toBe('pending');
    fail = false;
    await service.retryResults();
    expect((await store.get(match.code))?.platform?.result).toBe('sent');
  });
});

it('reports the other player as winner when the higher-scoring player resigns', async () => {
  const id = randomUUID();
  const state = remote(id);
  const results: unknown[] = [];
  const provider = new Vatar('vtr_test_secret', 'test_results_secret', async (url, options) => {
    if (String(url).endsWith('/result')) {
      const result = JSON.parse(String(options?.body));
      results.push(result);
      return json({ ...state, status: 'done', winner: result.winner });
    }
    return json(state);
  });
  const service = new Matches(store, new Set(), 'test', provider);
  let match = await service.importPlatform(id, 'RESIGN', { id: 'a', name: 'Ada' });
  match = { ...match, game: { ...match.game, scores: [10, 200] } };
  await store.save(match, match.revision);
  await service.act(match.code, 'b', {
    id: randomUUID(),
    revision: match.revision,
    action: { kind: 'resign' },
  });
  await service.retryResults();
  expect(results).toEqual([{ winner: 'a' }]);
  await service.retryResults();
  expect(results).toHaveLength(1);
});
