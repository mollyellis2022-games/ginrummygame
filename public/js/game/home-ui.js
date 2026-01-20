// public/js/game/home-ui.js
function $(id) {
  return document.getElementById(id);
}

let bound = false;

export function initHomeUI() {
  if (bound) return; // protect against double binding
  bound = true;

  $("homePlayLiveBtn")?.addEventListener("click", () => {
    window.showScreen("screen-create");
  });

  $("homeCreateBtn")?.addEventListener("click", () => {
    window.showScreen("screen-create");
  });

  $("homeJoinBtn")?.addEventListener("click", () => {
    const code = $("homeJoinCode")?.value?.trim();
    if (code) window.__PREFILL_JOIN_CODE__ = code;
    window.showScreen("screen-create");
  });

  $("homeJoinCode")?.addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
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
    const chip = $("homeProfileChip");
    const nameEl = $("homeName");
    const avatarEl = $("homeAvatar");

    if (me) {
      loginBtn && (loginBtn.style.display = "none");
      chip && (chip.style.display = "flex");
      nameEl && (nameEl.textContent = me.display_name || me.email || "Player");

      if (avatarEl) {
        if (me.avatar_url) {
          avatarEl.src = me.avatar_url;
          avatarEl.style.opacity = "1";
        } else {
          avatarEl.style.opacity = "0";
        }
      }
    } else {
      chip && (chip.style.display = "none");
      loginBtn && (loginBtn.style.display = "flex");
    }
  } catch (e) {
    console.log("Home /me failed", e);
  }
}
