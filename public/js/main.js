// public/js/main.js
import { initHomeUI } from "./game/home-ui.js";

window.showScreen?.("screen-loading");

const isLocalDevHost =
  location.hostname === "localhost" || location.hostname === "127.0.0.1";

// ✅ Your Northflank backend domain (custom domain recommended)
const PROD_WS_URL = "wss://api.ellisandcodesigns.co.uk";

const WS_URL = isLocalDevHost ? "ws://localhost:3000" : PROD_WS_URL;

console.log(`[ENV] ${location.protocol}//${location.hostname} → ${WS_URL}`);

async function loadMe() {
  try {
    const r = await fetch("https://api.ellisandcodesigns.co.uk/me", {
      credentials: "include",
    });
    const data = await r.json();
    console.log("ME:", data);

    const me = data.user;

    const loginLink = document.getElementById("loginLink");
    const chip = document.getElementById("profileChip");
    const nameEl = document.getElementById("profileName");
    const avatarEl = document.getElementById("profileAvatar");
    const logoutLink = document.getElementById("logoutLink");

    if (me) {
      if (loginLink) loginLink.style.display = "none";
      if (chip) chip.style.display = "flex";
      if (nameEl) nameEl.textContent = me.display_name || me.email || "Player";

      if (avatarEl) {
        if (me.avatar_url) {
          avatarEl.src = me.avatar_url;
          avatarEl.style.display = "block";
        } else {
          avatarEl.style.display = "none";
        }
      }
    } else {
      if (chip) chip.style.display = "none";
      if (loginLink) loginLink.style.display = "inline-block";
      if (avatarEl) avatarEl.style.display = "none";
    }

    if (logoutLink) {
      logoutLink.onclick = async (e) => {
        e.preventDefault();
        await fetch("https://api.ellisandcodesigns.co.uk/auth/logout", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        location.reload();
      };
    }
  } catch (e) {
    console.log("loadMe failed", e);
  }
}

loadMe();

const socket = new WebSocket(WS_URL);
window.socket = socket;

socket.addEventListener("open", () => console.log("WS connected:", WS_URL));
socket.addEventListener("error", (e) => console.log("WS error:", e));
socket.addEventListener("close", () => console.log("WS closed"));

socket.addEventListener("message", (e) => console.log("message:", e.data));
socket.addEventListener("message", window.handleSocketMessage);

window.bindUIActions();

let didEnterLobby = false;

function setLoadingMessage(msg) {
  const el = document.getElementById("loadingMessage");
  if (el) el.textContent = msg;
}

socket.addEventListener("open", () => {
  if (didEnterLobby) return;
  didEnterLobby = true;
  window.showScreen("screen-home");
});

socket.addEventListener("error", () => {
  setLoadingMessage("Connection error… refresh to retry.");
  window.showScreen?.("screen-loading");
});

socket.addEventListener("close", () => {
  setLoadingMessage("Disconnected… refresh to reconnect.");
  window.showScreen?.("screen-loading");
});

// Reload once when the SW activates a new version
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "SW_UPDATED") location.reload();
  });
}

// ---- PWA / Service Worker ----
// ---- PWA / Service Worker ----
if (!isLocalDevHost && "serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", {
        updateViaCache: "none",
      });

      // Optional: force an update check on each load (handy while iterating)
      reg.update();
    } catch (e) {
      console.error("SW register failed", e);
    }
  });
}

initHomeUI();
