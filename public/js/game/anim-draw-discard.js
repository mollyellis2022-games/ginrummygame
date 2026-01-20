// public/js/game/anim-draw-discard.js
GameState._discardAnimMs = GameState._discardAnimMs ?? 520;
GameState._ginDiscardAnimMs = GameState._ginDiscardAnimMs ?? 1400; // 🔥 dramatic

function normalizeRect(rect) {
  if (!rect) return null;
  // If someone accidentally stored a getter function instead of a DOMRect
  const r = typeof rect === "function" ? rect() : rect;
  if (r && typeof r.left === "number" && typeof r.top === "number") return r;
  return null;
}

function captureDrawStart(source) {
  // source: "deck" | "discard"
  const fromEl =
    source === "discard"
      ? document.querySelector("#discard .card")
      : document.querySelector("#deck");

  if (!fromEl) return;

  GameState._pendingDrawVisual = {
    source,
    rect: fromEl.getBoundingClientRect(),
    html: fromEl.innerHTML, // ✅ includes deck-count div
    className: fromEl.className, // ✅ and its classes
  };

  GameState._preDrawHandIds = new Set(
    [...document.querySelectorAll("#hand .card")].map(
      (el) => el.dataset.cardId,
    ),
  );
}

function findNewHandCardEl() {
  const before = GameState._preDrawHandIds;
  if (!before || !(before instanceof Set)) return null;

  const els = [...document.querySelectorAll("#hand .card")];
  for (const el of els) {
    const id = el.dataset.cardId;
    if (id && !before.has(id)) return el;
  }
  return null;
}

function ginImpact() {
  slamDiscardPile();

  const root = document.querySelector(".table-inner") || document.body;
  root.classList.remove("gin-shake");
  void root.offsetWidth;
  root.classList.add("gin-shake");
  setTimeout(() => root.classList.remove("gin-shake"), 260);
}

async function animatePendingDrawToHand() {
  const pending = GameState._pendingDrawVisual;
  if (!pending?.rect) return;

  // ✅ If this draw was done via drag-to-hand, don't animate.
  if (GameState._suppressNextDrawAnim) {
    GameState._suppressNextDrawAnim = false;
    GameState._pendingDrawVisual = null;

    const toEl = findNewHandCardEl();
    if (toEl) {
      toEl.style.visibility = "";
      // smooth “settle”
      toEl.classList.add("hand-drop-in");
      setTimeout(() => toEl.classList.remove("hand-drop-in"), 260);
    }

    requestHandPoseRefresh(handDiv);
    return;
  }

  GameState._pendingDrawVisual = null;

  const toEl = findNewHandCardEl();
  if (!toEl) return;

  // Hide the real card until the ghost lands
  toEl.style.visibility = "hidden";

  // Build ghost
  const ghost = document.createElement("div");
  // ✅ always use captured class/html
  ghost.className = (pending.className || "card") + " fx-ghost-solid";
  ghost.innerHTML = pending.html || "";

  // ✅ IMPORTANT: deck-count id must NOT duplicate in DOM
  const dc = ghost.querySelector("#deck-count");
  if (dc) dc.remove();

  ghost.style.position = "fixed";
  ghost.style.left = `${pending.rect.left}px`;
  ghost.style.top = `${pending.rect.top}px`;
  ghost.style.width = `${pending.rect.width}px`;
  ghost.style.height = `${pending.rect.height}px`;
  ghost.style.margin = "0";
  ghost.style.zIndex = "99999";
  ghost.style.pointerEvents = "none";
  ghost.style.opacity = "1";
  ghost.style.willChange = "transform";
  ghost.style.backfaceVisibility = "hidden";
  ghost.style.transform = "translate3d(0,0,0) translateZ(0)";
  ghost.style.transition = "transform 420ms cubic-bezier(.2,.9,.2,1)";

  // optional: looks more like a lifted card
  ghost.style.boxShadow = "0 10px 25px rgba(0,0,0,.25)";

  document.body.appendChild(ghost);

  // Move to the real new card position
  const endRect = toEl.getBoundingClientRect();
  const dx = endRect.left - pending.rect.left;
  const dy = endRect.top - pending.rect.top;

  requestAnimationFrame(() => {
    ghost.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
  });

  // Wait for the flight to finish
  await sleep(420);

  // Swap illusion: remove ghost, reveal real card, then pop it
  ghost.remove();
  toEl.style.visibility = "";

  requestHandPoseRefresh(handDiv);

  // tiny “settle” bump
  toEl.classList.add("bump");
  setTimeout(() => toEl.classList.remove("bump"), 180);
}

