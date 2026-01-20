// public/js/core/router.js

window.showScreen = function (screenId) {
  document
    .querySelectorAll(".screen")
    .forEach((el) => el.classList.add("hidden"));
  document.getElementById(screenId)?.classList.remove("hidden");
};
