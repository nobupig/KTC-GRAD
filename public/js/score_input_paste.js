// js/score_input_paste.js
// ★あなた専用・完全版：Excel貼付け最適化版★

import {
  refreshSaveButtonState,
  recalcFinalScoresAfterRestore,
} from "./score_input_loader.js";

/**
 * Excel などの貼り付けテキストを 2次元配列に変換
 * 空行は "すべて空セル" として扱い、後でスキップ判定する
 */
function parsePasted(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.split(/\t|,/).map(v => v.trim()));
}

/**
 * 貼り付け開始列を取得
 * @param {HTMLElement} activeElement
 * @returns {number|null}
 */
function getStartCol(activeElement) {
  if (!activeElement) return null;
  const idx = activeElement.dataset.index;
  if (idx == null) return null;
  return Number(idx);
}

/**
 * メイン処理：
 * Excel 貼付け → 行列方向に学生表へ反映
 *
 * @param {string} pastedText
 * @param {HTMLTableSectionElement} tbody
 * @param {{ items:any[], normalizedWeights:number[] }} criteriaState
 */
export function applyPastedScores(pastedText, tbody, criteriaState) {
  const rows = parsePasted(pastedText);
  if (!rows.length) {
    alert("貼り付けデータが読み取れません。");
    return false;
  }

  const active = document.activeElement;
  const startCol = getStartCol(active);
  if (startCol == null) {
    alert("貼り付け対象のセルを選択してから貼り付けしてください。");
    return false;
  }

  const studentRows = Array.from(tbody.querySelectorAll("tr"));
  const studentCount = studentRows.length;

  const pasteColCount = rows[0].length;
  if (pasteColCount === 0) {
    alert("貼り付けデータが空です。");
    return false;
  }

  const itemCount = criteriaState.items.length;
  if (startCol + pasteColCount > itemCount) {
    alert("貼り付け列数が評価項目数を超えています。");
    return false;
  }

  let webRowIndex = studentRows.findIndex(tr => tr.contains(active));
  if (webRowIndex === -1) webRowIndex = 0;

  let pasteRowIndex = 0;
  while (pasteRowIndex < rows.length && webRowIndex < studentCount) {
    const vals = rows[pasteRowIndex];
    const tr = studentRows[webRowIndex];
    const inputs = tr.querySelectorAll("input[data-index]:not(.skill-level-input)");

    for (let c = 0; c < pasteColCount; c++) {
      const cellValue = vals[c];
      if (cellValue === "" || cellValue == null) continue;

      const num = Number(cellValue);
      if (!Number.isFinite(num)) continue;
      if (num < 0) continue;

      const col = startCol + c;
      const input = inputs[col];
      if (!input) continue;

      // ★ 評価基準 max を取得
      const item = criteriaState?.items?.[col];
      const max = item ? Number(item.max) : null;

      // ★ max 超過は「その場で拒否」
      if (Number.isFinite(max) && num > max) {
        input.value = "";
        input.classList.add("input-over-max");
        (window.showScoreInputErrorToast ? window.showScoreInputErrorToast(`この項目の上限は ${max} 点です`) : alert(`この項目の上限は ${max} 点です`));
        continue;
      }

      // ★ 正常値のみ反映
      input.classList.remove("input-over-max");
      input.value = String(num);
      input.dispatchEvent(new Event("input", { bubbles: true }));

    }

    pasteRowIndex++;
    webRowIndex++;
  }
  
  recalcFinalScoresAfterRestore(tbody);
  refreshSaveButtonState();
  return true;
}

