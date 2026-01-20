/**
 * Gin Rummy server (HTTP + WebSocket)
 *
 * High-level flow:
 * - Clients create/join rooms via WS messages.
 * - Server owns authoritative game state per room.
 * - Server pushes frequent `state` snapshots + occasional event messages (`round_reveal`, `timeout_discard`).
 *
 * Client compatibility targets (socket-handler.js):
 * - Outgoing server messages: init, room_update, join_ok, join_error, game_start, state, round_reveal, timeout_discard
 * - Incoming client actions: draw-deck, draw-discard, discard, gin, rematch, hand_order (+ supported aliases)
 
 client ID
 680046667724-utihfh41n2riu7u4fkombuj15d578ipp.apps.googleusercontent.com
 client secret
 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

 db connnection string = postgresql://postgres:[YOUR-PASSWORD]@db.bywpqhwumxibkdcamczs.supabase.co:5432/postgres
 */

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const Rooms = require("./rooms");
const crypto = require("crypto");
const cookie = require("cookie");
const mysql = require("mysql2/promise");
const { OAuth2Client } = require("google-auth-library");


const app = express();
const server = http.createServer(app);

// -------------------- Health (Northflank readiness) --------------------
app.get("/health", (req, res) => res.status(200).send("ok"));

// -------------------- MySQL (IONOS) --------------------
const db = mysql.createPool({
  host: process.env.DB_HOST,                 // e.g. 19438372.hosting-data.io
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

// -------------------- Google OAuth --------------------
// IMPORTANT: set these env vars on Northflank later:
// GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, FRONTEND_ORIGIN
const GOOGLE_REDIRECT_URI = "https://api.ellisandcodesigns.co.uk/auth/google/callback";

const oauth = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);

// -------------------- Sessions --------------------
function newSessionId() {
  return crypto.randomBytes(32).toString("hex"); // 64 chars
}

function buildSessionCookie() {
  // Cookie scoped to api. domain automatically, HttpOnly prevents JS access.
  // SameSite=Lax works well for OAuth redirects + normal navigation.
  return [
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=2592000", // 30 days
  ].join("; ");
}

async function createSession(userId) {
  const sid = newSessionId();
  await db.execute(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))",
    [sid, userId]
  );
  return sid;
}

async function getUserBySessionId(sid) {
  const [rows] = await db.execute(
    `
    SELECT u.id, u.email, p.display_name, p.avatar_url
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    JOIN profiles p ON p.user_id = u.id
    WHERE s.id = ?
      AND s.revoked_at IS NULL
      AND s.expires_at > NOW()
    LIMIT 1
    `,
    [sid]
  );
  return rows[0] || null;
}

function requireEnv(name) {
  if (!process.env[name]) throw new Error(`Missing env var: ${name}`);
}

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN;

