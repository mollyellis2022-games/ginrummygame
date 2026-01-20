// public/js/game/home-ui.js

function $(id) {
  return document.getElementById(id);
}

let bound = false;

export function initHomeUI() {
  if (bound) return;
  bound = true;

  // Main actions
  $("homePlayBtn")?.addEventListener("click", () =>
    window.showScreen("screen-create"),
  );
  $("homeRoomsBtn")?.addEventListener("click", () =>
    window.showScreen("screen-create"),
  ); // placeholder for rooms view
  $("homePracticeBtn")?.addEventListener("click", () =>
    window.showToast?.("Practice coming soon"),
  );

  // Bottom bar placeholders
  $("homeLeaderboardBtn")?.addEventListener("click", () =>
    window.showToast?.("Leaderboard coming soon"),
  );
  $("homeFriendsBtn")?.addEventListener("click", () =>
    window.showToast?.("Friends coming soon"),
  );

  // Top bar placeholders
  $("homeRulesBtn")?.addEventListener("click", () =>
    window.showToast?.("Rules coming soon"),
  );
  $("homeSettingsBtn")?.addEventListener("click", () =>
    window.showToast?.("Settings coming soon"),
  );

  // Profile modal open/close
  $("homeProfileBtn")?.addEventListener("click", () => openProfileModal(true));
  $("homeProfileCloseBtn")?.addEventListener("click", () =>
    openProfileModal(false),
  );
  $("homeProfileModal")?.addEventListener("click", (e) => {
    if (e.target === $("homeProfileModal")) openProfileModal(false);
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

function openProfileModal(open) {
  const m = $("homeProfileModal");
  if (!m) return;
  m.classList.toggle("open", !!open);
  m.setAttribute("aria-hidden", open ? "false" : "true");
}

async function loadMeIntoHome() {
  try {
    const r = await fetch("https://api.ellisandcodesigns.co.uk/me", {
      credentials: "include",
    });
    const { user: me } = await r.json();

    const loginBtn = document.getElementById("homeLoginBtn");

    const avatarImg = document.getElementById("homeAvatar");
    const fallback = document.getElementById("homeAvatarFallback");

    // Optional (only if you have a big avatar in the modal)
    const avatarBig = document.getElementById("homeAvatarBig");

    const nameEl = document.getElementById("homeName");
    const hintEl = document.getElementById("homeHint");
    const logoutBtn = document.getElementById("homeLogoutBtn");

    if (me) {
      // Top bar
      if (loginBtn) loginBtn.style.display = "none";
      if (logoutBtn) logoutBtn.style.display = "inline-flex";

      if (nameEl) nameEl.textContent = me.display_name || me.email || "Player";
      if (hintEl) hintEl.textContent = "Signed in";

      const url = me.avatar_url || "";
      if (avatarImg) {
        if (url) {
          avatarImg.src = url;
          avatarImg.style.opacity = "1";
          if (fallback) fallback.style.display = "none";
        } else {
          avatarImg.removeAttribute("src");
          avatarImg.style.opacity = "0";
          if (fallback) {
            const letter =
              (me.display_name && me.display_name.trim()[0]) ||
              (me.email && me.email.trim()[0]) ||
              "P";
            fallback.textContent = String(letter).toUpperCase();
            fallback.style.display = "block";
          }
        }
      }

      if (avatarBig) {
        if (url) {
          avatarBig.src = url;
          avatarBig.style.opacity = "1";
        } else {
          avatarBig.removeAttribute("src");
          avatarBig.style.opacity = "0";
        }
      }
    } else {
      if (loginBtn) loginBtn.style.display = "inline-flex";
      if (logoutBtn) logoutBtn.style.display = "none";

      if (nameEl) nameEl.textContent = "Guest";
      if (hintEl) hintEl.textContent = "Sign in to sync your profile";

      if (avatarImg) {
        avatarImg.removeAttribute("src");
        avatarImg.style.opacity = "0";
      }
      if (fallback) {
        fallback.textContent = "G";
        fallback.style.display = "block";
      }
      if (avatarBig) {
        avatarBig.removeAttribute("src");
        avatarBig.style.opacity = "0";
      }
    }
  } catch (e) {
    console.log("Home /me failed", e);
  }
}
