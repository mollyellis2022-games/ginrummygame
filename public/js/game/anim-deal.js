// public/js/game/anim-deal.js
// Deal polish: fly card backs, then flip into real face cards in-hand (one-by-one).

(function () {
  const TOTAL_CARDS = 20; // 10 each in 2p
  const DEAL_DELAY = 25;
  const GHOST_MS = 140; // to-hand can stay snappy
  const OPP_GHOST_MS = 220;
  const FLIP_MS = 220;
  const SHUFFLE_MS = 640; // keep in sync with CSS
  const POST_SHUFFLE_GAP = 520; // intentional beat before first card
  const DROP_MS = 640;
  const POST_DROP_GAP = 120;
  const RETURN_MS = 220;
  const POST_RETURN_GAP = 60;
  const PRE_ANIM_PAUSE_MS = 350;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function nextFrame() {
    return new Promise((r) => requestAnimationFrame(r));
  }

  function stripIds(node) {
    if (!node) return;
    if (node.removeAttribute) node.removeAttribute("id");
    node.querySelectorAll?.("[id]")?.forEach((n) => n.removeAttribute("id"));
  }

  function makeBackGhostFromDeck(deckEl) {
    const g = deckEl.cloneNode(true);
    stripIds(g);

    g.classList.add("deal-ghost", "fx-ghost-solid");
    g.querySelector?.("#deck-count")?.remove();
    g.querySelector?.(".deck-count")?.remove();

    g.style.position = "fixed";
    g.style.margin = "0";
    g.style.zIndex = "2147483647";
    g.style.pointerEvents = "none";
    g.style.willChange = "transform";
    g.style.backfaceVisibility = "hidden";
    g.style.transform = "translate3d(0,0,0)";
    g.style.boxShadow = "0 10px 25px rgba(0,0,0,.25)";
    return g;
  }

  function rectFromElOrRect(elOrRect) {
    if (!elOrRect) return null;

    if (typeof elOrRect.getBoundingClientRect === "function") {
      return elOrRect.getBoundingClientRect();
    }
    if (typeof elOrRect.left === "number") return elOrRect;
    return null;
  }

  async function animateBackGhost({
    fromEl,
    toElOrRect,
    ms = GHOST_MS,
    fadeOut = false,
    scaleTo = 1,
  }) {
    if (!fromEl || !toElOrRect) return;

    const fromRect = fromEl.getBoundingClientRect();
    const toRect = rectFromElOrRect(toElOrRect);
    if (!toRect) return;

    const ghost = makeBackGhostFromDeck(fromEl);
    ghost.style.left = `${fromRect.left}px`;
    ghost.style.top = `${fromRect.top}px`;
    ghost.style.width = `${fromRect.width}px`;
    ghost.style.height = `${fromRect.height}px`;

    // ✅ set an initial (angled) transform BEFORE enabling transitions
    ghost.style.transition = "none";
    ghost.style.transform = `translate3d(0,0,0) rotate(var(--deck-rest-rot, -8deg)) scale(1)`;
    ghost.style.opacity = "1";

    document.body.appendChild(ghost);

    const dx = toRect.left - fromRect.left;
    const dy = toRect.top - fromRect.top;

    // ✅ enable transition next frame, then move + de-rotate
    await nextFrame();
    ghost.style.transition = `transform ${ms}ms cubic-bezier(.2,.9,.2,1), opacity ${ms}ms cubic-bezier(.2,.9,.2,1)`;
    await nextFrame();

    ghost.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(0deg) scale(${scaleTo})`;
    if (fadeOut) ghost.style.opacity = "0";

    await sleep(ms + 10);
    try {
      ghost.remove();
    } catch {}
  }

  function computeInitialDealOrder(cards) {
    const hand = Array.isArray(cards) ? cards : [];
    const rankOrder = GameState.rankOrder || {};
    const suitRank = GameState.suitRank || {};

    return [...hand].sort((a, b) => {
      const ra = rankOrder[a.rank] ?? 999;
      const rb = rankOrder[b.rank] ?? 999;
      if (ra !== rb) return ra - rb;
      return (suitRank[a.suit] ?? 999) - (suitRank[b.suit] ?? 999);
    });
  }

  function makeHandSlotBack() {
    const el = document.createElement("div");
    el.className = "card back deal-slot";
    el.draggable = false;
    el.style.visibility = "hidden";
    return el;
  }

  function flipSwap(el, swapFn) {
    el.classList.remove("deal-flip");
    void el.offsetWidth;
    el.classList.add("deal-flip");

    setTimeout(
      () => {
        try {
          swapFn?.();
        } catch {}
      },
      Math.floor(FLIP_MS / 2),
    );
  }

  function replaceNode(oldEl, newEl) {
    if (!oldEl?.parentNode) return;
    oldEl.parentNode.replaceChild(newEl, oldEl);
  }

  // Drop-in replacement for: window.animateDealRound
// Adds: try/finally, GameState._dealAnimating flag, and always clears _dealAnimRoundId

window.animateDealRound = async function animateDealRound({ roundId } = {}) {
  if (!window.deckDiv || !window.handDiv) return;

  const revealDeckCount = () => {
    deckDiv.classList.remove("count-hidden");
    deckDiv.classList.add("count-reveal");
    setTimeout(() => deckDiv.classList.remove("count-reveal"), 260);
  };

  const cleanupDeckCount = () => {
    deckDiv.classList.remove("count-hidden");
    deckDiv.classList.remove("count-reveal");
  };

  // prevent double-play (same round)
  if (GameState._dealAnimRoundId === roundId) return;
  GameState._dealAnimRoundId = roundId;

  // mark: deal animation is active (use this to suppress other UI flashes)
  GameState._dealAnimating = true;

  try {
    window.maybeInitGameSeats?.();

    // NOTE: do NOT early-return if opp target missing — we can still deal to you
    const oppTarget = document.querySelector(
      '[data-seat="top"] .game-player-profile',
    );

    // ✅ 0) Immediately put UI into a clean “pre-animation” state BEFORE any pause.
    const deckWrap = document.getElementById("deck-wrap");
    deckDiv.classList.add("count-hidden");
    deckDiv.classList.remove("count-reveal");
    deckWrap?.classList.add("pre-drop");

    // Best-effort: ensure any match-end overlay is not visible during the first painted frame.
    window.hideMatchEndOverlay?.();
    document
      .querySelectorAll(
        "#match-end, #matchEndOverlay, .match-end-overlay, .match-end",
      )
      .forEach((el) => {
        el.style.display = "none";
      });

    // ✅ 1) Pause AFTER the screen is already in its correct pre-state.
    await nextFrame();
    await sleep(PRE_ANIM_PAUSE_MS);

    // ✅ drop deck in from top-right (staged/angled for shuffle+deal)
    await window.animateDeckDropIn?.({ ms: DROP_MS });
    deckWrap?.classList.remove("pre-drop");
    await sleep(POST_DROP_GAP);

    // ✅ shuffle first
    await window.animateDeckReshuffle?.({ ms: SHUFFLE_MS });
    await sleep(POST_SHUFFLE_GAP);

    // Build the exact final order the hand would end up in after reconcileHandOrder()
    const orderedForYou = computeInitialDealOrder(GameState.lastHand);
    let yourIx = 0;

    // Clear hand before dealing
    handDiv.innerHTML = "";
    handDiv.className = handDiv.className.replace(/\bsize-\d+\b/g, "");
    handDiv.classList.add("size-0");

    // During deal, prevent interactions on dealt cards
    GameState._dealBuiltHandDom = false;

    for (let i = 0; i < TOTAL_CARDS; i++) {
      const toYou = i % 2 === 0;

      if (toYou) {
        const slot = makeHandSlotBack();
        handDiv.appendChild(slot);

        // Let layout update so slot has a real rect
        window.requestHandPoseRefresh?.(handDiv);
        await nextFrame();

        await animateBackGhost({
          fromEl: deckDiv,
          toElOrRect: slot,
          ms: GHOST_MS,
        });

        slot.style.visibility = "visible";

        const card = orderedForYou[yourIx++] ?? null;

        flipSwap(slot, () => {
          if (!card) return;

          // Create the REAL card DOM (with listeners) and swap it in at the same spot.
          const real = createCardDiv(card);
          real.classList.add("deal-lock"); // pointer-events none until deal ends
          replaceNode(slot, real);
        });

        await sleep(FLIP_MS);
        window.requestHandPoseRefresh?.(handDiv);
      } else {
        // Opponent deal: prefer virtual/offscreen rect; fall back to oppTarget if present.
        const deckRect = deckDiv.getBoundingClientRect();

        const oppRect = window.getOppVirtualRect?.({
          w: deckRect.width,
          h: deckRect.height,
        });

        // (Optional) debug log — keep while verifying, then delete
        console.log("[deal] opponent anim target", {
          hasVirtualRect: !!oppRect,
          virtualRect: oppRect,
          hasOppTarget: !!oppTarget,
          oppTargetRect: oppTarget?.getBoundingClientRect?.(),
        });

        const dest = oppRect || oppTarget;

        if (dest) {
          await animateBackGhost({
            fromEl: deckDiv,
            toElOrRect: dest,
            ms: OPP_GHOST_MS,
            fadeOut: true,
            scaleTo: 0.86,
          });
        } else {
          // No destination available — short “lift” ghost so it still feels like a deal.
          await animateBackGhost({
            fromEl: deckDiv,
            toElOrRect: {
              left: deckRect.left,
              top: deckRect.top - 30,
              width: deckRect.width,
              height: deckRect.height,
            },
            ms: Math.min(OPP_GHOST_MS, 220),
            fadeOut: true,
            scaleTo: 0.92,
          });
        }
      }

      await sleep(DEAL_DELAY);
    }

    // Ensure drop zone exists (renderHandFromOrder usually does this)
    if (!GameState.dropZonesInitialized) {
      makeDropZone(handDiv);
      GameState.dropZonesInitialized = true;
    }

    // Mark: we already built a valid hand DOM; socket handler should NOT rerender it.
    GameState._dealBuiltHandDom = true;

    // ✅ return deck to original pose (flat), then reveal count
    await window.animateDeckReturnToRest?.({ ms: RETURN_MS });
    await sleep(POST_RETURN_GAP);
    revealDeckCount();
  } catch (err) {
    // If something goes wrong mid-deal, at least restore deck count visibility
    cleanupDeckCount();
    console.error("[deal] animateDealRound failed:", err);
  } finally {
    // ✅ always clear flags so the next round can animate
    GameState._dealAnimating = false;
    GameState._dealAnimRoundId = null;

    // optional: clear deck pre-drop class if your drop-in anim uses it
    document.getElementById("deck-wrap")?.classList.remove("pre-drop");
  }
};

})();