app.use((req, res, next) => {
  if (FRONTEND_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", FRONTEND_ORIGIN);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});


// -------------------- Auth routes --------------------
app.get("/auth/google/start", (req, res) => {
  requireEnv("GOOGLE_CLIENT_ID");
  requireEnv("GOOGLE_CLIENT_SECRET");
  requireEnv("FRONTEND_ORIGIN");

  const url = oauth.generateAuthUrl({
    access_type: "offline",
    scope: ["openid", "email", "profile"],
    prompt: "select_account",
  });

  res.redirect(url);
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send("Missing code");

    const { tokens } = await oauth.getToken(String(code));
    if (!tokens.id_token) return res.status(400).send("Missing id_token");

    const ticket = await oauth.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const googleSub = payload.sub;
    const email = payload.email;
    const name = payload.name || "Player";
    const picture = payload.picture || null;

    // Upsert user
    let userId = null;

    const [bySub] = await db.execute("SELECT id FROM users WHERE google_sub = ? LIMIT 1", [googleSub]);
    if (bySub[0]) {
      userId = bySub[0].id;
      await db.execute("UPDATE users SET last_login_at = NOW() WHERE id = ?", [userId]);
    } else {
      const [byEmail] = await db.execute("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
      if (byEmail[0]) {
        userId = byEmail[0].id;
        await db.execute(
          "UPDATE users SET google_sub = ?, last_login_at = NOW() WHERE id = ?",
          [googleSub, userId]
        );
      } else {
        const [ins] = await db.execute(
          "INSERT INTO users (email, google_sub, last_login_at) VALUES (?, ?, NOW())",
          [email, googleSub]
        );
        userId = ins.insertId;

        const displayName = String(name).slice(0, 50);
        await db.execute(
          "INSERT INTO profiles (user_id, display_name, avatar_url) VALUES (?, ?, ?)",
          [userId, displayName, picture]
        );
      }
    }

    // Ensure profile exists (in case of linking an old user)
    await db.execute(
      "INSERT IGNORE INTO profiles (user_id, display_name, avatar_url) VALUES (?, ?, ?)",
      [userId, String(name).slice(0, 50), picture]
    );

    const sid = await createSession(userId);

    res.setHeader("Set-Cookie", `sid=${sid}; ${buildSessionCookie()}`);
    res.redirect(process.env.FRONTEND_ORIGIN);
  } catch (err) {
    console.error("Google callback error:", err);
    res.status(500).send("Auth failed");
  }
});

app.post("/auth/logout", express.json(), async (req, res) => {
  const cookies = cookie.parse(req.headers.cookie || "");
  const sid = cookies.sid;

  if (sid) {
    await db.execute("UPDATE sessions SET revoked_at = NOW() WHERE id = ? LIMIT 1", [sid]);
    res.setHeader(
      "Set-Cookie",
      "sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
    );
  }

  res.status(200).json({ ok: true });
});

app.get("/me", async (req, res) => {
  const cookies = cookie.parse(req.headers.cookie || "");
  const sid = cookies.sid;

  if (!sid) return res.status(200).json({ user: null });

  const user = await getUserBySessionId(sid);
  return res.status(200).json({ user });
});



/**
 * Origin allow-list:
 * - `verifyClient` blocks unknown origins for browser WS connections.
 * - Keep dev URLs + your production domain here.
 */
const envAllowed = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const allowed = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://192.168.1.71:3000",
  ...envAllowed,
]);


/**
 * WS server:
 * - verifyClient runs during handshake; reject unexpected Origin headers.
 * - Note: some non-browser WS clients omit Origin.
 */
const wss = new WebSocket.Server({
  server,
  verifyClient: async (info, done) => {
    try {
      const origin = info.origin;

      // Require Origin in production
      if (!origin) {
        if (process.env.NODE_ENV !== "production") return done(true);
        return done(false, 401, "Origin required");
      }

      if (!allowed.has(origin)) return done(false, 401, "Origin not allowed");

      // OPTIONAL: require sign-in for WS connections
      // If you want guests allowed for now, comment this whole block out.
      const cookies = cookie.parse(info.req.headers.cookie || "");
      const sid = cookies.sid;

      if (sid) {
        const user = await getUserBySessionId(sid);
        if (user) info.req.user = user;
      }

      // Always allow the connection (origin is still enforced)
      return done(true);
    } catch (e) {
      console.error("verifyClient error:", e);
      return done(false, 401, "Unauthorized");
    }
  },
});



/**
 * Static hosting:
 * - serves /public (client)
 * - HTTP server also carries WS upgrade.
 */
const path = require("path");
app.use(express.static(path.join(__dirname, "..", "public")));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`HTTP+WS server running on http://localhost:${PORT}`);
});

/* =========================== CARD / RULE HELPERS =========================== */
/**
 * These helpers are used by:
 * - deadwood scoring / meld validation
 * - deck/hand serialization and card identity (cardId)
 */

const rankOrder = {
  A: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8,
  9: 9,
  10: 10,
  J: 11,
  Q: 12,
  K: 13,
};

function cardValue(card) {
  // Deadwood points: face cards = 10, ace = 1, number cards = numeric.
  if (["J", "Q", "K"].includes(card.rank)) return 10;
  if (card.rank === "A") return 1;
  return Number(card.rank);
}

function cardId(card) {
  // Stable identity used by:
  // - client DOM keys/order tracking
  // - server action matching (discard) and deadwood order
  return `${card.rank}${card.suit}`;
}

