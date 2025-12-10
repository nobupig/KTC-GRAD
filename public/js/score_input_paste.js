// js/score_input_paste.js
// STEP B-5：貼り付け入力ロジック

import { updateFinalScoreForRow } from "./score_input_modes.js";

/**
 * 貼り付けテキストをパースして 2次元配列にする
 *
 * 例:
 *  91905011,50,30
 *  91905012,45,35.5
 *
 * @param {string} text
 * @returns {string[][]}
 */
function parsePastedText(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(/[,\t]/).map((s) => s.trim()));
}

/**
 * 貼り付けされたスコアを tbody に反映する
 *
 * @param {string} pastedText
 * @param {HTMLTableSectionElement} tbody
 * @param {{ items:any[], normalizedWeights:number[] }} criteriaState
 * @param {{ currentMode:string }} modeState
 * @param {(msg:string)=>void} [showAlert]
 * @returns {boolean}  成功時 true, 失敗時 false
 */
export function applyPastedScores(
  pastedText,
  tbody,
  criteriaState,
  modeState,
  showAlert
) {
  const alertFn =
    showAlert ||
    ((msg) => {
      window.alert(msg);
    });

  const rowsData = parsePastedText(pastedText);
  if (!rowsData.length) {
    alertFn("貼り付けデータが空です。");
    return false;
  }

  const expectedItemCount = criteriaState.items?.length ?? 0;
  if (!expectedItemCount) {
    alertFn("評価項目が設定されていないため、貼り付けできません。");
    return false;
  }

  // 1行目で列数チェック
  const first = rowsData[0];
  if (first.length !== expectedItemCount + 1) {
    alertFn(
      `列数が一致しません。先頭列に学籍番号、その後ろに ${expectedItemCount} 個のスコアを並べてください。`
    );
    return false;
  }

  // 事前に tbody 内の行を studentId → tr にマッピング
  const trMap = new Map();
  tbody.querySelectorAll("tr").forEach((tr) => {
    const id = tr.dataset.studentId;
    if (id) trMap.set(String(id), tr);
  });

  // 1回検証用の領域（破壊的変更は最後まで行わない）
  const patchPlan = [];

  for (const cols of rowsData) {
    const [studentId, ...scoresRaw] = cols;
    const tr = trMap.get(studentId);
    if (!tr) {
      alertFn(`学籍番号 ${studentId} に対応する行が見つかりません。`);
      return false;
    }

    if (scoresRaw.length !== expectedItemCount) {
      alertFn(
        `学籍番号 ${studentId} の列数が不正です。期待列数: ${expectedItemCount} 件`
      );
      return false;
    }

    const inputs = tr.querySelectorAll("input[type='number']");
    if (inputs.length !== expectedItemCount) {
      alertFn(
        `学籍番号 ${studentId} の入力欄数が評価項目数と一致しません。`
      );
      return false;
    }

    const numericValues = scoresRaw.map((v) => Number(v || "0"));
    if (numericValues.some((v) => !Number.isFinite(v))) {
      alertFn(
        `学籍番号 ${studentId} に数値以外の値が含まれています。`
      );
      return false;
    }

    patchPlan.push({
      tr,
      values: numericValues,
    });
  }

  // ここまで来たら、一括で反映
  patchPlan.forEach(({ tr, values }) => {
    const inputs = tr.querySelectorAll("input[type='number']");
    inputs.forEach((input, idx) => {
      input.value = String(values[idx] ?? "");
    });
    updateFinalScoreForRow(tr, criteriaState, modeState, alertFn);
  });

  return true;
}
