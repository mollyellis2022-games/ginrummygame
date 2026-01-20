// UI elements
window.deckDiv = document.getElementById("deck");
window.handDiv = document.getElementById("hand");
window.discardDiv = document.getElementById("discard");
window.ginBtn = document.getElementById("ginBtn");

// overlays
window.overlayEl = document.getElementById("match-overlay");
window.matchResultEl = document.getElementById("match-result");
window.rematchStatusEl = document.getElementById("rematch-status");
window.rematchBtn = document.getElementById("rematch-btn");

// shared flags
window.lastDiscardTopId = null;
window.discardAnimating = false;
window.pendingTimeoutDiscards = new Set();