function shuffleInPlace(arr) {
  // Fisher–Yates shuffle (in-place).
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Deck replenishment:
 * If deck is empty, keep the current top discard card and shuffle the rest back into the deck.
 * This keeps the discard pile meaningful while ensuring the game can continue.
 */
function replenishDeckFromDiscard(game) {
  if (game.deck.length > 0) return false;
  if (!game.discardPile || game.discardPile.length < 2) return false;

  const top = game.discardPile.pop();
  const toShuffle = game.discardPile.splice(0);

  shuffleInPlace(toShuffle);
  game.deck = toShuffle;
  game.discardPile = [top];
  return true;
}

function maybeReplenish(game) {
  // Returns info object if replenishment happened; otherwise null.
  const before = game.deck.length;
  const did = replenishDeckFromDiscard(game);
  if (!did) return null;

  return {
    before,
    after: game.deck.length,
    ts: Date.now(),
  };
}

/**
 * Deadwood evaluation:
 * Uses the player's last known hand order (sent by client) to detect meld groups as contiguous blocks.
 * This mirrors client behavior (so server validation matches the UI representation).
 */
function deadwoodFromPlayerOrder(hand, orderIds = []) {
  const cards = (hand || []).filter(Boolean);

  // Lookup card objects by id for quick mapping.
  const byId = new Map(cards.map((c) => [cardId(c), c]));

  // No order recorded: treat all cards as deadwood (stable fallback).
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    const deadwoodPoints = cards.reduce((sum, c) => sum + cardValue(c), 0);
    return {
      meldGroups: [],
      deadwood: cards,
      deadwoodPoints,
      deadwoodCount: cards.length,
    };
  }

  // Reconstruct "visual order": known ids first, then any missing cards appended.
  const ordered = orderIds.map((id) => byId.get(id)).filter(Boolean);
  const seen = new Set(ordered.map(cardId));
  const missing = cards.filter((c) => !seen.has(cardId(c)));
  const orderedFull = [...ordered, ...missing];

  function isValidSet(block) {
    // 3+ of same rank, all suits unique.
    if (block.length < 3) return false;
    const r = block[0].rank;
    if (!block.every((c) => c.rank === r)) return false;
    const suits = new Set(block.map((c) => c.suit));
    return suits.size === block.length;
  }

  function isValidRun(block) {
    // 3+ consecutive ranks in the same suit, already ordered by the player.
    if (block.length < 3) return false;
    const suit = block[0].suit;
    if (!block.every((c) => c.suit === suit)) return false;

    const vals = block.map((c) => rankOrder[c.rank]);
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] !== vals[i - 1] + 1) return false;
    }
    return true;
  }

  /**
   * Finds meld blocks by scanning left-to-right and choosing the "best" meld starting at each index:
   * - Prefer the longest run
   * - Otherwise prefer a 4-card set over a 3-card set
   *
   * Output is arrays of cardIds so we can map back to card objects.
   */
  function findGroupedMeldBlocksInOrder(cardsInOrder) {
    const groups = [];
    let i = 0;

    while (i < cardsInOrder.length) {
      let best = null;

      // Longest run starting at i.
      for (let j = i + 2; j < cardsInOrder.length; j++) {
        const slice = cardsInOrder.slice(i, j + 1);
        if (isValidRun(slice)) {
          const ids = slice.map(cardId);
          if (!best || ids.length > best.length) best = ids;
        }
      }

      // Set starting at i (prefer 4 over 3).
      for (const len of [4, 3]) {
        const slice = cardsInOrder.slice(i, i + len);
        if (slice.length === len && isValidSet(slice)) {
          const ids = slice.map(cardId);
          if (!best || ids.length > best.length) best = ids;
        }
      }

      if (best) {
        groups.push(best);
        i += best.length;
      } else {
        i++;
      }
    }

    return groups;
  }

  const meldGroupsIds = findGroupedMeldBlocksInOrder(orderedFull);
  const meldIdSet = new Set(meldGroupsIds.flat());

  const deadwood = orderedFull.filter((c) => !meldIdSet.has(cardId(c)));
  const deadwoodPoints = deadwood.reduce((sum, c) => sum + cardValue(c), 0);

  // For overlays/reveal: return actual card objects grouped by meld.
  const meldGroups = meldGroupsIds.map((ids) =>
    ids.map((id) => byId.get(id)).filter(Boolean),
  );

  return {
    meldGroups,
    deadwood,
    deadwoodPoints,
    deadwoodCount: deadwood.length,
  };
}

