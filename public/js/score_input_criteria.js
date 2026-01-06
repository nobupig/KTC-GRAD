// js/score_input_criteria.js
// STEP B-1：評価基準のロード＋ヘッダ生成モジュール

import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { activateQuotaErrorState } from "./quota_banner.js";

/**
 * 評価基準状態
 */
export function createCriteriaState() {
  return {
    items: [],
    normalizedWeights: [],
    rawTotal: 0,
    ready: false,
    maxByIndex: [],
  };
}

/**
 * 割合を正規化
 */
export function normalizeWeights(weights) {
  const total = weights.reduce((s, v) => s + (Number(v) || 0), 0);

  if (total === 0) {
    return {
      normalized: weights.map(() => 0),
      rawTotal: 0,
    };
  }

  if (total >= 99 && total <= 101) {
    const factor = 100 / total;
    return {
      normalized: weights.map((v) => (Number(v) || 0) * factor),
      rawTotal: total,
    };
  }

  return { normalized: weights.slice(), rawTotal: total };
}

/**
 * Firestore から評価基準を取得
 */
export async function loadCriteria(db, year, subjectId, criteriaState) {
  criteriaState.items = [];
  criteriaState.normalizedWeights = [];
  criteriaState.rawTotal = 0;
  criteriaState.maxByIndex = [];
  criteriaState.ready = false;

  if (!subjectId) return;

  const colName = `evaluationCriteria_${year}`;
  const ref = doc(db, colName, subjectId);
    let snap;
    try {
      snap = await getDoc(ref);
    } catch (err) {
      if (err.code === "resource-exhausted" || String(err.message).includes("Quota exceeded")) {
        activateQuotaErrorState();
        throw err;
      } else {
        throw err;
      }
    }
  if (!snap.exists()) return;

  const data = snap.data() || {};
  const items = data.items || [];

  // --- adjustPoint, useAdjustPoint を state に格納 ---
  criteriaState.adjustPoint = (typeof data.adjustPoint === 'number' || data.adjustPoint === null) ? data.adjustPoint : null;
  criteriaState.useAdjustPoint = (typeof data.useAdjustPoint === 'boolean') ? data.useAdjustPoint : false;

  const mapped = items.map((it) => ({
    name: it.name || "",
    percent: Number(it.percent || 0),
    max: Number.isFinite(Number(it.max)) ? Number(it.max) : 100,
    // mode: it.mode || "scaled", // 旧モードは廃止（互換用に保持しない）
  }));

  const { normalized, rawTotal } = normalizeWeights(
    mapped.map((i) => i.percent)
  );

  criteriaState.items = mapped;
  criteriaState.normalizedWeights = normalized;
  criteriaState.rawTotal = rawTotal;
  criteriaState.maxByIndex = mapped.map((item) => item.max);
  criteriaState.ready = true;
  if (typeof window !== "undefined") {
    window.enableScoreInputs?.();
  }
}

/**
 * 成績表ヘッダ描画（項目ごとラベル表示）
 */
export function renderTableHeader(headerRow, criteriaState) {
  const table = headerRow?.closest("table");
  if (table) {
    const oldColgroup = table.querySelector("colgroup");
    if (oldColgroup) oldColgroup.remove();

    const colgroup = document.createElement("colgroup");
    const fixedWidths = [120, 60, 90, 60, 140];
    fixedWidths.forEach((w) => {
      const col = document.createElement("col");
      col.style.width = `${w}px`;
      colgroup.appendChild(col);
    });

    (criteriaState.items || []).forEach(() => {
      const col = document.createElement("col");
      col.style.width = "90px";
      colgroup.appendChild(col);
    });

    const finalCol = document.createElement("col");
    finalCol.style.width = "80px";
    colgroup.appendChild(finalCol);

    table.prepend(colgroup);
  }

  headerRow.innerHTML = "";

  const ths = [];
  const addTh = (label) => {
    const th = document.createElement("th");
    th.textContent = label;
    ths.push(th);
  };

  addTh("学籍番号");
  addTh("学年");
  addTh("組・コース");
  addTh("番号");
  addTh("氏名");

  const items = criteriaState.items || [];

  if (!items.length) {
    addTh("評価項目");
  } else {
    items.forEach((critItem, idx) => {
      const th = document.createElement("th");

      // ラベル
      const label = document.createElement("div");
      label.textContent = `${critItem.name} (${critItem.percent}%)`;
      th.appendChild(label);

      ths.push(th);
    });
  }

  addTh("最終成績");
  ths.forEach((th) => headerRow.appendChild(th));

  // ▼ ミニタブイベント（raw/scaled 廃止に伴い無効化）
// headerRow.addEventListener("click", (e) => {
//   const btn = e.target;
//   if (!(btn instanceof HTMLButtonElement)) return;
//   if (!btn.classList.contains("crit-mode-btn")) return;
//
//   const tbody = document.getElementById("scoreTableBody");
//   if (tbody && tbody.querySelector("tr.locked-row")) {
//     console.warn("[crit-mode] blocked: locked rows visible");
//     return;
//   }
//
//   const idx = Number(btn.dataset.index);
//   const item = criteriaState.items[idx];
//   if (!item) return;
//
//   item.mode = btn.textContent === "素点" ? "raw" : "scaled";
//
//   btn.parentElement.querySelectorAll("button").forEach((b) =>
//     b.classList.toggle("active", b === btn)
//   );
//
//   import("./score_input_loader.js").then(({ recalcFinalScoresAfterRestore }) => {
//     recalcFinalScoresAfterRestore(tbody);
//   });
// });

}
/**
 * 評価基準が「単一・100%」かどうかを判定
 * - 評価項目が1つ
 * - 割合が100%
 *
 * この場合：
 *   自動換算（0〜100）でも結果が同じため、貼り付け確認モーダルは不要。
 *
 * @param {{ items:any[] }} criteriaState
 * @returns {boolean}
 */
export function isSingle100PercentCriteria(criteriaState) {
  if (!criteriaState || !Array.isArray(criteriaState.items)) return false;
  if (criteriaState.items.length !== 1) return false;

  const percent = Number(criteriaState.items[0]?.percent || 0);
  return percent === 100;
}
