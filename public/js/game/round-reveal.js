// public/js/game/round-reveal.js

async function runRoundReveal(data) {
  const RR_TIMING = {
    startDelay: 260,
    betweenPlayers: 360,

    meldStep: 260,
    deadwoodStep: 200,

    cardDropDur: 290,
    cardFromY: -42,

    pillDelay: 320,
    closeAfter: 1200,
  };

  const overlay = document.getElementById("round-overlay");
  if (!overlay) return;

  // ✅ ignore duplicate reveals for the same round
  if (window._lastRRRoundId === data.roundId) return;
  window._lastRRRoundId = data.roundId;

  // ✅ block state-handler from hiding overlay mid-animation
  GameState._roundRevealActive = true;

  // NEW layout targets
  const hands = data.hands || { 0: [], 1: [] };
  const orders = data.handOrders || { 0: [], 1: [] };
  const oppDeadwoodEl = overlay.querySelector("#deadwood-area .deadwood-strip");
  const oppMeldEl = overlay.querySelector("#opp-hand-meld");
  const youDeadwoodEl = overlay.querySelector(
    "#you-deadwood-area .deadwood-strip"
  );
  const youMeldEl = overlay.querySelector("#you-hand-meld");

  // pill numbers (these are the spans inside the pills)
  const oppPtsEl = overlay.querySelector("#opp-deadwood-points");
  const youPtsEl = overlay.querySelector("#you-deadwood-points");

  // profile blocks (for pill + score target)
  const oppProfileEl = overlay.querySelector(".player1-icon");
  const youProfileEl = overlay.querySelector(".player2-icon");

  const loserSeat = data.loser; // 0 or 1
  const layouts = data.layouts || {}; // from server payload
  const awardPoints = Number(layouts[loserSeat]?.deadwoodPoints || 0);
  const finalScores = data.scores || [0, 0];
  // ✅ reconstruct scores BEFORE the award
  const prevScores = [...finalScores];
  prevScores[loserSeat] = Math.max(
    0,
    Number(finalScores[loserSeat] || 0) - awardPoints
  );

  const youId = GameState.playerId;
  const oppId = youId === 0 ? 1 : 0;

  // after: const finalScores = data.scores || [0,0];
  const youScoreBadge = youProfileEl?.querySelector(".icon-points");
  const oppScoreBadge = oppProfileEl?.querySelector(".icon-points");
  if (youScoreBadge) youScoreBadge.textContent = String(prevScores[youId] ?? 0);
  if (oppScoreBadge) oppScoreBadge.textContent = String(prevScores[oppId] ?? 0);


  if (!oppDeadwoodEl || !oppMeldEl || !youDeadwoodEl || !youMeldEl) {
    console.warn("Round reveal overlay elements missing. Check new HTML IDs.");
    GameState._roundRevealActive = false;
    requestAnimationFrame(() => window.applyStateAfterReveal?.());
    return;
  }

  // ---------- helpers ----------

  function cardIdUI(card) {
    return `${card.rank}${card.suit}`;
  }

  function cardValueUI(card) {
    if (["J", "Q", "K"].includes(card.rank)) return 10;
    if (card.rank === "A") return 1;
    return Number(card.rank);
  }

  function makeStaticCard(card) {
    const div = document.createElement("div");
    div.className = "round-overlay-card";
    div.addEventListener("contextmenu", (e) => e.preventDefault());

    const isRed = card.suit === "♥" || card.suit === "♦";
    div.classList.add(isRed ? "red" : "black");

    div.innerHTML = `
      <div class="corner top-left">${card.rank}</div>
    <div class="corner top-left-suit">${card.suit}</div>
    <div class="corner bottom-right">${card.suit}</div>
    `;

    div.style.cursor = "default";
    div.draggable = false;
    return div;
  }

  function dropIn(el, { fromY = -22, toY = 0, durationMs = 260 } = {}) {
    // start state (no transition yet)
    el.style.transition = "none";
    el.style.opacity = "0";
    el.style.transform = `translateY(${fromY}px) scale(0.98)`;

    // force layout so the browser commits the start styles
    // (this is the key for mobile)
    void el.offsetHeight;

    // now animate to end state
    el.style.transition = `opacity ${durationMs}ms ease, transform ${durationMs}ms cubic-bezier(.2,.9,.2,1)`;

    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = `translateY(${toY}px) scale(1)`;
    });
  }

  function clearAll() {
    oppDeadwoodEl.innerHTML = "";
    oppMeldEl.innerHTML = "";
    youDeadwoodEl.innerHTML = "";
    youMeldEl.innerHTML = "";

    if (oppPtsEl) oppPtsEl.textContent = "0";
    if (youPtsEl) youPtsEl.textContent = "0";

    // hide pills until the end
    overlay.querySelectorAll(".round-meta").forEach((el) => {
      el.classList.remove("show");
      el.style.display = ""; // let CSS decide
    });

    overlay.querySelectorAll(".player-profile").forEach((el) => {
      el.classList.remove("dim");
    });
  }

  function deadwoodInHandOrder(playerId, deadwoodCards) {
    const hand = hands[playerId] || [];
    const byId = new Map(hand.map((c) => [cardIdUI(c), c]));
    const ord =
      Array.isArray(orders[playerId]) && orders[playerId].length
        ? orders[playerId]
        : [...byId.keys()];

    const deadIds = new Set((deadwoodCards || []).map(cardIdUI));
    return ord
      .map((id) => byId.get(id))
      .filter((c) => c && deadIds.has(cardIdUI(c)));
  }

  async function animateMelds(containerEl, meldGroups, { stepMs = 120 } = {}) {
    containerEl.innerHTML = "";
    const groups = Array.isArray(meldGroups) ? meldGroups : [];

    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi] || [];
      for (let i = 0; i < group.length; i++) {
        const card = group[i];
        const el = makeStaticCard(card);

        const isLastInGroup = i === group.length - 1;
        const isLastGroup = gi === groups.length - 1;
        if (isLastInGroup && !isLastGroup) el.classList.add("meld-inner-gap");

        containerEl.appendChild(el);
        dropIn(el, {
          fromY: RR_TIMING.cardFromY,
          durationMs: RR_TIMING.cardDropDur,
        });

        await sleep(stepMs);
      }
    }
  }

  // ✅ returns lastEl so we can start +X from the last deadwood card
  async function animateDeadwood(
    containerEl,
    deadwoodOrdered,
    ptsEl,
    { stepMs = 140 } = {}
  ) {
    containerEl.innerHTML = "";
    let running = 0;
    let lastEl = null;

    for (const card of deadwoodOrdered) {
      const el = makeStaticCard(card);
      containerEl.appendChild(el);

      dropIn(el, {
        fromY: RR_TIMING.cardFromY,
        durationMs: RR_TIMING.cardDropDur,
      });

      lastEl = el;

      const v = cardValueUI(card);
      running += v;
      if (ptsEl) ptsEl.textContent = String(running);

      await sleep(stepMs);
    }

    return { running, lastEl };
  }

  function profileForSeat(seat) {
    return seat === youId ? youProfileEl : oppProfileEl;
  }
  function deadwoodAnimForSeat(seat, youDead, oppDead) {
    return seat === youId ? youDead : oppDead;
  }
  function deadwoodStripForSeat(seat) {
    return seat === youId ? youDeadwoodEl : oppDeadwoodEl;
  }

  // ✅ fly bubble from last deadwood card -> score badge, then bump score
  async function animatePillAndScore({
    profileEl,
    fromEl,
    addPoints,
    finalScore,

    popMs = 260, // pop at start + at icon
    flyMs = 1200, // deadwood -> icon
    dropMs = 700, // icon -> points
    holdMs = 140, // tiny pauses
  }) {
    if (!profileEl || !fromEl) return;

    const icon = profileEl.querySelector(".profile-icon");
    const scoreBadge = profileEl.querySelector(".icon-points");
    if (!icon || !scoreBadge) return;

    // --- start rect (deadwood last card) ---
    let startRect = await getVisibleRect(fromEl, { frames: 2 });
    if (!startRect) {
      const strip = fromEl.closest(".deadwood-strip") || fromEl;
      const lastCard = strip?.querySelector?.(".round-overlay-card:last-child");
      startRect = await getVisibleRect(lastCard, { frames: 2 });
    }
    if (!startRect) return;

    const sx = startRect.left + startRect.width / 2;
    const sy = startRect.top + startRect.height / 2;

    // --- mid rect (profile icon center) ---
    const iconRect = icon.getBoundingClientRect();
    const mx = iconRect.left + iconRect.width / 2;
    const my = iconRect.top + iconRect.height / 2;

    // --- end rect (points badge center) ---
    const endRect = scoreBadge.getBoundingClientRect();
    const ex = endRect.left + endRect.width / 2;
    const ey = endRect.top + endRect.height / 2;

    // --- ghost pill ---
    const ghost = document.createElement("div");
    ghost.className = "rr-pill-ghost";
    ghost.innerHTML = `<div class="pill"><span>${addPoints}</span></div>`;
    overlay.appendChild(ghost);

    // place at start
    ghost.style.left = `${sx}px`;
    ghost.style.top = `${sy}px`;

    // 1) POP on deadwood
    requestAnimationFrame(() => ghost.classList.add("pop"));
    await sleep(popMs);
    await sleep(holdMs);

    // 2) FLY to icon center
    ghost.classList.add("fly");
    ghost.style.transform = `translate(calc(-50% + ${mx - sx}px), calc(-50% + ${
      my - sy
    }px)) scale(1)`;

    await sleep(flyMs);

    // 2b) POP again at icon (quick scale pulse)
    ghost.classList.remove("fly");
    ghost.classList.add("pop"); // reuse pop transition for a little bounce
    ghost.style.transform = `translate(calc(-50% + ${mx - sx}px), calc(-50% + ${
      my - sy
    }px)) scale(1.08)`;
    await sleep(140);
    ghost.style.transform = `translate(calc(-50% + ${mx - sx}px), calc(-50% + ${
      my - sy
    }px)) scale(1)`;
    await sleep(120);

    // 3) DROP to points badge
    ghost.classList.remove("pop");
    ghost.classList.add("drop");
    ghost.style.transform = `translate(calc(-50% + ${ex - sx}px), calc(-50% + ${
      ey - sy
    }px)) scale(1)`;

    await sleep(dropMs);

    // update + bump score
    const safeFinal = Number.isFinite(Number(finalScore))
      ? Number(finalScore)
      : 0;
    scoreBadge.textContent = String(safeFinal);
    scoreBadge.classList.add("rr-score-bump");
    setTimeout(() => scoreBadge.classList.remove("rr-score-bump"), 320);

    // ✅ let the moment land
    await sleep(900); // try 700–1200 depending on vibe

    // cleanup
    ghost.classList.add("done");
    await sleep(220);
    ghost.remove();
  }

  // ---------- start ----------

  clearAll();
  overlay.classList.remove("hidden");
  await nextFrame();
  await nextFrame();

  const L0 = layouts[0] || { meldGroups: [], deadwood: [], deadwoodPoints: 0 };
  const L1 = layouts[1] || { meldGroups: [], deadwood: [], deadwoodPoints: 0 };

  const youLayout = youId === 0 ? L0 : L1;
  const oppLayout = oppId === 0 ? L0 : L1;
  let scheduledClose = false;

  try {
    await sleep(RR_TIMING.startDelay);

    // YOU
    await animateMelds(youMeldEl, youLayout.meldGroups, {
      stepMs: RR_TIMING.meldStep,
    });
    const youDead = await animateDeadwood(
      youDeadwoodEl,
      deadwoodInHandOrder(youId, youLayout.deadwood),
      youPtsEl,
      { stepMs: RR_TIMING.deadwoodStep }
    );

    await sleep(RR_TIMING.betweenPlayers);

    // OPP
    await animateMelds(oppMeldEl, oppLayout.meldGroups, {
      stepMs: RR_TIMING.meldStep,
    });
    const oppDead = await animateDeadwood(
      oppDeadwoodEl,
      deadwoodInHandOrder(oppId, oppLayout.deadwood),
      oppPtsEl,
      { stepMs: RR_TIMING.deadwoodStep }
    );

    await sleep(RR_TIMING.pillDelay);

    // LOSER TARGETS

    const loserSeat = data.loser;

    const loserProfileEl = profileForSeat(loserSeat);

    const loserDead = deadwoodAnimForSeat(loserSeat, youDead, oppDead);
    const loserLastDeadwoodEl = loserDead?.lastEl;

    const fallbackFromEl = deadwoodStripForSeat(loserSeat);

    await nextFrame();
    await nextFrame(); // two frames is safer on mobile/slow machines

    await animatePillAndScore({
      profileEl: loserProfileEl,
      fromEl: loserLastDeadwoodEl || fallbackFromEl,
      addPoints: awardPoints,
      finalScore: Number(finalScores[loserSeat] || 0),
      popMs: 260,
      flyMs: 1200,
      dropMs: 700,
    });

    clearTimeout(window._rrCloseTimer);
    window._rrCloseTimer = setTimeout(() => {
      overlay.classList.add("hidden");
      GameState._roundRevealActive = false;
      requestAnimationFrame(() => window.applyStateAfterReveal?.());
    }, RR_TIMING.closeAfter);

    scheduledClose = true;
  } catch (e) {
    console.error("runRoundReveal failed:", e);
  } finally {
    if (!scheduledClose) {
      overlay.classList.add("hidden");
      GameState._roundRevealActive = false;
      requestAnimationFrame(() => window.applyStateAfterReveal?.());
    }
  }
}
