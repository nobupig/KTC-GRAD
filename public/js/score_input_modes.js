// js/score_input_modes.js
// STEP B-2〜B-4：入力モード（raw/scaled）＋バリデーション＋最終成績計算

/**
 * モード状態オブジェクト
 * - currentMode: "scaled" | "raw"
 */
export function createModeState() {
  return {
    currentMode: "scaled", // デフォルトは自動換算モード
  };
}

/**
 * タブUIを動的生成してモード切り替えを可能にする
 *
 * @param {{ container?: HTMLElement, infoMessageEl?: HTMLElement }} options
 * @param {{ currentMode: string }} modeState
 */
export function initModeTabs(options, modeState) {
  // 全体モードUIは不要のため、生成処理を完全に無効化
  return;
}

/**
 * 1セルの入力値を「内部用 0〜100 スコア」に変換
 *
 * @param {number} rawValue 入力値
 * @param {number} weight   評価基準の割合値(例:70)
 * @param {"raw"|"scaled"} mode
 * @returns {number} 0〜100 のスコア（NaN許可）
 */
function toPercentScore(rawValue, weight, mode) {
  if (!Number.isFinite(rawValue)) return NaN;

  if (mode === "raw") {
    if (weight <= 0) return NaN;
    return (rawValue / weight) * 100;
  }
  // scaled
  return rawValue;
}

/**
 * 入力値を検証（モード別）
 *
 * @param {number} value
 * @param {number} weight 評価割合
 * @param {"raw"|"scaled"} mode
 * @param {(msg:string)=>void} showAlert
 * @returns {boolean} OKならtrue
 */
function validateValue(value, weight, mode, showAlert) {
  if (!Number.isFinite(value)) {
    showAlert("数値を入力してください。");
    return false;
  }
  if (value < 0) {
    showAlert("マイナスの値は入力できません。");
    return false;
  }

  if (mode === "raw") {
    if (value > weight) {
      showAlert(`この項目は 0〜${weight} の範囲で入力してください。`);
      return false;
    }
  } else {
    // scaled
    if (value > 100) {
      showAlert("0〜100 の範囲で入力してください。");
      return false;
    }
  }
  return true;
}

/**
 * 1行分の最終成績を計算してセルに反映
 *
 * @param {HTMLTableRowElement} tr
 * @param {{ items:any[], normalizedWeights:number[] }} criteriaState
 * @param {{ currentMode: string }} modeState
 * @param {(msg:string)=>void} [showAlert]
 */
export function updateFinalScoreForRow(tr, criteriaState, modeState, showAlert) {
  const items = criteriaState.items || [];
  const weights = criteriaState.normalizedWeights || [];

  if (!items.length || !weights.length) return;

  const inputs = tr.querySelectorAll("input[type='number']");
  let total = 0;
  let invalid = false;

  inputs.forEach((input) => {
    const idx = Number(input.dataset.index || "0");
    const weight = items[idx] ? Number(items[idx].percent || 0) : 0;

    const raw = Number(input.value || "0");

    const alertFn =
      showAlert ||
      ((msg) => {
        // TODO: 後でスタイリッシュなトーストUIに差し替え
        window.alert(msg);
      });

    if (!validateValue(raw, weight, modeState.currentMode, alertFn)) {
      invalid = true;
      // 入力を元に戻す／クリアする場合はここで制御
      return;
    }

    const pScore = toPercentScore(raw, weight, modeState.currentMode);
    if (!Number.isFinite(pScore)) return;

    const w = weights[idx] ?? 0;
    total += (pScore * w) / 100;
  });

  if (invalid) return;

  const finalCell = tr.querySelector(".final-score");
  if (finalCell) {
    finalCell.textContent = Number.isFinite(total)
      ? Math.floor(total).toString()
      : "";
  }
}

/**
 * すべての行の最終成績を再計算
 *
 * @param {HTMLTableSectionElement} tbody
 * @param {{ items:any[], normalizedWeights:number[] }} criteriaState
 * @param {{ currentMode: string }} modeState
 * @param {(msg:string)=>void} [showAlert]
 */
export function updateAllFinalScores(tbody, criteriaState, modeState, showAlert) {
  const rows = tbody.querySelectorAll("tr");
  rows.forEach((tr) =>
    updateFinalScoreForRow(tr, criteriaState, modeState, showAlert)
  );
}

/**
 * tbody 内のすべての input に対して、
 * 入力時に自動で最終成績を再計算するハンドラを設定
 *
 * @param {HTMLTableSectionElement} tbody
 * @param {{ items:any[], normalizedWeights:number[] }} criteriaState
 * @param {{ currentMode: string }} modeState
 * @param {(msg:string)=>void} [showAlert]
 */
export function attachInputHandlers(tbody, criteriaState, modeState, showAlert) {
  tbody.addEventListener("input", (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.type !== "number") return;

    const tr = target.closest("tr");
    if (!tr) return;

    updateFinalScoreForRow(tr, criteriaState, modeState, showAlert);
  });
}
