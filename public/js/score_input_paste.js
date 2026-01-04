// js/score_input_paste.js
// ★あなた専用・完全版：Excel貼付け最適化版★

import { updateFinalScoreForRow } from "./score_input_modes.js";
import { isSingle100PercentCriteria } from "./score_input_criteria.js";

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

function openPasteModeModal(targetItems, onApply, onCancel) {
  const modal = document.getElementById("pasteModeModal");
  const tbody = document.getElementById("pasteModeTableBody");
  tbody.innerHTML = "";

  const selections = [];

  targetItems.forEach((item, idx) => {
    const tr = document.createElement("tr");

    const tdName = document.createElement("td");
    tdName.textContent = item.name || "(無名)";
    tr.appendChild(tdName);

    const tdPercent = document.createElement("td");
    tdPercent.textContent = `${item.percent}%`;
    tr.appendChild(tdPercent);

    const tdSelect = document.createElement("td");

    // 単一100%項目は選択不要（disabled）
    const isTrivial =
      targetItems.length === 1 && Number(item.percent) === 100;

    if (isTrivial) {
      tdSelect.textContent = "選択不要";
      selections[idx] = "scaled";
    } else {
      const select = document.createElement("select");
      const optScaled = new Option("自動換算（0〜100）", "scaled");
      const optRaw = new Option("素点（換算後）", "raw");

      select.appendChild(optScaled);
      select.appendChild(optRaw);
      select.value = item.mode || "scaled";

      select.addEventListener("change", () => {
        selections[idx] = select.value;
      });

      selections[idx] = select.value;
      tdSelect.appendChild(select);
    }

    tr.appendChild(tdSelect);
    tbody.appendChild(tr);
  });

  modal.classList.remove("hidden");

  document.getElementById("pasteModeCancelBtn").onclick = () => {
    modal.classList.add("hidden");
    onCancel();
  };

  document.getElementById("pasteModeApplyBtn").onclick = () => {
    modal.classList.add("hidden");
    onApply(selections);
  };
}

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

// ===== 貼り付け時の入力意味確認 =====
const isTrivial = isSingle100PercentCriteria(criteriaState);

if (!isTrivial) {
  const targetItems = criteriaState.items.slice(
    startCol,
    startCol + pasteColCount
  );

  openPasteModeModal(
    targetItems,
    (selectedModes) => {
      // 再帰的に再実行（選択結果付き）
      applyPastedScoresWithModes(
        rows,
        tbody,
        criteriaState,
        modeState,
        startCol,
        selectedModes
      );
    },
    () => {}
  );
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

function applyPastedScoresWithModes(
  rows,
  tbody,
  criteriaState,
  modeState,
  startCol,
  selectedModes
) {
  const studentRows = Array.from(tbody.querySelectorAll("tr"));
  let webRowIndex = 0;

  rows.forEach((vals) => {
    if (webRowIndex >= studentRows.length) return;
    if (vals.every(v => v === "")) {
      webRowIndex++;
      return;
    }

    const tr = studentRows[webRowIndex];
    const inputs = tr.querySelectorAll("input[type='number']");

    vals.forEach((cellValue, c) => {
      if (cellValue === "") return;

      const col = startCol + c;
      const input = inputs[col];
      if (!input) return;

      const num = Number(cellValue);
      if (!Number.isFinite(num)) return;

      input.value = String(num);

      // 一時的に mode を差し替えて計算
      const originalMode = criteriaState.items[col].mode;
      criteriaState.items[col].mode = selectedModes[c] || originalMode;

      updateFinalScoreForRow(tr, criteriaState, modeState);

      // 戻す
      criteriaState.items[col].mode = originalMode;
    });

    webRowIndex++;
  });
}
