// public/js/meld-visuals.js

window.MeldVisuals = (() => {
  let _lastGrouped = [];

  function getCardById(id) {
    return GameState.lastHand.find((c) => GameState.cardIdFromCard(c) === id);
  }

  function isValidSet(cards) {
    if (cards.length < 3) return false;
    const rank = cards[0].rank;
    if (!cards.every((c) => c.rank === rank)) return false;
    const suits = new Set(cards.map((c) => c.suit));
    return suits.size === cards.length;
  }

  function isValidRun(cards) {
    if (cards.length < 3) return false;

    const suit = cards[0].suit;
    if (!cards.every((c) => c.suit === suit)) return false;

    // IMPORTANT: use the current order (no sorting)
    const vals = cards.map((c) => GameState.rankOrder[c.rank]);

    // must be strictly increasing by 1 in the order shown
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] !== vals[i - 1] + 1) return false;
    }
    return true;
  }

  // Find contiguous meld blocks based on CURRENT player order
  function findGroupedMeldBlocks() {
    const cardsInOrder = GameState.handOrder.map(getCardById).filter(Boolean);
    const groups = [];
    let i = 0;

    while (i < cardsInOrder.length) {
      let best = null;

      // longest run starting at i
      for (let j = i + 2; j < cardsInOrder.length; j++) {
        const slice = cardsInOrder.slice(i, j + 1);
        if (isValidRun(slice)) {
          const ids = slice.map((c) => GameState.cardIdFromCard(c));
          if (!best || ids.length > best.length) best = ids;
        }
      }

      // set starting at i (prefer 4 over 3)
      for (const len of [4, 3]) {
        const slice = cardsInOrder.slice(i, i + len);
        if (slice.length === len && isValidSet(slice)) {
          const ids = slice.map((c) => GameState.cardIdFromCard(c));
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

    return groups; // array of id arrays
  }

  let _highlightEnabled = true;

  function setHighlightEnabled(v) {
    _highlightEnabled = !!v;
  }

  function layoutCoversAllButDeadwood(maxDeadwoodCards = 1) {
    if (!GameState.userHasManuallyOrdered) return false;

    const cardsInOrder = GameState.handOrder.map(getCardById).filter(Boolean);
    const grouped = findGroupedMeldBlocks();
    if (!grouped.length) return false;

    const meldIds = new Set(grouped.flat());
    const deadwood = cardsInOrder.filter(
      (c) => !meldIds.has(GameState.cardIdFromCard(c))
    );

    return deadwood.length <= maxDeadwoodCards;
  }

  function clearMeldVisuals(handNodeById) {
    handNodeById.forEach((el) => {
      el.classList.remove(
        "meld-glow",
        "meld-glow-1",
        "meld-glow-2",
        "meld-glow-3",
        "meld-glow-4",
        "meld-gap",
        "meld-inner-gap"
      );
    });
  }

  function applyGroupedMeldGlow(handNodeById, grouped) {
    grouped.forEach((group, i) => {
      const cls = `meld-glow-${(i % 4) + 1}`; // 1..4 cycle
      group.forEach((id) => {
        const el = handNodeById.get(id);
        if (el) el.classList.add("meld-glow", cls);
      });
    });
  }

  function refresh() {
    const handDiv = document.getElementById("hand");
    if (!handDiv) return;

    const handNodeById = new Map(
      [...handDiv.querySelectorAll(".card")].map((n) => [n.dataset.cardId, n])
    );

    clearMeldVisuals(handNodeById);

    if (!_highlightEnabled) return;
    if (!GameState.userHasManuallyOrdered) return;

    const grouped = findGroupedMeldBlocks();
    _lastGrouped = grouped.map((g) => g.slice()); // defensive copy
    applyGroupedMeldGlow(handNodeById, grouped);
  }

  function pushHighlightedMelds(handDiv) {
    if (!GameState.userHasManuallyOrdered) return;

    const hd = handDiv || document.getElementById("hand");
    if (!hd) return;

    const grouped = Array.isArray(_lastGrouped) ? _lastGrouped : [];
    if (!grouped.length) return;

    const meldSet = new Set(grouped.flat());

    // Keep player's internal order within each meld block
    const front = [];
    for (const g of grouped) {
      const gSet = new Set(g);
      for (const id of GameState.handOrder) if (gSet.has(id)) front.push(id);
    }

    const rest = GameState.handOrder.filter((id) => !meldSet.has(id));
    const nextOrder = [...front, ...rest];

    // No-op if already in that order (prevents jitter)
    const same =
      nextOrder.length === GameState.handOrder.length &&
      nextOrder.every((id, i) => id === GameState.handOrder[i]);
    if (same) return;

    GameState.handOrder = nextOrder;

    // Reorder DOM to match
    const nodeById = new Map(
      [...hd.querySelectorAll(".card")].map((n) => [n.dataset.cardId, n])
    );

    GameState.handOrder.forEach((id) => {
      const node = nodeById.get(id);
      if (node) hd.appendChild(node);
    });
  }

  return {
    refresh,
    pushHighlightedMelds,
    layoutCoversAllButDeadwood,
    setHighlightEnabled,
  };
})();
