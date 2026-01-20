// public/js/game/drag-drop.js

// ---- Drag/drop ordering ----
function makeDropZone(zoneEl) {
  zoneEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (!GameState.draggedCardEl) return;

    const afterEl = getDragAfterElement(zoneEl, e.clientX);
    if (!afterEl) zoneEl.appendChild(GameState.draggedCardEl);
    else zoneEl.insertBefore(GameState.draggedCardEl, afterEl);
  });
}

function makeDiscardDropZone(discardEl) {
  discardEl.addEventListener("dragover", (e) => {
    if (!GameState.draggedCardEl) return;
    if (!(GameState.currentPhase === "discard" && GameState.isYourTurn)) return;
    e.preventDefault();
    discardEl.classList.add("drop-ready");
  });

  discardEl.addEventListener("dragleave", () => {
    discardEl.classList.remove("drop-ready");
  });

  discardEl.addEventListener("drop", (e) => {
    e.preventDefault();
    discardEl.classList.remove("drop-ready");

    if (!(GameState.currentPhase === "discard" && GameState.isYourTurn)) return;

    const el = GameState.draggedCardEl;
    if (!el) return;

    const cardId = el.dataset.cardId;
    if (!cardId) return;

    // ✅ capture start position BEFORE state updates / rerender
    captureDiscardStart(el);

    // clear drag state
    GameState._didDiscardByDrop = true;
    GameState.draggedCardEl = null;

    // ✅ use cardId variable
    window.socket.send(JSON.stringify({ type: "discard", cardId }));
  });
}

function getDragAfterElement(container, x) {
  const cards = [...container.querySelectorAll(".card:not(.dragging)")].filter(
    (c) => !c.classList.contains("drag-placeholder")
  );

  return cards.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = x - box.left - box.width / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY }
  ).element;
}