/* =========================== DECK HELPERS =========================== */
/**
 * Deck creation/shuffling and a deterministic initial sort for a cleaner "deal" UI.
 */

function createDeck() {
  const suits = ["♠", "♥", "♦", "♣"];
  const ranks = [
    { name: "A", value: 1 },
    { name: "2", value: 2 },
    { name: "3", value: 3 },
    { name: "4", value: 4 },
    { name: "5", value: 5 },
    { name: "6", value: 6 },
    { name: "7", value: 7 },
    { name: "8", value: 8 },
    { name: "9", value: 9 },
    { name: "10", value: 10 },
    { name: "J", value: 10 },
    { name: "Q", value: 10 },
    { name: "K", value: 10 },
  ];

  const deck = [];
  for (const suit of suits)
    for (const rank of ranks)
      deck.push({ suit, rank: rank.name, value: rank.value });
  return deck;
}

function shuffle(deck) {
  // Fisher–Yates shuffle (in-place).
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

function sortHandForDeal(hand) {
  // Initial deal ordering: rank ascending, then suit, purely for UI consistency.
  return [...hand].sort((a, b) => {
    const ra = rankOrder[a.rank];
    const rb = rankOrder[b.rank];
    if (ra !== rb) return ra - rb;
    return String(a.suit).localeCompare(String(b.suit));
  });
}

/* =========================== ROOM GAME WRAPPER =========================== */
/**
 * makeRoom() owns ALL per-room state + logic:
 * - sockets[]: connected players (index == playerId)
 * - game: current match state (deck, hands, turn, scores, etc.)
 *
 * This file intentionally keeps gameplay logic inside the room closure so we can:
 * - start/stop timers per room
 * - broadcast state to exactly the sockets in this room
 */

function makeRoom({ code, playersNeeded = 2, targetScore = 10 }) {
  // Next starting player alternates each round (random for first round of a match).
  let nextFirstPlayer = Math.random() < 0.5 ? 0 : 1;

  const room = {
    code,
    playersNeeded,
    sockets: [], // index = playerId
    game: null,
  };

  /* ------------------------- Turn timer / timeout ------------------------- */
  const TURN_MS_DEFAULT = 30000;

  room.turnTimer = null;
  room.turnEndsAt = null;

  // Direct send to a single player (used for "timeout_discard" with cardId).
  function sendTo(playerId, obj) {
    const ws = room.sockets[playerId];
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  // Broadcast to everyone except one player (used for "opponent timed out" notification).
  function broadcastExcept(skipPlayerId, obj) {
    const msg = JSON.stringify(obj);
    room.sockets.forEach((ws, i) => {
      if (i === skipPlayerId) return;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(msg);
    });
  }

  function clearTurnTimer() {
    if (room.turnTimer) clearTimeout(room.turnTimer);
    room.turnTimer = null;
    room.turnEndsAt = null;
  }

  function startTurnTimer(ms = TURN_MS_DEFAULT) {
    clearTurnTimer();
    room.turnEndsAt = Date.now() + ms;

    room.turnTimer = setTimeout(() => {
      onTurnTimeout();
    }, ms);
  }

  function endTurnToNextPlayer() {
    const game = room.game;
    if (!game) return;

    game.currentPlayer = (game.currentPlayer + 1) % 2;
    game.phase = "draw";

    startTurnTimer(game.turnMs ?? TURN_MS_DEFAULT);
    sendState();
  }

  /**
   * Turn timeout behavior:
   * - If current player has 11+ cards (i.e., they should discard), force a random discard.
   * - Notify the timed-out player with the exact cardId (client can animate the removal).
   * - Notify the opponent that a timeout discard occurred (no cardId needed).
   * - Then advance the turn and broadcast new state.
   */
  function onTurnTimeout() {
    const game = room.game;
    if (!game) return;
    if (game.roundOver || game.matchOver) return;

    const pid = game.currentPlayer;
    const hand = game.players[pid]?.hand;

    if (Array.isArray(hand) && hand.length > 10) {
      const idx = Math.floor(Math.random() * hand.length);
      const [card] = hand.splice(idx, 1);
      game.discardPile.push(card);

      const discardedCardId = `${card.rank}${card.suit}`;

      sendTo(pid, {
        type: "timeout_discard",
        playerId: pid,
        cardId: discardedCardId,
      });

      broadcastExcept(pid, { type: "timeout_discard", playerId: pid });
    } else {
      // Optional: signal that the player timed out but no forced discard occurred.
      room.broadcast({ type: "timeout_pass", playerId: pid });
    }

    endTurnToNextPlayer();
  }

  /* ----------------------------- Room messaging ---------------------------- */
  function broadcast(obj) {
    const msg = JSON.stringify(obj);
    room.sockets.forEach((ws) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(msg);
    });
  }

  function sendRoomUpdate() {
    // Used by lobby UI to show how many players joined and when host can start.
    broadcast({
      type: "room_update",
      code: room.code,
      joined: room.sockets.length,
      needed: room.playersNeeded,
    });
  }

  /* -------------------------- Round lifecycle / deal ----------------------- */
  function startRound() {
    // Preserve match-scoped fields between rounds.
    const lastMsg = room.game?.roundMessage ?? null;
    const lastMsgTs = room.game?.roundMessageTs ?? null;
    const nextRoundId = (room.game?.roundId ?? 0) + 1;

    const deck = createDeck();
    const existingScores = room.game?.scores ?? [0, 0];
    const targetScoreLocal = room.game?.targetScore ?? targetScore;

    shuffle(deck);

    const firstPlayer = nextFirstPlayer;
    nextFirstPlayer = 1 - nextFirstPlayer;

    room.game = {
      deck,
      discardPile: [],
      players: [{ hand: [] }, { hand: [] }],
      currentPlayer: firstPlayer,
      phase: "draw",
      roundOver: false,
      winner: null,
      winType: null,
      roundId: nextRoundId,
      lastHandOrder: { 0: [], 1: [] },

      scores: existingScores ?? [0, 0],
      targetScore: targetScoreLocal ?? targetScore,
      matchOver: false,
      matchWinner: null,
      roundMessage: lastMsg,
      roundMessageTs: lastMsgTs,
      rematchVotes: [false, false],
      rematchCountdownEndsAt: null,
      _rematchCountdownTimer: null, // internal only
    };

    // Deal 10 each, then flip one discard to start the pile.
    for (let i = 0; i < 10; i++) {
      room.game.players[0].hand.push(deck.pop());
      room.game.players[1].hand.push(deck.pop());
    }
    room.game.discardPile.push(room.game.deck.pop());

    // Deterministic initial hand order to match the "deal" animation UI.
    room.game.players[0].hand = sortHandForDeal(room.game.players[0].hand);
    room.game.players[1].hand = sortHandForDeal(room.game.players[1].hand);

    // Seed lastHandOrder so client renders exactly in this order immediately after the deal.
    room.game.lastHandOrder = {
      0: room.game.players[0].hand.map(cardId),
      1: room.game.players[1].hand.map(cardId),
    };

    room.game.turnMs = 30000;
    startTurnTimer(room.game.turnMs);

    sendState();
  }

  /* --------------------------- State serialization -------------------------- */
  function sendState() {
    // Server pushes full state snapshots frequently; client treats them as authoritative.
    if (!room.game) return;

    let replenishInfo = null;
    if (room.game.phase === "draw" && room.game.deck.length === 0) {
      // Only replenish when a draw would occur (keeps discard top stable outside draw).
      replenishInfo = maybeReplenish(room.game);
    }

    room.sockets.forEach((ws, index) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const hand = room.game.players[index].hand;
      const oppIndex = index === 0 ? 1 : 0;
      const oppHandCount = room.game.players[oppIndex].hand.length;

      // Compute deadwood based on the player's last reported ordering (mirrors client grouping rules).
      const orderIds = room.game.lastHandOrder?.[index] || [];
      const layout = deadwoodFromPlayerOrder(hand, orderIds);

      ws.send(
        JSON.stringify({
          type: "state",
          code: room.code,

          yourHand: hand,
          yourTurn: room.game.currentPlayer === index,
          phase: room.game.phase,

          discardTop: room.game.discardPile.at(-1),
          deckCount: room.game.deck.length,
          oppHandCount,

          turnEndsAt: room.turnEndsAt,
          turnMs: room.game.turnMs ?? 30000,

          deadwoodCount: layout.deadwoodCount,
          deadwoodPoints: layout.deadwoodPoints, // debug / future UI

          deckReplenished: replenishInfo ? true : false,
          deckReplenishInfo: replenishInfo,

          roundOver: room.game.roundOver,
          winner: room.game.winner,
          winType: room.game.winType,
          roundId: room.game.roundId,
          ginPlayerId: room.game.roundOver ? room.game.winner : null,
          finalDiscard: room.game.discardPile.at(-1) || null,

          scores: room.game.scores,
          targetScore: room.game.targetScore,
          matchOver: room.game.matchOver,
          matchWinner: room.game.matchWinner,

          roundMessage: room.game.roundMessage,
          roundMessageTs: room.game.roundMessageTs,
          rematchVotes: room.game.rematchVotes,
          rematchCountdownEndsAt: room.game.rematchCountdownEndsAt,
        }),
      );
    });
  }

  /* ---------------------------- Client actions ----------------------------- */
  function handleAction(playerId, action) {
    // All client actions enter here. We enforce match/round/turn/phase rules.
    const game = room.game;
    if (!game) return;

    // Backwards/alternate naming support (keeps server compatible with older clients).
    if (action && typeof action.type === "string") {
      const t = action.type;
      if (t === "draw_deck") action.type = "draw-deck";
      if (t === "draw_discard") action.type = "draw-discard";
      if (t === "declare_gin") action.type = "gin";
      if (t === "vote_rematch") action.type = "rematch";
    }

    // Hand order is client-driven UI state; server stores it for scoring/validation.
    if (action.type === "hand_order") {
      if (Array.isArray(action.order)) {
        game.lastHandOrder[playerId] = action.order.slice();
      }
      return;
    }

    // Hard locks: only rematch votes allowed after round/match ends.
    if (game.matchOver && action.type !== "rematch") return;
    if (game.roundOver && action.type !== "rematch") return;

    // Turn lock: only current player can act during live play (except rematch voting).
    if (playerId !== game.currentPlayer && action.type !== "rematch") return;

    // Draw from deck.
    if (action.type === "draw-deck") {
      if (game.phase !== "draw") return;

      const info = maybeReplenish(game);
      if (info) {
        // Optional broadcast event: client may animate deck reshuffle.
        room.broadcast({
          type: "deck_reshuffle",
          code: room.code,
          deckCount: info.after,
          info,
        });
      }

      if (game.deck.length === 0) return;

      const card = game.deck.pop();
      game.players[playerId].hand.push(card);
      game.phase = "discard";
      sendState();
      return;
    }

    // Draw from discard pile.
    if (action.type === "draw-discard") {
      if (game.phase !== "draw") return;
      if (game.discardPile.length === 0) return;

      const card = game.discardPile.pop();
      if (!card) return;

      game.players[playerId].hand.push(card);
      game.phase = "discard";
      sendState();
      return;
    }

    // Discard a card by id (or by card object, depending on client payload).
    if (action.type === "discard") {
      if (game.phase !== "discard") return;

      const hand = game.players[playerId].hand;
      const actionCardId =
        action.cardId ??
        (action.card && action.card.rank && action.card.suit
          ? `${action.card.rank}${action.card.suit}`
          : null);
      if (!actionCardId) return;

      const idx = hand.findIndex((c) => `${c.rank}${c.suit}` === actionCardId);
      if (idx === -1) return;

      const card = hand.splice(idx, 1)[0];
      game.discardPile.push(card);

      endTurnToNextPlayer();
      return;
    }

    // Declare gin: validate deadwood <= 1 for the declaring player.
    if (action.type === "gin") {
      if (game.phase !== "discard") return;
      const winner = playerId;
      const loser = (playerId + 1) % 2;

      const winnerOrder = game.lastHandOrder?.[winner] || [];

      // If we never got a hand order for the winner, fall back to current hand order.
      if (!winnerOrder.length) {
        game.lastHandOrder[winner] = game.players[winner].hand.map(cardId);
      }

      const winnerLayout = deadwoodFromPlayerOrder(
        game.players[winner].hand,
        game.lastHandOrder?.[winner] || [],
      );
      if (winnerLayout.deadwoodCount > 1) return;

      const loserLayout = deadwoodFromPlayerOrder(
        game.players[loser].hand,
        game.lastHandOrder?.[loser] || [],
      );

      // Scoring rule (your variant): loser adds their own deadwood points.
      game.scores[loser] += loserLayout.deadwoodPoints;

      // Compute layouts for the reveal overlay.
      const layouts = {
        0: deadwoodFromPlayerOrder(
          game.players[0].hand,
          game.lastHandOrder?.[0] || [],
        ),
        1: deadwoodFromPlayerOrder(
          game.players[1].hand,
          game.lastHandOrder?.[1] || [],
        ),
      };

      game.roundOver = true;
      game.winner = winner;
      game.winType = "gin";

      // Match end condition: first to reach/exceed target loses (per your logic).
      const hitTarget = game.scores.findIndex((s) => s >= game.targetScore);
      if (hitTarget !== -1) {
        game.matchOver = true;
        game.matchWinner = hitTarget === 0 ? 1 : 0;
        clearTurnTimer();
      }

      console.log("[GIN]", {
        room: room.code,
        winner,
        winnerDeadwood: winnerLayout.deadwoodCount,
        matchOver: game.matchOver,
        matchWinner: game.matchWinner,
      });

      // One-off reveal event: client runs the cinematic/overlay using this payload.
      room.broadcast({
        type: "round_reveal",
        code: room.code,
        roundId: game.roundId,

        ginPlayerId: winner,
        finalDiscard: game.discardPile.at(-1) || null,

        winner,
        loser,
        winType: "gin",

        hands: { 0: game.players[0].hand, 1: game.players[1].hand },
        handOrders: {
          0: game.lastHandOrder?.[0] || [],
          1: game.lastHandOrder?.[1] || [],
        },
        layouts,
        scores: game.scores,
        targetScore: game.targetScore,

        matchOver: game.matchOver,
        matchWinner: game.matchWinner,
      });

      // Follow up with `state` so the client can reconcile final authoritative values.
      sendState();

      // Auto-start next round after reveal animation window (if match continues).
      if (!game.matchOver) setTimeout(() => startRound(), 9000);
      return;
    }

    // Rematch voting: when both players vote, start a short countdown then reset match state.
    if (action.type === "rematch") {
      game.rematchVotes[playerId] = true;
      sendState();

      const bothReady = game.rematchVotes[0] && game.rematchVotes[1];
      if (bothReady && !game.rematchCountdownEndsAt) {
        game.rematchCountdownEndsAt = Date.now() + 5000;
        sendState();

        if (game._rematchCountdownTimer)
          clearTimeout(game._rematchCountdownTimer);
        game._rematchCountdownTimer = setTimeout(() => {
          if (!room.game) return;
          if (!room.game.matchOver) return;

          // Reset match-scoped fields.
          room.game.rematchVotes = [false, false];
          room.game.rematchCountdownEndsAt = null;
          room.game._rematchCountdownTimer = null;

          room.game.lastHandOrder = { 0: [], 1: [] };
          room.game.scores = [0, 0];
          room.game.matchOver = false;
          room.game.matchWinner = null;
          room.game.roundOver = false;
          room.game.winner = null;
          room.game.winType = null;
          room.game.roundMessage = null;
          room.game.roundMessageTs = null;

          nextFirstPlayer = Math.random() < 0.5 ? 0 : 1;

          startRound();
        }, 5000);
      }
      return;
    }
  }

  // Expose room methods used by the connection layer.
  room.broadcast = broadcast;
  room.sendRoomUpdate = sendRoomUpdate;
  room.startRound = startRound;
  room.sendState = sendState;
  room.handleAction = handleAction;
  room.startTurnTimer = startTurnTimer;
  room.clearTurnTimer = clearTurnTimer;

  return room;
}

