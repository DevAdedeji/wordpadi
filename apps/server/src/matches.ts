import { createHash, randomInt } from 'node:crypto';
import {
  createGame,
  availableBag,
  tilesRemaining,
  exchangeTiles,
  passTurn,
  playMove,
  resignGame,
  winnerOf,
} from '@word-lagos/game-core';
import {
  commandSchema,
  type Command,
  type Snapshot,
  type GameSummary,
} from '@word-lagos/multiplayer';
import type { Match, Player, Store } from './store';
import { Vatar } from './vatar';
import { wakeRecovery } from './recovery';

export class MatchError extends Error {}
export class Matches {
  constructor(
    private store: Store,
    private dictionary: ReadonlySet<string>,
    private environment: 'local' | 'test' | 'live' = 'local',
    private provider?: Vatar,
  ) {}
  async importPlatform(
    id: string,
    code: string,
    player: Player,
    rematchOf?: string,
    attempt = 0,
  ): Promise<Match> {
    if (!this.provider?.matchesEnabled)
      throw new MatchError('LagosLife matches are not configured.');
    const remote = await this.provider.match(id);
    if (!remote.players.some((p) => p.playerId === player.id))
      throw new MatchError('You are not a player in this LagosLife match.');
    const existing = await this.store.platformMatch(id, this.environment);
    if (existing?.game.status === 'finished') return existing;
    if (existing?.rematchOf && rematchOf && existing.rematchOf !== rematchOf)
      throw new MatchError('This match already belongs to another rematch.');
    const source = rematchOf ?? existing?.rematchOf;
    const invitation = source ? await this.rematchInfo(source, player.id) : null;
    if (invitation?.existingCode && invitation.existingCode !== existing?.code)
      throw new MatchError('A rematch already exists. Open it from the previous result.');
    if (invitation && remote.players.some((p) => !invitation.playerIds.includes(p.playerId)))
      throw new MatchError('This rematch is reserved for the original players.');
    if (!['open', 'playing'].includes(remote.status) || remote.endsAt <= Date.now())
      throw new MatchError('This LagosLife match has ended or expired.');
    const players = remote.players.map((p) => ({ id: p.playerId, name: p.name }));
    if (new Set(players.map((p) => p.id)).size !== players.length)
      throw new MatchError('LagosLife returned invalid players.');
    if (remote.status === 'playing' && (players.length !== 2 || !remote.nonce))
      throw new MatchError('LagosLife has not confirmed both players.');
    if (
      existing &&
      existing.game.history.length &&
      existing.players.some((p, i) => p.id !== players[i]?.id)
    )
      throw new MatchError('The match players changed. Reopen LagosLife.');
    const match: Match = existing
      ? {
          ...existing,
          players,
          rematchOf: source,
          invitedPlayer: existing.invitedPlayer ?? invitation?.opponent,
          expiresAt: remote.endsAt,
          platform: { ...existing.platform!, nonce: remote.nonce ?? null },
          revision: existing.revision + 1,
        }
      : {
          code,
          rematchOf: source,
          invitedPlayer: invitation?.opponent,
          environment: this.environment,
          revision: 0,
          players,
          game: { ...createGame('friends', randomInt(1, 4294967296)), mode: 'friends' },
          receipts: [],
          expiresAt: remote.endsAt,
          platform: { id, nonce: remote.nonce ?? null, result: 'pending' },
        };
    if (
      existing &&
      existing.rematchOf === match.rematchOf &&
      existing.players.length === players.length &&
      existing.players.every((p, i) => p.id === players[i]?.id && p.name === players[i]?.name) &&
      existing.expiresAt === match.expiresAt &&
      existing.platform?.nonce === match.platform?.nonce
    )
      return existing;
    const saved = existing
      ? await this.store.save(match, existing.revision)
      : await this.store.insert(match);
    if (!saved) {
      const concurrent = await this.store.platformMatch(id, this.environment);
      if (concurrent && concurrent.players.some((p) => p.id === player.id)) {
        if (source && concurrent.rematchOf !== source) {
          if (attempt >= 2) throw new MatchError('The match changed. Try the rematch again.');
          return this.importPlatform(id, code, player, source, attempt + 1);
        }
        return concurrent;
      }
      throw new MatchError('This game code is already in use. Please reopen the match.');
    }
    return match;
  }
  async retryResults(): Promise<void> {
    if (!this.provider?.matchesEnabled) return;
    for (const match of await this.store.pendingResults(this.environment)) {
      if (!match.platform?.nonce) continue;
      try {
        const remote = await this.provider.match(match.platform.id);
        const winnerSeat = winnerOf(match.game);
        const winner = winnerSeat === null ? 'draw' : match.players[winnerSeat].id;
        if (remote.status === 'done' && remote.winner !== winner)
          throw new MatchError('The platform result differs from the saved game.');
        const expired =
          ['void', 'cancelled'].includes(remote.status) ||
          (remote.status !== 'done' && remote.endsAt <= Date.now());
        if (!expired && remote.status !== 'done')
          await this.provider.result(match.platform.id, match.platform.nonce, winner);
        await this.store.save(
          {
            ...match,
            revision: match.revision + 1,
            platform: { ...match.platform, result: expired ? 'expired' : 'sent' },
          },
          match.revision,
        );
        console.info(
          JSON.stringify({
            event: expired ? 'platform_result_expired' : 'platform_result_sent',
            code: match.code,
          }),
        );
      } catch {
        console.warn(JSON.stringify({ event: 'platform_result_pending', code: match.code }));
      }
    }
  }
  async list(playerId: string, completed: boolean, offset: number) {
    const rows = await this.store.list(playerId, this.environment, completed, offset);
    return {
      games: rows.slice(0, 50).map((row) => summary(row, playerId)),
      nextOffset: rows.length > 50 ? offset + 50 : null,
    };
  }
  async record(code: string, playerId: string) {
    // Completed games remain available as records after the invitation expires.
    const match = await this.store.get(code);
    if (
      !match ||
      match.environment !== this.environment ||
      !match.players.some((p) => p.id === playerId)
    )
      throw new MatchError('This record is not available.');
    const opponent = match.players.find((p) => p.id !== playerId);
    if (!opponent) throw new MatchError('Your friend has not joined this game yet.');
    const record = await this.store.record(playerId, opponent.id, this.environment);
    return {
      ...record,
      opponent: opponent.name,
      recent: record.recent.map((row) => summary(row, playerId)),
    };
  }
  async rematchInfo(code: string, playerId: string) {
    const previous = await this.store.get(code);
    if (
      !previous ||
      previous.environment !== this.environment ||
      !previous.players.some((p) => p.id === playerId)
    )
      throw new MatchError('This game is not available.');
    if (previous.game.status !== 'finished' || previous.players.length !== 2)
      throw new MatchError('Finish this game before starting a rematch.');
    const opponent = previous.players.find((p) => p.id !== playerId)!;
    const existing = await this.store.rematch(code, this.environment);
    if (existing && existing.game.status !== 'finished' && existing.expiresAt <= Date.now())
      throw new MatchError('That rematch expired. Create a new friend game instead.');
    return {
      opponent,
      playerIds: previous.players.map((p) => p.id),
      existingCode: existing?.code ?? null,
      mustJoinPlatform: !!existing?.platform && !existing.players.some((p) => p.id === playerId),
    };
  }
  async rematch(code: string, player: Player): Promise<Match> {
    const info = await this.rematchInfo(code, player.id);
    if (info.existingCode) return (await this.store.get(info.existingCode))!;
    if (this.provider?.matchesEnabled)
      throw new MatchError('Start this rematch through LagosLife.');
    return this.create(player, code, info.opponent);
  }
  async stats(playerId: string) {
    return this.store.stats(playerId, this.environment);
  }
  async create(player: Player, rematchOf?: string, invitedPlayer?: Player): Promise<Match> {
    for (let i = 0; i < 5; i++) {
      const match: Match = {
        environment: this.environment,
        rematchOf,
        invitedPlayer,
        code: Array.from({ length: 6 }, () => String.fromCharCode(65 + randomInt(26))).join(''),
        revision: 0,
        players: [player],
        game: { ...createGame('friends', randomInt(1, 4294967296)), mode: 'friends' },
        receipts: [],
        expiresAt: Date.now() + 7 * 86400000,
      };
      if (await this.store.insert(match)) return match;
      if (rematchOf) {
        const concurrent = await this.store.rematch(rematchOf, this.environment);
        if (concurrent) return concurrent;
      }
    }
    throw new MatchError('Could not create a game. Please try again.');
  }
  async get(code: string): Promise<Match> {
    const match = await this.store.get(code);
    if (
      !match ||
      match.environment !== this.environment ||
      (match.game.status !== 'finished' && match.expiresAt <= Date.now())
    )
      throw new MatchError('This game code has expired or does not exist.');
    return match;
  }
  async join(code: string, player: Player): Promise<Match> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let match = await this.get(code);
      if (match.platform && match.players.length < 2)
        match = await this.importPlatform(match.platform.id, match.code, player);
      if (match.players.some((p) => p.id === player.id)) return match;
      if (match.platform) throw new MatchError('Join this match through LagosLife first.');
      if (match.invitedPlayer && match.invitedPlayer.id !== player.id)
        throw new MatchError('This rematch is reserved for the invited player.');
      if (match.players.length === 2) throw new MatchError('This game already has two players.');
      const next = { ...match, players: [...match.players, player], revision: match.revision + 1 };
      if (await this.store.save(next, match.revision)) return next;
    }
    throw new MatchError('The game changed. Please join again.');
  }
  async prepareAutomaticPlay(
    code: string,
    playerId: string,
    revision: number,
    placements: import('@word-lagos/game-core').Placement[],
  ): Promise<Match> {
    const match = await this.get(code);
    if (
      match.players.length !== 2 ||
      match.players[match.game.turn]?.id !== playerId ||
      match.game.status !== 'playing'
    )
      throw new MatchError('Play a word is available on your turn.');
    if (match.revision !== revision)
      throw new MatchError('The board changed. No diamonds were spent.');
    if (match.game.history.length >= 999)
      throw new MatchError('This match has reached its turn limit.');
    const game = playMove(match.game, placements, this.dictionary);
    return { ...match, game: { ...game, mode: 'friends' }, revision: match.revision + 1 };
  }
  async act(code: string, playerId: string, input: unknown): Promise<Match> {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) throw new MatchError('Invalid move request.');
    const command: Command = parsed.data;
    const match = await this.get(code);
    const seat = match.players.findIndex((p) => p.id === playerId);
    if (seat < 0) throw new MatchError('You are not a player in this game.');
    const digest = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    const receipt = match.receipts.find((r) => r.id === command.id);
    if (receipt) {
      if (receipt.playerId !== playerId || receipt.digest !== digest)
        throw new MatchError('That request ID was already used.');
      return match;
    }
    if (match.players.length !== 2) throw new MatchError('Wait for your friend to join.');
    if (match.game.status !== 'playing') throw new MatchError('This game has finished.');
    if (match.revision !== command.revision)
      throw new MatchError('The board changed. Review the latest board and try again.');
    if (command.action.kind !== 'resign' && match.game.turn !== seat)
      throw new MatchError('It is your friend’s turn.');
    if (match.game.history.length >= 999)
      throw new MatchError('This match has reached its turn limit. Start a new game.');
    let game;
    try {
      const action = command.action;
      game =
        action.kind === 'resign'
          ? resignGame(match.game, seat)
          : action.kind === 'play'
            ? playMove(match.game, action.placements, this.dictionary)
            : action.kind === 'pass'
              ? passTurn(match.game)
              : exchangeTiles(match.game, action.ids);
    } catch (error) {
      throw new MatchError(
        error instanceof Error ? error.message : 'This move could not be played.',
      );
    }
    const next: Match = {
      ...match,
      game: { ...game, mode: 'friends' },
      revision: match.revision + 1,
      receipts: [...match.receipts, { id: command.id, playerId, digest }],
    };
    if (!(await this.store.save(next, match.revision)))
      throw new MatchError('Another move arrived first. Review the board and try again.');
    if (next.game.status === 'finished' && next.platform) wakeRecovery();
    return next;
  }
}
/** Explicit projection: never serialize the full game, seed, bag, or opponent's rack. */
export function snapshot(match: Match, playerId: string, online: ReadonlySet<string>): Snapshot {
  const seat = match.players.findIndex((p) => p.id === playerId);
  if (seat < 0) throw new MatchError('You are not a player in this game.');
  const other = 1 - seat;
  return {
    code: match.code,
    revision: match.revision,
    phase: match.players.length < 2 ? 'waiting' : match.game.status,
    board: match.game.board,
    rack: match.game.racks[seat],
    bagCount: availableBag(match.game, seat).length,
    tilesLeft: tilesRemaining(match.game, seat),
    opponentRackCount: match.players[other] ? match.game.racks[other].length : 0,
    scores: [match.game.scores[seat], match.game.scores[other]],
    turn: match.game.turn === seat ? 0 : 1,
    history: match.game.history.map((h) => ({ ...h, player: h.player === seat ? 0 : 1 })),
    status: match.game.status,
    endReason: match.game.endReason,
    resignedBy:
      match.game.resignedBy === undefined ? undefined : match.game.resignedBy === seat ? 0 : 1,
    players: [match.players[seat], match.players[other]]
      .filter((p): p is Player => !!p)
      .map((p) => ({ name: p.name, online: online.has(p.id) })),
    expiresAt: match.expiresAt,
  };
}

function summary(row: Awaited<ReturnType<Store['list']>>[number], playerId: string): GameSummary {
  const seat = row.players.findIndex((p) => p.id === playerId);
  if (seat < 0) throw new MatchError('This game is not available.');
  return {
    code: row.code,
    opponent: row.players[1 - seat]?.name ?? null,
    scores: [row.scores[seat], row.scores[1 - seat]],
    phase: row.players.length < 2 ? 'waiting' : row.status,
    yourTurn: row.status === 'playing' && row.players.length === 2 && row.turn === seat,
    expiresAt: row.expiresAt,
    outcome:
      row.status !== 'finished'
        ? null
        : winnerOf({ scores: row.scores, resignedBy: row.resignedBy ?? undefined }) === null
          ? 'draw'
          : winnerOf({ scores: row.scores, resignedBy: row.resignedBy ?? undefined }) === seat
            ? 'win'
            : 'loss',
    resigned: row.resignedBy !== null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
