window.showScreen?.("screen-loading");

const isLocalDevHost =
  location.hostname === "localhost" || location.hostname === "127.0.0.1";

const isSecurePage = location.protocol === "https:";

const WS_URL = isLocalDevHost
  ? `ws://localhost:3000`
  : isSecurePage
    ? "wss://gin-rummy-server.onrender.com"
    : `ws://${location.hostname}:3000`;

    
console.log(`[ENV] ${location.protocol}//${location.hostname} → ${WS_URL}`);


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
  window.showScreen("screen-create");
});

socket.addEventListener("error", () => {
  setLoadingMessage("Connection error… refresh to retry.");
  window.showScreen?.("screen-loading");
});

socket.addEventListener("close", () => {
  setLoadingMessage("Disconnected… refresh to reconnect.");
  window.showScreen?.("screen-loading");
});

// ---- PWA / Service Worker ----
if (!isLocalDevHost && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(console.error);
  });
}
