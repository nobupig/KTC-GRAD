// public/js/edit_mode_subject_lock.js
export function lockSubjectSelectInEditMode() {
  if (!window.__isEditMode) return;

  // 対象科目セレクト
  const subjectSelect = document.getElementById("subjectSelect");
  if (!subjectSelect) return;

  // 完全に操作不可に
  subjectSelect.disabled = true;

  // 見た目も「固定」と分かるように
  subjectSelect.style.opacity = "0.6";
  subjectSelect.style.cursor = "not-allowed";

  // 念のため change を潰す（事故防止）
  subjectSelect.addEventListener(
    "change",
    (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true
  );
}