function enableDrawDragFromPile(
  sourceEl,
  source /* "deck"|"discard" */,
  handEl
) {
  if (!sourceEl || !handEl) return;

  if (sourceEl._drawDragBound) return;
  sourceEl._drawDragBound = true;

  const DRAG_START_PX = 10;

  let armed = false;
  let dragging = false;
  let startX = 0,
    startY = 0;
  let pid = null;
  let placeholder = null;

  function ensurePlaceholder() {
    if (placeholder && placeholder.isConnected) return placeholder;
    placeholder = document.createElement("div");
    placeholder.className = "card draw-placeholder";
    return placeholder;
  }

  function removePlaceholder() {
    if (placeholder && placeholder.isConnected) placeholder.remove();
    placeholder = null;
  }

  function placePlaceholderAtX(clientX) {
    const ph = ensurePlaceholder();
    if (!handEl.contains(ph)) handEl.appendChild(ph);

    const before = getInsertBeforeByX(handEl, clientX, ph);
    if (before === null) handEl.appendChild(ph);
    else handEl.insertBefore(ph, before);
  }

  function getPlaceholderIndex() {
    if (!placeholder || !placeholder.isConnected) return null;
    const kids = [...handEl.querySelectorAll(".card:not(.drag-placeholder)")];
    return kids.indexOf(placeholder); // 0..n-1
  }

  function canDrawNow() {
    if (GameState._dealAnimating) return false;
    if (GameState._roundRevealActive) return false;
    if (GameState._discardAnimLock) return false;

    if (!GameState.isYourTurn) return false;
    if (GameState.currentPhase !== "draw") return false;

    if (source === "discard" && sourceEl.classList.contains("empty"))
      return false;

    return true;
  }

  function doDraw() {
    // Hard guard (covers races where state flips mid-gesture)
    if (!canDrawNow()) return;

    captureDrawStart?.(source);
    window.socket.send(
      JSON.stringify({
        type: source === "deck" ? "draw-deck" : "draw-discard",
      }),
    );
  }


  function inside(el, x, y) {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
  let ghost = null;
  let ghostW = 0;
  let ghostH = 0;

  function makeGhostFromSource(sourceEl) {
    const g = sourceEl.cloneNode(true);
    g.classList.add("draw-drag-ghost");

    g.removeAttribute("id"); // ✅ prevent duplicate #deck
    g.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
    // remove any deck count element (id OR class), just in case
    g.querySelector("#deck-count")?.remove();
    g.querySelector(".deck-count")?.remove();

    const sr = sourceEl.getBoundingClientRect();
    ghostW = sr.width;
    ghostH = sr.height;

    g.style.position = "fixed";
    g.style.margin = "0";
    g.style.zIndex = "2147483647";
    g.style.pointerEvents = "none";
    g.style.outline = "4px solid lime";
    g.style.opacity = "1";
    g.style.display = "block";
    g.style.visibility = "visible";
    g.style.width = `${ghostW}px`;
    g.style.height = `${ghostH}px`;

    // ✅ initial position
    g.style.left = `${sr.left}px`;
    g.style.top = `${sr.top}px`;

    // ✅ avoid transform positioning entirely
    g.style.transform = "none";
    g.style.filter = "none";

    document.body.appendChild(g);

    return g;
  }

  function moveGhostToFinger(x, y) {
    if (!ghost) return;
    ghost.style.left = `${x - ghostW / 2}px`;
    ghost.style.top = `${y - ghostH / 2}px`;
  }

  function onLostCapture() {
    cleanup();
  }

  function cleanup() {
    handEl.classList.remove("draw-drop-ready");
    if (ghost) ghost.remove();
    ghost = null;

    removePlaceholder();

    armed = false;
    dragging = false;
    pid = null;
    GameState._drawDragActive = false;

    window.removeEventListener("pointermove", onMove, { capture: true });
    window.removeEventListener("pointerup", onUp, { capture: true });
    window.removeEventListener("pointercancel", onCancel, { capture: true });

    sourceEl.removeEventListener("lostpointercapture", onLostCapture);
  }

  function onMove(e) {
    if (!armed && !dragging) return;
    if (pid !== null && e.pointerId !== pid) return;

    const dist = Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY);

    if (!dragging) {
      if (dist < DRAG_START_PX) return;

      dragging = true;
      sourceEl.dataset.dragMoved = "1";
      setTimeout(() => delete sourceEl.dataset.dragMoved, 300);

      ghost = makeGhostFromSource(sourceEl);
      moveGhostToFinger(e.clientX, e.clientY);
    }

    moveGhostToFinger(e.clientX, e.clientY);

    const overHand = inside(handEl, e.clientX, e.clientY);
    handEl.classList.toggle("draw-drop-ready", overHand);

    if (overHand) {
      placePlaceholderAtX(e.clientX);
    } else {
      removePlaceholder();
    }

    e.preventDefault();
  }

  function onUp(e) {
    if (pid !== null && e.pointerId !== pid) return;

    const movedDist =
      Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY);
    const wasTap = armed && !dragging && movedDist < DRAG_START_PX;

    const droppedOnHand = dragging && inside(handEl, e.clientX, e.clientY);

    let desiredIndex = null;
    if (droppedOnHand) desiredIndex = getPlaceholderIndex();

    try {
      sourceEl.releasePointerCapture(e.pointerId);
    } catch {}

    // ✅ NEW: if it was a tap, draw immediately (no placeholder index)
    if (wasTap) {
      cleanup();

      // Prevent any synthetic click/ghost handlers from firing after this.
      e.preventDefault();
      e.stopPropagation();

      doDraw();
      return;
    }

    if (!dragging) {
      cleanup();
      return;
    }

    cleanup();

    if (droppedOnHand) {
      // remember where they wanted it
      GameState._pendingDrawInsertIndex =
        typeof desiredIndex === "number" && desiredIndex >= 0
          ? desiredIndex
          : null;

      // ✅ NEW: suppress the server-confirmation draw flight on *your* screen
      GameState._suppressNextDrawAnim = true;

      doDraw();
    }

    e.preventDefault();
    e.stopPropagation();
  }

  function onCancel(e) {
    try {
      sourceEl.releasePointerCapture(e.pointerId);
    } catch {}
    cleanup();
  }

  sourceEl.addEventListener(
    "pointerdown",
    (e) => {
      // allow if pointerType missing (some browsers)
      if (e.pointerType && e.pointerType !== "touch") return;
      if (!canDrawNow()) return;

      if (GameState._drawDragActive) return;
      GameState._drawDragActive = true;

      // ✅ FORCE CAPTURE
      try {
        sourceEl.setPointerCapture(e.pointerId);
      } catch {}
      sourceEl.addEventListener("lostpointercapture", onLostCapture);

      armed = true;
      dragging = false;
      startX = e.clientX;
      startY = e.clientY;
      pid = e.pointerId;

      window.addEventListener("pointermove", onMove, {
        passive: false,
        capture: true,
      });
      window.addEventListener("pointerup", onUp, {
        passive: false,
        capture: true,
      });
      window.addEventListener("pointercancel", onCancel, {
        passive: false,
        capture: true,
      });

      e.preventDefault();
    },
    { passive: false, capture: true }
  );
}

