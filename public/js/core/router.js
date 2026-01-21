// public/js/core/router.js
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => {
    s.style.display = "none";
  });

  const el = document.getElementById(id);
  if (el) el.style.display = "block";
}

window.showScreen = showScreen;