function animatePendingDiscardToDiscardPile(opts = {}) {
  const pending = GameState._pendingDiscardVisual;
  if (!pending?.rect || !pending.cardId) return;

  const dramatic = !!opts.dramatic;
  const ms = dramatic
    ? (GameState._ginDiscardAnimMs ?? 1400)
    : (GameState._discardAnimMs ?? 420);
  const ease = dramatic
    ? "cubic-bezier(.08, 1.12, .2, 1)" // slow  weighty
    : "cubic-bezier(.2,.9,.2,1)";

  GameState._pendingDiscardVisual = null;

  const discardSlotEl = document.querySelector("#discard");
  if (!discardSlotEl) return;

  const discardTopEl = document.querySelector("#discard .card");
  if (!discardTopEl) return;

  GameState._discardAnimLock = true;

  const endRect = discardSlotEl.getBoundingClientRect();
  const startRect = normalizeRect(pending.rect);
  if (!startRect) return;

  const ghost = pending.card
    ? createStaticCardDiv(pending.card)
    : (() => {
        const el = document.createElement("div");
        el.className = (pending.className || "card") + " fx-ghost-solid";
        el.innerHTML = pending.html || "";
        return el;
      })();

  // ✅ keep it crisp: discard-sized from the start, no transform scale
  const startLeft = startRect.left + (startRect.width - endRect.width) / 2;
  const startTop = startRect.top + (startRect.height - endRect.height) / 2;

  ghost.classList.add("is-discard-ghost");

  ghost.style.position = "fixed";
  ghost.style.left = `${startLeft}px`;
  ghost.style.top = `${startTop}px`;
  ghost.style.width = `${endRect.width}px`;
  ghost.style.height = `${endRect.height}px`;
  ghost.style.margin = "0";
  ghost.style.zIndex = "99999";
  ghost.style.pointerEvents = "none";
  ghost.style.opacity = "1";
  ghost.style.willChange = "transform, filter";
  ghost.style.backfaceVisibility = "hidden";
  ghost.style.transform = "translate3d(0,0,0)";
  ghost.style.transition = `transform ${ms}ms ${ease}, filter ${ms}ms ${ease}`;

  // 🎬 dramatic lift
  ghost.style.boxShadow = dramatic
    ? "0 22px 48px rgba(0,0,0,.45)"
    : "0 10px 25px rgba(0,0,0,.25)";

  document.body.appendChild(ghost);

  const dx = endRect.left - startLeft;
  const dy = endRect.top - startTop;

  if (dramatic) {
    const ms = GameState._ginDiscardAnimMs ?? 1400;

    ghost.classList.add("is-discard-ghost");
    ghost.style.animation = `ginCinematic ${ms}ms cubic-bezier(.12, 1.18, .22, 1) forwards`;

    ghost.style.setProperty("--dx", `${dx}px`);
    ghost.style.setProperty("--dy", `${dy}px`);

    ghost.style.transformOrigin = "50% 50%";
    ghost.style.boxShadow = "0 40px 90px rgba(0,0,0,.62)";
  } else {
    requestAnimationFrame(() => {
      ghost.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    });
  }

  setTimeout(() => {
    ghost.remove();

    // 💥 slam the pile (dramatic only)
    if (dramatic) ginImpact();

    // your existing small pop is optional — I’d keep it for normal discards
    const liveTopEl = document.querySelector("#discard .card");
    if (liveTopEl && !dramatic) {
      liveTopEl.classList.remove("discard-top-reveal");
      // two RAFs avoids rare “same-frame no-restart” on mobile Chrome
      requestAnimationFrame(() => {
        requestAnimationFrame(() =>
          liveTopEl.classList.add("discard-top-reveal"),
        );
      });
      setTimeout(() => liveTopEl.classList.remove("discard-top-reveal"), 700);
    }

    GameState._discardAnimLock = false;
    if (GameState._queuedDiscardTop !== null) {
      renderDiscardTop(GameState._queuedDiscardTop);
      GameState._queuedDiscardTop = null;
    }
  }, ms);
}

function findCardById(cardId) {
  const hand = GameState.lastHand || [];
  return hand.find((c) => String(c.id) === String(cardId)) || null;
}

function captureDiscardStart(cardEl) {
  if (!cardEl) return;
  const cardId = cardEl.dataset.cardId;
  if (!cardId) return;

  const cardObj = findCardById(cardId); // ✅ now we have rank/suit etc

  GameState._pendingDiscardVisual = {
    cardId,
    rect: cardEl.getBoundingClientRect(),
    html: cardEl.innerHTML,
    className: cardEl.className,
    card: cardObj, // ✅ add this
  };

  GameState.pendingDiscardCardId = cardId;
  GameState._discardAnimLock = true;
}

function animateDeckReshuffle({ ms = 420 } = {}) {
  const el =
    window.deckDiv ||
    (typeof deckDiv !== "undefined" ? deckDiv : null) ||
    document.querySelector("#deck");

  if (!el) return Promise.resolve();

  el.classList.remove("reshuffling");
  void el.offsetHeight; // one restart reflow is fine
  el.classList.add("reshuffling");

  return new Promise((resolve) => {
    const done = () => {
      resolve();
    };
    el.addEventListener("animationend", done, { once: true });
    setTimeout(done, ms + 80);
  });
}