function enablePointerDragReorder(cardEl, containerEl) {
  const isCoarse = isTouchDevice();

  if (!isCoarse) return;

  let moved = false;
  let startX = 0;
  let startY = 0;
  let myToken = 0;

  let dragging = false;
  let ghost = null;
  let placeholder = null;

  let offsetX = 0;
  let offsetY = 0;

  function moveGhost(clientX, clientY) {
    if (!ghost) return;
    ghost.style.transform = `translate3d(${clientX - offsetX}px, ${
      clientY - offsetY - 18
    }px, 0) scale(1.05)`;
  }

  function clearArtifacts() {
    document.querySelectorAll(".hand-drag-ghost").forEach((n) => n.remove());
    ghost = null;
  }

  function restoreIfStuck() {
    // always clean global artifacts
    clearAllDragging();
    document.querySelectorAll(".hand-drag-ghost").forEach((n) => n.remove());

    armed = false;
    dragging = false;

    // local placeholder cleanup if it exists
    if (placeholder) {
      if (placeholder.isConnected) placeholder.replaceWith(cardEl);
      placeholder = null;
    }

    cardEl.classList.remove("dragging");
  }

  function finishDrag(e) {
    if ((GameState.dragToken || 0) !== myToken) {
      dragging = false;
      armed = false;

      // server re-render happened; don't reinsert old cardEl
      if (placeholder) {
        if (placeholder.isConnected) placeholder.remove();
        placeholder = null;
      }

      clearArtifacts();
      cardEl.classList.remove("dragging");
      cardEl.style.transform = "";
      cardEl.style.transition = "";

      requestHandPoseRefresh(containerEl);
      GameState._handReorderActive = false;
      applyQueuedHandRenderIfNeeded();
      return;
    }

    if (!dragging) return;

    discardDiv?.classList.remove("drop-ready");

    // If released over discard pile during discard phase, treat as discard
    if (
      discardDiv &&
      GameState.isYourTurn &&
      GameState.currentPhase === "discard"
    ) {
      if (isPointInside(discardDiv, e.clientX, e.clientY)) {
        // cleanup ghost/placeholder like normal
        clearArtifacts();

        const id = cardEl.dataset.cardId;

        const alreadyInHand = containerEl.querySelector(
          `.card[data-card-id="${id}"]`
        );

        if (alreadyInHand && alreadyInHand !== cardEl) {
          if (placeholder) {
            if (placeholder.isConnected) placeholder.remove();
            placeholder = null;
          }
        } else {
          if (placeholder) {
            if (placeholder.isConnected) placeholder.replaceWith(cardEl);
            placeholder = null;
          }
        }

        cardEl.classList.remove("dragging");

        cardEl.style.transform = "";
        cardEl.style.transition = "";

        requestHandPoseRefresh(containerEl);

        // mark that this movement was intentional, but we are discarding not reordering
        cardEl.dataset.dragMoved = "1";
        setTimeout(() => {
          delete cardEl.dataset.dragMoved;
        }, 250);

        captureDiscardStart(cardEl); // ✅ add this

        // ✅ send discard
        window.socket.send(
          JSON.stringify({ type: "discard", cardId: cardEl.dataset.cardId })
        );

        // ✅ IMPORTANT: end reorder mode + run any queued render
        GameState._handReorderActive = false;
        applyQueuedHandRenderIfNeeded();

        try {
          cardEl.releasePointerCapture(e.pointerId);
        } catch {}

        e.preventDefault();
        e.stopPropagation();

        return;
      }
    }

    try {
      cardEl.releasePointerCapture(e.pointerId);
    } catch {}

    clearArtifacts();

    if (placeholder) {
      if (placeholder.isConnected) placeholder.replaceWith(cardEl);
      placeholder = null;
    }

    cardEl.classList.remove("dragging");
    cardEl.style.transform = "";
    cardEl.style.transition = "";
    requestHandPoseRefresh(containerEl);

    GameState.userHasManuallyOrdered = true;
    GameState.reorderCount = (GameState.reorderCount || 0) + 1;

    finalizeHandAfterUserMove();

    GameState._handReorderActive = false;
    applyQueuedHandRenderIfNeeded();

    cardEl.dataset.dragMoved = moved ? "1" : "0";
    setTimeout(() => {
      delete cardEl.dataset.dragMoved;
    }, 0);

    e.preventDefault();
    e.stopPropagation();
  }

  function isPointInside(el, x, y) {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  const DRAG_START_PX = 8; // tweak: 6–12 feels good on phones
  let armed = false;
  let startPointerId = null;

  function startDrag(e) {
    if (dragging) return;
    dragging = true;
    GameState._handReorderActive = true;

    try {
      cardEl.setPointerCapture(e.pointerId);
    } catch {}

    const r = cardEl.getBoundingClientRect();
    offsetX = e.clientX - r.left;
    offsetY = e.clientY - r.top;

    // placeholder keeps the space in the hand
    placeholder = document.createElement("div");
    placeholder.className = "card drag-placeholder";
    placeholder.style.width = `${cardEl.offsetWidth}px`;
    placeholder.style.height = `${cardEl.offsetHeight}px`;

    cardEl.replaceWith(placeholder);
    if (!containerEl.contains(placeholder))
      containerEl.appendChild(placeholder);

    // ghost floats above everything
    ghost = cardEl.cloneNode(true);
    ghost.classList.add("hand-drag-ghost");
    ghost.classList.remove("dragging");
    document.body.appendChild(ghost);

    ghost.style.position = "fixed";
    ghost.style.left = "0px";
    ghost.style.top = "0px";
    ghost.style.margin = "0";
    ghost.style.zIndex = "99999";
    ghost.style.pointerEvents = "none";
    ghost.style.width = `${r.width}px`;
    ghost.style.height = `${r.height}px`;
    ghost.style.transform = "translate3d(0,0,0) rotate(0deg) scale(1.05)";

    cardEl.classList.add("dragging");
    moveGhost(e.clientX, e.clientY);
  }

  cardEl.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.pointerType && e.pointerType !== "touch") return; // touch only

      restoreIfStuck();
      myToken = GameState.dragToken || 0;

      armed = true;
      dragging = false;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      startPointerId = e.pointerId;

      window.addEventListener("pointermove", onWindowMove, {
        passive: false,
        capture: true,
      });
      window.addEventListener("pointerup", onWindowUp, {
        passive: false,
        capture: true,
      });
      window.addEventListener("pointercancel", onWindowCancel, {
        passive: false,
        capture: true,
      });
    },
    { passive: true }
  );

  function onWindowMove(e) {
    if (!armed && !dragging) return;
    if (startPointerId !== null && e.pointerId !== startPointerId) return;

    const dist = Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY);

    // If we haven't started dragging yet, only start once moved enough
    if (!dragging) {
      if (dist < DRAG_START_PX) return; // still a tap
      startDrag(e); // now we begin the drag officially
    }

    if (!dragging) return;

    // show discard highlight while hovering over it
    if (
      discardDiv &&
      GameState.isYourTurn &&
      GameState.currentPhase === "discard"
    ) {
      discardDiv.classList.toggle(
        "drop-ready",
        isPointInside(discardDiv, e.clientX, e.clientY)
      );
    }

    if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 6) {
      moved = true;
    }

    moveGhost(e.clientX, e.clientY);

    const insertBefore = getInsertBeforeByX(
      containerEl,
      e.clientX,
      placeholder
    );
    if (insertBefore === null) containerEl.appendChild(placeholder);
    else containerEl.insertBefore(placeholder, insertBefore);

    e.preventDefault();
  }

  function onWindowUp(e) {
    armed = false;

    if (!dragging) {
      window.removeEventListener("pointermove", onWindowMove, {
        capture: true,
      });
      window.removeEventListener("pointerup", onWindowUp, { capture: true });
      window.removeEventListener("pointercancel", onWindowCancel, {
        capture: true,
      });
      return;
    }

    finishDrag(e);
    window.removeEventListener("pointermove", onWindowMove, {
      capture: true,
    });
    window.removeEventListener("pointerup", onWindowUp, { capture: true });
    window.removeEventListener("pointercancel", onWindowCancel, {
      capture: true,
    });
  }

  function onWindowCancel(e) {
    finishDrag(e);
    restoreIfStuck();
    GameState._handReorderActive = false;
    applyQueuedHandRenderIfNeeded();

    window.removeEventListener("pointermove", onWindowMove, {
      capture: true,
    });
    window.removeEventListener("pointerup", onWindowUp, { capture: true });
    window.removeEventListener("pointercancel", onWindowCancel, {
      capture: true,
    });
  }
}

