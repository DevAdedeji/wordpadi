import DiamondIcon from './diamonds/DiamondIcon';
import { useDiamonds } from './diamonds/useDiamonds';
import DiamondShop from './diamonds/DiamondShop';
import HintPanel from './diamonds/HintPanel';
import { HINT_COST } from '@word-lagos/multiplayer';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Lightbulb,
  Menu,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CircleHelp,
  Leaf,
  Layers,
  Plus,
  Palette,
  Flag,
  BarChart3,
  Eye,
  RotateCcw,
  Shuffle,
  SkipForward,
  Sparkles,
  Trophy,
  WifiOff,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  DICTIONARY_VERSION,
  createGame,
  availableBag,
  tilesRemaining,
  resignGame,
  winnerOf,
  emptyBoard,
  evaluateMove,
  exchangeTiles,
  makeLexicon,
  passTurn,
  playMove,
  premiumAt,
  tileValue,
  type Game,
} from '@word-lagos/game-core';
import { loadGame, saveGame } from './storage';
import WordFeedback from './WordFeedback';
import OpponentRack from './OpponentRack';
import { useTileDrag } from './useTileDrag';
import ActionIcon from './ActionIcon';
import { useFriendGame } from './multiplayer/useFriendGame';
import FriendLobby from './multiplayer/FriendLobby';
import MyGames from './multiplayer/MyGames';
import PlayerStats from './multiplayer/PlayerStats';
import { usePlayerStats } from './multiplayer/usePlayerStats';
import MatchClock, { useExpired } from './multiplayer/MatchClock';
import { createFriendGame } from './multiplayer/client';
import { usePlatform } from './platform/usePlatform';
import BoardThemes from './platform/BoardThemes';
import InviteCode from './multiplayer/InviteCode';
import { useGameDraft } from './multiplayer/useGameDraft';
import type { BotMove } from '../../../packages/game-core/src/bot';
type Modal =
  | 'menu'
  | 'diamonds'
  | 'hint'
  | 'help'
  | 'new'
  | 'dictionary'
  | 'exchange'
  | 'history'
  | 'friends'
  | 'games'
  | 'themes'
  | 'stats'
  | 'resign'
  | 'result'
  | 'rematch'
  | null;
