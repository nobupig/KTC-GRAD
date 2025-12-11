// js/score_input_paste.js
// ★あなた専用・完全版：Excel貼付け最適化版★

import { updateFinalScoreForRow } from "./score_input_modes.js";

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
 * @param {{ currentMode:string }} modeState
 */
export function applyPastedScores(pastedText, tbody, criteriaState, modeState) {
  const rows = parsePasted(pastedText);
  if (!rows.length) {
    alert("貼り付けデータが読み取れません。");
    return false;
  }

  // 貼付け開始位置（現在フォーカス中のセル）
  const active = document.activeElement;
  const startCol = getStartCol(active);

  if (startCol == null) {
    alert("貼り付け対象のセルを選択してから貼り付けしてください。");
    return false;
  }

  const studentRows = Array.from(tbody.querySelectorAll("tr"));
  const studentCount = studentRows.length;

  // 1行目で横方向の列数を確認（Excel側で貼られた列数）
  const pasteColCount = rows[0].length;
  if (pasteColCount === 0) {
    alert("貼り付けデータが空です。");
    return false;
  }

  // Web 側の評価項目数
  const itemCount = criteriaState.items.length;

  // startCol から itemCount を超えないかチェック
  if (startCol + pasteColCount > itemCount) {
    alert("貼り付け列数が評価項目数を超えています。");
    return false;
  }

  // 貼り付け開始行：学生の最初の行 or 現在の学生行（Excel 行とずらす運用はしない設計）
  let webRowIndex = studentRows.findIndex(tr => tr.contains(active));
  if (webRowIndex === -1) webRowIndex = 0;

  let pasteRowIndex = 0;

  while (pasteRowIndex < rows.length && webRowIndex < studentCount) {
    const vals = rows[pasteRowIndex];

    // 空行判定（すべて空セルの行 → スキップ）
    const isEmptyRow = vals.every(v => v === "");
    if (!isEmptyRow) {
      const tr = studentRows[webRowIndex];
      const inputs = tr.querySelectorAll("input[type='number']");

      for (let c = 0; c < pasteColCount; c++) {
        const cellValue = vals[c];

        // 空セルの場合 → スキップ（上書きしない）
        if (cellValue === "") continue;

        const col = startCol + c;
        const input = inputs[col];
        if (!input) continue;

        const num = Number(cellValue);
        if (!Number.isFinite(num)) {
          alert(`数値ではない値が含まれています（${cellValue}）。`);
          return false;
        }

        input.value = String(num);
      }

      updateFinalScoreForRow(tr, criteriaState, modeState);
    }

    pasteRowIndex++;
    webRowIndex++;
  }

  return true;
}
