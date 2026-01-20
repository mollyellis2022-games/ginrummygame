// public/js/game/home-ui.js
function $(id) {
  return document.getElementById(id);
}

let bound = false;

// public/js/game/home-ui.js
function $(id) {
  return document.getElementById(id);
}

export function initHomeUI() {
  if (bound) return;
  bound = true;

  const row = $("homeCardsRow");
  const dotsWrap = $("homeCarouselDots");
  const joinInput = $("homeJoinCode");

  // --- dots + snap index ---
  if (row && dotsWrap) {
    const dots = Array.from(dotsWrap.querySelectorAll(".dot"));

    const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

    const setActive = () => {
      const w = row.clientWidth || 1;
      const idx = clamp(Math.round(row.scrollLeft / w), 0, dots.length - 1);
      dots.forEach((d, i) => d.classList.toggle("active", i === idx));
    };

    row.addEventListener("scroll", () => requestAnimationFrame(setActive), { passive: true });
    setActive();
  }

  // --- allow horizontal swipe even if body is locked ---
  // (CSS touch-action: pan-x on .home-cards-row is the main fix, but this helps older devices)
  if (row) row.style.webkitOverflowScrolling = "touch";

  // --- input hygiene ---
  joinInput?.addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  });

  // --- routing ---
  $("homePlayLiveBtn")?.addEventListener("click", () => {
    window.showScreen("screen-create");
  });

  $("homePracticeBtn")?.addEventListener("click", () => {
    window.showToast?.("Practice mode coming soon");
  });

  $("homeCreateBtn")?.addEventListener("click", () => {
    window.showScreen("screen-create");
  });

  $("homeJoinBtn")?.addEventListener("click", () => {
    const code = joinInput?.value?.trim();
    if (code) window.__PREFILL_JOIN_CODE__ = code;
    window.showScreen("screen-create");
  });

  $("homeLogoutBtn")?.addEventListener("click", async () => {
    await fetch("https://api.ellisandcodesigns.co.uk/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    await loadMeIntoHome();
  });

  loadMeIntoHome();
}

async function loadMeIntoHome() {
  try {
    const r = await fetch("https://api.ellisandcodesigns.co.uk/me", {
      credentials: "include",
    });
    const { user: me } = await r.json();

    const loginBtn = $("homeLoginBtn");

    // profile card elements (these DO exist in your new HTML)
    const profileDesc = $("homeProfileCardDesc");
    const profileMini = $("homeProfileMini");
    const logoutBtn = $("homeLogoutBtn");

    const nameEl = $("homeName");
    const hintEl = $("homeHint");
    const avatarEl = $("homeAvatar");

    if (me) {
      loginBtn && (loginBtn.style.display = "none");

      profileDesc && (profileDesc.textContent = "Signed in");
      profileMini && (profileMini.style.display = "flex");
      logoutBtn && (logoutBtn.style.display = "inline-flex");

      nameEl && (nameEl.textContent = me.display_name || me.email || "Player");
      hintEl && (hintEl.textContent = "Signed in");

      if (avatarEl) {
        if (me.avatar_url) {
          avatarEl.src = me.avatar_url;
          avatarEl.style.opacity = "1";
        } else {
          avatarEl.removeAttribute("src");
          avatarEl.style.opacity = "0";
        }
      }
    } else {
      loginBtn && (loginBtn.style.display = "flex");

      profileDesc && (profileDesc.textContent = "Sign in to sync stats.");
      profileMini && (profileMini.style.display = "none");
      logoutBtn && (logoutBtn.style.display = "none");

      if (avatarEl) {
        avatarEl.removeAttribute("src");
        avatarEl.style.opacity = "0";
      }
    }
  } catch (e) {
    console.log("Home /me failed", e);
  }
}