/* =========================== CONNECTIONS / ROOM COMMANDS =========================== */
/**
 * This section maps WS connections to Rooms + playerIds.
 * - Rooms are created/joined via WS messages
 * - Each WS is assigned: ws.roomCode + ws.playerId
 */

function safeSend(ws, obj) {
  // Centralized safe sender for one-off replies (errors, init, etc.).
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function removeSocketFromRoom(ws) {
  // Called on WS close: removes socket from room, reindexes playerIds, resets game.
  const code = ws.roomCode;
  if (!code) return;

  const room = Rooms.getRoom(code);
  if (!room) return;

  const idx = room.sockets.indexOf(ws);
  if (idx !== -1) room.sockets.splice(idx, 1);

  // After removal, playerId equals the socket's index.
  room.sockets.forEach((sock, i) => {
    sock.playerId = i;
  });

  // Inform remaining clients of their new playerId to prevent UI desync.
  room.sockets.forEach((sock) => {
    if (sock && sock.readyState === WebSocket.OPEN) {
      safeSend(sock, { type: "init", playerId: sock.playerId });
    }
  });

  // Room empty => delete.
  if (room.sockets.length === 0) {
    Rooms.deleteRoom(code);
    return;
  }

  // Update lobby UI counts.
  room.sendRoomUpdate();

  // Simple disconnect rule: terminate the current game.
  if (room.clearTurnTimer) room.clearTurnTimer();
  room.game = null;

  // Optional: inform remaining player they must start a new game/rematch.
  safeSend(room.sockets[0], {
    type: "join_error",
    message: "Player disconnected. Game ended.",
  });
}

wss.on("connection", (ws, req) => {
  // Note: verifyClient already checks Origin, this is extra logging/defense.
   ws.user = req.user || null;

   const origin = req.headers.origin;
  console.log("WS connection attempt, origin =", origin);
  
  if (origin && !allowed.has(origin)) {
    console.log("Blocked WS origin:", origin);
    ws.close();
    return;
  }

  console.log("WS connected origin:", origin);

  // Player identity is assigned during create/join.
  ws.playerId = null;
  ws.roomCode = null;

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return; // ignore malformed messages
    }

    /* ---------------------------- Room creation ---------------------------- */
    if (data.type === "create_room") {
      const code = String(data.code || "")
        .toUpperCase()
        .trim();
      const playersNeeded = Number(data.playersNeeded || 2);
      const pointsTarget = Number(data.pointsTarget || 10);

      if (!code || code.length < 4) {
        safeSend(ws, { type: "join_error", message: "Invalid room code." });
        return;
      }

      // Gameplay currently supports 2 players only.
      if (playersNeeded !== 2) {
        safeSend(ws, {
          type: "join_error",
          message: "4-player not supported yet (2-player only for now).",
        });
        return;
      }

      if (Rooms.hasRoom(code)) {
        safeSend(ws, {
          type: "join_error",
          message: "Code already exists. Try again.",
        });
        return;
      }

      const room = makeRoom({ code, playersNeeded, targetScore: pointsTarget });
      Rooms.setRoom(code, room);

      ws.roomCode = code;
      ws.playerId = 0;
      room.sockets.push(ws);

      // init => client learns its playerId (drives seat/turn UI)
      safeSend(ws, { type: "init", playerId: 0 });
      room.sendRoomUpdate();
      return;
    }

    /* ----------------------------- Room joining ---------------------------- */
    if (data.type === "join_room") {
      const code = String(data.code || "")
        .toUpperCase()
        .trim();
      const room = Rooms.getRoom(code);

      if (!room) {
        safeSend(ws, { type: "join_error", message: "Room not found." });
        return;
      }

      if (room.sockets.length >= room.playersNeeded) {
        safeSend(ws, { type: "join_error", message: "Room is full." });
        return;
      }

      ws.roomCode = code;
      ws.playerId = room.sockets.length;
      room.sockets.push(ws);

      safeSend(ws, { type: "init", playerId: ws.playerId });
      safeSend(ws, { type: "join_ok", code });

      room.sendRoomUpdate();
      return;
    }

    /* -------------------------- Host starts the game ------------------------ */
    if (data.type === "start_game") {
      const code = String(data.code || "")
        .toUpperCase()
        .trim();
      const room = Rooms.getRoom(code);

      if (!room) return;
      if (ws.roomCode !== code) return;
      if (ws.playerId !== 0) return;
      if (room.sockets.length < room.playersNeeded) {
        safeSend(ws, {
          type: "join_error",
          message: "Need more players to start.",
        });
        return;
      }

      room.broadcast({ type: "game_start", code });
      room.startRound();
      return;
    }

    /* ---------------------------- Game actions ----------------------------- */
    const code = ws.roomCode;
    if (!code) return;

    const room = Rooms.getRoom(code);
    if (!room) return;

    if (typeof ws.playerId !== "number") return;

    room.handleAction(ws.playerId, data);
  });

  ws.on("close", () => {
    removeSocketFromRoom(ws);
  });
});
