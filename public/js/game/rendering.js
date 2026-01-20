// public/js/game/rendering.js
function getDiscardDiv() {
  return document.getElementById("discard");
}

function renderHandFromOrder(hand) {
  handDiv.innerHTML = "";

  const byId = new Map(hand.map((c) => [GameState.cardIdFromCard(c), c]));

  GameState.handOrder.forEach((id) => {
    const card = byId.get(id);
    if (!card) return;
    handDiv.appendChild(createCardDiv(card));
  });

  // apply size class for CSS curve rules
  const n = handDiv.querySelectorAll(".card").length;
  handDiv.classList.remove(
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
    "size-14"
  );

  handDiv.classList.add(`size-${n}`);

  if (!GameState.dropZonesInitialized) {
    makeDropZone(handDiv);
    GameState.dropZonesInitialized = true;
  }
}

function normalizeCardShape(c) {
  if (!c) return null;

  // already correct
  if (typeof c === "object" && c.rank && c.suit) return c;

  // nested { card: { rank, suit } }
  if (typeof c === "object" && c.card && c.card.rank && c.card.suit)
    return c.card;

  // common shorthand keys
  if (typeof c === "object" && c.r && c.s) return { rank: c.r, suit: c.s };

  // if server sends an id like "AS" / "10H" etc (guessing)
  if (typeof c === "string") {
    const s = c.slice(-1);
    const r = c.slice(0, -1);
    const suitMap = { S: "♠", H: "♥", D: "♦", C: "♣" };
    if (suitMap[s] && r) return { rank: r, suit: suitMap[s] };
  }

  return null;
}



function renderDiscardTop(discardTop) {
  const discardDiv = getDiscardDiv();
  if (!discardDiv) return;


  discardDiv.classList.remove("drop-ready");

  discardDiv.innerHTML = "";

  const cardDiv = document.createElement("div");
  cardDiv.className = "card discard-slot";

  if (!discardTop) {
    cardDiv.classList.add("empty");
    cardDiv.draggable = false;
    discardDiv.appendChild(cardDiv);
    return;
  }
  discardTop = normalizeCardShape(discardTop);
  if (!discardTop) {
    cardDiv.classList.add("empty");
    cardDiv.draggable = false;
    discardDiv.appendChild(cardDiv);
    return;
  }


  cardDiv.draggable = false;

  const colorClass =
    discardTop.suit === "♥" || discardTop.suit === "♦" ? "red" : "black";
  cardDiv.classList.add(colorClass);

  const topLeft = document.createElement("div");
  topLeft.className = "corner top-left";
  topLeft.textContent = discardTop.rank;

   const center = document.createElement("div");
   center.className = "corner top-left-suit";
   center.textContent = discardTop.suit;

  const bottomRight = document.createElement("div");
  bottomRight.className = "corner bottom-right";
  bottomRight.textContent = discardTop.suit;

 

  cardDiv.append(topLeft, center, bottomRight);

  if (
    GameState.isYourTurn &&
    GameState.currentPhase === "draw" &&
    !GameState._dealAnimating &&
    !GameState._roundRevealActive &&
    !GameState._discardAnimLock
  ) {
    cardDiv.classList.add("clickable");

    if (!isTouchDevice()) {
      bindTap(cardDiv, () => {
        if (GameState._dealAnimating || GameState._roundRevealActive || GameState._discardAnimLock) return;
        if (!GameState.isYourTurn || GameState.currentPhase !== "draw") return;

        captureDrawStart("discard");
        window.socket.send(JSON.stringify({ type: "draw-discard" }));
      }, { touch: false });
    }
  }

  // Drag-to-draw from discard to hand (works mouse + touch)
  enableDrawDragFromPile(cardDiv, "discard", handDiv);

  discardDiv.appendChild(cardDiv);
}



