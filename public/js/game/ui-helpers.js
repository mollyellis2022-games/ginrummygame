// public/js/game/ui-helpers.js

function cardId(c) {
  return c ? `${c.rank}${c.suit}` : null;
}

function isTouchDevice() {
  return (
    navigator.maxTouchPoints > 0 ||
    "ontouchstart" in window ||
    window.matchMedia?.("(hover: none)").matches
  );
}

function isCoarsePointer() {
  return window.matchMedia?.("(pointer: coarse)")?.matches || false;
}


// --- double-tap helpers (mobile) ---
const DOUBLE_TAP_MS = 320;
const TAP_MOVE_PX = 10;

let _lastTapTs = 0;
let _lastTapCardId = null;

function ensureToastStack() {
  let stack = document.querySelector(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }
  return stack;
}

function showToast(message, ms = 1400) {
  const stack = ensureToastStack();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  stack.appendChild(toast);

  // animate in
  requestAnimationFrame(() => toast.classList.add("show"));

  // animate out + remove
  setTimeout(() => toast.classList.remove("show"), ms);
  setTimeout(() => toast.remove(), ms + 250);
}

function lockLobbyUI() {
  GameState.lobbyLocked = true;

  const ids = [
    "players2Btn",
    "players4Btn",
    "points10Btn",
    "points50Btn",
    "points100Btn",
    "createGameBtn",
    "goJoinBtn",
  ];

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = true;
    el.classList.add("disabled");
  });
}

function unlockLobbyUI() {
  GameState.lobbyLocked = false;

  const ids = [
    "players2Btn",
    "players4Btn",
    "points10Btn",
    "points50Btn",
    "points100Btn",
    "createGameBtn",
    "goJoinBtn",
  ];

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = false;
    el.classList.remove("disabled");
  });
}

function maybeInitGameSeats() {
  if (GameState.playerId == null) return;

  // default to 2 if not set yet
  if (!GameState.playersNeeded) GameState.playersNeeded = 2;

  ensureSeatsFromState(); // the version that uses GameState only
}


function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function rectCenter(r) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function rectFromCenter(center, w, h) {
  return {
    left: center.x - w / 2,
    top: center.y - h / 2,
    width: w,
    height: h,
  };
}

function getOppVirtualRect({ w = 60, h = 90, side = "top" } = {}) {
  const pad = 18;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left, top;

  if (side === "top") {
    left = Math.round(vw / 2 - w / 2);
    top = -h - pad; // off-screen above
  } else if (side === "right") {
    left = vw + pad; // off-screen to the right
    top = Math.round(vh * 0.18);
  } else if (side === "left") {
    left = -w - pad; // off-screen to the left
    top = Math.round(vh * 0.18);
  } else {
    left = Math.round(vw / 2 - w / 2);
    top = -h - pad;
  }

  return { left, top, width: w, height: h };
}

