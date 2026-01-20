// public/js/game/turn-indicator.js

let _turnCountdownRaf = null;
let _turnCountdownStart = 0;
let _turnCountdownMs = 0;
const WARNING_MS = 7000; // yellow starts
const PANIC_MS = 3000; // red + faster pulse


// 0deg = UP, 90 = RIGHT, 180 = DOWN, 270 = LEFT
function angleDeg_0Up(fromEl, toEl) {
  if (!fromEl || !toEl) return 0;

  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();

  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const bx = b.left + b.width / 2;
  const by = b.top + b.height / 2;

  const dx = bx - ax;
  const dy = by - ay;

  // atan2 gives 0deg on +X (right). Convert so 0deg is UP.
  const degFromRight = Math.atan2(dy, dx) * (180 / Math.PI);
  return (degFromRight + 90 + 360) % 360;
}



const TURN_ARROW_CALIBRATION_DEG = -90;

function aimTurnIndicatorAtSeat(indEl, seatName) {
  const targetProfile = getProfileInSeat(seatName);
  if (!targetProfile) return;

  const fromEl = indEl.querySelector(".turn-indicator-rotor") || indEl;
  const targetDeg =
    angleDeg_0Up(fromEl, targetProfile) + TURN_ARROW_CALIBRATION_DEG;

  setTurnWheelRotation(indEl, targetDeg);
}





function stopTurnCountdown(indEl) {
  if (_turnCountdownRaf) cancelAnimationFrame(_turnCountdownRaf);
  _turnCountdownRaf = null;
  _turnCountdownStart = 0;
  _turnCountdownMs = 0;

  indEl.classList.remove("is-warning", "is-panic");
  indEl.style.setProperty("--sweep", "360deg");
}

function startTurnCountdown(indEl, ms) {
  ms = Math.max(350, Number(ms) || 0);
  stopTurnCountdown(indEl);
  console.log("COUNTDOWN START", ms, indEl);

  _turnCountdownStart = performance.now();
  _turnCountdownMs = ms;

  const tick = (now) => {
    const elapsed = now - _turnCountdownStart;
    const remaining = Math.max(0, _turnCountdownMs - elapsed);

    const t = elapsed / _turnCountdownMs;
    const p = Math.max(0, 1 - t);

    // update ring fill
    indEl.style.setProperty("--sweep", `${p * 360}deg`);

    // ramp classes
    indEl.classList.toggle(
      "is-warning",
      remaining > 0 && remaining <= WARNING_MS
    );
    indEl.classList.toggle("is-panic", remaining > 0 && remaining <= PANIC_MS);

    if (remaining > 0) {
      _turnCountdownRaf = requestAnimationFrame(tick);
    } else {
      _turnCountdownRaf = null;
      indEl.classList.remove("is-warning", "is-panic");
      indEl.style.setProperty("--sweep", "0deg");
    }
  };

  _turnCountdownRaf = requestAnimationFrame(tick);
}

let _turnWheelDeg = null; // remembers last wheel angle

function setTurnWheelRotation(indEl, targetDeg) {
  if (_turnWheelDeg == null) {
    // first set: no animation
    indEl.classList.add("no-anim");
    _turnWheelDeg = targetDeg;
    indEl.style.setProperty("--turn-rot", `${_turnWheelDeg}deg`);

    // allow future animations
    requestAnimationFrame(() => indEl.classList.remove("no-anim"));
    return;
  }

  // choose shortest direction
  let delta = targetDeg - _turnWheelDeg;
  delta = ((delta + 540) % 360) - 180; // normalize to [-180, 180]

  _turnWheelDeg = _turnWheelDeg + delta;
  indEl.style.setProperty("--turn-rot", `${_turnWheelDeg}deg`);
}


function assignSeats({ playerCount, youId, players }) {
  // players: array of player ids in the order you want to display them (excluding you if you prefer)
  const seatEls = {
    top: document.querySelector('[data-seat="top"]'),
    right: document.querySelector('[data-seat="right"]'),
    bottom: document.querySelector('[data-seat="bottom"]'),
    left: document.querySelector('[data-seat="left"]'),
  };

  // clear seats
  Object.values(seatEls).forEach((el) => (el.innerHTML = ""));

  // bottom is always you
  seatEls.bottom.appendChild(renderPlayerBadge(youId));

  if (playerCount === 2) {
    const opp = players.find((id) => id !== youId);
    seatEls.top.appendChild(renderPlayerBadge(opp));
    // hide unused seats
    seatEls.left.style.display = "none";
    seatEls.right.style.display = "none";
  } else {
    seatEls.left.style.display = "";
    seatEls.right.style.display = "";

    // Example order: left=P2, top=P3, right=P4 (change to taste)
    const others = players.filter((id) => id !== youId);
    seatEls.left.appendChild(renderPlayerBadge(others[0]));
    seatEls.top.appendChild(renderPlayerBadge(others[1]));
    seatEls.right.appendChild(renderPlayerBadge(others[2]));
  }
}

function renderPlayerBadge(playerId) {
  const wrap = document.createElement("div");
  wrap.className = "game-player-profile";
  wrap.dataset.playerId = String(playerId);

  const label =
    Number(playerId) === Number(GameState.playerId)
      ? "YOU"
      : `P${Number(playerId) + 1}`;

  wrap.innerHTML = `
    <div class="game-profile-icon">${label}
      <div class="game-icon-points" data-points-for="${playerId}">0</div>
    </div>
  `;
  return wrap;
}


let _prevSeatKey = "";

