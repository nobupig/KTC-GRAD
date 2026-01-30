// public/js/edit_mode_notice.js
console.log("[edit_mode_notice] module loaded");

export function renderEditModeNoticeOnce(options = {}) {
    console.log("[edit_mode_notice] renderEditModeNotice called");
  // 修正モード以外では何もしない
  if (!window.__isEditMode) return;

  const {
    noticeId = "editModeNotice",
    anchorId = null,          // ← id 指定は任意に
    insert = "before",
  } = options;

  // 多重生成防止
  if (document.getElementById(noticeId)) return;

  // ===== アンカー決定（id → class → table の順）=====
  const anchor =
    (anchorId && document.getElementById(anchorId)) ||
    document.querySelector(".score-table") ||
    document.querySelector("table");

  if (!anchor || !anchor.parentNode) return;

  const notice = document.createElement("div");
  notice.id = noticeId;
  notice.className = "edit-mode-notice";

  notice.innerHTML = `
    <div class="edit-mode-notice__title">⚠ 成績修正モードについて</div>
    <div class="edit-mode-notice__body">
      このモードは成績修正モードです。<br>
      超過学生の登録・解除、時間数の変更はこの画面では行えません。<br>
      該当する場合は <span class="edit-mode-notice__strong">Slack にて教務までご連絡ください。</span>
    </div>
  `;

  if (insert === "after") {
    anchor.parentNode.insertBefore(notice, anchor.nextSibling);
  } else {
    anchor.parentNode.insertBefore(notice, anchor);
  }
}
