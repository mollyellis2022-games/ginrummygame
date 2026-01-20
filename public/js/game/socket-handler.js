window.handleSocketMessage = function handleSocketMessage(event) {
  // Entry point for ALL incoming WebSocket messages from the server.
  // Messages fall into three buckets:
  // 1) Lobby/room lifecycle (room_update, join_ok, join_error, game_start)
  // 2) One-off game events (round_reveal, timeout_discard)
  // 3) Main authoritative game state sync (state)
  let data;
  try {
    // Server sends JSON strings; ignore anything else to avoid crashing the UI loop.
    data = JSON.parse(event.data);
  } catch (err) {
    console.warn("[WS] Ignoring non-JSON message:", event.data);
    return;
  }

  // Lightweight telemetry for debugging "why is my UI weird?" moments.
  console.log("[WS]", data.type, {
    roundOver: data.roundOver,
    matchOver: data.matchOver,
    roundId: data.roundId,
    ginPlayerId: data.ginPlayerId,
  });

  // Small helpers to keep the rest of this handler defensive and readable.
  // - getHandDiv/getDeckDiv tolerate missing DOM (screen not mounted yet).
  // - isTruthyTurn handles the server sending booleans/strings/numbers.
  // - asArray prevents "undefined is not iterable" bugs if server omits a field.
  const getHandDiv = () => window.handDiv ?? document.getElementById("hand");
  const getDeckDiv = () => window.deckDiv ?? document.getElementById("deck");
  const isTruthyTurn = (v) => v === true || v === "true" || v === 1;
  const asArray = (v) => (Array.isArray(v) ? v : []);

  // Utility: quickly hide overlays when we need to avoid overlap with animations.
  function forceHideOverlays() {
    document.getElementById("round-overlay")?.classList.add("hidden");
    document.getElementById("match-overlay")?.classList.add("hidden");
  }

  // PATCH: disable/enable interactions while dealing
  function setDrawControlsEnabled(enabled) {
    const deckDiv = getDeckDiv();
    const discardDiv = document.getElementById("discard");

    if (deckDiv) {
      deckDiv.classList.toggle("clickable", !!enabled);
      deckDiv.classList.toggle("disabled", !enabled);
    }
    if (discardDiv) {
      discardDiv.classList.toggle("clickable", !!enabled);
      discardDiv.classList.toggle("disabled", !enabled);
    }
  }

  function updateDeckCountFromState(state) {
    const deckCountEl = document.getElementById("deck-count");
    if (!deckCountEl || typeof state?.deckCount !== "number") return;

    if (state.deckCount === 0) {
      deckCountEl.textContent = String(GameState.lastKnownDeckCount ?? 0);
    } else {
      deckCountEl.textContent = String(state.deckCount);
      GameState.lastKnownDeckCount = state.deckCount;
    }
  }


  // PATCH: shared new-round start sequence
  function beginNewRoundFlow(stateMsg) {
    if (!stateMsg || stateMsg.roundId == null) return false;
    if (stateMsg.roundOver || stateMsg.matchOver) return false;

    // Mark we are now in this round immediately (prevents "deal fires on first draw")
    window._lastRRRoundId = null;
    GameState.resetForNewRound(stateMsg.roundId);

    // Apply authoritative core fields, but do NOT render the hand yet.
    GameState.isYourTurn = isTruthyTurn(stateMsg.yourTurn);
    GameState.currentPhase = stateMsg.phase ?? GameState.currentPhase;
    GameState.lastHand = asArray(stateMsg.yourHand);
    updateDeckCountFromState(stateMsg);


    // Reset deal guards
    GameState._dealAnimating = true;
    GameState._dealAnimRoundId = null; // ensure the anim is allowed to run

    window.resetTurnCountdownGuards?.();

    // Clear drag state so the new round starts cleanly.
    clearAllDragging?.();
    GameState.draggedCardEl = null;
    GameState._didDiscardByDrop = false;

    // Clear hand area before dealing cards.
    const handDiv = getHandDiv();
    if (handDiv) {
      handDiv.innerHTML = "";
      handDiv.className = handDiv.className.replace(/\bsize-\d+\b/g, "");
      handDiv.classList.add("size-0");
    }

    // IMPORTANT: per your desired sequence:
    // 1) Round overlay disappears (already done by round-reveal close)
    // 2) Deal animation
    // 3) Discard top flip/show
    // 4) Start turn timer UI
    setDrawControlsEnabled(false);
    renderDiscardTop?.(null);
    window.renderMatchOverlayFromState?.(stateMsg);

    const dealRoundId = stateMsg.roundId;

    // Run dealing, then reconcile to latest server state for this round.
    animateDealRound?.({ roundId: dealRoundId })?.finally?.(() => {
      if (GameState.currentRoundId !== dealRoundId) return;

      const latest = GameState._lastStateMsg || stateMsg;
      if (!latest || latest.roundId !== dealRoundId) return;
      updateDeckCountFromState(latest);

      window.maybeInitGameSeats?.();

      // Discard top AFTER dealing (flip/show happens here if renderDiscardTop animates)
      renderDiscardTop?.(latest.discardTop || null);

      GameState._dealAnimating = false;

      // Timer start should be AFTER discard flip/show.
      // (If updateProfilesAndTurnIndicator starts the timer, this fixes the order.)
      updateProfilesAndTurnIndicator?.(latest);

      GameState._dealAnimating = false;

      const dealt = asArray(latest.yourHand);
      GameState.lastHand = dealt;

      if (!GameState._handReorderActive) {
        GameState.reconcileHandOrder(dealt);

        // ✅ If the deal animation already built the DOM, don't wipe it.
        if (GameState._dealBuiltHandDom) {
          GameState._dealBuiltHandDom = false;

          // Make sure GameState.handOrder matches DOM
          syncHandOrderFromDOM?.();
          sendHandOrder?.();

          // Re-enable interactions on dealt cards now that deal is done
          handDiv?.querySelectorAll?.(".deal-lock")?.forEach((el) => {
            el.classList.remove("deal-lock");
          });

          requestHandPoseRefresh?.(handDiv);
        } else {
          clearAllDragging?.();
          renderHandFromOrder?.(dealt);
          syncHandOrderFromDOM?.();
          sendHandOrder?.();
        }
      }


      // Re-enable draw controls only if it's actually your draw phase.
      const canDrawNow =
        GameState.isYourTurn && GameState.currentPhase === "draw";
      setDrawControlsEnabled(canDrawNow);
    });

    // Baseline trackers (so opponent inference doesn’t misfire)
    GameState._prevDiscardTopId = discardIdFromTop(stateMsg.discardTop);
    GameState._prevOppHandCount =
      typeof stateMsg.oppHandCount === "number" ? stateMsg.oppHandCount : null;
    GameState._prevYourTurn = GameState.isYourTurn;
    GameState._prevPhase = GameState.currentPhase;

    return true;
  }

  // This function is invoked after the "round reveal" cinematic starts/finishes,
  // so we can re-apply the latest state (hands/discard/turn/phase) without the
  // state handler fighting the reveal overlay.
  window.applyStateAfterReveal = function applyStateAfterReveal() {
    // Prefer a stashed state (if we deferred a reset during reveal), otherwise use latest.
    const data = GameState._pendingRoundResetState || GameState._lastStateMsg;
    GameState._pendingRoundResetState = null;
    if (!data) return;

    // Reveal is done; allow normal state-driven rendering again.
    GameState._playGinDiscardOnReveal = false;

    // If reveal ended and the next state is a NEW live round,
    // DO NOT render hand immediately; run deal sequence now.
    const isNewRound =
      data.roundId != null && GameState.currentRoundId !== data.roundId;

    if (isNewRound && !data.roundOver && !data.matchOver) {
      beginNewRoundFlow(data);
      return;
    }
    // ✅ If match is over, get the overlay up FIRST to avoid table flash.
    if (data.matchOver) {
      window.renderMatchOverlayFromState?.(data);
    }

    // Re-apply the core server-authoritative state.
    GameState.isYourTurn = isTruthyTurn(data.yourTurn);
    GameState.currentPhase = data.phase ?? GameState.currentPhase;
    GameState.lastHand = asArray(data.yourHand);

    // Update turn indicator / player HUD bits.
    updateProfilesAndTurnIndicator?.(data);

    // Discard pile should always reflect the server-authoritative top card.
    renderDiscardTop?.(data.discardTop || null);

    // Re-render the player's hand unless the user is actively reordering.
    // (Re-rendering during drag drops can break the drag interaction.)
    if (!GameState._handReorderActive) {
      GameState.reconcileHandOrder(GameState.lastHand);
      clearAllDragging?.();
      renderHandFromOrder?.(GameState.lastHand);
      syncHandOrderFromDOM?.();
      sendHandOrder?.(); // keep server in sync with the current visual order
    }

    // Update knock/gin UI affordances and match overlay.
    updateGinUI?.();
    if (!data.matchOver) {
      window.renderMatchOverlayFromState?.(data);
    }
  };;

  // ===== Connection / identity bootstrap =====
  // Server assigns a playerId early; we cache it and update the UI label.
  if (data.type === "init") {
    GameState.playerId = data.playerId;
    const titleEl = document.getElementById("player-title");
    if (titleEl) {
      titleEl.textContent = `You are Player ${GameState.playerId + 1}`;
    }
    window.maybeInitGameSeats?.();
    return;
  }

  // ===== Lobby / room lifecycle messages =====
  // These update the pre-game lobby screen and host/start controls.
  if (data.type === "room_update" && data.code === GameState.roomCode) {
    GameState.playersJoined = data.joined;

    const playerCountEl = document.getElementById("playerCountText");
    const statusEl = document.getElementById("waitingStatus");
    const startBtn = document.getElementById("startGameBtn");

    // Always update lobby counters for both host and joiners.
    if (playerCountEl) {
      playerCountEl.textContent = `Players: ${data.joined}/${data.needed}`;
    }

    // Track join count so we can show a toast only when the number increases.
    if (typeof GameState.lastSeenJoined !== "number")
      GameState.lastSeenJoined = data.joined;
    const prev = GameState.lastSeenJoined;
    GameState.lastSeenJoined = data.joined;

    if (GameState.isHost) {
      // Host sees "ready to start" messaging and gets the Start button enabled when full.
      if (statusEl) {
        if (data.joined < data.needed)
          statusEl.textContent = "Waiting for players to join…";
        else
          statusEl.textContent = `Player ${data.joined} has joined. Start the game!`;
      }

      // Celebrate new join events.
      if (data.joined > prev) {
        showToast(`Player ${data.joined} joined 🎉`);
      }

      // Enable/disable Start and visually pulse when it becomes available.
      if (startBtn) {
        const canStart = data.joined >= data.needed;
        startBtn.disabled = !canStart;
        if (canStart) startBtn.classList.add("pulse");
        else startBtn.classList.remove("pulse");
      }
    } else {
      // Joiners just wait for the host to start.
      if (statusEl) statusEl.textContent = "Waiting for host to start game…";
      if (data.joined > prev)
        showToast(`Player joined (${data.joined}/${data.needed})`);
    }

    return;
  }

  // Join success: switch to host/waiting screen and hide room code/start UI (for joiners).
  if (data.type === "join_ok" && data.code === GameState.roomCode) {
    window.showScreen("screen-host");

    const statusEl = document.getElementById("waitingStatus");
    if (statusEl) {
      statusEl.textContent = "Waiting for host to start game…";
    }

    document.getElementById("roomCodeSection")?.classList.add("hidden");
    document.getElementById("startGameBtn")?.classList.add("hidden");
    return;
  }

  // Join failure: show a simple alert and stop processing.
  if (data.type === "join_error") {
    alert(data.message || "Join failed");
    return;
  }

  // Host started the game: move to the game screen.
  if (data.type === "game_start" && data.code === GameState.roomCode) {
    window.showScreen?.("screen-game");
    return;
  }

  // ===== One-off game events (cinematics / timers) =====

  // Round reveal: special cinematic sequence (especially for Gin).
  // During reveal we take extra care not to let normal state updates hide overlays mid-animation.
  if (data.type === "round_reveal" && data.code === GameState.roomCode) {
    forceHideOverlays();

    // Identify who went gin (or who the winner is).
    const ginPid = Number.isFinite(Number(data.ginPlayerId))
      ? Number(data.ginPlayerId)
      : Number(data.winner);

    // Choose the final discard card (server-provided preferred; fall back to queued).
    const finalCard =
      data.finalDiscard ||
      data.discardTop ||
      GameState._queuedDiscardTop ||
      null;

    // Animation duration (tuned elsewhere).
    const ms = GameState._ginDiscardAnimMs ?? 1400;

    // If we have enough info, run the "dramatic discard" + reveal choreography.
    if (Number.isFinite(ginPid) && finalCard) {
      GameState._playGinDiscardOnReveal = true;

      if (ginPid === GameState.playerId) {
        // You already created a discard "ghost" from your hand; animate it to the pile.
        animatePendingDiscardToDiscardPile({ dramatic: true });
      } else {
        // Opponent discard: create a visual from the server card and animate to the pile.
        GameState._pendingOppDiscardVisual = { card: finalCard };
        animatePendingOppDiscardToPile({ dramatic: true });
      }

      // After the animation completes, force authoritative discard + start reveal overlay.
      setTimeout(() => {
        GameState._queuedDiscardTop = null;
        GameState._discardAnimLock = false;

        // Ensure discard pile shows the correct top card after the cinematic.
        renderDiscardTop?.(finalCard);

        GameState._playGinDiscardOnReveal = false;

        // Lock reveal as "active" so state handler can defer resets while overlay is running.
        GameState._roundRevealActive = true;

        runRoundReveal(data);

        // One-frame catch-up: ensures hand/discard/turn indicators are fresh after reveal starts.
        requestAnimationFrame(() => window.applyStateAfterReveal?.());
      }, ms);

      return;
    }

    // Fallback: if we can't do the full cinematic, still run the reveal UI.
    runRoundReveal(data);
    return;
  }

  // Timeout discard: server tells client a discard was forced due to timer expiration.
  // This is handled BEFORE "state" so any UI effects can occur promptly.
  if (data.type === "timeout_discard") {
    const fn =
      (typeof window.handleTimeoutDiscard === "function" &&
        window.handleTimeoutDiscard) ||
      (typeof handleTimeoutDiscard === "function" && handleTimeoutDiscard);

    if (fn) fn(data);
    else
      console.warn(
        "[WS] timeout_discard received but no handler is registered",
      );
    return;
  }

  // ===== Main authoritative state sync =====
  // Everything below this line expects a "state" message.
  if (data.type !== "state") return;

  // Ignore state messages for other rooms.
  if (data.code && GameState.roomCode && data.code !== GameState.roomCode)
    return;

  // Cache the latest state for other parts of the UI (and for deal/reveal catch-up).
  GameState._lastStateMsg = data;

  // Capture previous snapshots to detect opponent actions (draw/discard) by diffs.
  const nextYourTurn = isTruthyTurn(data.yourTurn);
  const prev = {
    yourTurn: GameState.isYourTurn,
    phase: GameState.currentPhase,
    discardTopId: GameState._prevDiscardTopId,
    oppCount: GameState._prevOppHandCount,
  };

  // Apply core state immediately: this is the authoritative source of truth.
  GameState.isYourTurn = nextYourTurn;
  GameState.currentPhase = data.phase ?? GameState.currentPhase;
  GameState.lastHand = asArray(data.yourHand);

  // PATCH: handle round boundary BEFORE calling updateProfilesAndTurnIndicator
  // so the timer doesn’t start early and the hand doesn’t render before dealing.
  if (GameState.currentRoundId !== data.roundId) {
    if (data.roundId == null) {
      console.warn("[WS] state missing roundId; skipping round reset");
    } else {
      if (GameState._roundRevealActive) {
        GameState._pendingRoundResetState = data;
        return;
      }

      // If this is a live new round, run the strict sequence now.
      if (!data.roundOver && !data.matchOver) {
        const started = beginNewRoundFlow(data);
        if (started) return;
      }

      // Otherwise (roundOver/matchOver), at least update roundId so we don't
      // retrigger "new round" later on the first action.
      GameState.currentRoundId = data.roundId;

      // fall through to normal rendering (match-over UI etc)
    }
  }

  // Update basic UI elements driven by state.
  if (!GameState._dealAnimating) {
    updateProfilesAndTurnIndicator?.(data);
  }


  // Deck count display (with a "0 means unknown" fallback).
  const deckCountEl = document.getElementById("deck-count");
  if (deckCountEl && typeof data.deckCount === "number") {
    if (data.deckCount === 0) {
      deckCountEl.textContent = String(GameState.lastKnownDeckCount ?? 0);
    } else {
      deckCountEl.textContent = String(data.deckCount);
      GameState.lastKnownDeckCount = data.deckCount;
    }
  }

  // Visual cue that the deck was replenished (server provides info flags).
  if (data.deckReplenished && data.deckReplenishInfo) {
    animateDeckReshuffle();
  }

  // If a Gin reveal cinematic is running, hide overlays but keep state updated.
  if (GameState._playGinDiscardOnReveal) {
    forceHideOverlays();
  }


  // ===== Match-over overlay handling =====
  // Shows rematch UI and ready indicators, and manages countdown state.
  {
    const overlayEl = document.getElementById("match-overlay");
    const rematchBtn = document.getElementById("rematch-btn");
    const p1Ready = document.getElementById("match-p1-ready");
    const p2Ready = document.getElementById("match-p2-ready");

    if (overlayEl && rematchBtn) {
      if (!GameState._playGinDiscardOnReveal && data.matchOver) {
        overlayEl.classList.remove("hidden");

        const votes = data.rematchVotes || [false, false];
        p1Ready?.classList.toggle("hidden", !votes?.[0]);
        p2Ready?.classList.toggle("hidden", !votes?.[1]);

        window.updateRematchCountdown?.(data.rematchCountdownEndsAt);

        const countdownOn = !!data.rematchCountdownEndsAt;
        const iVoted = votes[GameState.playerId] === true;

        // Disable rematch button after voting or while countdown is active.
        rematchBtn.disabled = countdownOn || iVoted;
        rematchBtn.classList.toggle("disabled", rematchBtn.disabled);
      } else {
        overlayEl.classList.add("hidden");

        rematchBtn.disabled = false;
        rematchBtn.classList.toggle("disabled", false);

        window.updateRematchCountdown?.(null);

        p1Ready?.classList.toggle("hidden", true);
        p2Ready?.classList.toggle("hidden", true);
      }
    }
  }

  // If we're back in live play, ensure round overlay isn't left visible.
  if (!GameState._roundRevealActive && !data.roundOver && !data.matchOver) {
    document.getElementById("round-overlay")?.classList.add("hidden");
  }

  // Scoreboard: basic match progress UI.
  const scoreboardEl = document.getElementById("scoreboard");
  if (scoreboardEl && data.scores && typeof data.targetScore === "number") {
    scoreboardEl.textContent = `Scores — P1: ${data.scores[0]} | P2: ${data.scores[1]} (Lose at ${data.targetScore})`;
  }

  // ===== Opponent-action inference (draw/discard animations) =====
  // We infer opponent draw/discard by comparing previous vs current counts/discardTop.
  const newDiscardTopId = discardIdFromTop(data.discardTop);

  // Server-provided opponent hand count (naming can vary).
  const newOppCount =
    typeof data.oppHandCount === "number"
      ? data.oppHandCount
      : typeof data.otherHandCount === "number"
        ? data.otherHandCount
        : null;

  // If opp hand count increased while it's not your turn, opponent just drew.
  // Determine source by whether discardTop changed at the same time.
  let oppJustDrewFromDiscard = false;
  if (newOppCount != null && prev.oppCount != null) {
    if (!GameState.isYourTurn && newOppCount === prev.oppCount + 1) {
      const drewFrom =
        newDiscardTopId !== prev.discardTopId ? "discard" : "deck";
      GameState._pendingOppDrawVisual = { source: drewFrom };
      oppJustDrewFromDiscard = drewFrom === "discard";
    }
  }

  // Opponent discard is detected when the turn flips back to you AND discardTop changes,
  // excluding the special case where discardTop changed because they drew from discard.
  const oppJustFinishedTurn = prev.yourTurn === false && nextYourTurn === true;

  console.log("[OPP DISCARD CHECK]", {
    prevYourTurn: prev.yourTurn,
    nowYourTurn: GameState.isYourTurn,
    oppJustFinishedTurn,
    oppJustDrewFromDiscard,
    prevDiscardTopId: prev.discardTopId,
    newDiscardTopId,
    roundOver: data.roundOver,
    matchOver: data.matchOver,
  });

  const discardAnimId = newDiscardTopId;

  if (
    oppJustFinishedTurn &&
    !data.roundOver &&
    !data.matchOver &&
    !oppJustDrewFromDiscard &&
    discardAnimId &&
    discardAnimId !== prev.discardTopId &&
    discardAnimId !== GameState._lastOppDiscardAnimId
  ) {
    // Queue opponent discard animation (only once per unique discardTop id).
    GameState._lastOppDiscardAnimId = discardAnimId;
    console.log("[OPP DISCARD ANIM QUEUED]", data.discardTop);
    GameState._pendingOppDiscardVisual = { card: data.discardTop };
    GameState._discardAnimLock = true;
  }

  // Persist "prev" trackers for the next state tick.
  GameState._prevDiscardTopId = newDiscardTopId;
  GameState._prevOppHandCount = newOppCount;
  GameState._prevPhase = GameState.currentPhase;
  GameState._prevYourTurn = GameState.isYourTurn;

  // Deadwood and end-of-round/match flags used by UI logic elsewhere.
  const deadwoodCount =
    typeof data.deadwoodCount === "number" ? data.deadwoodCount : 999;
  GameState.lastDeadwoodCount = deadwoodCount;
  GameState.lastRoundOver = !!data.roundOver;
  GameState.lastMatchOver = !!data.matchOver;

  // Keep internal hand order stable across server updates.
  GameState.reconcileHandOrder(GameState.lastHand);

  // Hand rendering rules:
  // - Don't render during deal animation.
  // - Don't re-render while user is reordering; queue a rerender for when they finish.
  if (GameState._dealAnimating) {
    // Intentionally skip render while deal animation plays.
  } else if (GameState._handReorderActive) {
    GameState._pendingHandRerender = true;
  } else {
    clearAllDragging();
    renderHandFromOrder(GameState.lastHand);
    syncHandOrderFromDOM();
    sendHandOrder();
  }

  // If user selected an insert position during a draw-drag, enforce that position now.
  if (typeof GameState._pendingDrawInsertIndex === "number") {
    const newEl = findNewHandCardEl(); // compares current DOM to pre-draw snapshot
    if (newEl) {
      const handDiv = getHandDiv();
      if (!handDiv) {
        console.warn("[UI] handDiv missing; cannot apply draw insert index");
        GameState._pendingDrawInsertIndex = null;
        return;
      }

      const cards = [...handDiv.querySelectorAll(".card")];
      const idx = Math.max(
        0,
        Math.min(GameState._pendingDrawInsertIndex, cards.length - 1),
      );

      const target = cards[idx];
      if (target && target !== newEl) handDiv.insertBefore(newEl, target);
      else if (!target) handDiv.appendChild(newEl);

      syncHandOrderFromDOM();
      sendHandOrder();
      finalizeHandAfterUserMove();
    }

    GameState._pendingDrawInsertIndex = null;
  }

  // Allow meld highlighters to run after the hand is updated.
  MeldVisuals.setHighlightEnabled?.(true);

  // Deck UI: clickable only when it's your turn and you're in the draw phase.
  {
    const deckDiv = getDeckDiv();
    if (deckDiv) {
      const canDraw = !GameState._dealAnimating && GameState.isYourTurn && GameState.currentPhase === "draw";
      deckDiv.classList.toggle("clickable", canDraw);
      deckDiv.classList.toggle("disabled", !canDraw);
    }
  }

  // Ensure the discard slot exists so future updates/animations have a target element.
  if (!document.querySelector("#discard .card")) {
    renderDiscardTop?.(null);
  }

  // Discard rendering:
  // - If an animation is in progress, stash the top card for later.
  // - Otherwise render immediately from authoritative state.
  const discardTop = data.discardTop || null;
  if (GameState._discardAnimLock) {
    GameState._queuedDiscardTop = discardTop;
  } else {
    renderDiscardTop?.(discardTop);
  }

  // Schedule animations after DOM updates for smoother rendering.
  requestAnimationFrame(() => {
    if (GameState._playGinDiscardOnReveal) return;

    animatePendingDrawToHand();
    animatePendingDiscardToDiscardPile();
    animatePendingOppDraw();
    animatePendingOppDiscardToPile();
  });

  // Refresh meld visuals only after the player has interacted (avoids noisy reflows).
  if (GameState.handTouched) {
    MeldVisuals.refresh();
  }

  // Update action buttons (gin/knock/etc.) based on latest state.
  updateGinUI();
};