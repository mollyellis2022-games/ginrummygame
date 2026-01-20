// public/js/game/lobby-ui.js

function setPlayersNeeded(n) {
  GameState.playersNeeded = n;
  document.getElementById("players2Btn")?.classList.toggle("active", n === 2);
  document.getElementById("players4Btn")?.classList.toggle("active", n === 4);

  window.maybeInitGameSeats?.();
}

function generateRoomCode(len = 6) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < len; i++)
    code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

window.createRoom = function () {
  GameState.isHost = true;
  GameState.roomCode = generateRoomCode(6);
  GameState.playersJoined = 1;

  lockLobbyUI(); // ✅ lock create screen inputs

  document.getElementById("roomCodeText").textContent = GameState.roomCode;

  document.getElementById("waitingStatus").textContent =
    "Waiting for players to join…";

  document.getElementById("roomCodeSection")?.classList.remove("hidden");
  document.getElementById("startGameBtn")?.classList.remove("hidden");

  window.showScreen("screen-host");

  window.socket.send(
    JSON.stringify({
      type: "create_room",
      code: GameState.roomCode,
      playersNeeded: GameState.playersNeeded,
      pointsTarget: GameState.pointsTarget,
    })
  );
};

window.joinRoom = function () {
  const code = document
    .getElementById("joinCodeInput")
    ?.value.trim()
    .toUpperCase();
  if (!code) return;

  GameState.isHost = false;
  GameState.roomCode = code;

  window.socket.send(JSON.stringify({ type: "join_room", code }));
};


function bindTap(el, handler, { touch = false } = {}) {
  if (!el) return;

  if (touch) {
    el.addEventListener(
      "pointerup",
      (e) => {
        if (e.pointerType !== "touch") return;
        if (el.dataset.dragMoved === "1") return;
        e.preventDefault();
        handler(e);
      },
      { passive: false },
    );
  }

  el.addEventListener("click", (e) => {
    // click events generally only matter for mouse/pen; touch click is unreliable here
    if (e.pointerType === "touch") return;
    handler(e);
  });
}

window.bindTap = bindTap;

