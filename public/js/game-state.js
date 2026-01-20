// public/js/game-state.js

window.GameState = {
  // socket-related

  playerId: null,
  isYourTurn: false,
  currentPhase: "draw",

  // lobby / rooms
  isHost: false,
  roomCode: null,
  playersNeeded: 2,
  playersJoined: 1,
  pointsTarget: 10,

  // round/game payload
  lastHand: [],
  currentRoundId: null,
  dataLastMeldGroups: [],
  userHasManuallyOrdered: false,

  // ordering
  handOrder: [],
  handOrderInitialized: false,
  reorderCount: 0,

  // drag/drop flags (these used to be globals)
  draggedCardEl: null,
  dropZonesInitialized: false,
  pendingDiscardCardId: null,

  // animation timings
  // discard pile animation sync
  _discardAnimMs: 420,
  _oppDrawAnimMs: 700,
  _oppDiscardAnimMs: 650,
  _discardAnimLock: false,
  _queuedDiscardTop: null,
  _dealAnimRoundId: null,
  _lastOppDiscardAnimId: null,
  _oppDiscardAnimInFlight: false,

  rankOrder: {
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
  },

  suitRank: { "♣": 1, "♦": 2, "♥": 3, "♠": 4 },

  cardIdFromCard(c) {
    return `${c.rank}${c.suit}`;
  },

  resetForNewRound(newRoundId) {
    this.currentRoundId = newRoundId;

    this.handOrderInitialized = false;
    this.handOrder = [];

    this.dropZonesInitialized = false;
    this.draggedCardEl = null;

    this.userHasManuallyOrdered = false;
    this.reorderCount = 0;
    this.dataLastMeldGroups = [];
    this.lastHand = [];

    GameState.lastKnownDeckCount = null;
    GameState._prevDiscardTopId = null;
    GameState._prevOppHandCount = null;
    GameState._prevPhase = null;
    GameState._prevYourTurn = null;

    // 🔽 animation + visual guards
    GameState._pendingOppDrawVisual = null;
    GameState._pendingOppDiscardVisual = null;
    GameState._oppDiscardAnimInFlight = false;
    GameState._lastOppDiscardAnimId = null;
  },

  reconcileHandOrder(hand) {
    const idsInHand = new Set(hand.map(this.cardIdFromCard));

    // first time in a round: sort hand A->K then suit
    if (!this.handOrderInitialized) {
      const sortedOnce = [...hand].sort((a, b) => {
        const ra = this.rankOrder[a.rank];
        const rb = this.rankOrder[b.rank];
        if (ra !== rb) return ra - rb;
        return (this.suitRank[a.suit] || 0) - (this.suitRank[b.suit] || 0);
      });

      this.handOrder = sortedOnce.map(this.cardIdFromCard);
      this.handOrderInitialized = true;
      return;
    }

    // remove cards no longer in hand
    this.handOrder = this.handOrder.filter((id) => idsInHand.has(id));

    // add new cards to the end
    const existing = new Set(this.handOrder);
    const newOnes = hand
      .map(this.cardIdFromCard)
      .filter((id) => !existing.has(id));
    this.handOrder.push(...newOnes);

    // de-dupe handOrder, keep first occurrence
    const seen = new Set();
    this.handOrder = this.handOrder.filter((id) =>
      seen.has(id) ? false : (seen.add(id), true)
    );
  },
};

function discardIdFromTop(top) {
  if (!top) return null;
  // if server sends {rank,suit}:
  if (top.rank && top.suit) return `${top.rank}${top.suit}`;
  // if server sends string id already:
  if (typeof top === "string") return top;
  return JSON.stringify(top);
}

function getOppAnchorRect() {
  const el =
    document.getElementById("opp-hand") ||
    document.getElementById("opponent-area") ||
    document.getElementById("opponent-profile");
  if (!el) return null;
  return el.getBoundingClientRect();
}