function ensureSeatsFromState() {
  const youId = GameState.playerId;
  if (youId == null) return;

  const playerCount = Number(GameState.playersNeeded || 2);
  const players = playerCount === 4 ? [0, 1, 2, 3] : [0, 1];

  const seatKey = `${playerCount}:${youId}`;
  if (seatKey === _prevSeatKey) return;
  _prevSeatKey = seatKey;

  assignSeats({ playerCount, youId, players });
}


let _prevYourTurn = null;
let _prevTurnEndsAt = null;



function updatePointsFromState(state) {
  if (!Array.isArray(state?.scores)) return;

  const pointEls = document.querySelectorAll(
    `.game-icon-points[data-points-for]`
  );
  pointEls.forEach((el) => {
    const pid = Number(el.getAttribute("data-points-for"));
    if (!Number.isFinite(pid)) return;
    el.textContent = String(state.scores[pid] ?? 0);
  });
}


function getProfileInSeat(seat) {
  return document.querySelector(`[data-seat="${seat}"] .game-player-profile`);
}

function setProfileState(profileEl, isActive) {
  if (!profileEl) return;
  profileEl.classList.toggle("active", !!isActive);
  profileEl.classList.toggle("inactive", !isActive);
}


function seatNameForPlayerId(pid) {
  const el = document.querySelector(
    `.game-player-profile[data-player-id="${pid}"], .game-player-profile[data-playerId="${pid}"]`
  );
  return el?.closest("[data-seat]")?.getAttribute("data-seat") || null;
}



function updateProfilesAndTurnIndicator(state) {
  window.maybeInitGameSeats?.();
  const ind = document.getElementById("turn-indicator");
  if (!ind) return;
  if (GameState.playerId == null) return;
  if (GameState._dealAnimating) return;


  // ✅ build seats from GameState.playersNeeded
  ensureSeatsFromState();

  const yourTurn =
    state.yourTurn === true ||
    state.yourTurn === "true" ||
    state.yourTurn === 1;

  // ✅ points
  updatePointsFromState(state);

  const youProfile = getProfileInSeat("bottom");
  if (!youProfile) return;

  const topProfile = getProfileInSeat("top");
  const leftProfile = getProfileInSeat("left");
  const rightProfile = getProfileInSeat("right");

  const playerCount = Number(GameState.playersNeeded || 2);
  const isTwoPlayer = playerCount === 2;

  // YOU
  setProfileState(youProfile, yourTurn);

  if (isTwoPlayer) {
    // opponent sits top
    if (topProfile) setProfileState(topProfile, !yourTurn);

    // hide unused seats (your assignSeats does this too, but belt + braces)
    const leftSeat = document.querySelector(`[data-seat="left"]`);
    const rightSeat = document.querySelector(`[data-seat="right"]`);
    if (leftSeat) leftSeat.style.display = "none";
    if (rightSeat) rightSeat.style.display = "none";
  } else {
    // 4p fallback (no turnPlayerId yet): dim everyone else during your turn
    [topProfile, leftProfile, rightProfile].forEach((p) => {
      if (!p) return;
      p.classList.toggle("inactive", yourTurn);
      p.classList.remove("active");
    });
  }

  // indicator visibility
  const show = !state.roundOver && !state.matchOver;
  ind.classList.toggle("hidden", !show);
  ind.classList.toggle("is-active", yourTurn);

  // countdown
  const turnEndsAt = state.turnEndsAt ?? 0;
  const remaining = Math.max(0, turnEndsAt - Date.now());
  const msToUse = remaining || (state.turnMs ?? 30000);

  if (yourTurn) {
    if (_prevYourTurn !== true || _prevTurnEndsAt !== turnEndsAt) {
      startTurnCountdown(ind, msToUse);
    }
  } else {
    if (_prevYourTurn !== false) stopTurnCountdown(ind);
    _prevTurnEndsAt = null;
  }

  // wheel rotate (aim at the actual seat icon DOM position)
  const turnChanged = _prevYourTurn !== null && _prevYourTurn !== yourTurn;

  if (turnChanged) {
    ind.classList.add("is-switching");
    const rotor = ind.querySelector(".turn-indicator-rotor");
    if (rotor) void rotor.offsetWidth;
  }


  let activeSeat = "bottom"; // default

  if (playerCount === 2) {
    activeSeat = yourTurn ? "bottom" : "top";
  } else {
    // 4p (later): when you have turnPlayerId, map it to a seat
    // For now, fallback behavior:
    activeSeat = yourTurn ? "bottom" : "top";
    // Example for later:
    // const turnPid = Number(state.turnPlayerId);
    // activeSeat = seatNameForPlayerId(turnPid) || "top";
  }

  aimTurnIndicatorAtSeat(ind, activeSeat);

  if (turnChanged) {
    setTimeout(() => ind.classList.remove("is-switching"), 80);
  }

  _prevYourTurn = yourTurn;
  _prevTurnEndsAt = turnEndsAt;
}

function resetTurnCountdownGuards() {
  _prevYourTurn = null;
  _prevTurnEndsAt = null;

  const ind = document.getElementById("turn-indicator");
  if (ind) stopTurnCountdown(ind);
}

window.resetTurnCountdownGuards = resetTurnCountdownGuards;


window.maybeInitGameSeats = function () {
  if (GameState.playerId == null) return;

  // default if not chosen yet
  if (!GameState.playersNeeded) GameState.playersNeeded = 2;

  ensureSeatsFromState(); // uses GameState only
};
