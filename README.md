# Gin Rummy (Web)

A multiplayer Gin Rummy game built with **HTML, CSS, JavaScript** on the client and **Node.js + WebSockets** on the server.

This project is structured like a small studio production: clear separation between server logic, network handling, UI, animations, and game state.

---

## 📁 Project Structure

/
├─ public/ # Static frontend (served by Express)
│ ├─ index.html
│ ├─ sw.js # Service Worker (prod only)
| ├─ manifest.json
│ ├─ css/
│ │ └─ style.css
│ └─ js/
│ ├─ core/
│ │ └─ router.js # screen routing (showScreen)
│ │
│ ├─ game/
│ │ ├─ ui-elements.js # cached DOM elements + shared flags
│ │ ├─ ui-helpers.js # small helpers (toast, touch detect, utils)
│ │ ├─ turn-indicator.js # turn wheel + countdown logic
│ │ ├─ anim-draw-discard.js
│ │ ├─ anim-opponent.js
│ │ ├─ round-reveal.js # end-of-round overlay animations
│ │ ├─ rendering.js # render hand, discard, cards
│ │ ├─ drag-drop.js # drag, reorder, touch interactions
│ │ ├─ lobby-ui.js # lobby / create / join UI
│ │ └─ socket-handler.js # incoming WS message handling
│ │
│ ├─ game-state.js # GameState singleton (client state)
│ ├─ meld-visuals.js # meld detection + highlighting
│ └─ main.js # app bootstrap + WS setup
│
├─ server/
│ ├─ server.js # Express + WebSocket server entry
│ └─ rooms.js # room & match management
│
├─ package-lock.json
├─ package.json
└─ README.md



---

## 🧠 Architecture Overview

### Client (Browser)
- **No frameworks** — plain HTML/CSS/JS
- Scripts are loaded via classic `<script>` tags (not ES modules)
- Shared functions are exposed via `window.*` where needed
- Load order is intentional and important

### Server (Node.js)
- Express serves `/public`
- WebSocket server handles multiplayer state
- Server is authoritative for game state

---



## 🔌 Script Load Order (Critical)

In `index.html`:

```html
<script src="/js/core/router.js"></script>

<script src="/js/game-state.js"></script>
<script src="/js/meld-visuals.js"></script>

<script src="/js/game/ui-elements.js"></script>
<script src="/js/game/ui-helpers.js"></script>
<script src="/js/game/turn-indicator.js"></script>
<script src="/js/game/anim-draw-discard.js"></script>
<script src="/js/game/anim-opponent.js"></script>
<script src="/js/game/round-reveal.js"></script>
<script src="/js/game/rendering.js"></script>
<script src="/js/game/drag-drop.js"></script>
<script src="/js/game/lobby-ui.js"></script>
<script src="/js/game/socket-handler.js"></script>

<script src="/js/main.js"></script>


Why:

router.js must load before anything uses showScreen

game-state.js before anything touches GameState

socket-handler.js after all UI/game functions exist

main.js last (bootstrap + WS connection)

🌍 Environment Handling (Local vs Production)

The client automatically switches WebSocket targets based on where it’s loaded:

Local dev:

ws://localhost:3000


LAN testing (phone on same Wi-Fi):

ws://<laptop-ip>:3000


Production:

wss://gin-rummy-server.onrender.com



Debug log in main.js:

console.log(
  `[ENV] ${location.protocol}//${location.hostname} → ${WS_URL}`
);