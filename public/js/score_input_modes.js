// js/score_input_modes.js
// STEP B：入力（自動換算のみ）＋バリデーション＋換算後表示＋最終成績計算
//
// 仕様（2025-12 改訂版：A仕様）
// ----------------------------------------
// - 上限超過しても「勝手に補正しない」
// - 数値はそのまま残し、セルを赤枠で強調表示（.ktc-input-error）
// - 寄与点・最終成績の計算には「エラーセルは含めない」
// - 不正値（数値でない、負の値など）は即座にアラートしてクリア
// - 将来の「成績送信時」に使えるよう、エラー情報を返す

/**
 * 1セル分の「最終成績への寄与点」を計算（自動換算のみ）
 *
 * - 換算式は 入力値 × (percent / 100)
 *
 * @param {number} value 入力値
 * @param {number} percent  評価割合（例: 50, 30, 20）
 * @returns {number} 最終成績に足し込む「寄与点」
 */
function calcContribution(value, percent, maxAllowed) {
  const v = Number(value);
  const p = Number(percent);
  const m = Number(maxAllowed);

  if (!Number.isFinite(v) || !Number.isFinite(p)) return 0;

  // max が不正なら「100点満点」として扱う（保険）
  if (!Number.isFinite(m) || m <= 0) return (v * p) / 100;

  // (value / max) * percent
  return (v / m) * p;
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

// DOMから調整点を読み取る（Firestore readなし）
function getAdjustPointFromDom() {
  const el = document.getElementById("adjustPointDisplay");
  if (!el) return null;
  const n = Number((el.textContent || "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// 現在の科目タイプを推定（special/elective/normal/skill）
function deriveSubjectType(context) {
  if (context && typeof context.subjectType === "string") {
    return context.subjectType;
  }

  try {
    const meta = (typeof window !== "undefined" && (window.currentSubjectMeta || window.__currentSubjectMeta)) || null;
    if (meta && typeof meta === "object") {
      if (meta.specialType === 1 || meta.specialType === 2) return "special";
      if (meta.required === false) return "elective";
      if (meta.isSkillLevel === true) return "skill";
    }
  } catch (e) { /* noop */ }

  try {
    const bodyType = document?.body?.dataset?.subjectType;
    if (bodyType) return bodyType;
  } catch (e) { /* noop */ }

  return "normal";
}

// 既存の riskContext 提供者を優先しつつ、DOMから補完
function buildLocalRiskContext(context) {
  if (context && typeof context.riskContextBuilder === "function") {
    try { return context.riskContextBuilder() || {}; } catch (e) { /* noop */ }
  }
  if (context && context.riskContext) {
    return context.riskContext;
  }

  const adjustPoint = getAdjustPointFromDom();
  const subjectType = deriveSubjectType(context);
  return { adjustPoint, subjectType };
}

/**
 * 1行分の最終成績を計算してセルに反映
 *
 * ここでやっていること：
 *  - 入力文字列から数字以外を除去（1--- → 1 など）し、数値に変換
 *  - 空欄：アラート無し・括弧表示無し・エラーも無し
 *  - 不正値（数値でない／マイナス）はアラートしてクリア
 *  - 上限超過（0〜100 を超えた場合）は
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
 *       value: 120,
 *       max: 100,
 *     },
 *   ]
 * }
 *
 * @param {HTMLTableRowElement} tr
 * @param {{ items:any[], normalizedWeights:number[] }} criteriaState
 * @param {any} context  // リスク判定などの外部文脈を受け取る
 * @param {(msg:string)=>void} [showAlert]
 * @param {number} [rowIndex]  // updateAllFinalScores から渡せるようにしておく
 * @returns {{hasError:boolean, errors:any[]}}
 */
export function updateFinalScoreForRow(
  tr,
  criteriaState,
  context,
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
  let hasAnyInput = false;
  let hasEmpty = false;
  const errors = [];

  inputs.forEach((input) => {
    const idx = Number(input.dataset.index || "0");
    const item = items[idx];
    const percent = Number((criteriaState.normalizedWeights || [])[idx] ?? (item?.percent || 0));


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
      // 空欄があることを記録し、換算表示が残らないようクリアして戻る
      hasEmpty = true;
      if (hasConvertedSpan) {
        span.textContent = "";
      }
      return;
    } else {
      hasAnyInput = true;
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

// ---------- ③ 最大値を評価基準から取得（最終確定仕様） ----------
    const maxAllowed = Number(item.max);

    if (!Number.isFinite(maxAllowed) || maxAllowed <= 0) {
      console.error("[FATAL] invalid item.max (should never happen)", item);
      return;
    }
// ---------- ★ STEP4：input の max 属性を評価基準と同期 ----------
if (Number.isFinite(maxAllowed) && maxAllowed > 0) {
  input.max = String(maxAllowed);
} else {
  input.removeAttribute("max");
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
      });

      // 寄与点には含めない
      return;
    }

    // ---------- ⑤ 正常値として寄与点を計算 ----------
let contribution = 0;

if (
  Number.isFinite(value) &&
  Number.isFinite(maxAllowed) &&
  maxAllowed > 0 &&
  Number.isFinite(percent)
) {
  contribution = (value / maxAllowed) * percent;
}
console.log({
  idx,
  itemName: item?.name,
  percent,
  maxAllowed,
  value,
  contribution,
});

    if (hasConvertedSpan) {
      span.textContent = `(${contribution.toFixed(1)})`;
    }

    total += contribution;
  });

  // ---------- ⑥ 最終成績セルに合計を反映 ----------
  const finalCell = tr.querySelector(".final-score");
  if (finalCell) {
    if (!hasAnyInput) {
      finalCell.textContent = "";
    
    } else {
      finalCell.textContent = Number.isFinite(total) ? Math.floor(total).toString() : "";
    }
    // === STEP.B: 保存時点で「全入力済か」を DOM に記録 ===
    try {
      if (tr && tr.dataset) {
        tr.dataset.allFilled = (!hasEmpty && hasAnyInput) ? "1" : "0";
      }
    } catch (e) {
      // 何もしない（安全）
    }

    // --- 赤点ハイライト（発火点をここに集約） ---
    try {
      const finalText = finalCell.textContent || "";
      const riskContext = buildLocalRiskContext(context);
      const flags = computeRiskFlags(finalText, riskContext);
      tr.classList.toggle("red-failure-row", !!(flags && flags.isFail));
    } catch (e) {
      // noop
    }
  }

  return {
    hasError: errors.length > 0,
    errors,
  };
}

/**
 * 与えられた最終成績と文脈から赤点/超過を判定する共通関数
 * @param {string|number|null|undefined} finalScore
 * @param {{ useAdjustment?: boolean, adjustPoint?: number|null }} [ctx]
 * @returns {{ isFail: boolean, isExcess: boolean }}
 */
export function computeRiskFlags(finalScore, ctx) {
  // 空欄・未入力ガード
  if (finalScore === null || finalScore === undefined) {
    return { isFail: false, isExcess: false };
  }
  if (typeof finalScore === "string" && finalScore.trim() === "") {
    return { isFail: false, isExcess: false };
  }
  const numericScore = Number(finalScore);
  if (!Number.isFinite(numericScore)) {
    return { isFail: false, isExcess: false };
  }

  const subjectType = ctx?.subjectType || "normal";
  const rawAdjust = ctx?.adjustPoint;
  const adjustPoint = Number.isFinite(Number(rawAdjust)) ? Number(rawAdjust) : null;

  if (subjectType === "special") {
    return { isFail: false, isExcess: false };
  }

  if (subjectType === "elective") {
    return { isFail: numericScore < 60, isExcess: false };
  }

  if (subjectType === "normal" || subjectType === "skill") {
    if (Number.isFinite(adjustPoint)) {
      return { isFail: numericScore < adjustPoint, isExcess: false };
    }
    return { isFail: false, isExcess: false };
  }

  return { isFail: false, isExcess: false };
}

/**
 * すべての行の最終成績を再計算
 *
 * 将来の「成績送信時のエラー一覧表示」で使えるように、
 * 全行分のエラー情報を配列で返す。
 *
 * 例：
 * const errorList = updateAllFinalScores(tbody, criteriaState, context);
 * if (errorList.length > 0) { ...モーダル表示... }
 *
 * @param {HTMLTableSectionElement} tbody
 * @param {{ items:any[], normalizedWeights:number[] }} criteriaState
 * @param {any} context  // リスク判定などの外部文脈を受け取る
 * @param {(msg:string)=>void} [showAlert]
 * @returns {any[]} errors
 */
export function updateAllFinalScores(
  tbody,
  criteriaState,
  context,
  showAlert
) {
  const rows = tbody.querySelectorAll("tr");
  const allErrors = [];

  rows.forEach((tr, rowIndex) => {
    const result = updateFinalScoreForRow(
      tr,
      criteriaState,
      context,
      showAlert,
      rowIndex
    );
    if (result && Array.isArray(result.errors) && result.errors.length > 0) {
      allErrors.push(...result.errors);
    }
  });

  return allErrors;
}
// ================================
// STEP2: 手入力時の即時再計算
// ================================
export function setupAutoRecalcOnInput(
  tbody,
  criteriaState,
  context
) {
  if (!tbody) return;

  // ★ tbody 全体で input を拾う（イベント委譲）
  tbody.addEventListener("input", (ev) => {
    const target = ev.target;

    if (!(target instanceof HTMLInputElement)) return;
    if (target.type !== "number") return;

    // ★ 入力のたびに最終成績を再計算
    updateAllFinalScores(
      tbody,
      criteriaState,
      context
    );
  });
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
 * @param {any} context  // リスク判定などの外部文脈を受け取る
 * @param {(msg:string)=>void} [showAlert]
 */
export function attachInputHandlers(
  tbody,
  criteriaState,
  context,
  showAlert
) {
  tbody.addEventListener("input", (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.type !== "number") return;

    const tr = target.closest("tr");
    if (!tr) return;

    updateFinalScoreForRow(tr, criteriaState, context, showAlert);
  });
}