// expose for deal flow (anim-deal awaits it)
window.animateDeckReshuffle = animateDeckReshuffle;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function animateDeckDropIn({ ms = 560 } = {}) {
  const wrap = document.querySelector("#deck-wrap");
  if (!wrap) return Promise.resolve();

  wrap.classList.remove("deck-returning");
  wrap.classList.remove("deck-dropping");
  wrap.classList.remove("pre-drop");
  wrap.classList.add("deck-staged"); // ensure staged angle during drop/shuffle/deal
  wrap.style.opacity = "0"; // prevent 1-frame flash

  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      wrap.style.opacity = "";
      wrap.classList.add("deck-dropping");

      const done = () => {
        wrap.removeEventListener("animationend", done);
        wrap.classList.remove("deck-dropping");
        resolve();
      };
      wrap.addEventListener("animationend", done, { once: true });
      setTimeout(done, ms + 80);
    });
  });
}

function animateDeckReturnToRest({ ms = 220 } = {}) {
  const wrap = document.querySelector("#deck-wrap");
  if (!wrap) return Promise.resolve();

  wrap.classList.remove("deck-dropping");
  wrap.classList.remove("deck-returning");

  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      wrap.classList.add("deck-returning");
      const done = () => {
        wrap.removeEventListener("animationend", done);
        wrap.classList.remove("deck-returning");
        wrap.classList.remove("deck-staged"); // back to original pose
        resolve();
      };
      wrap.addEventListener("animationend", done, { once: true });
      setTimeout(done, ms + 80);
    });
  });
}

window.animateDeckDropIn = animateDeckDropIn;
window.animateDeckReturnToRest = animateDeckReturnToRest;

function handleTimeoutDiscard(msg) {
  const isYou = msg.playerId === GameState.playerId;

  if (isYou && msg.cardId) {
    // find the actual card element in your hand DOM
    const el = document.querySelector(
      `[data-card-id="${CSS.escape(msg.cardId)}"]`,
    );
    if (el) {
      // ✅ call YOUR existing discard animation function here
      animatePendingDiscardToDiscardPile(); // <-- replace with your function name
    }
  } else {
    // opponent timed out: you probably don’t have their card DOM, so optionally animate a “ghost card” to discard
    animatePendingOppDiscardToPile();
  }
}

function applyQueuedHandRenderIfNeeded() {
  if (!GameState._pendingHandRerender) return;

  GameState._pendingHandRerender = false;

  // re-sync ordering with whatever latest hand the server sent
  GameState.reconcileHandOrder(GameState.lastHand);

  // now we can safely rebuild DOM
  clearAllDragging();
  renderHandFromOrder(GameState.lastHand);
  syncHandOrderFromDOM();
  sendHandOrder();

  MeldVisuals.refresh?.();
  updateGinUI?.();
}

function refreshHandPose(container = handDiv) {
  // Re-apply size-N (your existing CSS curve rules)
  const n = container.querySelectorAll(".card:not(.drag-placeholder)").length;

  container.classList.remove(
    "size-0",
    "size-1",
    "size-2",
    "size-3",
    "size-4",
    "size-5",
    "size-6",
    "size-7",
    "size-8",
    "size-9",
    "size-10",
    "size-11",
    "size-12",
    "size-13",
    "size-14",
  );
  container.classList.add(`size-${n}`);

  // If you have a JS layout function, call it here
  if (typeof window.layoutHand === "function") window.layoutHand();
}

let _handPoseRAF = null;
function requestHandPoseRefresh(container = handDiv) {
  if (_handPoseRAF) cancelAnimationFrame(_handPoseRAF);
  _handPoseRAF = requestAnimationFrame(() => {
    _handPoseRAF = null;
    refreshHandPose(container);
  });
}

function slamDiscardPile() {
  const pile = document.getElementById("discard");
  if (!pile) return;

  pile.classList.remove("gin-slam");
  // force reflow so animation can restart
  void pile.offsetWidth;
  pile.classList.add("gin-slam");

  // cleanup
  setTimeout(() => pile.classList.remove("gin-slam"), 520);
}

function pickGinFinalDiscardCardEl() {
  // choose the last real card in hand (ignore placeholders)
  const cards = [
    ...document.querySelectorAll("#hand .card:not(.drag-placeholder)"),
  ];
  if (!cards.length) return null;
  return cards[cards.length - 1];
}

function captureGinFinalDiscard() {
  const el = pickGinFinalDiscardCardEl();
  if (!el) return false;

  captureDiscardStart(el);

  // ✅ resolve the actual card object from lastHand using cardId
  const cid = GameState._pendingDiscardVisual?.cardId;
  if (cid && Array.isArray(GameState.lastHand)) {
    GameState._ginDiscardTop =
      GameState.lastHand.find((c) => String(c.id) === String(cid)) || null;
  } else {
    GameState._ginDiscardTop = null;
  }

  GameState._playGinDiscardOnReveal = true;
  return true;
}

// expose for bindUIActions file
window.slamDiscardPile = slamDiscardPile;
window.captureGinFinalDiscard = captureGinFinalDiscard;
