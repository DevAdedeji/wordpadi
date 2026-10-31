import { DICTIONARY_VERSION, SUPPORTED_DICTIONARY_VERSIONS } from '@word-lagos/game-core';
import { diamondStore, migrateDiamonds } from './diamonds-store';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as liteDrizzle } from 'drizzle-orm/pglite';
import { drizzle as pgDrizzle } from 'drizzle-orm/node-postgres';
import { integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { and, eq, sql, desc } from 'drizzle-orm';
import pg from 'pg';
import type { Purchase } from './vatar';
import { z } from 'zod';
import {
  statsSchema,
  boardSchema,
  historySchema,
  tileSchema,
  codeSchema,
} from '@word-lagos/multiplayer';

export const playerSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(80),
});
export type Player = z.infer<typeof playerSchema>;
export const matchSchema = z.object({
  code: codeSchema,
  environment: z.enum(['local', 'test', 'live']).default('local'),
  revision: z.number().int().nonnegative(),
  players: z.array(playerSchema).min(1).max(2),
  game: z.object({
    version: z.literal(1),
    dictionary: z
      .enum(SUPPORTED_DICTIONARY_VERSIONS)
      .transform((): typeof DICTIONARY_VERSION => DICTIONARY_VERSION),
    mode: z.literal('friends'),
    board: boardSchema,
    bag: z.array(tileSchema).max(120),
    tileSupply: z.literal('personal-60').optional(),
    racks: z.array(z.array(tileSchema).max(7)).length(2),
    scores: z.array(z.number().int()).length(2),
    turn: z.number().int().min(0).max(1),
    history: historySchema,
    scoreless: z.number().int().min(0).max(6),
    rng: z.number().int().nonnegative(),
    status: z.enum(['playing', 'finished']),
    endReason: z.enum(['rack-empty', 'scoreless', 'resigned']).nullable(),
    resignedBy: z.number().int().min(0).max(1).optional(),
  }),
  receipts: z
    .array(z.object({ id: z.string(), playerId: z.string(), digest: z.string() }))
    .max(1000),
  expiresAt: z.number(),
  rematchOf: codeSchema.optional(),
  invitedPlayer: playerSchema.optional(),
  platform: z
    .object({
      id: z.string(),
      nonce: z.string().nullable(),
      result: z.enum(['pending', 'sent', 'expired']).default('pending'),
    })
    .optional(),
});
export type Match = z.infer<typeof matchSchema>;
const matches = pgTable('friend_matches', {
  code: text('code').primaryKey(),
  revision: integer('revision').notNull(),
  data: jsonb('data').$type<Match>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
const sessions = pgTable('local_sessions', {
  hash: text('hash').primaryKey(),
  player: jsonb('player').$type<Player>().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
const purchases = pgTable('vatar_purchases', {
  id: text('id').notNull(),
  environment: text('environment').notNull(),
  playerId: text('player_id').notNull(),
  productId: text('product_id').notNull(),
  amount: integer('amount').notNull(),
  currency: text('currency').notNull(),
  status: text('status').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
export async function openStore(databaseUrl?: string, localPath?: string) {
  const client = databaseUrl
    ? new pg.Pool({
        connectionString: databaseUrl,
        max: 5,
        connectionTimeoutMillis: 30000,
        idleTimeoutMillis: 20000,
        statement_timeout: 15000,
      })
    : new PGlite(localPath);
  const db = client instanceof pg.Pool ? pgDrizzle(client) : liteDrizzle(client);
  // Initial, additive schema. Future changes require a numbered migration.
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS friend_matches (code text PRIMARY KEY CHECK (code ~ '^[A-Z]{6}$'), revision integer NOT NULL CHECK (revision >= 0), data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`,
  );
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS local_sessions (hash text PRIMARY KEY, player jsonb NOT NULL, expires_at timestamptz NOT NULL)`,
  );
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  // Migration 1: additive purchase ledger, platform identity uniqueness, and SDK invite codes.
  await db.transaction(async (tx) => {
    const applied = await tx.execute(
      sql`INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING RETURNING version`,
    );
    if (!applied.rows.length) return;
    await tx.execute(
      sql`CREATE TABLE vatar_purchases (id text NOT NULL, environment text NOT NULL CHECK (environment IN ('test','live')), player_id text NOT NULL, product_id text NOT NULL, amount integer NOT NULL CHECK (amount > 0), currency text NOT NULL CHECK (currency = 'NGN'), status text NOT NULL CHECK (status IN ('pending','delivered','refunded')), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (id, environment))`,
    );
    await tx.execute(
      sql`CREATE INDEX vatar_purchases_owner ON vatar_purchases(environment, player_id)`,
    );
    await tx.execute(
      sql`CREATE UNIQUE INDEX friend_matches_platform_id ON friend_matches ((data->>'environment'), (data->'platform'->>'id')) WHERE data->'platform'->>'id' IS NOT NULL`,
    );
    await tx.execute(
      sql`ALTER TABLE friend_matches DROP CONSTRAINT IF EXISTS friend_matches_code_check`,
    );
    await tx.execute(
      sql`ALTER TABLE friend_matches ADD CONSTRAINT friend_matches_code_check CHECK (code ~ '^[A-Z0-9]{6}$')`,
    );
  });
  await db.transaction(async (tx) => {
    const applied = await tx.execute(
      sql`INSERT INTO schema_migrations(version) VALUES (2) ON CONFLICT DO NOTHING RETURNING version`,
    );
    if (!applied.rows.length) return;
    await tx.execute(
      sql`CREATE UNIQUE INDEX friend_matches_rematch ON friend_matches ((coalesce(data->>'environment','local')), (data->>'rematchOf')) WHERE data->>'rematchOf' IS NOT NULL`,
    );
  });
  await migrateDiamonds(db);
  const diamonds = diamondStore(db);
  const owned = (playerId: string, environment: string) =>
    and(
      sql`${matches.data}->'players' @> ${JSON.stringify([{ id: playerId }])}::jsonb`,
      sql`coalesce(${matches.data}->>'environment', 'local') = ${environment}`,
    );
  const finished = sql`${matches.data}->'game'->>'status' = 'finished'`;
  const summaryColumns = {
    code: matches.code,
    players: sql<Player[]>`${matches.data}->'players'`,
    scores: sql<number[]>`${matches.data}->'game'->'scores'`,
    turn: sql<number>`(${matches.data}->'game'->>'turn')::int`,
    resignedBy: sql<number | null>`(${matches.data}->'game'->>'resignedBy')::int`,
    expiresAt: sql<number>`(${matches.data}->>'expiresAt')::double precision`,
    status: sql<'playing' | 'finished'>`${matches.data}->'game'->>'status'`,
    updatedAt: matches.updatedAt,
  };
  return {
    diamonds,
    async hasPendingRecovery(environment: string, matchesEnabled: boolean): Promise<boolean> {
      const result = await db.execute(sql`select
        exists (select 1 from vatar_purchases where environment = ${environment} and status = 'pending')
        or (${matchesEnabled} and exists (select 1 from friend_matches
          where data->>'environment' = ${environment}
          and data->'game'->>'status' = 'finished'
          and data->'platform'->>'result' = 'pending'
          and data->'platform'->>'nonce' is not null)) as pending`);
      return z.object({ pending: z.boolean() }).parse(result.rows[0]).pending;
    },
    async grantPurchase(purchase: Purchase): Promise<void> {
      await db
        .insert(purchases)
        .values({
          id: purchase.id,
          environment: purchase.mode,
          playerId: purchase.playerId,
          productId: purchase.productId,
          amount: purchase.amount,
          currency: purchase.currency,
          status: 'pending',
        })
        .onConflictDoNothing();
    },
    async deliveredPurchase(id: string, environment: string): Promise<void> {
      await db
        .update(purchases)
        .set({ status: 'delivered', updatedAt: sql`now()` })
        .where(
          and(
            eq(purchases.id, id),
            eq(purchases.environment, environment),
            sql`${purchases.status} <> 'refunded'`,
          ),
        );
    },
    async revokePurchase(id: string, environment: 'test' | 'live'): Promise<void> {
      await diamonds.refund(id, environment);
    },
    async ownsTheme(
      playerId: string,
      environment: string,
      productId = 'sunset_board',
    ): Promise<boolean> {
      const rows = await db
        .select({ id: purchases.id })
        .from(purchases)
        .where(
          and(
            eq(purchases.playerId, playerId),
            eq(purchases.environment, environment),
            eq(purchases.productId, productId),
            sql`${purchases.status} <> 'refunded'`,
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
    async ownedPurchases(playerId: string, environment: string) {
      return db
        .select({ id: purchases.id, productId: purchases.productId })
        .from(purchases)
        .where(
          and(
            eq(purchases.playerId, playerId),
            eq(purchases.environment, environment),
            sql`${purchases.status} <> 'refunded'`,
            sql`${purchases.productId} IN ('sunset_board','midnight_board','ankara_board','royal_board')`,
          ),
        )
        .limit(20);
    },
    async pendingPurchases(environment: string) {
      return db
        .select({ id: purchases.id, playerId: purchases.playerId })
        .from(purchases)
        .where(and(eq(purchases.environment, environment), eq(purchases.status, 'pending')))
        .orderBy(purchases.updatedAt)
        .limit(10);
    },
    async platformMatch(id: string, environment: string): Promise<Match | null> {
      const [row] = await db
        .select()
        .from(matches)
        .where(
          and(
            sql`${matches.data}->>'environment' = ${environment}`,
            sql`${matches.data}->'platform'->>'id' = ${id}`,
          ),
        )
        .limit(1);
      return row ? matchSchema.parse(row.data) : null;
    },
    async pendingResults(environment: string): Promise<Match[]> {
      const rows = await db
        .select()
        .from(matches)
        .where(
          and(
            sql`${matches.data}->>'environment' = ${environment}`,
            sql`${matches.data}->'platform'->>'result' = 'pending'`,
            finished,
          ),
        )
        .orderBy(matches.updatedAt)
        .limit(10);
      return rows.map((row) => matchSchema.parse(row.data));
    },
    async list(playerId: string, environment: string, completed: boolean, offset: number) {
      return db
        .select(summaryColumns)
        .from(matches)
        .where(
          and(
            owned(playerId, environment),
            completed
              ? finished
              : and(
                  sql`${matches.data}->'game'->>'status' = 'playing'`,
                  sql`(${matches.data}->>'expiresAt')::numeric > extract(epoch from now()) * 1000`,
                ),
          ),
        )
        .orderBy(desc(matches.updatedAt), desc(matches.code))
        .limit(51)
        .offset(offset);
    },
    async record(playerId: string, opponentId: string, environment: string) {
      const pair = and(
        owned(playerId, environment),
        sql`${matches.data}->'players' @> ${JSON.stringify([{ id: opponentId }])}::jsonb`,
        finished,
      );
      const scoreDifference = sql`CASE WHEN ${matches.data}->'game'->>'resignedBy' IS NOT NULL THEN CASE WHEN ${matches.data}->'players'->((${matches.data}->'game'->>'resignedBy')::int)->>'id' = ${playerId} THEN -1 ELSE 1 END WHEN ${matches.data}->'players'->0->>'id' = ${playerId}
        THEN (${matches.data}->'game'->'scores'->>0)::int - (${matches.data}->'game'->'scores'->>1)::int
        ELSE (${matches.data}->'game'->'scores'->>1)::int - (${matches.data}->'game'->'scores'->>0)::int END`;
      const [counts] = await db
        .select({
          played: sql<number>`count(*)::int`,
          wins: sql<number>`count(*) filter (where (${scoreDifference}) > 0)::int`,
          losses: sql<number>`count(*) filter (where (${scoreDifference}) < 0)::int`,
          draws: sql<number>`count(*) filter (where (${scoreDifference}) = 0)::int`,
        })
        .from(matches)
        .where(pair);
      const recent = await db
        .select(summaryColumns)
        .from(matches)
        .where(pair)
        .orderBy(desc(matches.updatedAt), desc(matches.code))
        .limit(20);
      return { ...counts, recent };
    },
    async rematch(source: string, environment: string): Promise<Match | null> {
      const [row] = await db
        .select()
        .from(matches)
        .where(
          and(
            sql`coalesce(${matches.data}->>'environment','local') = ${environment}`,
            sql`${matches.data}->>'rematchOf' = ${source}`,
          ),
        )
        .limit(1);
      return row ? matchSchema.parse(row.data) : null;
    },
    async stats(playerId: string, environment: string) {
      const result = await db.execute(sql`
        WITH owned_games AS (
          SELECT data, CASE WHEN data->'players'->0->>'id' = ${playerId} THEN 0 ELSE 1 END AS seat
          FROM friend_matches WHERE data->'players' @> ${JSON.stringify([{ id: playerId }])}::jsonb
          AND coalesce(data->>'environment','local') = ${environment}
        ), completed AS (
          SELECT *, (data->'game'->'scores'->>seat)::int AS score,
          CASE WHEN data->'game'->>'resignedBy' IS NOT NULL
            THEN CASE WHEN (data->'game'->>'resignedBy')::int = seat THEN -1 ELSE 1 END
            ELSE (data->'game'->'scores'->>seat)::int - (data->'game'->'scores'->>(1-seat))::int END AS outcome
          FROM owned_games WHERE data->'game'->>'status' = 'finished'
        ), moves AS (
          SELECT move FROM owned_games, jsonb_array_elements(data->'game'->'history') AS move
          WHERE (move->>'player')::int = seat AND move->>'kind' = 'play'
        ) SELECT
          (SELECT count(*)::int FROM completed) AS played,
          (SELECT count(*)::int FROM completed WHERE outcome > 0) AS wins,
          (SELECT count(*)::int FROM completed WHERE outcome < 0) AS losses,
          (SELECT count(*)::int FROM completed WHERE outcome = 0) AS draws,
          (SELECT max(score) FROM completed) AS "bestScore",
          coalesce((SELECT max((move->>'score')::int) FROM moves),0) AS "bestMove",
          coalesce((SELECT move->'words' FROM moves ORDER BY (move->>'score')::int DESC, move->'words' LIMIT 1),'[]'::jsonb) AS "bestWords",
          (SELECT coalesce(sum(jsonb_array_length(move->'words')),0)::int FROM moves) AS words,
          (SELECT count(*)::int FROM moves WHERE jsonb_array_length(move->'placements') = 7) AS bingos,
          (SELECT count(*)::int FROM owned_games WHERE data->'game'->>'status' = 'playing'
            AND jsonb_array_length(data->'players') = 2 AND (data->'game'->>'turn')::int = seat
            AND (data->>'expiresAt')::numeric > extract(epoch from now()) * 1000) AS "yourTurn"
      `);
      return statsSchema.parse(result.rows[0]);
    },
    async get(code: string): Promise<Match | null> {
      const [row] = await db.select().from(matches).where(eq(matches.code, code));
      return row ? matchSchema.parse(row.data) : null;
    },
    async insert(match: Match): Promise<boolean> {
      return (
        (
          await db
            .insert(matches)
            .values({ code: match.code, revision: match.revision, data: match })
            .onConflictDoNothing()
            .returning()
        ).length === 1
      );
    },
    async save(match: Match, previousRevision: number): Promise<boolean> {
      return (
        (
          await db
            .update(matches)
            .set({ data: match, revision: match.revision, updatedAt: sql`now()` })
            .where(and(eq(matches.code, match.code), eq(matches.revision, previousRevision)))
            .returning()
        ).length === 1
      );
    },
    async session(hash: string): Promise<Player | null> {
      const [row] = await db.select().from(sessions).where(eq(sessions.hash, hash));
      return row && row.expiresAt.getTime() > Date.now() ? playerSchema.parse(row.player) : null;
    },
    async addSession(hash: string, player: Player): Promise<void> {
      await db
        .insert(sessions)
        .values({ hash, player, expiresAt: new Date(Date.now() + 7 * 86400000) });
    },
    async healthy(): Promise<void> {
      await db.execute(sql`SELECT 1`);
    },
    async close(): Promise<void> {
      if (client instanceof pg.Pool) await client.end();
      else await client.close();
    },
  };
}
export type Store = Awaited<ReturnType<typeof openStore>>;
