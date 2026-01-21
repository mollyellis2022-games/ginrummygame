function showScreen(id) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.add("hidden");
    screen.style.removeProperty("display"); // clear inline "block"
  });

  const el = document.getElementById(id);
  if (el) {
    el.classList.remove("hidden");
    el.style.removeProperty("display"); // let CSS decide (grid/flex)
  }
}

window.showScreen = showScreen;
