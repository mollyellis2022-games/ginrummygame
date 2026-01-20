function $(id) {
  return document.getElementById(id);
}

export function bindHome() {
  // Route into your existing lobby/create/join screens
  $("homePlayLiveBtn")?.addEventListener("click", () =>
    window.showScreen("screen-create"),
  );
  $("homeCreateBtn")?.addEventListener("click", () =>
    window.showScreen("screen-create"),
  );

  $("homeJoinCode")?.addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  });

  $("homeJoinBtn")?.addEventListener("click", () => {
    // If you already have a join flow in your create screen, store the code and focus the join UI.
    const code = $("homeJoinCode")?.value?.trim();
    if (code) window.__PREFILL_JOIN_CODE__ = code;
    window.showScreen("screen-create");
  });

  $("homePracticeBtn")?.addEventListener("click", () => {
    // If you don't have practice yet, you can route to rules or show toast.
    window.showToast?.("Practice mode coming soon");
  });

  $("homeLogoutBtn")?.addEventListener("click", async () => {
    await fetch("https://api.ellisandcodesigns.co.uk/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    await loadMeIntoHome(); // refresh UI
  });

  loadMeIntoHome();
}

export async function loadMeIntoHome() {
  try {
    const r = await fetch("https://api.ellisandcodesigns.co.uk/me", {
      credentials: "include",
    });
    const data = await r.json();
    const me = data.user;

    const loginBtn = $("homeLoginBtn");
    const chip = $("homeProfileChip");
    const nameEl = $("homeName");
    const hintEl = $("homeHint");
    const avatarEl = $("homeAvatar");

    if (me) {
      if (loginBtn) loginBtn.style.display = "none";
      if (chip) chip.style.display = "flex";
      if (nameEl) nameEl.textContent = me.display_name || me.email || "Player";
      if (hintEl) hintEl.textContent = "Signed in";

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
      if (chip) chip.style.display = "none";
      if (loginBtn) loginBtn.style.display = "flex"; // it’s an <a>
    }
  } catch (e) {
    console.log("loadMeIntoHome failed", e);
  }
}
