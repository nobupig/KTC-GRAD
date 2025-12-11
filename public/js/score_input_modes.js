// js/score_input_modes.js
// STEP B：入力モード（raw/scaled）＋バリデーション＋換算後表示＋最終成績計算
//
// 仕様（2025-12 改訂版：A仕様）
// ----------------------------------------
// - 上限超過しても「勝手に補正しない」
// - 数値はそのまま残し、セルを赤枠で強調表示（.ktc-input-error）
// - 寄与点・最終成績の計算には「エラーセルは含めない」
// - 不正値（数値でない、負の値など）は即座にアラートしてクリア
// - 将来の「成績送信時」に使えるよう、エラー情報を返す

/**
 * モード状態オブジェクト
 * - currentMode: "scaled" | "raw"
 *
 * ※いまは「列ごとのモード」がメインなので、
 *   currentMode はあくまでフォールバック用です。
 */
export function createModeState() {
  return {
    currentMode: "scaled", // デフォルトは自動換算モード
  };
}

/**
 * 旧仕様の「全体タブUI」は現在は使っていないので何もしない
 */
export function initModeTabs(_options, _modeState) {
  return;
}

/**
 * 1セル分の「最終成績への寄与点」を計算
 *
 * - mode === "scaled"（自動換算モード）
 *    → 入力値は 0〜100 の素点
 *    → 寄与点 = 入力値 × (percent / 100)
 *
 * - mode === "raw"（素点モード）
 *    → 入力値は 0〜percent の“既に換算済みの点”
 *    → 寄与点 = 入力値 そのもの
 *
 * @param {number} rawValue 入力値
 * @param {number} percent  評価割合（例: 50, 30, 20）
 * @param {"raw"|"scaled"} mode
 * @returns {number} 最終成績に足し込む「寄与点」
 */
function calcContribution(rawValue, percent, mode) {
  if (!Number.isFinite(rawValue) || !Number.isFinite(percent)) return NaN;

  if (mode === "scaled") {
    // 例：percent = 30, rawValue = 80 → 80 * 0.3 = 24
    return (rawValue * percent) / 100;
  } else {
    // raw モード：既に「0〜percent 点」に換算済みなのでそのまま使う
    return rawValue;
  }
}

/**
 * tr 要素から学生情報（学籍番号・氏名）を取得
 *  ※ renderStudentRows の構造前提：
 *    学籍番号 / 学年 / 組・コース / 番号 / 氏名 / ...
 */
function getStudentInfoFromRow(tr) {
  const tds = tr.querySelectorAll("td");
  const studentId = tds[0]?.textContent?.trim?.() || "";
  const studentName = tds[4]?.textContent?.trim?.() || "";
  return { studentId, studentName };
}

/**
 * 数値の基本チェック（数値かどうか・マイナスかどうか）
 * ※ 上限超過チェックはここでは行わない（A仕様）
 *
 * @param {number} value
 * @param {(msg:string)=>void} showAlert
 * @returns {boolean}
 */
function basicNumericCheck(value, showAlert) {
  if (!Number.isFinite(value)) {
    showAlert("数値を入力してください。");
    return false;
  }
  if (value < 0) {
    showAlert("マイナスの値は入力できません。");
    return false;
  }
  return true;
}

/**
 * 1行分の最終成績を計算してセルに反映
 *
 * ここでやっていること：
 *  - 入力文字列から数字以外を除去（1--- → 1 など）し、数値に変換
 *  - 空欄：アラート無し・括弧表示無し・エラーも無し
 *  - 不正値（数値でない／マイナス）はアラートしてクリア
 *  - 上限超過（raw: 0〜percent, scaled: 0〜100 を超えた場合）は
 *      → 数値はそのまま残す
 *      → セルに .ktc-input-error を付与（赤枠表示用）
 *      → 寄与点としては計算に含めない
 *  - 正常値のみ寄与点を計算し () で表示
 *  - 最終成績セルに合計を表示（小数点以下切り捨て）
 *
 * さらに、将来の「送信時のエラー一覧表示」に備えて、
 * 上限超過などのエラー情報を配列で返す：
 *
 * 戻り値の例：
 * {
 *   hasError: true,
 *   errors: [
 *     {
 *       type: "overMax",
 *       rowIndex: 3,
 *       studentId: "12345",
 *       studentName: "山田 太郎",
 *       itemIndex: 0,
 *       itemName: "小テスト",
 *       value: 50,
 *       max: 30,
 *       mode: "raw",
 *     },
 *   ]
 * }
 *
 * @param {HTMLTableRowElement} tr
 * @param {{ items:any[], normalizedWeights:number[] }} criteriaState
 * @param {{ currentMode: string }} modeState
 * @param {(msg:string)=>void} [showAlert]
 * @param {number} [rowIndex]  // updateAllFinalScores から渡せるようにしておく
 * @returns {{hasError:boolean, errors:any[]}}
 */