function getInsertBeforeByX(container, clientX, ignoreEl) {
  const cards = [
    ...container.querySelectorAll(".card:not(.drag-placeholder)"),
  ].filter((c) => c !== ignoreEl);

  if (!cards.length) return null;

  // Insert before the first card whose center is to the right of the pointer.
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    if (clientX < cx) return c;
  }

  // Pointer is past all card centers => append to end
  return null;
}

function getCardCenterX(el) {
  const r = el.getBoundingClientRect();
  return r.left + r.width / 2;
}

function clearAllDragging() {
  GameState.dragToken = (GameState.dragToken || 0) + 1;

  document.querySelectorAll("#hand .card.dragging").forEach((el) => {
    el.classList.remove("dragging");
  });

  document
    .querySelectorAll("#hand .drag-placeholder")
    .forEach((el) => el.remove());
  document.querySelectorAll(".hand-drag-ghost").forEach((el) => el.remove());
}

function finalizeHandAfterUserMove() {
  GameState.handTouched = true;
  GameState.userHasManuallyOrdered = true;

  // 1) sync from DOM order
  syncHandOrderFromDOM();
  sendHandOrder();

  // 2) after DOM settles, highlight then push the SAME melds
  requestAnimationFrame(() => {
    MeldVisuals.refresh();

    // push the melds that were just detected & highlighted
    MeldVisuals.pushHighlightedMelds?.(handDiv);

    // pushing changes DOM, so re-sync + send
    syncHandOrderFromDOM();
    sendHandOrder();

    updateGinUI();
  });
}


function sendHandOrder() {
  if (!window.socket || window.socket.readyState !== 1) return;
  if (!GameState.handOrder?.length) return;

  window.socket.send(
    JSON.stringify({
      type: "hand_order",
      order: GameState.handOrder, // ["5♦","6♦",...]
    })
  );
}