function flyClone(elToClone, startRect, endRect, { ms = 320, scale = 1 } = {}) {
  const clone = elToClone.cloneNode(true);
  clone.classList.add("fx-ghost-solid");
  clone.style.backfaceVisibility = "hidden";
  clone.style.transform = "translateZ(0)";

  clone.style.position = "fixed";
  clone.style.left = `${startRect.left}px`;
  clone.style.top = `${startRect.top}px`;
  clone.style.width = `${startRect.width}px`;
  clone.style.height = `${startRect.height}px`;
  clone.style.margin = "0";
  clone.style.zIndex = "999999";
  clone.style.pointerEvents = "none";
  clone.style.transformOrigin = "top left";
  clone.style.willChange = "transform, opacity";
  clone.style.background = "#fff";
  clone.style.opacity = "1";
  clone.style.filter = "none";
  clone.style.mixBlendMode = "normal";

  document.body.appendChild(clone);

  const dx = endRect.left - startRect.left;
  const dy = endRect.top - startRect.top;

  // start
  clone.style.transform = `translate3d(0,0,0) scale(${scale})`;

  // animate
  requestAnimationFrame(() => {
    clone.style.transition = `transform ${ms}ms cubic-bezier(.2,.9,.2,1)`;
    clone.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1)`;
  });

  return new Promise((resolve) => {
    setTimeout(() => {
      clone.remove();
      resolve();
    }, ms);
  });
}

function makeGhostCardFromCardEl(cardEl) {
  const r = cardEl.getBoundingClientRect();
  const ghost = cardEl.cloneNode(true);

  ghost.classList.add("rr-ghost", "fx-ghost-solid"); // optional class name
  ghost.style.backfaceVisibility = "hidden";
  ghost.style.transform = "translate3d(0,0,0) translateZ(0)";
  ghost.style.position = "fixed";
  ghost.style.left = `${r.left}px`;
  ghost.style.top = `${r.top}px`;
  ghost.style.width = `${r.width}px`;
  ghost.style.height = `${r.height}px`;
  ghost.style.margin = "0";
  ghost.style.zIndex = "99999";
  ghost.style.pointerEvents = "none";
  ghost.style.transition =
    "transform 420ms cubic-bezier(.2,.9,.2,1), opacity 180ms ease";
  ghost.style.background = "#fff";
  ghost.style.opacity = "1";
  ghost.style.filter = "none";
  ghost.style.mixBlendMode = "normal";

  document.body.appendChild(ghost);
  return { ghost, startRect: r };
}

function createStaticCardDiv(card) {
  const div = document.createElement("div");
  div.className = "card";
  div.draggable = false;

  const colorClass = card.suit === "♥" || card.suit === "♦" ? "red" : "black";
  div.classList.add(colorClass);

  div.innerHTML = `
    <div class="corner top-left">${card.rank}</div>
    <div class="corner top-left-suit">${card.suit}</div>
    <div class="corner bottom-right">${card.suit}</div>
  `;
  return div;
}

function rectIsValid(r) {
  return (
    r &&
    Number.isFinite(r.left) &&
    Number.isFinite(r.top) &&
    r.width > 0 &&
    r.height > 0
  );
}

// File: /public/js/game/<your match overlay js file>

// --- helpers --------------------------------------------------------------

function isOverlayVisuallyOnScreen(el, { opacityThreshold = 0.06 } = {}) {
  if (!el) return false;

  const cs = getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden") return false;

  const op = Number(cs.opacity);
  if (Number.isFinite(op)) return op > opacityThreshold;

  return true;
}

function isRoundOverlayOnScreen() {
  const round = document.getElementById("round-overlay");
  return isOverlayVisuallyOnScreen(round);
}

function startRoundOverlayFadeOutIfNeeded() {
  const round = document.getElementById("round-overlay");
  if (!round) return;
  if (!round.classList.contains("hidden")) round.classList.add("hidden");
}

// IMPORTANT: for match overlay, do NOT do the "add hidden then remove next frame" dance.
// That creates a visible gap where the game screen shows.
function showMatchOverlayImmediate(overlayEl) {
  if (!overlayEl) return;
  overlayEl.classList.remove("hidden"); // triggers your CSS transition
}

function hideMatchOverlayImmediate(overlayEl) {
  if (!overlayEl) return;
  overlayEl.classList.add("hidden"); // triggers your CSS transition
}

// --- handoff state --------------------------------------------------------

let _matchHandoffTimer = 0;
let _matchHandoffData = null;

function cancelMatchHandoff() {
  if (_matchHandoffTimer) window.clearTimeout(_matchHandoffTimer);
  _matchHandoffTimer = 0;
  _matchHandoffData = null;
}

/**
 * Called when matchOver arrives but we still want to respect "round overlay then match overlay".
 * We wait until round reveal finishes, then we start fading round overlay (if needed),
 * and we show match overlay after a small overlap (no empty gap).
 */
function scheduleMatchOverlayHandoff(data) {
  _matchHandoffData = data;
  if (_matchHandoffTimer) return;

  const tick = () => {
    _matchHandoffTimer = 0;

    const overlayEl = document.getElementById("match-overlay");
    if (!overlayEl) return cancelMatchHandoff();

    // 1) Wait until the reveal sequence is finished (your intended ordering).
    if (GameState._roundRevealActive) {
      _matchHandoffTimer = window.setTimeout(tick, 30);
      return;
    }

    // 2) If round overlay is still fading/visible, start fading it and overlap.
    if (isRoundOverlayOnScreen()) {
      startRoundOverlayFadeOutIfNeeded();

      // Overlap: show match overlay shortly after round starts fading out.
      _matchHandoffTimer = window.setTimeout(() => {
        const payload = _matchHandoffData;
        cancelMatchHandoff();

        showMatchOverlayImmediate(overlayEl);
        // Render content immediately after showing (no visible pause).
        window.renderMatchOverlayFromState(payload);
      }, 110);

      return;
    }

    // 3) Otherwise show immediately.
    const payload = _matchHandoffData;
    cancelMatchHandoff();

    showMatchOverlayImmediate(overlayEl);
    window.renderMatchOverlayFromState(payload);
  };

  _matchHandoffTimer = window.setTimeout(tick, 0);
}

// --- main renderer --------------------------------------------------------

window.renderMatchOverlayFromState = function renderMatchOverlayFromState(data) {
  if (!data) return;

  const overlayEl = document.getElementById("match-overlay");
  const rematchBtn = document.getElementById("rematch-btn");
  if (!overlayEl || !rematchBtn) return;

  // Suppress during gin cinematic
  if (GameState._playGinDiscardOnReveal) {
    hideMatchOverlayImmediate(overlayEl);
    cancelMatchHandoff();
    return;
  }

  const p1ScoreEl = document.getElementById("match-p1-score");
  const p2ScoreEl = document.getElementById("match-p2-score");
  const p1RibbonEl = document.getElementById("match-p1-ribbon");
  const p2RibbonEl = document.getElementById("match-p2-ribbon");
  const p1Ready = document.getElementById("match-p1-ready");
  const p2Ready = document.getElementById("match-p2-ready");

  if (data.matchOver) {
    // ✅ If round reveal is active or round overlay still visible, handoff.
    if (GameState._roundRevealActive || isRoundOverlayOnScreen()) {
      hideMatchOverlayImmediate(overlayEl);
      scheduleMatchOverlayHandoff(data);
      return;
    }

    cancelMatchHandoff();

    // ✅ Show immediately to avoid any "game screen gap".
    showMatchOverlayImmediate(overlayEl);

    const winner = Number(data.matchWinner);
    overlayEl.classList.toggle("win", winner === GameState.playerId);

    if (p1ScoreEl) p1ScoreEl.textContent = String(data.scores?.[0] ?? 0);
    if (p2ScoreEl) p2ScoreEl.textContent = String(data.scores?.[1] ?? 0);

    if (p1RibbonEl) p1RibbonEl.style.display = winner === 0 ? "block" : "none";
    if (p2RibbonEl) p2RibbonEl.style.display = winner === 1 ? "block" : "none";

    const votes = data.rematchVotes || [false, false];
    p1Ready?.classList.toggle("hidden", !votes?.[0]);
    p2Ready?.classList.toggle("hidden", !votes?.[1]);

    window.updateRematchCountdown?.(data.rematchCountdownEndsAt);

    const countdownOn = !!data.rematchCountdownEndsAt;
    const iVoted = votes[GameState.playerId] === true;

    rematchBtn.disabled = countdownOn || iVoted;
    rematchBtn.classList.toggle("disabled", rematchBtn.disabled);
  } else {
    cancelMatchHandoff();

    hideMatchOverlayImmediate(overlayEl);

    rematchBtn.disabled = false;
    rematchBtn.classList.toggle("disabled", false);

    window.updateRematchCountdown?.(null);

    p1Ready?.classList.toggle("hidden", true);
    p2Ready?.classList.toggle("hidden", true);

    if (p1RibbonEl) p1RibbonEl.style.display = "none";
    if (p2RibbonEl) p2RibbonEl.style.display = "none";
  }
};


async function getVisibleRect(el, { frames = 2 } = {}) {
  if (!el) return null;
  for (let i = 0; i < frames; i++) await nextFrame();

  const r = el.getBoundingClientRect();
  return rectIsValid(r) ? r : null;
}


window.updateRematchCountdown = function updateRematchCountdown(endsAt) {
  const el = document.getElementById("rematch-countdown");
  if (!el) return;

  if (!endsAt) {
    el.textContent = "";
    el.classList.add("hidden");
    clearInterval(window._rematchCdInt);
    return;
  }

  el.classList.remove("hidden");

  const tick = () => {
    const leftMs = endsAt - Date.now();
    const left = Math.max(0, Math.ceil(leftMs / 1000));
    el.textContent = left > 0 ? `Rematch starting in ${left}…` : `Starting…`;
    if (leftMs <= 0) clearInterval(window._rematchCdInt);
  };

  clearInterval(window._rematchCdInt);
  tick();
  window._rematchCdInt = setInterval(tick, 200);
};