export function updateFinalScoreForRow(
  tr,
  criteriaState,
  modeState,
  showAlert,
  rowIndex
) {
  const items = criteriaState.items || [];
  if (!items.length) {
    // 評価基準が無い場合は何もしない
    return { hasError: false, errors: [] };
  }

  const inputs = tr.querySelectorAll("input[type='number']");
  const { studentId, studentName } = getStudentInfoFromRow(tr);

  const alertFn =
    showAlert ||
    ((msg) => {
      window.alert(msg);
    });

  let total = 0;
  const errors = [];

  inputs.forEach((input) => {
    const idx = Number(input.dataset.index || "0");
    const item = items[idx];
    const percent = item ? Number(item.percent || 0) : 0;

    // 列ごとのモード
    const mode =
      (item && item.mode) ||
      (modeState && modeState.currentMode) ||
      "scaled";

    // 変換結果表示用 <span>
    const span = input.nextElementSibling;
    const hasConvertedSpan =
      span && span.classList && span.classList.contains("converted-score");

    // まずはエラー表示・括弧表示をリセット
    input.classList.remove("ktc-input-error");
    if (hasConvertedSpan) {
      span.textContent = "";
    }

    // ---------- ① 入力文字列をクリーンアップ ----------
    let rawStr = (input.value || "").toString();

    // 数字と小数点以外を除去
    rawStr = rawStr.replace(/[^\d.]/g, "");

    // 小数点が複数ある場合は最初の1つだけ残す
    const firstDot = rawStr.indexOf(".");
    if (firstDot !== -1) {
      const head = rawStr.slice(0, firstDot + 1);
      const tail = rawStr.slice(firstDot + 1).replace(/\./g, "");
      rawStr = head + tail;
    }

    if (rawStr !== input.value) {
      input.value = rawStr;
    }

    // ---------- 空欄は無視（アラート無し・括弧表示無し） ----------
    if (rawStr === "") {
      return;
    }

    const value = Number(rawStr);

    // ---------- ② 数値として妥当かどうか ----------
    if (!basicNumericCheck(value, alertFn)) {
      // 不正な値はクリアして終了（エラーセルとしては扱わない）
      input.value = "";
      if (hasConvertedSpan) {
        span.textContent = "";
      }
      return;
    }

    // ---------- ③ モードごとの最大値を決定 ----------
    let maxAllowed;
    if (mode === "raw") {
      maxAllowed = Number(percent || 0);
      if (!Number.isFinite(maxAllowed) || maxAllowed <= 0) {
        // 満点が定義されていない場合はアラート
        alertFn("評価基準の割合（満点）が設定されていません。");
        // とりあえずこのセルは計算に含めない＆エラー表示
        input.classList.add("ktc-input-error");
        errors.push({
          type: "noMax",
          rowIndex: typeof rowIndex === "number" ? rowIndex : null,
          studentId,
          studentName,
          itemIndex: idx,
          itemName: item ? item.name || "" : "",
          value,
          max: null,
          mode,
        });
        return;
      }
    } else {
      maxAllowed = 100;
    }

    // ---------- ④ 上限超過チェック（A仕様の肝） ----------
    if (Number.isFinite(maxAllowed) && maxAllowed > 0 && value > maxAllowed) {
      // ここでは「自動補正しない」
      // → 数値はそのまま input.value に残し、
      //    セルを赤枠表示だけ行う
      input.classList.add("ktc-input-error");
      if (hasConvertedSpan) {
        span.textContent = "";
      }

      errors.push({
        type: "overMax",
        rowIndex: typeof rowIndex === "number" ? rowIndex : null,
        studentId,
        studentName,
        itemIndex: idx,
        itemName: item ? item.name || "" : "",
        value,
        max: maxAllowed,
        mode,
      });

      // 寄与点には含めない
      return;
    }

    // ---------- ⑤ 正常値として寄与点を計算 ----------
    const contribution = calcContribution(value, percent, mode);
    if (hasConvertedSpan) {
      span.textContent = `(${contribution.toFixed(1)})`;
    }

    total += contribution;
  });

  // ---------- ⑥ 最終成績セルに合計を反映 ----------
  const finalCell = tr.querySelector(".final-score");
  if (finalCell) {
    finalCell.textContent = Number.isFinite(total)
      ? Math.floor(total).toString()
      : "";
  }

  return {
    hasError: errors.length > 0,
    errors,
  };
}

/**
 * すべての行の最終成績を再計算
 *
 * 将来の「成績送信時のエラー一覧表示」で使えるように、
 * 全行分のエラー情報を配列で返す。
 *
 * 例：
 * const errorList = updateAllFinalScores(tbody, criteriaState, modeState);
 * if (errorList.length > 0) { ...モーダル表示... }
 *
 * @param {HTMLTableSectionElement} tbody
 * @param {{ items:any[], normalizedWeights:number[] }} criteriaState
 * @param {{ currentMode: string }} modeState
 * @param {(msg:string)=>void} [showAlert]
 * @returns {any[]} errors
 */
export function updateAllFinalScores(
  tbody,
  criteriaState,
  modeState,
  showAlert
) {
  const rows = tbody.querySelectorAll("tr");
  const allErrors = [];

  rows.forEach((tr, rowIndex) => {
    const result = updateFinalScoreForRow(
      tr,
      criteriaState,
      modeState,
      showAlert,
      rowIndex
    );
    if (result && Array.isArray(result.errors) && result.errors.length > 0) {
      allErrors.push(...result.errors);
    }
  });

  return allErrors;
}

/**
 * tbody 内のすべての input に対して、
 * 入力時に自動で最終成績を再計算するハンドラを設定
 *
 * ※ 現状 score_input_loader.js では、各行入力時に
 *    直接 updateFinalScoreForRow を呼んでいるので、
 *    この関数は「予備」として残しておく。
 *
 * @param {HTMLTableSectionElement} tbody
 * @param {{ items:any[], normalizedWeights:number[] }} criteriaState
 * @param {{ currentMode: string }} modeState
 * @param {(msg:string)=>void} [showAlert]
 */
export function attachInputHandlers(
  tbody,
  criteriaState,
  modeState,
  showAlert
) {
  tbody.addEventListener("input", (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.type !== "number") return;

    const tr = target.closest("tr");
    if (!tr) return;

    updateFinalScoreForRow(tr, criteriaState, modeState, showAlert);
  });
}
