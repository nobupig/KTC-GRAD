// js/score_input_criteria.js
// STEP B-1：評価基準のロード＋ヘッダ生成モジュール

import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/**
 * 評価基準状態
 */
export function createCriteriaState() {
  return {
    items: [],
    normalizedWeights: [],
    rawTotal: 0,
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

  if (!subjectId) return;

  const colName = `evaluationCriteria_${year}`;
  const ref = doc(db, colName, subjectId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const data = snap.data() || {};
  const items = data.items || [];

  // --- adjustPoint, useAdjustPoint を state に格納 ---
  criteriaState.adjustPoint = (typeof data.adjustPoint === 'number' || data.adjustPoint === null) ? data.adjustPoint : null;
  criteriaState.useAdjustPoint = (typeof data.useAdjustPoint === 'boolean') ? data.useAdjustPoint : false;

  const mapped = items.map((it) => ({
    name: it.name || "",
    percent: Number(it.percent || 0),
    mode: it.mode || "scaled",
  }));

  const { normalized, rawTotal } = normalizeWeights(
    mapped.map((i) => i.percent)
  );

  criteriaState.items = mapped;
  criteriaState.normalizedWeights = normalized;
  criteriaState.rawTotal = rawTotal;
}

/**
 * 成績表ヘッダ描画＋項目ごとミニモードボタン
 */
export function renderTableHeader(headerRow, criteriaState) {
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

      const wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.gap = "4px";
      wrap.style.marginTop = "4px";

      const btnScaled = document.createElement("button");
      btnScaled.textContent = "自動換算";
      btnScaled.dataset.index = String(idx);
      btnScaled.className = "crit-mode-btn";
      if (critItem.mode === "scaled") btnScaled.classList.add("active");

      const btnRaw = document.createElement("button");
      btnRaw.textContent = "素点";
      btnRaw.dataset.index = String(idx);
      btnRaw.className = "crit-mode-btn";
      if (critItem.mode === "raw") btnRaw.classList.add("active");

      wrap.appendChild(btnScaled);
      wrap.appendChild(btnRaw);

      th.appendChild(wrap);
      ths.push(th);
    });
  }

  addTh("最終成績");
  ths.forEach((th) => headerRow.appendChild(th));

  // ▼ ミニタブイベント
  headerRow.addEventListener("click", (e) => {
    const btn = e.target;
    if (!(btn instanceof HTMLButtonElement)) return;
    if (!btn.classList.contains("crit-mode-btn")) return;

    const idx = Number(btn.dataset.index);
    const item = criteriaState.items[idx];
    if (!item) return;

    item.mode = btn.textContent === "素点" ? "raw" : "scaled";

    btn.parentElement.querySelectorAll("button").forEach((b) =>
      b.classList.toggle("active", b === btn)
    );

 // ▼▼▼ 【ここがSTEP3追加部分】 ▼▼▼
  const tbody = document.getElementById("scoreTableBody");
  const inputs = tbody.querySelectorAll(`input[data-index="${idx}"]`);

  inputs.forEach((input) => {
    const weight = Number(item.percent || 0);

    if (item.mode === "raw") {
      input.max = String(weight);
      input.placeholder = `0〜${weight}`;
    } else {
      input.max = "100";
      input.placeholder = "0〜100";
    }
  });
  // ▲▲▲ STEP3追加ここまで ▲▲▲

    import("./score_input_modes.js").then(
      ({ updateAllFinalScores }) => {
        const tbody = document.getElementById("scoreTableBody");
        updateAllFinalScores(tbody, criteriaState, { currentMode: "scaled" });
      }
    );
  });
}
