import { Hints } from './hints';
import { DiamondError } from './diamonds-store';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { diamondPacks, codeSchema, hintRequestSchema } from '@word-lagos/multiplayer';
import { Auth, AuthError } from './auth';
import { Matches, MatchError } from './matches';
import type { Store } from './store';
import { friendRoom } from './room';
import { VatarError } from './vatar';
import { Purchases, themeProduct, themeProducts } from './purchases';
import { wakeRecovery } from './recovery';
export async function startServer({
  store,
  auth,
  matches,
  port = 0,
  production = false,
  publicOrigin,
  purchases,
  platformMatches = false,
}: {
  store: Store;
  auth: Auth;
  matches: Matches;
  port?: number;
  production?: boolean;
  publicOrigin?: string;
  purchases?: Purchases;
  platformMatches?: boolean;
}) {
  const app = express();
  const diamondEnvironment = purchases?.mode ?? 'local';
  const hints = new Hints(store, matches, diamondEnvironment);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method))
      res.once('finish', wakeRecovery);
    next();
  });
  // Railway supplies one trusted reverse proxy hop. Never trust arbitrary client IP headers locally.
  if (production) app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      'frame-ancestors https://lagoslife.app https://www.lagoslife.app https://naijalife.app https://www.naijalife.app https://lagoslife.eliysites.com',
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.get('/health', async (_req, res) => {
    try {
      await store.healthy();
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });
  app.get('/api/config', (_req, res) =>
    res.json({
      authMode: auth.mode,
      platformMatches,
      diamondPurchases: !!purchases,
      themeProduct: purchases ? themeProduct : null,
      themeProducts: purchases ? themeProducts : [],
    }),
  );
  app.use(
    '/api',
    rateLimit({ windowMs: 60000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  app.use(express.json({ limit: '8kb' }));
  const bearer = (req: express.Request) =>
    req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : undefined;
  app.get('/api/platform/theme', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const identity = await auth.verify(bearer(req));
      const themes = purchases ? await purchases.ownedThemes(identity.id) : [];
      res.json({ owned: themes.includes('sunset'), themes });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/platform/purchases/claim', async (req, res, next) => {
    try {
      const identity = await auth.verify(bearer(req));
      const { purchaseId } = z
        .object({ purchaseId: z.string().min(1).max(160) })
        .strict()
        .parse(req.body);
      if (!purchases) throw new VatarError('Purchases are unavailable.');
      await purchases.claim(identity.id, purchaseId);
      const themes = await purchases.ownedThemes(identity.id);
      res.json({ owned: themes.includes('sunset'), themes });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/diamonds/wallet', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const identity = await auth.verify(bearer(req));
      if (auth.mode !== 'local' && !purchases)
        throw new DiamondError('Diamonds are not available yet.');
      const balance = await store.diamonds.initialize(identity.id, diamondEnvironment);
      res.json({ balance, demo: auth.mode === 'local' });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/diamonds/demo', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (auth.mode !== 'local' || production)
        throw new DiamondError('Demo purchases are unavailable.');
      const identity = await auth.verify(bearer(req));
      const { id, productId } = z
        .object({ id: z.uuid(), productId: z.string() })
        .strict()
        .parse(req.body);
      const pack = diamondPacks.find((p) => p.id === productId);
      if (!pack) throw new DiamondError('Unknown diamond pack.');
      res.json({
        balance: await store.diamonds.demoCredit(identity.id, id, pack.diamonds),
        demo: true,
      });
    } catch (error) {
      next(error);
    }
  });
  app.post(
    '/api/diamonds/hint',
    rateLimit({ windowMs: 60000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false }),
    async (req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        const identity = await auth.verify(bearer(req));
        if (auth.mode !== 'local' && !purchases)
          throw new DiamondError('Hints are not available yet.');
        const input = hintRequestSchema.parse(req.body);
        const result = await hints.request(identity.id, input);
        if (input.kind === 'friend' && result.move) {
          try {
            await matchMaker.remoteRoomCall(input.code, 'publish');
          } catch {
            console.warn(
              JSON.stringify({ event: 'automatic_move_publish_pending', code: input.code }),
            );
          }
        }
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );
  app.post('/api/platform/matches', async (req, res, next) => {
    try {
      const identity = await auth.verify(bearer(req));
      const { id, code, rematchOf } = z
        .object({
          id: z.string().min(1).max(160),
          code: codeSchema,
          rematchOf: codeSchema.optional(),
        })
        .strict()
        .parse(req.body);
      const match = await matches.importPlatform(id, code, identity, rematchOf);
      res.json({ code: match.code });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/local-player', async (_req, res, next) => {
    try {
      res.json(await auth.issueLocal());
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/friends', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const identity = await auth.verify(bearer(req));
      const query = z
        .object({
          completed: z.enum(['true', 'false']).default('false'),
          offset: z.coerce.number().int().min(0).max(100000).default(0),
        })
        .parse(req.query);
      res.json(await matches.list(identity.id, query.completed === 'true', query.offset));
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/friends/:code/record', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const identity = await auth.verify(bearer(req));
      res.json(await matches.record(codeSchema.parse(req.params.code), identity.id));
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/me/stats', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const identity = await auth.verify(bearer(req));
      res.json(await matches.stats(identity.id));
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/friends/:code/rematch', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const identity = await auth.verify(bearer(req));
      const info = await matches.rematchInfo(codeSchema.parse(req.params.code), identity.id);
      res.json({
        opponent: info.opponent.name,
        existingCode: info.existingCode,
        mustJoinPlatform: info.mustJoinPlatform,
      });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/friends/:code/rematch', async (req, res, next) => {
    try {
      const identity = await auth.verify(bearer(req));
      const match = await matches.rematch(codeSchema.parse(req.params.code), identity);
      res.json({ code: match.code });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/friends', async (req, res, next) => {
    try {
      const identity = await auth.verify(bearer(req));
      const match = await matches.create(identity);
      res.status(201).json({ code: match.code });
    } catch (e) {
      next(e);
    }
  });
  const connections = new Map<string, Promise<void>>();
  app.post('/api/friends/:code/connect', async (req, res, next) => {
    try {
      const code = codeSchema.parse(req.params.code);
      const session = bearer(req);
      const identity = await auth.verify(session);
      await matches.join(code, identity);
      const existing = connections.get(code);
      if (existing) await existing;
      else {
        const connection = (async () => {
          const rooms = await matchMaker.query({ roomId: code });
          if (!rooms.length) await matchMaker.createRoom('friend', { code, session });
        })();
        connections.set(code, connection);
        try {
          await connection;
        } finally {
          connections.delete(code);
        }
      }
      res.json({ code });
    } catch (e) {
      next(e);
    }
  });
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const known =
        error instanceof AuthError ||
        error instanceof MatchError ||
        error instanceof VatarError ||
        error instanceof DiamondError ||
        error instanceof z.ZodError;
      if (!known) console.error(JSON.stringify({ event: 'request_failed' }));
      res.status(error instanceof AuthError ? 401 : known ? 400 : 500).json({
        error:
          error instanceof z.ZodError
            ? 'Check the request and try again.'
            : known
              ? error.message
              : 'The server could not complete this request.',
      });
    },
  );
  const webRoot = fileURLToPath(new URL('../../web/dist', import.meta.url));
  app.use(express.static(webRoot));
  app.get('/', (_req, res) => res.sendFile(`${webRoot}/index.html`));
  const http = createServer(app);
  matchMaker.controller.exposedMethods = ['joinById'];
  matchMaker.controller.getCorsHeaders = () => ({
    'Access-Control-Allow-Origin': publicOrigin ?? 'http://127.0.0.1:43127',
  });
  const server = new Server({
    transport: new WebSocketTransport({
      server: http,
      maxPayload: 8192,
      verifyClient: ({ origin }: { origin: string }) =>
        !origin || origin === (publicOrigin ?? 'http://127.0.0.1:43127'),
    }),
    greet: false,
    gracefullyShutdown: false,
  });
  server.define('friend', friendRoom(auth, matches)).filterBy(['code']);
  await server.listen(port, production ? '0.0.0.0' : '127.0.0.1');
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('No listening address.');
  return { port: address.port, close: () => server.gracefullyShutdown(false) };
}