const alphabet = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
const freshGame = (): Game => createGame('computer', crypto.getRandomValues(new Uint32Array(1))[0]);
const premiumNames = {
  TW: 'Triple word',
  DW: 'Double word',
  TL: 'Triple letter',
  DL: 'Double letter',
  '': 'Empty',
};
export default function App() {
  const [soloGame, setGame] = useState<Game>(() => loadGame() ?? freshGame());
  const friend = useFriendGame();
  const platform = usePlatform();
  const diamonds = useDiamonds(!!platform.identity || platform.demo, platform.demo);
  const [hintSearched, setHintSearched] = useState(false);
  const account = usePlayerStats(friend.snapshot?.revision);
  const expired = useExpired(
    friend.snapshot?.status === 'playing' ? friend.snapshot.expiresAt : undefined,
  );
  const turnCount =
    (account.stats?.yourTurn ?? 0) + (soloGame.status === 'playing' && soloGame.turn === 0 ? 1 : 0);
  const [rematchTarget, setRematchTarget] = useState<{ code: string; opponent: string } | null>(
    null,
  );
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const multiplayer = !!friend.code;
  const game = multiplayer
    ? (friend.snapshot ?? {
        ...soloGame,
        board: emptyBoard(),
        scores: [0, 0],
        history: [],
        turn: 0,
        status: 'playing' as const,
        endReason: null,
      })
    : soloGame;
  const bagCount = multiplayer
    ? (friend.snapshot?.bagCount ?? 0)
    : availableBag(soloGame, 0).length;
  const personalTilesLeft = multiplayer
    ? (friend.snapshot?.tilesLeft ?? null)
    : tilesRemaining(soloGame, 0);
  const opponentRackCount = multiplayer
    ? (friend.snapshot?.opponentRackCount ?? 0)
    : soloGame.racks[1].length;
  const opponentName = multiplayer ? (friend.snapshot?.players[1]?.name ?? 'Friend') : 'Ayo';
  const playerName = multiplayer ? (friend.snapshot?.players[0]?.name ?? 'You') : 'You';
  const waiting = multiplayer && friend.snapshot?.phase === 'waiting';

  const {
    draft,
    setDraft,
    saveFailed: draftSaveFailed,
  } = useGameDraft(
    friend.code ?? 'computer',
    multiplayer
      ? friend.snapshot
        ? String(friend.snapshot.revision)
        : null
      : `${soloGame.rng}:${soloGame.history.length}:${soloGame.status}`,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [wordsText, setWordsText] = useState(''),
    [loadError, setLoadError] = useState(false),
    [loadAttempt, setLoadAttempt] = useState(0);
  const [message, setMessage] = useState(''),
    [saveError, setSaveError] = useState(false),
    [botError, setBotError] = useState(''),
    [retry, setRetry] = useState(0);
  const [lookup, setLookup] = useState(''),
    [swapIds, setSwapIds] = useState<string[]>([]),
    [zoom, setZoom] = useState(false);
  const [blank, setBlank] = useState<{ tileId: string; row: number; col: number } | null>(null);
  const [rackOrder, setRackOrder] = useState<string[]>([]);
  const modalRef = useRef<HTMLDivElement>(null);
  const boardScrollRef = useRef<HTMLDivElement>(null);
  const zoomFocus = useRef({ x: 0.5, y: 0.5 });
  useEffect(() => {
    const viewport = boardScrollRef.current;
    if (!viewport) return;
    viewport.scrollLeft = zoom
      ? zoomFocus.current.x * viewport.scrollWidth - viewport.clientWidth / 2
      : 0;
    viewport.scrollTop = zoom
      ? zoomFocus.current.y * viewport.scrollHeight - viewport.clientHeight / 2
      : 0;
  }, [zoom]);
  function toggleZoom() {
    const viewport = boardScrollRef.current;
    if (viewport)
      zoomFocus.current = {
        x: (viewport.scrollLeft + viewport.clientWidth / 2) / viewport.scrollWidth,
        y: (viewport.scrollTop + viewport.clientHeight / 2) / viewport.scrollHeight,
      };
    setZoom((value) => !value);
  }

  const dictionary = useMemo(() => makeLexicon(wordsText), [wordsText]);
  const opponentTurn = game.turn === 1 && game.status === 'playing';
  const isThinking = !multiplayer && opponentTurn && !platform.paused && !platform.previewTheme;
  const turnReady =
    !platform.paused &&
    !platform.previewTheme &&
    !expired &&
    !!wordsText &&
    !loadError &&
    !opponentTurn &&
    game.status === 'playing' &&
    (!multiplayer ||
      (friend.status === 'connected' && !friend.pending && friend.snapshot?.phase === 'playing'));
  const canPlay = turnReady && !diamonds.busy;
  const rack = multiplayer ? (friend.snapshot?.rack ?? []) : soloGame.racks[0];
  const hintPosition = multiplayer
    ? `${friend.code}:${friend.snapshot?.revision}`
    : JSON.stringify({ board: game.board, rack });
  const currentHintPosition = useRef(hintPosition);
  currentHintPosition.current = hintPosition;
  useEffect(() => {
    setHintSearched(false);
  }, [hintPosition]);
  async function requestHint() {
    if (!canPlay) return;
    const position = hintPosition;
    const result = await diamonds.hint(
      multiplayer && friend.snapshot
        ? { kind: 'friend', code: friend.snapshot.code, revision: friend.snapshot.revision }
        : { kind: 'computer', board: game.board, rack },
    );
    if (
      result &&
      (position === currentHintPosition.current ||
        (multiplayer && currentHintPosition.current.startsWith(`${friend.code}:`)))
    ) {
      setHintSearched(true);
      if (result.move) {
        if (!multiplayer) {
          const next = playMove(soloGame, result.move.placements, dictionary);
          setSaveError(!saveGame(next));
          setGame(next);
        }
        clearDraft();
        setModal(null);
      }
    }
    if (multiplayer && friend.code)
      window.dispatchEvent(new CustomEvent('wordpadi:platform-update', { detail: friend.code }));
  }
  const orderedRack = [...rack].sort((a, b) => rackOrder.indexOf(a.id) - rackOrder.indexOf(b.id));
  const preview = useMemo(
    () => evaluateMove(game.board, rack, draft, dictionary),
    [game.board, rack, draft, dictionary],
  );
  const lastMove = game.history.at(-1);
  const lastCells = new Set(lastMove?.placements.map((p) => `${p.row},${p.col}`));
  const opponentPlayed = lastMove?.player === 1 && lastMove.kind === 'play';
  const opponentFeedback = useMemo(() => {
    if (!opponentPlayed || !lastMove.placements.length) return [];
    const previous = game.board.map((row) => row.slice());
    const playedRack = lastMove.placements.map((p) => {
      const tile = previous[p.row][p.col]!;
      previous[p.row][p.col] = null;
      return { id: p.tileId, letter: tile.blank ? '?' : p.letter };
    });
    return evaluateMove(previous, playedRack, lastMove.placements, dictionary).words ?? [];
  }, [game.board, lastMove, opponentPlayed, dictionary]);
  function locateOpponentMove() {
    if (!opponentPlayed) return;
    const tile = boardScrollRef.current?.querySelector<HTMLElement>('.opponent-last-play');
    tile?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  }
  const tileDrag = useTileDrag(
    canPlay && !modal && !blank,
    `${friend.code ?? 'computer'}:${game.history.length}`,
    (id, target) => {
      if (target.kind === 'rack') {
        setDraft((current) => current.filter((p) => p.tileId !== id));
        setSelected(null);
        setMessage('Tile returned to your rack.');
        return;
      }
      if (game.board[target.row][target.col]) return;
      const pending = draft.find((p) => p.tileId === id);
      const occupied = draft.find((p) => p.row === target.row && p.col === target.col);
      if (occupied && occupied.tileId !== id) return;
      if (pending) {
        setDraft((current) =>
          current.map((p) => (p.tileId === id ? { ...p, row: target.row, col: target.col } : p)),
        );
        setSelected(null);
        setMessage('');
      } else place(target.row, target.col, id);
    },
  );
  const draggedTile = tileDrag.drag && rack.find((t) => t.id === tileDrag.drag?.id);
  const draggedLetter =
    draggedTile && (draft.find((p) => p.tileId === draggedTile.id)?.letter ?? draggedTile.letter);
  const bestWord = game.history
    .filter((h) => h.player === 0 && h.kind === 'play')
    .sort((a, b) => b.score - a.score)[0];
  useEffect(() => {
    const controller = new AbortController();
    setLoadError(false);
    fetch(`/words.txt?v=${DICTIONARY_VERSION}`, { signal: controller.signal, cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error('Dictionary unavailable');
        return r.text();
      })
      .then((text) => {
        if (text.length < 1000 || text.includes('<html')) throw new Error('Dictionary unavailable');
        setWordsText(text);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setLoadError(true);
      });
    return () => controller.abort();
  }, [loadAttempt]);
  useEffect(() => {
    setSaveError(!saveGame(soloGame));
  }, [soloGame]);
  useEffect(() => {
    if (!isThinking || !wordsText) return;
    setBotError('');
    let active = true;
    const worker = new Worker(new URL('./bot.worker.ts', import.meta.url), { type: 'module' });
    const timer = window.setTimeout(() => {
      if (active) {
        setBotError('The computer took too long. Your game is saved. Try again.');
        worker.terminate();
      }
    }, 30000);
    worker.onmessage = (
      event: MessageEvent<{ id: number; move: BotMove | null; error?: string }>,
    ) => {
      if (!active) return;
      window.clearTimeout(timer);
      if (event.data.error) {
        setBotError(event.data.error);
        return;
      }
      try {
        let next: Game;
        if (event.data.move) {
          next = playMove(soloGame, event.data.move.placements, dictionary);
          const move = next.history.at(-1)!;
          setMessage(`Ayo played ${move.words.join(' + ')} for ${move.score} points.`);
        } else if (availableBag(soloGame, 1).length >= 7) {
          next = exchangeTiles(
            soloGame,
            soloGame.racks[1].map((t) => t.id),
          );
          setMessage('Ayo swapped tiles. Your turn.');
        } else {
          next = passTurn(soloGame);
          setMessage('Ayo passed. Your turn.');
        }
        setGame(next);
      } catch (e) {
        setBotError(e instanceof Error ? e.message : 'Could not complete the computer’s turn.');
      }
    };
    worker.onerror = () => {
      window.clearTimeout(timer);
      setBotError('The computer could not load. Try again.');
    };
    worker.postMessage({
      id: game.history.length,
      board: game.board,
      rack: soloGame.racks[1],
      words: wordsText,
    });
    return () => {
      active = false;
      window.clearTimeout(timer);
      worker.terminate();
    };
  }, [soloGame, isThinking, wordsText, dictionary, retry]);
  useEffect(() => {
    if (!modal && !blank) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = modalRef.current;
    const focusable = 'button:not(:disabled), input, select, [tabindex="0"]';
    (
      (dialog?.querySelector('[autofocus]') as HTMLElement | null) ??
      dialog?.querySelector<HTMLElement>(focusable)
    )?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModal(null);
        setBlank(null);
      }
      if (event.key === 'Tab' && dialog) {
        const nodes = [...dialog.querySelectorAll<HTMLElement>(focusable)];
        const first = nodes[0],
          last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [modal, blank]);
  useEffect(() => {
    setSelected(null);
    setBlank(null);
    setMessage('');
  }, [friend.code, friend.snapshot?.revision]);
  function clearDraft() {
    setDraft([]);
    setSelected(null);
    setMessage('');
  }
  function place(row: number, col: number, tileId = selected, letter?: string) {
    if (!canPlay) return;
    const existing = draft.find((p) => p.row === row && p.col === col);
    if (existing) {
      setDraft((d) => d.filter((p) => p.tileId !== existing.tileId));
      setSelected(existing.tileId);
      setMessage('');
      return;
    }
    if (game.board[row][col]) return;
    if (!tileId) {
      setMessage('Choose a tile from your rack, then tap a square.');
      return;
    }
    const tile = rack.find((t) => t.id === tileId);
    if (!tile || draft.some((p) => p.tileId === tile.id)) return;
    if (tile.letter === '?' && !letter) {
      setBlank({ tileId, row, col });
      return;
    }
    setDraft((d) => [...d, { tileId: tile.id, row, col, letter: letter ?? tile.letter }]);
    setSelected(null);
    setMessage('');
    setBlank(null);
  }
  async function submit() {
    try {
      if (multiplayer) await friend.send({ kind: 'play', placements: draft });
      else setGame(playMove(soloGame, draft, dictionary));
      clearDraft();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  async function action(kind: 'pass' | 'exchange') {
    try {
      if (multiplayer)
        await friend.send(kind === 'pass' ? { kind: 'pass' } : { kind: 'exchange', ids: swapIds });
      else setGame(kind === 'pass' ? passTurn(soloGame) : exchangeTiles(soloGame, swapIds));
      clearDraft();
      setModal(null);
      setSwapIds([]);
      setMessage(kind === 'pass' ? 'You passed this turn.' : 'Fresh tiles, fresh possibilities.');
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  function start() {
    friend.leave();
    setGame(freshGame());
    clearDraft();
    setRackOrder([]);
    setModal(null);
    setBotError('');
    zoomFocus.current = { x: 0.5, y: 0.5 };
    setZoom(false);
  }
  function requestRematch(code: string, opponent: string) {
    setRematchTarget({ code, opponent });
    setActionError('');
    setModal('rematch');
  }
  async function rematch() {
    if (!rematchTarget || actionBusy) return;
    setActionBusy(true);
    setActionError('');
    try {
      const code = await createFriendGame(rematchTarget.code);
      friend.join(code);
      clearDraft();
      setModal(null);
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : 'Could not start a rematch. Try again.',
      );
    } finally {
      setActionBusy(false);
    }
  }
  async function resign() {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError('');
    try {
      if (multiplayer) await friend.send({ kind: 'resign' });
      else setGame(resignGame(soloGame, 0));
      clearDraft();
      setModal('result');
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : 'Could not resign. Reconnect and try again.',
      );
    } finally {
      setActionBusy(false);
    }
  }
  function shuffle() {
    const ids = rack.map((t) => t.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    setRackOrder(ids);
  }
  const finished = game.status === 'finished';
  const showActivePlayer =
    !finished && !expired && !waiting && (!multiplayer || friend.status === 'connected');
  useEffect(() => {
    if (finished && (!multiplayer || friend.snapshot)) setModal('result');
  }, [finished, friend.code]);
  useEffect(() => {
    if (!zoom || !opponentPlayed || modal) return;
    const frame = requestAnimationFrame(locateOpponentMove);
    return () => cancelAnimationFrame(frame);
  }, [zoom, game.history.length, friend.code, modal]);
  const outcome =
    winnerOf(game) === null
      ? 'A well-matched draw.'
      : winnerOf(game) === 0
        ? 'You’ve got a way with words.'
        : `${opponentName} takes this one.`;
  return (
    <div
      data-embedded={window.self !== window.top}
      onClickCapture={tileDrag.clickCapture}
      className={`app-shell text-forest theme-${platform.previewTheme ?? platform.theme}`}
    >
      {tileDrag.drag && draggedTile && (
        <div
          className="dragging-tile"
          aria-hidden="true"
          style={{ left: tileDrag.drag.x, top: tileDrag.drag.y - 48 }}
        >
          <span>{draggedLetter === '?' ? '' : draggedLetter}</span>
          <sub>{tileValue(draggedTile.letter)}</sub>
        </div>
      )}
      <header className="mobile-game-header">
        <div className="mobile-topbar">
          <button
            aria-label="My games"
            title={turnCount ? `${turnCount} games need your turn` : 'My games'}
            className="games-nav-button"
            disabled={friend.pending || diamonds.busy}
            onClick={() => setModal('games')}
          >
            <Layers size={21} />
            {turnCount > 0 && (
              <span className="turn-badge" aria-label={`${turnCount} games need your turn`}>
                {turnCount}
              </span>
            )}
          </button>
          <span className="mobile-game-title">WORDPADI</span>
          <button
            className="diamond-nav"
            aria-label="Open diamond shop"
            onClick={() => setModal('diamonds')}
          >
            <DiamondIcon size={15} />
            <span>{diamonds.balance === null ? '—' : Math.max(0, diamonds.balance)}</span>
          </button>
          <button
            aria-label="New game"
            disabled={friend.pending || diamonds.busy}
            onClick={() => {
              setModal('new');
            }}
          >
            <Plus size={23} />
          </button>
        </div>
        <div className="mobile-scoreboard">
          <div
            className={`mobile-player ${showActivePlayer && !opponentTurn ? 'current-player' : ''}`}
          >
            <span className="mobile-avatar">Y</span>
            <span>
              {playerName}
              <strong>
                {game.scores[0]}
                {preview.ok && <small>+{preview.score}</small>}
              </strong>
            </span>
          </div>
          <span className="versus-tile">
            W<span>P</span>
          </span>
          <div
            className={`mobile-player opponent ${showActivePlayer && opponentTurn ? 'current-player' : ''}`}
          >
            <span>
              {opponentName}
              <strong>{game.scores[1]}</strong>
            </span>
            <span className="mobile-avatar bot-avatar">
              <Sparkles size={22} />
            </span>
          </div>
        </div>
      </header>
      <header className="site-header">
        <a className="brand" href="/" aria-label="WordPadi home">
          <span className="brand-mark">
            w<span>p</span>
            <i />
          </span>
          <span>
            word<span className="brand-light">padi</span>
            <span className="brand-dot">.</span>
          </span>
        </a>
        <button
          className="quiet-button diamond-desktop"
          onClick={() => setModal('diamonds')}
          aria-label="Open diamond shop"
        >
          <DiamondIcon size={18} />
          {diamonds.balance === null ? 'Diamonds' : Math.max(0, diamonds.balance)}
        </button>
        <span className="header-note">
          <span /> YOUR WORD. YOUR MOVE.
        </span>
        <button
          className="quiet-button"
          disabled={friend.pending || diamonds.busy}
          onClick={() => setModal('games')}
        >
          <Layers size={18} /> My games{' '}
          {turnCount > 0 && <span className="tab-count">{turnCount}</span>}
        </button>
        <button
          className="new-game-button header-new-game"
          disabled={friend.pending || diamonds.busy}
          onClick={() => setModal('new')}
        >
          <Plus size={17} /> New game
        </button>
        <button
          className="quiet-button help-button"
          aria-label="How to play"
          onClick={() => setModal('help')}
        >
          <CircleHelp size={17} />
          <span>How to play</span>
        </button>
      </header>
      <main>
        <section className="page-heading">
          <div>
            <div className="eyebrow">
              <span className="sunburst">✳</span> THE WORD CLUB
            </div>
            <h1>
              Make your next word count<span>.</span>
            </h1>
            <p>Take your time. Find your word. Make it a good one.</p>
          </div>
          <button
            className="new-game-button"
            disabled={friend.pending || diamonds.busy}
            onClick={() => {
              setModal('new');
            }}
          >
            <Plus size={17} /> New game
          </button>
        </section>
        <div className="game-layout">
          <section className="play-area" aria-label="Game board and rack">
            <div className="board-toolbar">
              <button
                className="icon-button zoom-button"
                onClick={toggleZoom}
                aria-label={zoom ? 'Zoom out board' : 'Zoom in board'}
              >
                {zoom ? <ZoomOut size={18} /> : <ZoomIn size={18} />}
                <span>{zoom ? 'Full board' : 'Zoom in'}</span>
              </button>
              <div className="board-timer">
                {multiplayer && friend.snapshot && !finished && (
                  <MatchClock expiresAt={friend.snapshot.expiresAt} waiting={waiting} compact />
                )}
              </div>
            </div>
            <div className="board-status-slot">
              {platform.previewTheme ? (
                <div className="theme-preview-notice">
                  <span>
                    <Eye size={15} /> Trying {platform.previewTheme}
                  </span>
                  <button onClick={() => setModal('themes')}>Back to shop</button>
                  <button aria-label="End theme preview" onClick={() => platform.preview(null)}>
                    <X size={15} />
                  </button>
                </div>
              ) : finished ? (
                <div className="match-result-banner">
                  <Trophy size={23} />
                  <div>
                    <strong>{outcome}</strong>
                    <span>
                      {game.endReason === 'resigned'
                        ? game.resignedBy === 0
                          ? 'You resigned.'
                          : 'Your opponent resigned.'
                        : `${game.scores[0]} – ${game.scores[1]} · Final score`}
                    </span>
                  </div>
                  <button
                    disabled={actionBusy}
                    onClick={() =>
                      multiplayer && friend.code
                        ? requestRematch(friend.code, opponentName)
                        : start()
                    }
                  >
                    Rematch <RotateCcw size={15} />
                  </button>
                </div>
              ) : expired ? (
                <div className="match-expired">
                  <strong>This match has expired.</strong>
                  <span>Start a fresh game to play again.</span>
                  <button onClick={() => setModal('new')}>
                    New game <Plus size={15} />
                  </button>
                </div>
              ) : multiplayer && friend.status !== 'connected' ? (
                <div className="friend-connection" role="status">
                  <div>
                    <strong>
                      {friend.status === 'connecting' ? 'Connecting…' : 'Connection lost'}
                    </strong>
                    <span>{friend.error || 'Reconnecting to your saved game'}</span>
                  </div>
                  {friend.status === 'disconnected' && (
                    <button className="new-game-button" onClick={friend.reconnect}>
                      Reconnect
                    </button>
                  )}
                </div>
              ) : multiplayer && friend.error ? (
                <p className="friend-error" role="alert">
                  {friend.error}
                </p>
              ) : waiting && friend.code ? (
                <InviteCode key={friend.code} code={friend.code} />
              ) : multiplayer && !friend.snapshot?.players[1]?.online ? (
                <div className="friend-connection" role="status">
                  <div>
                    <strong>Your friend is offline</strong>
                    <span>Moves are saved · They can continue when they return</span>
                  </div>
                </div>
              ) : !platform.paused && opponentRackCount > 0 ? (
                <div className="opponent-rack-bar">
                  <OpponentRack count={opponentRackCount} name={opponentName} />
                </div>
              ) : null}
            </div>
            <div ref={boardScrollRef} className={`board-scroll ${zoom ? 'is-zoomed' : ''}`}>
              <div className="board-frame">
                <div className="board" role="group" aria-label="15 by 15 word board">
                  {game.board.flatMap((row, r) =>
                    row.map((tile, c) => {
                      const pending = draft.find((p) => p.row === r && p.col === c);
                      const premium = premiumAt(r, c);
                      const letter = tile?.letter ?? pending?.letter;
                      const isBlank =
                        tile?.blank ??
                        (pending && rack.find((t) => t.id === pending.tileId)?.letter === '?');
                      return (
                        <button
                          key={`${r}-${c}`}
                          className={`square premium-${premium || 'normal'} ${letter ? 'has-tile' : ''} ${pending ? `pending ${preview.ok ? 'pending-valid' : 'pending-invalid'}` : ''} ${tile && lastCells.has(`${r},${c}`) ? `last-play ${opponentPlayed ? 'opponent-last-play' : ''}` : ''} ${tileDrag.drag?.target?.kind === 'board' && tileDrag.drag.target.row === r && tileDrag.drag.target.col === c && !tile ? 'drop-target' : ''} ${pending?.tileId === tileDrag.drag?.id && pending ? 'drag-source' : ''} ${r === 7 && c === 7 ? 'centre' : ''}`}
                          onClick={() => place(r, c)}
                          data-board-row={r}
                          data-board-col={c}
                          onPointerDown={(e) => {
                            if (pending) tileDrag.down(e, pending.tileId);
                          }}
                          onPointerMove={tileDrag.move}
                          onPointerUp={tileDrag.up}
                          onPointerCancel={tileDrag.cancel}
                          onLostPointerCapture={tileDrag.cancel}
                          disabled={!canPlay || !!tile}
                          aria-label={`${String.fromCharCode(65 + c)}${r + 1}: ${letter ? `${letter}${isBlank ? ' blank' : ''}${pending ? ', placed tile, tap to recall' : ''}` : r === 7 && c === 7 ? 'Centre star, double word' : premiumNames[premium]}`}
                        >
                          {letter ? (
                            <>
                              <span className="tile-letter">{letter}</span>
                              <sub>{isBlank ? 0 : tileValue(letter)}</sub>
                              {isBlank && <i className="blank-dot" />}
                            </>
                          ) : r === 7 && c === 7 ? (
                            <span className="centre-star">✦</span>
                          ) : premium ? (
                            <span className="premium-text">
                              {premium[0]}
                              <br />
                              {premium[1]}
                            </span>
                          ) : null}
                        </button>
                      );
                    }),
                  )}
                  {draft.length ? (
                    preview.words && (
                      <WordFeedback
                        words={preview.words}
                        total={preview.ok ? preview.score : undefined}
                      />
                    )
                  ) : opponentPlayed ? (
                    <WordFeedback
                      words={opponentFeedback}
                      opponent={opponentName}
                      total={lastMove.score}
                    />
                  ) : null}
                </div>
              </div>
            </div>
            <div className="board-legend">
              <span>
                <i className="legend-tw" />
                Triple word
              </span>
              <span>
                <i className="legend-dw" />
                Double word
              </span>
              <span>
                <i className="legend-tl" />
                Triple letter
              </span>
              <span>
                <i className="legend-dl" />
                Double letter
              </span>
            </div>
            <div
              data-tile-rack
              className={`rack-panel ${tileDrag.drag?.target?.kind === 'rack' ? 'rack-drop-target' : ''}`}
            >
              <div className="rack-topline">
                <span>
                  <span className="rack-score">
                    You <strong>{game.scores[0]}</strong>
                    {preview.ok && <b className="projected-score">+{preview.score}</b>}
                  </span>
                  <span className="rack-opponent">
                    {opponentName} <strong>{game.scores[1]}</strong>
                  </span>
                  <span className="rack-count">{rack.length - draft.length} in rack</span>
                  <span
                    className="bag-count"
                    aria-label={
                      personalTilesLeft === null
                        ? `${bagCount} tiles in the shared bag`
                        : `${personalTilesLeft} of your 60 tiles left to play, including your rack`
                    }
                  >
                    <Layers size={13} />
                    <strong>{personalTilesLeft ?? bagCount}</strong>{' '}
                    {personalTilesLeft === null ? 'in shared bag' : 'tiles left for you'}
                  </span>
                </span>
                <button
                  className="hint-button"
                  disabled={!canPlay || diamonds.busy}
                  onClick={() => setModal('hint')}
                  aria-label={`Play the best word for ${HINT_COST} diamonds`}
                >
                  <Lightbulb size={15} />
                  <span>Play word</span>
                  <b>{HINT_COST}</b>
                  <DiamondIcon size={12} />
                </button>
                <button
                  className="shuffle-button"
                  onClick={shuffle}
                  disabled={!canPlay}
                  aria-label="Shuffle your rack"
                >
                  <Shuffle size={15} />
                  Shuffle
                </button>
              </div>
              <div className="rack" aria-label="Your tile rack">
                {orderedRack.map((t) => {
                  const used = draft.some((p) => p.tileId === t.id);
                  return (
                    <button
                      key={t.id}
                      className={`rack-tile ${used ? 'used' : ''} ${selected === t.id ? 'selected' : ''} ${tileDrag.drag?.id === t.id ? 'drag-source' : ''}`}
                      disabled={used || !canPlay}
                      aria-label={`${t.letter === '?' ? 'Blank' : t.letter} tile, ${tileValue(t.letter)} points`}
                      aria-pressed={selected === t.id}
                      onClick={() => {
                        setSelected(selected === t.id ? null : t.id);
                        setMessage('');
                      }}
                      onPointerDown={(e) => tileDrag.down(e, t.id)}
                      onPointerMove={tileDrag.move}
                      onPointerUp={tileDrag.up}
                      onPointerCancel={tileDrag.cancel}
                      onLostPointerCapture={tileDrag.cancel}
                    >
                      {!used && (
                        <>
                          <span>{t.letter === '?' ? '' : t.letter}</span>
                          <sub>{tileValue(t.letter)}</sub>
                          {t.letter === '?' && <i className="blank-rack-mark" />}
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
              <div
                className={`turn-message ${draft.length && !preview.ok ? 'draft-message' : ''}`}
                role="status"
              >
                {loadError ? (
                  <span>
                    Couldn’t load the word list.{' '}
                    <button onClick={() => setLoadAttempt((n) => n + 1)}>Retry</button>
                  </span>
                ) : !wordsText ? (
                  'Getting the word list ready…'
                ) : multiplayer && (waiting || opponentTurn || friend.pending) ? (
                  waiting ? (
                    'Share your code to invite a friend.'
                  ) : friend.pending ? (
                    'Submitting your move…'
                  ) : (
                    `${opponentName}’s turn`
                  )
                ) : botError && !multiplayer ? (
                  <span>
                    {botError} <button onClick={() => setRetry((n) => n + 1)}>Retry turn</button>
                  </span>
                ) : finished ? (
                  'Game complete. Ready for another round?'
                ) : isThinking ? (
                  <span className="thinking">
                    <i />
                    <i />
                    <i /> Ayo is finding a word…
                  </span>
                ) : (
                  message ||
                  (draft.length ? (
                    preview.ok ? (
                      <span className="sr-only">
                        Valid {preview.words.map((w) => w.word).join(' and ')}. {preview.score}{' '}
                        points. Ready to submit.
                      </span>
                    ) : (
                      <span>{preview.error}</span>
                    )
                  ) : selected ? (
                    'Now tap a square to place your tile.'
                  ) : (
                    'Tap a tile, then a square. Your next good word starts here.'
                  ))
                )}
              </div>
              <div className="rack-actions">
                <ActionIcon label="Game menu" onClick={() => setModal('menu')}>
                  <Menu size={24} />
                </ActionIcon>
                <ActionIcon
                  label="Recall tiles"
                  onClick={clearDraft}
                  disabled={!canPlay || !draft.length}
                >
                  <RotateCcw size={24} />
                </ActionIcon>
                <button className="play-button" onClick={submit} disabled={!canPlay || !preview.ok}>
                  {friend.pending ? 'Submitting…' : 'Submit'}{' '}
                  {preview.ok && <span>+{preview.score}</span>}
                  <ArrowRight size={17} />
                </button>
                <ActionIcon
                  label="Swap tiles"
                  onClick={() => {
                    setSwapIds([]);
                    setModal('exchange');
                  }}
                  disabled={!canPlay || bagCount < 7}
                >
                  <Shuffle size={24} />
                </ActionIcon>
                <ActionIcon
                  label="Pass turn"
                  onClick={() => action('pass')}
                  disabled={!canPlay || !!draft.length}
                >
                  <SkipForward size={24} />
                </ActionIcon>
              </div>
            </div>
          </section>
          <aside className="sidebar">
            <section className="match-card">
              <div className="card-topline">
                <h2>Your table</h2>
                <span className="pill">
                  {finished ? 'FINISHED' : multiplayer ? 'FRIEND MATCH' : 'VS AYO'}
                </span>
              </div>
              <div
                className={`player-row ${showActivePlayer && !opponentTurn ? 'active-player' : ''}`}
              >
                <div className="avatar you-avatar">Y</div>
                <div className="player-info">
                  <h3>
                    You <span>That’s you</span>
                  </h3>
                  <p>
                    {finished
                      ? 'Well played'
                      : isThinking
                        ? 'A word worth waiting for'
                        : game.history.length
                          ? 'Your move'
                          : 'You’re up first'}
                  </p>
                </div>
                <strong className="player-score">{game.scores[0]}</strong>
              </div>
              <div
                className={`player-row ${showActivePlayer && opponentTurn ? 'active-player' : ''}`}
              >
                <div className="avatar ayo-avatar">
                  <Sparkles size={21} />
                </div>
                <div className="player-info">
                  <h3>
                    {opponentName} <span>{multiplayer ? 'Friend' : 'Computer'}</span>
                  </h3>
                  <p>
                    {multiplayer
                      ? opponentTurn
                        ? 'Their turn'
                        : 'Your turn'
                      : isThinking
                        ? 'Thinking of something good…'
                        : 'Your friendly word rival'}
                  </p>
                </div>
                <strong className="player-score">{game.scores[1]}</strong>
              </div>
              <div className="match-stats">
                <div>
                  <span>{bagCount}</span>
                  <p>
                    {personalTilesLeft === null
                      ? 'Tiles in the shared bag'
                      : 'Tiles in your reserve'}
                  </p>
                </div>
                <div>
                  <span>{game.history.length + (finished ? 0 : 1)}</span>
                  <p>{finished ? 'Turns played' : 'Turn number'}</p>
                </div>
              </div>
              <div className="save-status">
                {multiplayer ? (
                  <>
                    <Check size={13} /> Accepted moves saved on the server
                  </>
                ) : saveError || draftSaveFailed ? (
                  <>
                    <WifiOff size={13} /> Saving unavailable in this browser
                  </>
                ) : (
                  <>
                    <Check size={13} /> Progress saved on this device
                  </>
                )}
              </div>
            </section>
            {finished ? (
              <section className="finish-card">
                <Trophy size={27} />
                <h2>{outcome}</h2>
                <p>
                  {game.endReason === 'resigned'
                    ? 'The game ended by resignation.'
                    : game.endReason === 'rack-empty'
                      ? 'The last tile is down.'
                      : 'Six turns without a score.'}{' '}
                  {game.endReason !== 'resigned' && 'Unplayed tile values have been deducted'}
                  {game.endReason === 'rack-empty' ? ' and awarded to the player who finished' : ''}
                  .
                </p>
                <button
                  onClick={() => {
                    setModal('new');
                  }}
                >
                  Another round <ArrowRight size={16} />
                </button>
              </section>
            ) : (
              <section className="tip-card">
                <div className="tip-heading">
                  <Leaf size={16} />
                  <span>A LITTLE WORD WISDOM</span>
                </div>
                <p>
                  {game.history.length
                    ? 'Small words. Big possibilities.'
                    : 'Every great game starts with one little word.'}
                </p>
                <span>
                  {game.history.length
                    ? 'Two-letter words can turn a tight corner into your next big score.'
                    : 'Place your first word across the centre star. It’s a double word score.'}
                </span>
                <div className="tip-illustration" aria-hidden="true">
                  <span>
                    P<sub>3</sub>
                  </span>
                  <span>
                    A<sub>1</sub>
                  </span>
                  <span>
                    L<sub>1</sub>
                  </span>
                  <i>✳</i>
                </div>
              </section>
            )}
            <section className="history-card">
              <div className="card-topline">
                <h2>The word trail</h2>
                <span>
                  {game.history.length ? `${game.history.length} turns` : 'A fresh start'}
                </span>
              </div>
              {game.history.length ? (
                <ol className="history-list list-none overflow-y-auto">
                  {game.history
                    .slice()
                    .reverse()
                    .slice(0, 20)
                    .map((h, i) => (
                      <li key={game.history.length - i}>
                        <span className={`history-dot ${h.player ? 'bot-dot' : ''}`} />
                        <div>
                          <strong>
                            {h.kind === 'play'
                              ? h.words.join(' · ')
                              : h.kind === 'pass'
                                ? 'Passed the turn'
                                : h.kind === 'resign'
                                  ? 'Resigned'
                                  : 'Swapped tiles'}
                          </strong>
                          <span>
                            {h.player ? opponentName : 'You'} · Turn {game.history.length - i}
                          </span>
                        </div>
                        <b>{h.kind === 'play' ? `+${h.score}` : '—'}</b>
                      </li>
                    ))}
                </ol>
              ) : (
                <div className="empty-history">
                  <span>“</span>
                  <p>
                    A blank board.
                    <br />
                    So many possibilities.
                  </p>
                  <small>Your words will find a home here.</small>
                </div>
              )}
            </section>
            {bestWord && (
              <div className="best-word">
                <Trophy size={16} />
                <span>
                  Your best turn <strong>{bestWord.words[0]}</strong>
                </span>
                <b>+{bestWord.score}</b>
              </div>
            )}
          </aside>
        </div>
        <footer>
          <span>
            MADE FOR THE LOVE OF WORDS <span>✳</span>
          </span>
          <span>
            A little wordplay <span className="footer-dot">·</span> Better with friends.
          </span>
        </footer>
      </main>
      {(modal || blank) && (
        <div
          className={`modal-overlay fixed inset-0 z-50 flex justify-center ${['menu', 'games', 'stats', 'themes', 'result', 'diamonds', 'hint'].includes(modal ?? '') ? 'games-overlay items-end min-[761px]:items-center' : 'items-center'}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setModal(null);
              setBlank(null);
            }
          }}
        >
          <div
            className={`modal ${modal === 'themes' ? 'shop-modal' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            ref={modalRef}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close dialog"
              onClick={() => {
                setModal(null);
                setBlank(null);
              }}
            >
              <X size={20} />
            </button>
            {blank ? (
              <>
                <div className="eyebrow">A LITTLE POSSIBILITY</div>
                <h2 id="dialog-title">Pick your blank’s letter.</h2>
                <p>A blank can be any letter. It’s always worth zero points.</p>
                <div className="alphabet-grid grid grid-cols-7">
                  {alphabet.map((l) => (
                    <button key={l} onClick={() => place(blank.row, blank.col, blank.tileId, l)}>
                      {l}
                    </button>
                  ))}
                </div>
              </>
            ) : modal === 'menu' ? (
              <div className="game-menu">
                <h2 id="dialog-title">Game menu</h2>
                <nav aria-label="Game options">
                  <button onClick={() => setModal('history')}>
                    <Trophy size={21} />
                    <span>Word trail</span>
                    <ArrowRight size={17} />
                  </button>
                  <button onClick={() => setModal('dictionary')}>
                    <BookOpen size={21} />
                    <span>Word check</span>
                    <ArrowRight size={17} />
                  </button>
                  {!finished && !waiting && !expired && (
                    <button
                      className="game-menu-resign"
                      disabled={
                        actionBusy ||
                        diamonds.busy ||
                        (multiplayer && friend.status !== 'connected')
                      }
                      onClick={() => {
                        setActionError('');
                        setModal('resign');
                      }}
                    >
                      <Flag size={21} />
                      <span>Resign game</span>
                      <ArrowRight size={17} />
                    </button>
                  )}
                </nav>
              </div>
            ) : modal === 'diamonds' ? (
              <DiamondShop wallet={diamonds} />
            ) : modal === 'hint' ? (
              <HintPanel
                wallet={diamonds}
                searched={hintSearched}
                onFind={() => void requestHint()}
                onShop={() => setModal('diamonds')}
                canFind={turnReady}
              />
            ) : modal === 'games' ? (
              <MyGames
                computer={soloGame}
                turnCount={turnCount}
                onStats={() => setModal('stats')}
                onShop={() => setModal('themes')}
                onRematch={requestRematch}
                currentCode={friend.code}
                onComputer={() => {
                  friend.leave();
                  setModal(null);
                }}
                onJoin={(code) => {
                  if (code !== friend.code) friend.join(code);
                  setModal(null);
                }}
                onNew={() => setModal('new')}
              />
            ) : modal === 'themes' ? (
              <BoardThemes platform={platform} onPreview={() => setModal(null)} />
            ) : modal === 'stats' ? (
              <PlayerStats account={account} />
            ) : modal === 'result' ? (
              <div
                className={`game-result result-${winnerOf(game) === null ? 'draw' : winnerOf(game) === 0 ? 'win' : 'loss'}`}
              >
                <div className="result-medal">
                  <Trophy size={34} />
                </div>
                <div className="eyebrow">THAT’S A WRAP</div>
                <h2 id="dialog-title">
                  {winnerOf(game) === null
                    ? 'A perfect match.'
                    : winnerOf(game) === 0
                      ? 'You won!'
                      : `${opponentName} wins.`}
                </h2>
                <p>
                  {winnerOf(game) === null
                    ? 'All square. One more round to settle it?'
                    : winnerOf(game) === 0
                      ? 'Good words. Great game. Take your bow.'
                      : 'A good game, and another chance is waiting.'}
                </p>
                <div className="result-scoreboard">
                  <div className={winnerOf(game) === 0 ? 'winner' : ''}>
                    <span>You</span>
                    <strong>{game.scores[0]}</strong>
                    <small>{winnerOf(game) === 0 ? 'WINNER' : 'POINTS'}</small>
                  </div>
                  <span>—</span>
                  <div className={winnerOf(game) === 1 ? 'winner' : ''}>
                    <span>{opponentName}</span>
                    <strong>{game.scores[1]}</strong>
                    <small>{winnerOf(game) === 1 ? 'WINNER' : 'POINTS'}</small>
                  </div>
                </div>
                <p className="result-reason">
                  {game.endReason === 'resigned'
                    ? game.resignedBy === 0
                      ? 'You resigned. Your opponent takes the win.'
                      : `${opponentName} resigned. You take the win.`
                    : game.endReason === 'rack-empty'
                      ? 'One player has used all their tiles. Final rack adjustments are included.'
                      : 'The game ended after six scoreless turns. Final tile adjustments are included.'}
                </p>
                <button
                  className="play-button modal-primary"
                  onClick={() =>
                    multiplayer && friend.code ? requestRematch(friend.code, opponentName) : start()
                  }
                >
                  <RotateCcw size={17} /> Play again
                </button>
                <button className="result-games" onClick={() => setModal('games')}>
                  <Layers size={17} /> My games
                </button>
                <button className="result-history" onClick={() => setModal('history')}>
                  View the word trail <ArrowRight size={14} />
                </button>
              </div>
            ) : modal === 'resign' ? (
              <div className="decision-panel">
                <span className="decision-icon">
                  <Flag size={26} />
                </span>
                <div className="eyebrow">LEAVE THE TABLE</div>
                <h2 id="dialog-title">Call this one?</h2>
                <p>
                  Resigning ends this game and gives {opponentName} the win. Your other games stay
                  right where you left them.
                </p>
                {actionError && (
                  <p role="alert" className="friend-error">
                    {actionError}
                  </p>
                )}
                <button
                  className="play-button modal-primary"
                  disabled={actionBusy}
                  onClick={() => setModal(null)}
                >
                  Keep playing
                </button>
                <button
                  className="resign-confirm"
                  disabled={actionBusy || expired}
                  onClick={() => void resign()}
                >
                  {actionBusy ? 'Saving…' : 'Resign game'}
                </button>
              </div>
            ) : modal === 'rematch' ? (
              <div className="decision-panel">
                <span className="decision-icon">
                  <RotateCcw size={26} />
                </span>
                <div className="eyebrow">ONE MORE ROUND</div>
                <h2 id="dialog-title">Again, {rematchTarget?.opponent}?</h2>
                <p>
                  A fresh board, fresh tiles. Share the new code with {rematchTarget?.opponent};
                  their seat is reserved. Your previous result stays in Records.
                </p>
                {actionError && (
                  <p role="alert" className="friend-error">
                    {actionError}
                  </p>
                )}
                <button
                  className="play-button modal-primary"
                  disabled={actionBusy}
                  onClick={() => void rematch()}
                >
                  {actionBusy ? 'Preparing your table…' : 'Start rematch'}
                  <ArrowRight size={17} />
                </button>
                <button
                  className="quiet-button modal-help"
                  disabled={actionBusy}
                  onClick={() => setModal('games')}
                >
                  Back to My games
                </button>
              </div>
            ) : modal === 'friends' ? (
              <FriendLobby
                onJoin={(code) => {
                  friend.join(code);
                  setModal(null);
                }}
              />
            ) : modal === 'new' ? (
              <>
                <div className="eyebrow">PULL UP A CHAIR</div>
                <h2 id="dialog-title">A fresh board awaits.</h2>
                <p>
                  Challenge a friend or play against Ayo.
                  {!multiplayer && game.history.length > 0 && !finished
                    ? ' Starting again replaces your saved game.'
                    : ''}
                </p>
                <button className="play-button modal-primary" onClick={() => setModal('friends')}>
                  <Users size={18} /> Play a friend
                </button>
                <button className="new-game-button modal-primary" onClick={start}>
                  Play against Ayo <ArrowRight size={18} />
                </button>
                <button className="quiet-button modal-help" onClick={() => setModal('themes')}>
                  <Palette size={17} /> Theme shop
                </button>
                <button className="quiet-button modal-help" onClick={() => setModal('stats')}>
                  <BarChart3 size={17} /> My stats & achievements
                </button>
                <button className="quiet-button modal-help" onClick={() => setModal('help')}>
                  <CircleHelp size={17} /> How to play
                </button>
              </>
            ) : modal === 'history' ? (
              <>
                <div className="eyebrow">YOUR TABLE</div>
                <h2 id="dialog-title">{finished ? outcome : 'The word trail'}</h2>
                <p>
                  You: {game.scores[0]}
                  {` · ${opponentName}: ${game.scores[1]}`} ·{' '}
                  {personalTilesLeft === null
                    ? `${bagCount} in the shared bag`
                    : `${personalTilesLeft} tiles left for you (${bagCount} in reserve)`}
                </p>
                {finished && (
                  <p>
                    {game.endReason === 'resigned'
                      ? game.resignedBy === 0
                        ? 'You resigned. Your opponent wins.'
                        : 'Your opponent resigned. You win.'
                      : 'Remaining tile values have been deducted from the final scores.'}
                  </p>
                )}
                <ol className="history-list">
                  {game.history
                    .slice()
                    .reverse()
                    .map((h, i) => (
                      <li key={i}>
                        <div>
                          <strong>
                            {h.kind === 'play'
                              ? h.words.join(' · ')
                              : h.kind === 'pass'
                                ? 'Passed'
                                : h.kind === 'resign'
                                  ? 'Resigned'
                                  : 'Swapped tiles'}
                          </strong>
                          <span>
                            {h.player ? opponentName : 'You'} · Turn {game.history.length - i}
                          </span>
                        </div>
                        <b>{h.score ? `+${h.score}` : '—'}</b>
                      </li>
                    ))}
                </ol>
                {!game.history.length && <p>Your first word starts the story.</p>}
                {finished && (
                  <button
                    className="rematch-cta"
                    onClick={() =>
                      multiplayer && friend.code
                        ? requestRematch(friend.code, opponentName)
                        : start()
                    }
                  >
                    <RotateCcw size={17} /> Rematch with {opponentName}
                  </button>
                )}
                {!finished && !waiting && !expired && (
                  <button
                    className="resign-confirm"
                    onClick={() => {
                      setActionError('');
                      setModal('resign');
                    }}
                  >
                    <Flag size={15} /> Resign game
                  </button>
                )}
                <button
                  className="play-button modal-primary"
                  onClick={() => {
                    setModal('new');
                  }}
                >
                  New game <Plus size={18} />
                </button>
              </>
            ) : modal === 'help' ? (
              <>
                <div className="eyebrow">WELCOME TO THE TABLE</div>
                <h2 id="dialog-title">Good words start here.</h2>
                <ol className="rules">
                  <li>
                    <strong>Pick. Place. Play.</strong>
                    <p>
                      Tap a tile, then a square. Tap a placed tile to take it back. You can also
                      drag tiles from your rack. Drag unsubmitted tiles to another square or back to
                      your rack.
                    </p>
                  </li>
                  <li>
                    <strong>Keep it connected.</strong>
                    <p>
                      Your first word covers the centre star. After that, connect to the board.
                      Place new tiles in one row or column; every word formed must be valid.
                    </p>
                  </li>
                  <li>
                    <strong>Make the squares count.</strong>
                    <p>
                      DL and TL multiply a letter. DW and TW multiply the whole word. Bonuses apply
                      only when a tile is first placed. Use all seven tiles for 50 extra points.
                    </p>
                  </li>
                  <li>
                    <strong>Find your next move.</strong>
                    <p>
                      New games give each player 60 tiles: 2 blanks, 28 vowels and 30 consonants.
                      Hold up to seven at a time. Blanks can be any letter and score zero. Swap when
                      at least seven tiles remain in your reserve; swapping uses your turn.
                    </p>
                  </li>
                  <li>
                    <strong>Finish strong.</strong>
                    <p>
                      The game ends when a player uses all 60 of their tiles, or after six
                      consecutive scoreless turns. Unplayed rack tiles are deducted; a player who
                      finishes their supply receives their opponent’s remaining rack points. Earlier
                      games keep their shared bag rules.
                    </p>
                  </li>
                </ol>
                <p className="dictionary-note">
                  WordPadi English includes our original word list plus reviewed modern English
                  additions from SCOWL. This is a casual game dictionary, not an official Scrabble
                  tournament list.{' '}
                  <a href="/dictionary-license.txt" target="_blank" rel="noreferrer">
                    Dictionary credits <ArrowUpRight size={12} />
                  </a>
                </p>
              </>
            ) : modal === 'dictionary' ? (
              <>
                <div className="eyebrow">A LITTLE WORD CONFIDENCE</div>
                <h2 id="dialog-title">Is that a word?</h2>
                <p>Check our English word list before you commit.</p>
                <label className="lookup-label" htmlFor="word-lookup">
                  Your word
                </label>
                <input
                  id="word-lookup"
                  autoFocus
                  className="word-input"
                  placeholder="Try FRIEND… or HELLO"
                  maxLength={15}
                  value={lookup}
                  onChange={(e) => setLookup(e.target.value.replace(/[^a-z]/gi, '').toUpperCase())}
                />
                {lookup.length >= 2 && wordsText ? (
                  <div className={`lookup-result ${dictionary.has(lookup) ? 'valid' : 'invalid'}`}>
                    {dictionary.has(lookup) ? <Check size={21} /> : <X size={21} />}
                    <span>
                      <strong>{lookup}</strong>
                      {dictionary.has(lookup)
                        ? ' is in our word list.'
                        : ' isn’t in our word list.'}
                    </span>
                  </div>
                ) : (
                  <p className="lookup-hint">
                    {wordsText ? 'Enter at least two letters.' : 'The word list is loading…'}
                  </p>
                )}
                <p className="dictionary-note">
                  Check a word before submitting. Board placement and any crossing words still need
                  to be valid.
                </p>
              </>
            ) : (
              <>
                <div className="eyebrow">CHANGE YOUR LETTERS</div>
                <h2 id="dialog-title">Fresh tiles, fresh ideas.</h2>
                <p>
                  Choose tiles to swap. This uses your turn and recalls any tiles you’ve placed.
                </p>
                <div className="exchange-rack">
                  {rack.map((t) => (
                    <button
                      className={`rack-tile ${swapIds.includes(t.id) ? 'selected' : ''}`}
                      key={t.id}
                      aria-label={`Swap ${t.letter === '?' ? 'blank' : t.letter} tile`}
                      aria-pressed={swapIds.includes(t.id)}
                      onClick={() =>
                        setSwapIds((ids) =>
                          ids.includes(t.id) ? ids.filter((id) => id !== t.id) : [...ids, t.id],
                        )
                      }
                    >
                      <span>{t.letter === '?' ? '' : t.letter}</span>
                      <sub>{tileValue(t.letter)}</sub>
                    </button>
                  ))}
                </div>
                <button
                  className="play-button modal-primary"
                  disabled={!swapIds.length}
                  onClick={() => action('exchange')}
                >
                  Swap {swapIds.length || ''} {swapIds.length === 1 ? 'tile' : 'tiles'}{' '}
                  <Shuffle size={17} />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
