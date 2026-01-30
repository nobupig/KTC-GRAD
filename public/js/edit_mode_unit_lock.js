export function lockUnitButtonsInEditMode() {
  if (!window.__isEditMode) return;

  const unitKeyFromUrl =
    new URLSearchParams(location.search).get("unitKey");

  const unitButtons = document.querySelectorAll(
    "button[data-unit-key]"
  );
  if (!unitButtons.length) return;

  unitButtons.forEach((btn) => {
    const btnUnitKey = btn.dataset.unitKey;

    // ★ URL と完全一致するものだけ active
    if (String(btnUnitKey) === String(unitKeyFromUrl)) {
      btn.classList.add("active");
      btn.setAttribute("aria-current", "true");
    } else {
      btn.classList.remove("active");
      btn.removeAttribute("aria-current");
    }

    // ロック
    btn.disabled = true;
    btn.style.pointerEvents = "none";
    btn.style.opacity = "0.5";
    btn.style.cursor = "not-allowed";
    btn.title = "修正モードではユニットを切り替えられません";
  });
}
