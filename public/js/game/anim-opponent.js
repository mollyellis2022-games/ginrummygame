// public/js/game/anim-opponent.js

function animatePendingOppDiscardToPile(opts = {}) {
  const pending = GameState._pendingOppDiscardVisual;
  if (!pending?.card) return;

  // ✅ if an opp discard anim is already running, don't start another
  if (GameState._oppDiscardAnimInFlight) {
    // keep pending cleared so it doesn't replay later
    GameState._pendingOppDiscardVisual = null;
    return;
  }

  // ✅ CONSUME + LOCK
  GameState._pendingOppDiscardVisual = null;
  GameState._oppDiscardAnimInFlight = true;

  const discardSlotEl = document.querySelector("#discard");
  if (!discardSlotEl) {
    GameState._oppDiscardAnimInFlight = false;
    return;
  }

  const dramatic = !!opts.dramatic;
  const ms = dramatic
    ? (GameState._ginDiscardAnimMs ?? 1400)
    : (GameState._oppDiscardAnimMs ?? 650);

  GameState._discardAnimLock = true;

  const endRect = discardSlotEl.getBoundingClientRect();
  const startRect = getOppVirtualRect({ w: endRect.width, h: endRect.height });

  if (!startRect) {
    GameState._discardAnimLock = false;
    GameState._oppDiscardAnimInFlight = false;
    return;
  }

  const ghost = createStaticCardDiv(pending.card);
  ghost.classList.add("fx-ghost-solid", "is-discard-ghost");

  ghost.style.position = "fixed";
  ghost.style.left = `${startRect.left}px`;
  ghost.style.top = `${startRect.top}px`;
  ghost.style.width = `${endRect.width}px`;
  ghost.style.height = `${endRect.height}px`;
  ghost.style.margin = "0";
  ghost.style.zIndex = "99999";
  ghost.style.pointerEvents = "none";
  ghost.style.backfaceVisibility = "hidden";
  ghost.style.willChange = "transform, filter";
  ghost.style.transform = "translate3d(0,0,0)";
  ghost.style.transformOrigin = "50% 50%";

  ghost.style.boxShadow = dramatic
    ? "0 40px 90px rgba(0,0,0,.62)"
    : "0 10px 25px rgba(0,0,0,.25)";

  document.body.appendChild(ghost);

  const dx = endRect.left - startRect.left;
  const dy = endRect.top - startRect.top;

  if (dramatic) {
    ghost.style.transition = "none";
    ghost.style.animation = `ginCinematic ${ms}ms cubic-bezier(.12, 1.18, .22, 1) forwards`;
    ghost.style.setProperty("--dx", `${dx}px`);
    ghost.style.setProperty("--dy", `${dy}px`);
  } else {
    ghost.style.transition = `transform ${ms}ms cubic-bezier(.2,.9,.2,1)`;
    requestAnimationFrame(() => {
      ghost.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    });
  }

  const finish = () => {
    try {
      ghost.remove();
    } catch {}

    if (dramatic) {
      ginImpact?.();
    } else {
      const liveTopEl = document.querySelector("#discard .card");
      if (liveTopEl) {
        liveTopEl.classList.remove("discard-top-reveal");
        requestAnimationFrame(() => {
          requestAnimationFrame(() => liveTopEl.classList.add("discard-top-reveal"));
        });
        setTimeout(() => liveTopEl.classList.remove("discard-top-reveal"), 700);
      }
    }

    GameState._discardAnimLock = false;
    GameState._oppDiscardAnimInFlight = false;

    if (GameState._queuedDiscardTop !== null) {
      renderDiscardTop(GameState._queuedDiscardTop);
      GameState._queuedDiscardTop = null;
    }
  };

  // ✅ timeout fallback (covers both transition + keyframes)
  setTimeout(finish, ms + 30);
}

function animatePendingOppDraw() {
  const pending = GameState._pendingOppDrawVisual;
  if (!pending) return;
  GameState._pendingOppDrawVisual = null;

  const startEl =
    pending.source === "discard"
      ? document.querySelector("#discard .card")
      : deckDiv;

  if (!startEl) return;

  const startRect = startEl.getBoundingClientRect();
  const endRect = getOppVirtualRect({
    w: startRect.width,
    h: startRect.height,
  });
  const ms = GameState._oppDrawAnimMs ?? 650;

  const ghost = document.createElement("div");
  ghost.className = "card back fx-ghost-solid";
  ghost.style.position = "fixed";
  ghost.style.left = `${startRect.left}px`;
  ghost.style.top = `${startRect.top}px`;
  ghost.style.width = `${startRect.width}px`;
  ghost.style.height = `${startRect.height}px`;
  ghost.style.margin = "0";
  ghost.style.zIndex = "99999";
  ghost.style.pointerEvents = "none";
  ghost.style.willChange = "transform";
  ghost.style.backfaceVisibility = "hidden";
  ghost.style.transform = "translate3d(0,0,0) translateZ(0)";
  ghost.style.transition = `transform ${ms}ms cubic-bezier(.2,.9,.2,1)`;
  ghost.style.boxShadow = "0 10px 25px rgba(0,0,0,.25)";

  document.body.appendChild(ghost);

  const dx = endRect.left - startRect.left;
  const dy = endRect.top - startRect.top;

  requestAnimationFrame(() => {
    ghost.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
  });

  setTimeout(() => ghost.remove(), ms);
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