function createCardDiv(card) {
  const div = document.createElement("div");
  div.addEventListener("contextmenu", (e) => e.preventDefault());
  div.className = "card";
  div.dataset.cardId = GameState.cardIdFromCard(card);
  div.dataset.rank = card.rank;
  div.dataset.suit = card.suit;

  const isCoarse = isTouchDevice();

  // ✅ phones use pointer drag only, desktop uses HTML5 drag only
  div.draggable = !isCoarse;

  const colorClass = card.suit === "♥" || card.suit === "♦" ? "red" : "black";
  div.classList.add(colorClass);

  const topLeft = document.createElement("div");
  topLeft.className = "corner top-left";
  topLeft.textContent = card.rank;

  const center = document.createElement("div");
  center.className = "corner top-left-suit";
  center.textContent = card.suit;

  const bottomRight = document.createElement("div");
  bottomRight.className = "corner bottom-right";
  bottomRight.textContent = card.suit;

  

  div.append(topLeft, center, bottomRight);

  if (!isCoarse) {
    div.addEventListener("dragstart", () => {
      GameState.draggedCardEl = div;
      div.classList.add("dragging");
    });

    div.addEventListener("dragend", () => {
      div.classList.remove("dragging");

      // ✅ Clear any stale inline pose that might override the fan curve
      div.style.transform = "";
      div.style.transition = "";

      // ✅ Re-apply curve/lift based on the new DOM order
      requestHandPoseRefresh(handDiv);

      if (GameState._didDiscardByDrop) {
        GameState._didDiscardByDrop = false;
        GameState.draggedCardEl = null;
        return;
      }

      if (!GameState.draggedCardEl) return;

      GameState.draggedCardEl = null;

      GameState.userHasManuallyOrdered = true;
      GameState.reorderCount = (GameState.reorderCount || 0) + 1;

      finalizeHandAfterUserMove();

      GameState._handReorderActive = false;
      applyQueuedHandRenderIfNeeded();
    });
  } else {
    enablePointerDragReorder(div, handDiv);
    // ✅ mobile double-tap to discard (in discard phase)
    let tapStartX = 0;
    let tapStartY = 0;
    let tapMoved = false;

    div.addEventListener(
      "pointerdown",
      (e) => {
        // only track taps for touch pointers
        if (e.pointerType && e.pointerType !== "touch") return;
        tapMoved = false;
        tapStartX = e.clientX;
        tapStartY = e.clientY;
      },
      { passive: true }
    );

    div.addEventListener(
      "pointermove",
      (e) => {
        if (e.pointerType && e.pointerType !== "touch") return;
        if (
          Math.abs(e.clientX - tapStartX) + Math.abs(e.clientY - tapStartY) >
          TAP_MOVE_PX
        ) {
          tapMoved = true;
        }
      },
      { passive: true }
    );

    div.addEventListener(
      "pointerup",
      (e) => {
        if (e.pointerType && e.pointerType !== "touch") return;

        // if it was a drag, don't treat it as a tap
        if (tapMoved) return;
        if (div.classList.contains("dragging")) return;
        if (div.dataset.dragMoved === "1") return;

        // only allow double-tap discard during discard phase
        if (!(GameState.currentPhase === "discard" && GameState.isYourTurn))
          return;
        if (div.parentElement?.id !== "hand") return;

        const now = Date.now();
        const id = div.dataset.cardId;

        const isDouble =
          _lastTapCardId === id && now - _lastTapTs <= DOUBLE_TAP_MS;

        _lastTapTs = now;
        _lastTapCardId = id;

        if (!isDouble) return;

        // ✅ discard (capture start for animation)
        captureDiscardStart(div);
        window.socket.send(JSON.stringify({ type: "discard", cardId: id }));

        // prevent any ghost click behaviour
        e.preventDefault?.();
        e.stopPropagation?.();
      },
      { passive: false }
    );
  }
  div.addEventListener("click", () => {
    if (isCoarse) return; // ✅ drag-only on phones

    if (!(GameState.currentPhase === "discard" && GameState.isYourTurn)) return;
    if (div.parentElement?.id !== "hand") return;

    captureDiscardStart(div);
    window.socket.send(
      JSON.stringify({ type: "discard", cardId: div.dataset.cardId })
    );
  });

  return div;
}


function syncHandOrderFromDOM() {
  const ids = [
    ...document.querySelectorAll("#hand .card:not(.drag-placeholder)"),
  ]
    .map((el) => el.dataset.cardId)
    .filter(Boolean);

  // de-dupe, keep first occurrence (stable order)
  const seen = new Set();
  const unique = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }

  GameState.handOrder = unique;
}



function updateGinUI() {
  if (!ginBtn) return;
  const canLayout =
    typeof MeldVisuals?.layoutCoversAllButDeadwood === "function"
      ? MeldVisuals.layoutCoversAllButDeadwood(1)
      : false;

  const canGin =
    GameState.isYourTurn &&
    GameState.currentPhase === "discard" &&
    GameState.userHasManuallyOrdered && // only after they've moved cards
    canLayout && // <=1 deadwood by card count (local)
    !GameState.lastRoundOver &&
    !GameState.lastMatchOver;

  ginBtn.disabled = !canGin;
  ginBtn.classList.toggle("disabled", ginBtn.disabled);
  ginBtn.classList.toggle("pulse", canGin);
  ginBtn.classList.toggle("is-hidden", !canGin);

  // Turn-wheel button skin
    const ind = document.getElementById("turn-indicator");
    if (ind) ind.classList.toggle("is-gin", canGin);

}