// ---- Actions ----
window.bindUIActions = function bindUIActions() {
  window.showScreen("screen-loading");
  // ====== MAIN GAME UI ======

  // Deck: click on desktop only; touch tap handled inside enableDrawDragFromPile
  bindTap(
    deckDiv,
    () => {
      if (
        GameState._dealAnimating ||
        GameState._roundRevealActive ||
        GameState._discardAnimLock
      )
        return;
      if (!GameState.isYourTurn || GameState.currentPhase !== "draw") return;

      captureDrawStart("deck");
      window.socket.send(JSON.stringify({ type: "draw-deck" }));
    },
    { touch: false },
  );

  enableDrawDragFromPile(deckDiv, "deck", handDiv);

  makeDiscardDropZone(discardDiv);

  const ginBtn = document.getElementById("ginBtn");

  if (ginBtn) {
    ginBtn.addEventListener("click", () => {
      if (ginBtn.disabled) return;
      if (!window.socket || socket.readyState !== WebSocket.OPEN) return;

      // ✅ CAPTURE GIN DISCARD VISUALS NOW (while hand DOM exists)
      window.captureGinFinalDiscard?.();

      socket.send(JSON.stringify({ type: "gin" }));
    });
  }

  rematchBtn.onclick = () => {
    window.socket.send(JSON.stringify({ type: "rematch" }));
    rematchBtn.disabled = true;
    rematchBtn.classList.toggle("disabled", true);
  };

  // ===== Leave Modal wiring =====
  (function wireLeaveModal() {
    // prevent double binding if bindUIActions ever re-runs
    if (window._leaveModalBound) return;
    window._leaveModalBound = true;

    const modal = document.getElementById("leave-modal");
    const cancelBtn = document.getElementById("leaveCancelBtn");
    const confirmBtn = document.getElementById("leaveConfirmBtn");

    if (!modal || !cancelBtn || !confirmBtn) {
      console.warn("Leave modal elements missing (#leave-modal / buttons).");
      return;
    }

    const openModal = () => {
      modal.classList.remove("hidden");
    };

    const closeModal = () => {
      modal.classList.add("hidden");
    };

    // Open from any leave button (game screen OR overlay)
    document.addEventListener("click", (e) => {
      const btn = e.target.closest?.(".leaveGameBtn");
      if (!btn) return;
      e.preventDefault();
      openModal();
    });

    // Close actions
    cancelBtn.addEventListener("click", closeModal);
    modal
      .querySelector(".modal-backdrop")
      ?.addEventListener("click", closeModal);

    // Escape key
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.classList.contains("hidden"))
        closeModal();
    });

    // Confirm leave
    confirmBtn.addEventListener("click", () => {
      closeModal();

      // tell server (if you implement on server)
      if (window.socket?.readyState === 1) {
        window.socket.send(JSON.stringify({ type: "leave_room" }));
      }

      // cleanup local UI/drag
      clearAllDragging();
      GameState._drawDragActive = false;

      // hide overlays if any
      document.getElementById("round-overlay")?.classList.add("hidden");
      document.getElementById("match-overlay")?.classList.add("hidden");

      // go back to menu
      window.showScreen("screen-create");
    });
  })();

  // ====== LOBBY / CREATE / JOIN UI ======

  document.getElementById("screen-host")?.classList.add("hidden");
  document.getElementById("screen-join")?.classList.add("hidden");
  document.getElementById("screen-game")?.classList.add("hidden");
  document.getElementById("screen-create")?.classList.remove("hidden");

  let selectedPoints = 10;
  window.GameState.pointsTarget = selectedPoints;

  function updatePointsDisplay() {
    window.GameState.pointsTarget = selectedPoints;
  }

  updatePointsButtons();

  // default lobby values
  setPlayersNeeded(window.GameState.playersNeeded || 2);

  // player count tabs
  document
    .getElementById("players2Btn")
    ?.addEventListener("click", () => setPlayersNeeded(2));
  document
    .getElementById("players4Btn")
    ?.addEventListener("click", () => setPlayersNeeded(4));

  // Points selection buttons
  document.getElementById("points10Btn").addEventListener("click", function () {
    selectedPoints = 10;
    updatePointsDisplay();
    updatePointsButtons();
  });
  document.getElementById("points50Btn").addEventListener("click", function () {
    selectedPoints = 50;
    updatePointsDisplay();
    updatePointsButtons();
  });
  document
    .getElementById("points100Btn")
    .addEventListener("click", function () {
      selectedPoints = 100;
      updatePointsDisplay();
      updatePointsButtons();
    });

  function updatePointsButtons() {
    ["points10Btn", "points50Btn", "points100Btn"].forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.classList.toggle(
        "active",
        Number(btn.textContent) === selectedPoints,
      );
    });
  }

  // create/join/start
  document
    .getElementById("createGameBtn")
    ?.addEventListener("click", window.createRoom);

  document.getElementById("backToCreateBtn")?.addEventListener("click", () => {
    window.showScreen("screen-create");
  });

  document.getElementById("goJoinBtn")?.addEventListener("click", () => {
    window.showScreen("screen-join");
  });

  document
    .getElementById("joinGameBtn")
    ?.addEventListener("click", window.joinRoom);

  document
    .getElementById("copyCodeBtn")
    ?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(window.GameState.roomCode || "");
        const btn = document.getElementById("copyCodeBtn");
        btn.textContent = "Copied!";
        setTimeout(() => (btn.textContent = "Copy"), 900);
      } catch {
        alert(
          "Couldn’t copy — please copy manually: " +
            (window.GameState.roomCode || ""),
        );
      }
    });

  document.getElementById("startGameBtn")?.addEventListener("click", () => {
    const GS = window.GameState;
    if (!GS.isHost || !GS.roomCode) return;

    document.getElementById("startGameBtn")?.classList.remove("pulse"); // ✅ stop pulse

    window.socket.send(
      JSON.stringify({ type: "start_game", code: GS.roomCode }),
    );
  });
};;