// ================================
// 現在表示中の調整点を数値で取得
// ================================
const DEBUG = false; // set true for local debug

function getCurrentAdjustPointNumber() {
  const el = document.getElementById("adjustPointDisplay");
  if (!el) return null;
  const n = Number((el.textContent || "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : null;
}
// 科目メタ情報の単一状態
let currentSubjectMeta = {
  subjectId: null,
  isSkillLevel: false,
  usesAdjustPoint: false, // isSkillLevel と同義（将来拡張用）
  passRule: null,
  required: false,
  specialType: 0,
};
function getSubjectType(meta) {
  if (!meta) return "normal";

  if (meta.specialType === 1 || meta.specialType === 2) {
    return "special";
  }
  if (meta.required === false) {
    return "elective";
  }
  if (meta.isSkillLevel === true) {
    return "skill";
  }
  return "normal";
}
let avgUpdateRafId = null;
// markDirty: 保存可能フラグを立てるユーティリティ
function markDirty(reason = "score") {
  try {
    if (typeof setUnsavedChanges === "function") {
      setUnsavedChanges(true);
    } else {
      hasUnsavedChanges = true;
      if (saveBtn) saveBtn.disabled = false;
    }
  } catch (e) {
    // noop
  }
  if (DEBUG) console.log('[DIRTY]', reason);
}
// ================================
// 調整点表示を更新
// ================================
function updateAdjustPointDisplay() {
  const el = document.getElementById("adjustPointDisplay");
  if (!el) return;
  const passRule = currentSubjectMeta?.passRule ?? null;
  const required = currentSubjectMeta?.required === true;
  if (passRule !== "adjustment" && !required) {
    el.textContent = "調整点：—";
    return;
  }
  // 平均点表示から値を取得
  const avgEl = document.getElementById("avgPointDisplay");
  if (!avgEl) {
    el.textContent = "調整点：—";
    return;
  }
  const avgText = avgEl.textContent.replace(/[^\d.]/g, "");
  const avg = parseFloat(avgText);
  if (isNaN(avg)) {
    el.textContent = "調整点：—";
    return;
  }
  const adjust = Math.ceil(avg * 0.7);
  el.textContent = `調整点：${adjust}`;
}
// ================================
// 平均点表示をリアルタイム更新（未入力行除外・DOMのみ）
// ================================
export function updateAveragePointDisplay() {
  const el = document.getElementById("avgPointDisplay");
  if (!el) return;
  const finalScores = studentState.finalScores ?? new Map();
  let sum = 0, count = 0;
  finalScores.forEach((score) => {
    if (Number.isFinite(score)) {
      sum += score;
      count++;
    }
  });
  el.textContent = count === 0 ? "平均点：—" : `平均点：${(sum / count).toFixed(1)}`;
  updateAdjustPointDisplay();
}
// ================================
// 超過学生登録モーダルの最低限の表示/非表示フック
// ================================
document.addEventListener('DOMContentLoaded', () => {
  if (window.__excessModalInitialized) return;
  window.__excessModalInitialized = true;

  updateAdjustPointDisplay();
  const excessStudentRegisterBtn = document.getElementById('excessStudentRegisterBtn');
        if (excessStudentRegisterBtn) {
          excessStudentRegisterBtn.addEventListener('click', () => {
            const modal = document.getElementById('excessStudentModal');
            const listArea = modal?.querySelector('.excess-list-scroll');
            if (!modal || !listArea) return;

            const checkedIds = Array.from(
              listArea.querySelectorAll('.excess-student-checkbox:checked')
            )
              .map((cb) => cb.dataset.studentId)
              .filter((id) => Boolean(id));

            const invalid = checkedIds.some((sid) => {
              const input = listArea.querySelector(`.excess-hours-input[data-student-id='${sid}']`);
              return !input || !input.value || Number(input.value) <= 0;
            });
            if (invalid) {
              alert('超過時間数が未入力の学生がいます。すべて入力してください。');
              return;
            }

            const nextState = {};
            checkedIds.forEach((sid) => {
              const input = listArea.querySelector(`.excess-hours-input[data-student-id='${sid}']`);
              const hours = Number(input?.value);
              if (Number.isFinite(hours) && hours > 0) {
                nextState[sid] = { hours };
              }
            });

            excessStudentsState = nextState;
            excessDirty = true;
            try { markDirty("excessStudents"); } catch (e) { /* noop */ }
            try { applyRiskClassesToAllRows(); } catch (e) { /* noop */ }
            modal.classList.add('hidden');
          });
      }
    // 超過学生登録用 state (top-level `excessStudentsState` を使用)
  const excessStudentBtn = document.getElementById('excessStudentBtn');
  const excessStudentModal = document.getElementById('excessStudentModal');
  const excessStudentCancelBtn = document.getElementById('excessStudentCancelBtn');
  if (excessStudentBtn && excessStudentModal && excessStudentCancelBtn) {
    excessStudentBtn.addEventListener('click', () => {
      // 名簿表示処理は DOM ではなく state から取得（Reads 0 保障）
      const listArea = document.getElementById('excessStudentListArea');
      const sourceStudents =
        studentState?.currentStudents?.length ? studentState.currentStudents :
        studentState?.displayStudents?.length ? studentState.displayStudents :
        [];
      const studentsFromDom = sourceStudents.map((stu) => ({
        studentId: String(stu.studentId ?? ""),
        grade: String(stu.grade ?? ""),
        course: String(stu.courseClass ?? ""),
        number: String(stu.number ?? ""),
        name: String(stu.name ?? ""),
      }));
      // if (DEBUG) console.log("excess modal students:", studentsFromDom);
      if (listArea) {
        listArea.replaceChildren();
        excessDraftState = cloneExcessState(excessStudentsState || {});

        for (const stu of studentsFromDom) {
          const tr = document.createElement("tr");

          tr.innerHTML = `
            <td style="text-align:center;">
              <input type="checkbox"
                     class="excess-student-checkbox"
                     data-student-id="${stu.studentId || ""}">
            </td>
            <td>${stu.studentId || ""}</td>
            <td style="text-align:center;">${stu.grade || ""}</td>
            <td style="text-align:center;">${stu.course || ""}</td>
            <td style="text-align:center;">${stu.number || ""}</td>
            <td>${stu.name || ""}</td>
            <td style="text-align:right;">
              <input type="number"
                     class="excess-hours-input"
                     data-student-id="${stu.studentId || ""}"
                     min="1"
                     placeholder="時間">
            </td>
          `;

          listArea.appendChild(tr);

          const hoursTd = tr.querySelector('td:last-child');
          if (hoursTd) {
            hoursTd.style.width = '96px';
            hoursTd.style.minWidth = '96px';
            hoursTd.style.maxWidth = '96px';
          }
          const cb = tr.querySelector('.excess-student-checkbox');
          const hoursInput = tr.querySelector('.excess-hours-input');
          const draftEntry = excessDraftState?.[stu.studentId];

          if (draftEntry && cb) {
            cb.checked = true;
          }
          if (draftEntry && hoursInput && typeof draftEntry.hours === "number") {
            hoursInput.value = String(draftEntry.hours);
          }

          if (cb) {
            cb.addEventListener('change', () => {
              const sid = cb.dataset.studentId;
              if (!sid) return;
              if (!excessDraftState) {
                excessDraftState = {};
              }
              if (!cb.checked) {
                delete excessDraftState[sid];
                return;
              }
              const hours = Number(hoursInput?.value);
              if (Number.isFinite(hours) && hours > 0) {
                excessDraftState[sid] = { hours };
              }
            });
          }

          if (hoursInput) {
            hoursInput.style.width = '100%';
            hoursInput.style.boxSizing = 'border-box';
            hoursInput.style.textAlign = 'right';
            hoursInput.addEventListener('input', () => {
              const sid = hoursInput.dataset.studentId;
              if (!sid) return;
              if (!cb || !cb.checked) {
                if (excessDraftState) delete excessDraftState[sid];
                return;
              }
              const hours = Number(hoursInput.value);
              if (!excessDraftState) {
                excessDraftState = {};
              }
              if (Number.isFinite(hours) && hours > 0) {
                excessDraftState[sid] = { hours };
              } else {
                delete excessDraftState[sid];
              }
            });
          }
        }
      }
      excessStudentModal.classList.remove('hidden');
    });
    excessStudentCancelBtn.addEventListener('click', () => {
      excessStudentModal.classList.add('hidden');
    });
  }
});
import {
  createCriteriaState,
  loadCriteria,
  renderTableHeader,
} from "./score_input_criteria.js";

import {
  createStudentState,
  loadAllStudents,
  loadStudentsByIds,
  loadStudentsForGrade,
  loadSubjectRoster,
  filterAndSortStudentsForSubject,
  renderStudentRows,
  sortStudents,
  sortStudentsBySkillLevel
} from "./score_input_students.js";

import {
  createModeState,
  initModeTabs,
  updateFinalScoreForRow,
  updateAllFinalScores,
  computeRiskFlags,
} from "./score_input_modes.js";
import { fetchIsSkillLevelFromSubjects } from "./fetch_isSkillLevel.js";

import { applyPastedScores } from "./score_input_paste.js";
import { CURRENT_YEAR } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getFirestore,
  onSnapshot,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { activateQuotaErrorState } from "./quota_banner.js";

// ================================
// ★ 科目マスタ（subjects）を正本として取得
// ================================
async function loadSubjectMaster(subjectId) {
  if (!subjectId) return null;
  const ref = doc(db, "subjects", subjectId);
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
  if (!snap.exists()) return null;
  return snap.data();
}
// ================================
// 新規追加: 習熟度フィルタUI生成
// ================================
function renderSkillLevelFilter(subject) {
  const area = document.getElementById("groupFilterArea");
  if (!area) return;
  area.innerHTML = "";
  const filterDefs = [
    { key: "all", label: "全員" },
    { key: "S", label: "S" },
    { key: "A1", label: "A1" },
    { key: "A2", label: "A2" },
    { key: "A3", label: "A3" },
    { key: "unset", label: "未設定" }
  ];
  const container = document.createElement("div");
  container.className = "filter-button-group";
  // デフォルトフィルタ値（必要に応じて変更可）
  const defaultFilterKey = "all";
  let defaultBtn = null;
filterDefs.forEach(def => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = def.label;

  // ★共通フィルタと同じクラス運用に寄せる（見た目が安定する）
  btn.className = "filter-btn";
  btn.dataset.filterKey = def.key;

  if (def.key === defaultFilterKey) {
    btn.classList.add("active");
    defaultBtn = btn;
  }

  btn.addEventListener("click", () => {
    // ★active を1つだけにする（全ボタン青の根本原因）
    container.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    applySkillLevelFilter(subject, def.key);
  });

  container.appendChild(btn);
});

  area.appendChild(container);
  // 初回のみ明示的にフィルタ適用
  if (defaultBtn) {
    applySkillLevelFilter(subject, defaultFilterKey);
  }
}

// ================================
// 新規追加: 習熟度フィルタ適用
// ================================
function applySkillLevelFilter(subject, key) {
  const baseList = (studentState.baseStudents || studentState.currentStudents || []).slice();
  const levelsMap = studentState.skillLevelsMap || {};
  let filtered = baseList;
  if (key === "all") {
    // すべて
    filtered = baseList;
  } else if (["S","A1","A2","A3"].includes(key)) {
    filtered = baseList.filter(stu => (levelsMap[stu.studentId] || "") === key);
  } else if (key === "unset") {
    filtered = baseList.filter(stu => !levelsMap[stu.studentId] || levelsMap[stu.studentId] === "");
  }
  stashCurrentInputScores(tbody);
  isRenderingTable = true;
  try {
    renderStudentRows(
      tbody,
      subject,
      filtered,
      criteriaState.items,
      (tr) => {
        updateFinalScoreForRow(tr, criteriaState, modeState);
      },
      studentState
    );
  } finally {
    isRenderingTable = false;
  }
  restoreStashedScores(tbody);
  // 習熟度値の反映
  if (currentSubjectMeta.isSkillLevel && studentState.skillLevelsMap) {
    const inputs = tbody.querySelectorAll('input.skill-level-input');
    inputs.forEach(input => {
      const sid = input.dataset.studentId;
      input.value = studentState.skillLevelsMap[sid] || "";
    });
  }
  studentState.currentStudents = filtered.slice();
  updateStudentCountDisplay(filtered.length);
  // ===== FIX: 習熟度フィルタ後の表示再構築（DOMのみ / Firestore readなし）=====
    const hasNumberInputs =
    tbody && tbody.querySelector("input[type='number'][data-criteria-name]");

    if (hasNumberInputs) {
      recalcFinalScoresAfterRestore(tbody);
    } else {
      updateAveragePointDisplay();
    }
  // applyRiskClassesToAllRows(); // disabled: avoid immediate row-level excess/red highlighting
}
// ================================
// 新規追加: 習熟度データを取得
// ================================
async function ensureSkillLevelsLoaded(subject) {
  if (!subject || currentSubjectMeta.isSkillLevel !== true) return;
  const ref = doc(db, `skillLevels_${currentYear}`, subject.subjectId);
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
  if (snap.exists()) {
    const data = snap.data() || {};
    studentState.skillLevelsMap = data.levels || {};
  } else {
    studentState.skillLevelsMap = {};
  }
}

// ================================
// Firebase 初期化
// ================================
const firebaseConfig = {
  apiKey: "AIzaSyB-ykIzRvYbc5osV6WATu6BSOJt_zlHkgM",
  authDomain: "ktc-grade-system.firebaseapp.com",
  projectId: "ktc-grade-system",
  storageBucket: "ktc-grade-system.appspot.com",
  messagingSenderId: "490169300362",
  appId: "1:490169300362:web:7c6e7b47a394d68d514473",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);


// ================================
// DOM 参照
// ================================
const logoutBtn = document.getElementById("logoutBtn");
const subjectSelect = document.getElementById("subjectSelect");
const headerUserDisplay = document.getElementById("headerUserDisplay");
const infoMessageEl = document.getElementById("infoMessage");
const headerRow = document.getElementById("scoreHeaderRow");
const tbody = document.getElementById("scoreTableBody");
const saveBtn = document.getElementById("saveBtn");
const backHomeBtn = document.getElementById("backHomeBtn");
const toEvaluationLink = document.getElementById("toEvaluationLink");


// ================================
// URLパラメータから subjectId を取得
// ================================
const urlParams = new URLSearchParams(window.location.search);
let subjectIdFromURL = urlParams.get("subjectId") || null;


// ================================
// 状態オブジェクト
// ================================
const criteriaState = createCriteriaState();
const studentState = createStudentState();
const modeState = createModeState();
const scoreUpdatedAtBaseMap = new Map(); // key: studentId, value: Firestore Timestamp|null
let pasteInitialized = false;

const currentYear = CURRENT_YEAR;
let teacherSubjects = []; // 教員の担当科目リスト（teacherSubjects_YYYY の subjects 配列）
let currentUser = null;
let hasUnsavedChanges = false;
let unsavedListenerInitialized = false;
let beforeUnloadListenerInitialized = false;
let currentSubjectId = null;
const subjectCache = new Map();
const criteriaCache = new Map();
const scoresCache = new Map();
const skillCache = new Map();
const tempScoresMap = new Map();
let isRenderingTable = false;
let isProgrammaticInput = false;
// 超過学生 state（モーダルと保存連携で使用）
let excessStudentsState = {};
let excessDraftState = null;
let excessDirty = false;
// フラグ: 復元時に savedScores が適用されたかを示す
let didApplySavedScores = false;
let ignoreNextSnapshot = false;
let lastSavedByMeAt = 0;
let scoresSnapshotUnsubscribe = null;

function cloneExcessState(src) {
  const base = src && typeof src === "object" ? src : {};
  if (typeof structuredClone === "function") {
    try { return structuredClone(base); } catch (e) { /* noop */ }
  }
  try {
    return JSON.parse(JSON.stringify(base));
  } catch (e) {
    return {};
  }
}

function syncFinalScoreForRow(tr) {
  if (!tr) return;
  const sid = String(tr.dataset.studentId || "");
  if (!sid) return;
  const scoreInputs = Array.from(tr.querySelectorAll("input[type='number']"));
  const hasInputValue = scoreInputs.some((input) => {
    return (input.value || "").toString().trim() !== "";
  });
  if (!hasInputValue) {
    studentState.finalScores.delete(sid);
    return;
  }
  const finalCell = tr.querySelector(".final-score");
  const score = finalCell ? Number(finalCell.textContent.trim()) : NaN;
  if (Number.isFinite(score)) {
    studentState.finalScores.set(sid, score);
  } else {
    studentState.finalScores.delete(sid);
  }
}

function syncFinalScoresFromTbody(tbody) {
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll("tr"));
  rows.forEach(syncFinalScoreForRow);
}

function applyRiskClassesToCell(cellEl, flags) {
  if (!cellEl || !flags) return;
  // セル単位のマーカーのみを操作する。行レベルのクラス付与は
  // refreshRiskClassesForVisibleRows() に一任する（ここでは tr 操作をしない）。
  // cellEl.classList.toggle("cell-fail", !!flags.isFail);
  // cellEl.classList.toggle("cell-excess", !!flags.isExcess);
}

function buildRiskContext() {
  const useAdjustment = currentSubjectMeta?.usesAdjustPoint === true;
  const adjustPoint = getCurrentAdjustPointNumber();
  const subjectType = getSubjectType(currentSubjectMeta);
  return { useAdjustment, adjustPoint, subjectType };
}

// 1行分のリスククラスを即時反映（Firestore readなし）
function applyRiskClassForRow(tr) {
  try {
    if (!tr) return;

    if (currentSubjectMeta?.specialType === 1 || currentSubjectMeta?.specialType === 2) {
      tr.classList.remove("row-fail", "row-excess", "row-fail-excess", "red-failure-row");
      return;
    }

    const studentId = tr.dataset.studentId;
    if (!studentId) return;

    const finalCell = tr.querySelector('.final-score');
    const finalText = finalCell ? (finalCell.textContent || '').toString().trim() : "";
    const flags = computeRiskFlags(finalText, buildRiskContext());
    const isFail = !!flags.isFail;
    const isExcess = !!excessStudentsState?.[studentId];

    tr.classList.remove("row-fail", "row-excess", "row-fail-excess", "red-failure-row");

    if (isFail && isExcess) {
      tr.classList.add("row-fail-excess", "red-failure-row");
    } else if (isFail) {
      tr.classList.add("row-fail", "red-failure-row");
    } else if (isExcess) {
      tr.classList.add("row-excess");
    }
  } catch (e) {
    // noop
  }
}

function refreshRiskClassesForVisibleRows() {
  // 再描画時の行表示はここで一本化する
  const rows = tbody ? tbody.querySelectorAll("tr") : document.querySelectorAll("#scoreTableBody tr");
  rows.forEach(row => {
    applyRiskClassForRow(row);
  });
  }

// 一括適用ユーティリティ：最終成績を再計算してから行クラスを付与する
function applyRiskClassesToAllRows() {
  if (currentSubjectMeta?.specialType === 1 || currentSubjectMeta?.specialType === 2) {
    const rows = tbody?.querySelectorAll("tr") || [];
    rows.forEach((tr) => {
      tr.classList.remove("row-fail", "row-excess", "row-fail-excess", "red-failure-row");
    });
    return;
  }
  try {
    if (tbody) {
      try {
        updateAllFinalScores(tbody, criteriaState, modeState);
      } catch (e) { /* noop */ }
      try {
        syncFinalScoresFromTbody(tbody);
      } catch (e) { /* noop */ }
    }
  } catch (e) {
    // noop
  }
  try {
    refreshRiskClassesForVisibleRows();
  } catch (e) { /* noop */ }
}

// 最小修正ヘルパ: 復元後に最終成績と()表示のみを再計算する
// 注意: `syncFinalScoresFromTbody` や行ハイライト系は呼ばない
export function recalcFinalScoresAfterRestore(tbodyEl) {
  if (!tbodyEl) return;

  try {
    // ① DOM上の最終成績・( ) を再計算
    updateAllFinalScores(tbodyEl, criteriaState, modeState);
  } catch (e) {
    console.warn("[WARN] updateAllFinalScores failed", e);
  }

  try {
    // ② ★平均点計算用MapをDOMから同期（Firestore readなし）
    syncFinalScoresFromTbody(tbodyEl);
  } catch (e) {
    console.warn("[WARN] syncFinalScoresFromTbody failed", e);
  }

  try {
    // ③ 平均点・調整点を更新
    updateAveragePointDisplay();
  } catch (e) {
    console.warn("[WARN] updateAveragePointDisplay failed", e);
  }
}


// consume-and-clear 用ヘルパ（1回だけ消費する）
export function consumeDidApplySavedScores() {
  const v = !!didApplySavedScores;
  didApplySavedScores = false;
  return v;
}

// modeState の参照を返す（評価基準確定後の再計算用）
export function getModeState() {
  return modeState;
}

// ================================
// 共通：メッセージ表示ヘルパ
// ================================
function setInfoMessage(text) {
  if (!infoMessageEl) return;
  infoMessageEl.textContent = text || "";
}

function setUnsavedChanges(flag) {
  hasUnsavedChanges = !!flag;

  if (hasUnsavedChanges) {
    infoMessageEl?.classList.add("warning-message");
    setInfoMessage("未保存の変更があります。保存してください。");
  } else {
    infoMessageEl?.classList.remove("warning-message");
    // 既存フローでのメッセージ更新に任せる
  }

  if (saveBtn) {
    saveBtn.disabled = !hasUnsavedChanges;
  }
}

function buildScoresObjFromRow(tr, criteriaState) {
  const items = (criteriaState?.items) || [];
  const scores = {};
  const inputs = tr.querySelectorAll('input[type="number"]');

  inputs.forEach((input) => {
    const idx = Number(input.dataset.index || "0");
    const item = items[idx];
    const key = item?.name || input.dataset.itemName || `item_${idx}`;

    const raw = (input.value ?? "").toString().trim();
    if (raw === "") return;
    const num = Number(raw);
    if (!Number.isFinite(num)) return;

    scores[key] = num;
  });

  return scores;
}

function getSaveTargetRows(tbody) {
  if (!tbody) return [];
  const rows = Array.from(tbody.querySelectorAll("tr"));
  return rows.filter((tr) => Boolean(tr?.dataset?.studentId));
}

function hasInputErrors(tbody) {
  if (!tbody) return false;
  return tbody.querySelector(".ktc-input-error") != null;
}

function stashCurrentInputScores(tbodyEl) {
  if (!tbodyEl) return;
  const inputs = tbodyEl.querySelectorAll(
    "input[data-student-id][data-criteria-name]"
  );

  inputs.forEach((input) => {
    const sid = input.dataset.studentId;
    const crit = input.dataset.criteriaName;
    const val = input.value;

    if (!sid || !crit || val === "") return;

    if (!tempScoresMap.has(sid)) {
      tempScoresMap.set(sid, {});
    }
    tempScoresMap.get(sid)[crit] = Number(val);
  });
}

function restoreStashedScores(tbodyEl) {
  if (!tbodyEl) return;
  if (!tempScoresMap.size) return;

  const inputs = tbodyEl.querySelectorAll(
    "input[data-student-id][data-criteria-name]"
  );

  isProgrammaticInput = true;
  try {
  inputs.forEach((input) => {
    const sid = input.dataset.studentId;
    const crit = input.dataset.criteriaName;
    const score = tempScoresMap.get(sid)?.[crit];
    if (score == null) return;

    input.value = score;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  } finally {
    isProgrammaticInput = false;
  }
}

async function loadSavedScoresForSubject(year, subjectId) {
  if (!subjectId) return null;
  const ref = doc(db, `scores_${year}`, subjectId);
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
  if (!snap.exists()) return null;

  const data = snap.data() || {};
  // 既存呼び出しは students マップを期待しているが、保存時は excessStudents も保持するため
  // ここではオブジェクト全体を返す（呼び出し側で .students を参照する）
  return data;
}


function applySavedScoresToTable(savedStudentsMap, tbodyEl) {
  if (!savedStudentsMap || !tbodyEl) return;

  const inputs = tbodyEl.querySelectorAll(
    "input[data-student-id][data-criteria-name]"
  );

  isProgrammaticInput = true;
  try {
    inputs.forEach((input) => {
      if (input.classList.contains("skill-level-input")) return;

      const studentId = input.dataset.studentId;
      const criteriaName = input.dataset.criteriaName;

      const studentData = savedStudentsMap[studentId];
      if (!studentData || !studentData.scores) return;

      const value = studentData.scores[criteriaName];
      if (value === undefined || value === null) return;

      input.value = String(value);
    });
  } finally {
    isProgrammaticInput = false;
  }
}


// ================================
// 教員名を読み込む
// ================================
async function loadTeacherName(user) {
  const ref = doc(db, "teachers", user.email);
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
  if (snap.exists()) {
    return snap.data().name || "";
  }
  return user.email;
}


// ================================
// 教員の担当科目一覧をロード
// ================================
async function loadTeacherSubjects(user) {
  const subjectsRef = doc(db, `teacherSubjects_${currentYear}`, user.email);
  let snap;
  try {
    snap = await getDoc(subjectsRef);
  } catch (err) {
    if (err.code === "resource-exhausted" || String(err.message).includes("Quota exceeded")) {
      activateQuotaErrorState();
      throw err;
    } else {
      throw err;
    }
  }

  subjectSelect.innerHTML = "";
  teacherSubjects = [];

  if (!snap.exists()) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "担当科目が登録されていません";
    subjectSelect.appendChild(opt);
    subjectSelect.disabled = true;
    setInfoMessage("担当科目が登録されていません。まず科目登録を行ってください。");
    return [];
  }

  const data = snap.data() || {};
  const subjects = data.subjects || [];

  if (!subjects.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "担当科目が登録されていません";
    subjectSelect.appendChild(opt);
    subjectSelect.disabled = true;
    setInfoMessage("担当科目が登録されていません。まず科目登録を行ってください。");
    return [];
  }

  teacherSubjects = subjects;

  subjects.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.subjectId;
    // ラベル：例「4年 / CC / 前期 / 材料力学Ⅰ」
    opt.textContent = `${s.grade}年 / ${s.course} / ${s.semester} / ${s.name}`;
    subjectSelect.appendChild(opt);
  });

  subjectSelect.disabled = false;
  return subjects;
}


// ================================
// subjectId から科目オブジェクトを取得
// ================================
function findSubjectById(subjectId) {
  if (!subjectId) return null;
  return teacherSubjects.find((s) => s.subjectId === subjectId) || null;
}

// 新規追加: 選択科目の登録情報を取得
async function ensureElectiveRegistrationLoaded(subject) {
  if (!subject || !subject.subjectId) return;

  // "required: false" 以外なら何もしない
  if (subject.required !== false) return;

  const colName = `electiveRegistrations_${currentYear}`;
  const regRef = doc(db, colName, subject.subjectId);
  let snap;
  try {
    snap = await getDoc(regRef);
  } catch (err) {
    if (err.code === "resource-exhausted" || String(err.message).includes("Quota exceeded")) {
      activateQuotaErrorState();
      throw err;
    } else {
      throw err;
    }
  }

  if (snap.exists()) {
    const data = snap.data() || {};
    const students = Array.isArray(data.students) ? data.students : [];
    studentState.electiveStudents = students;
  } else {
    studentState.electiveStudents = [];
  }
}

// 新規追加: 選択科目受講者登録モーダル
async function openElectiveRegistrationModal(subject) {
  const modal = document.getElementById("electiveModal");
  const listEl = document.getElementById("elective-table-body");
  const cancelBtn = document.getElementById("electiveCancelBtn");
  const registerBtn = document.getElementById("electiveRegisterBtn");

  if (!modal || !listEl) return;

  // すでに登録済みならモーダルは出さない
  if (studentState.electiveStudents && studentState.electiveStudents.length > 0) {
    return;
  }


  // 学年一致の全学生表示
  const grade = String(subject.grade);
  const students = studentState.allStudents.filter(s => String(s.grade) === grade);
  // 並び順を成績入力画面と揃える
  const sortedStudents = sortStudents(students);

// ===== モーダル内フィルタ用：元データ保持 =====
const modalBaseStudents = sortedStudents.slice();

// ===== モーダル内：組フィルタ処理 =====

const filterButtons = modal.querySelectorAll(".eg-btn");

filterButtons.forEach(btn => {
  btn.onclick = () => {
    // active 切替
    filterButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    const key = btn.dataset.group;

    // 絞り込み
    const filtered =
      key === "all"
        ? modalBaseStudents
        : modalBaseStudents.filter(
            s => String(s.courseClass) === String(key)
          );

    // 再描画（今ある描画ロジックをそのまま使う）
    listEl.innerHTML = "";
    filtered.forEach(s => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input type="checkbox" data-studentid="${s.studentId}" /></td>
        <td>${s.studentId}</td>
        <td>${s.grade}</td>
        <td>${s.courseClass ?? ""}</td>
        <td>${s.number ?? ""}</td>
        <td>${s.name}</td>
      `;
      listEl.appendChild(tr);
    });
  };
});


  
  listEl.innerHTML = "";
  sortedStudents.forEach(s => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" data-studentid="${s.studentId}" /></td>
      <td>${s.studentId}</td>
      <td>${s.grade}</td>
      <td>${s.courseClass ?? ""}</td>
      <td>${s.number ?? ""}</td>
      <td>${s.name}</td>
    `;
    listEl.appendChild(tr);
  });

  modal.style.display = "flex";

  cancelBtn.onclick = () => {
    modal.style.display = "none";
  };

  registerBtn.onclick = async () => {
    const checked = Array.from(listEl.querySelectorAll("input[type='checkbox']:checked"))
      .map(cb => cb.dataset.studentid);

    if (checked.length === 0) {
      alert("少なくとも1名を選択してください。");
      return;
    }

    const selected = studentState.allStudents.filter(s => checked.includes(s.studentId));

    const colName = `electiveRegistrations_${currentYear}`;
    const regRef = doc(db, colName, subject.subjectId);

    await setDoc(regRef, {
      subjectId: subject.subjectId,
      students: selected,
      updatedAt: new Date(),
    });

    studentState.electiveStudents = selected;

    modal.style.display = "none";
    await handleSubjectChange(subject.subjectId);
  };
}

// ================================
// 受講者人数表示を更新
// ================================
function updateStudentCountDisplay(count) {
  const el = document.getElementById("studentCountDisplay");
  if (!el) return;

  if (count === 0) {
    el.textContent = "受講者人数：0名";
  } else {
    el.textContent = `受講者人数：${count}名`;
  }
}

// ================================
// スコア更新時刻（表示時点）を保持
// ================================
async function loadScoreUpdatedAtBase(subjectId, studentsList) {
  scoreUpdatedAtBaseMap.clear();
  if (!subjectId) return;

  const list = Array.isArray(studentsList) ? studentsList : [];
  const ref = doc(db, `scores_${currentYear}`, subjectId);
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
  const data = snap.exists() ? snap.data() || {} : {};
  const studentsMap = data.students || {};

  list.forEach((stu) => {
    const sid = String(stu.studentId ?? "");
    if (!sid) return;
    const row = studentsMap[sid] || {};
    scoreUpdatedAtBaseMap.set(sid, row.updatedAt ?? null);
  });
}

function cleanupScoresSnapshotListener() {
  if (scoresSnapshotUnsubscribe) {
    scoresSnapshotUnsubscribe();
    scoresSnapshotUnsubscribe = null;
  }
}

function setupScoresSnapshotListener(subjectId) {
  cleanupScoresSnapshotListener();
  if (!subjectId) return;
  const ref = doc(db, `scores_${currentYear}`, subjectId);
  let initialized = false;
  scoresSnapshotUnsubscribe = onSnapshot(ref, (snapshot) => {
    if (!snapshot || !snapshot.exists()) return;
    if (!initialized) {
      initialized = true;
      return;
    }
    if (ignoreNextSnapshot) {
      ignoreNextSnapshot = false;
      return;
    }
    const data = snapshot.data?.() || {};
    const currentUserEmail = currentUser?.email || "";
    if (data.updatedBy && data.updatedBy === currentUserEmail) {
      return;
    }
    if (Date.now() - lastSavedByMeAt < 3000) {
      return;
    }
    alert("他の教員がこのクラスの成績を更新しました。再読み込みしてください。");
  });
}

// ================================
// 科目選択時の処理
// ================================
async function handleSubjectChange(subjectId) {
  setUnsavedChanges(false);
  if (!subjectId) {
    cleanupScoresSnapshotListener();
    infoMessageEl?.classList.remove("warning-message");
    scoreUpdatedAtBaseMap.clear();
    setInfoMessage("科目が選択されていません。");
    headerRow.innerHTML = "";
    tbody.innerHTML = `
      <tr>
        <td class="no-data" colspan="6">科目が選択されていません。</td>
      </tr>
    `;
    currentSubjectId = null;
    currentSubjectMeta = {
      subjectId: null,
      isSkillLevel: false,
      usesAdjustPoint: false,
      passRule: null,
      required: false,
      specialType: 0,
    };
    return;
  }

  // ▼ 同一科目の再読込防止（Reads削減の核心）
  if (subjectId === currentSubjectId) {
    if (DEBUG) console.log("[SKIP] same subject, Firestore reload skipped");
    return;
  }
  currentSubjectId = subjectId;
  setupScoresSnapshotListener(subjectId);

  const subject = findSubjectById(subjectId);

  let subjectMaster;
  if (subjectCache.has(subjectId)) {
    subjectMaster = subjectCache.get(subjectId);
  } else {
    subjectMaster = await loadSubjectMaster(subjectId);
    subjectCache.set(subjectId, subjectMaster);
  }

  let isSkillLevel;
  if (skillCache.has(subjectId)) {
    isSkillLevel = skillCache.get(subjectId);
  } else {
    isSkillLevel = await fetchIsSkillLevelFromSubjects(subjectId);
    skillCache.set(subjectId, isSkillLevel);
  }

  const passRule = subjectMaster?.passRule ?? subject?.passRule ?? null;
  const required = subjectMaster?.required ?? subject?.required ?? false;
  const usesAdjustPoint = passRule === "adjustment" || required === true;
  const specialType = Number(subjectMaster?.specialType ?? subject?.specialType ?? 0);
  currentSubjectMeta = {
    subjectId,
    isSkillLevel,
    usesAdjustPoint,
    passRule,
    required,
    specialType,
  };

  if (DEBUG) console.log("[DEBUG subjectMaster]", subjectMaster);
  if (DEBUG) console.log("[DEBUG isSkillLevel]", currentSubjectMeta.isSkillLevel);
  if (DEBUG) console.log(
    "[DEBUG subject]",
    {
      subjectId: subject?.subjectId,
      name: subject?.name,
      isSkillLevel: currentSubjectMeta.isSkillLevel,
      required: subject?.required
    }
  );
  await ensureElectiveRegistrationLoaded(subject);
  if (currentSubjectMeta.isSkillLevel) {
    await ensureSkillLevelsLoaded(subject);
  }
  if (currentSubjectMeta.isSkillLevel) {
    if (DEBUG) console.log("[SKILL LEVEL MODE] enabled");
  } else {
    if (DEBUG) console.log("[SKILL LEVEL MODE] disabled");
  }
  if (subject && subject.required === false) { await openElectiveRegistrationModal(subject); }
  if (!subject) {
    infoMessageEl?.classList.remove("warning-message");
    scoreUpdatedAtBaseMap.clear();
    setInfoMessage("選択された科目情報が見つかりません。");
    headerRow.innerHTML = "";
    tbody.innerHTML = `
      <tr>
        <td class="no-data" colspan="6">科目情報が見つかりません。</td>
      </tr>
    `;
    currentSubjectId = null;
    cleanupScoresSnapshotListener();
    return;
  }

  currentSubjectId = subjectId;
  tempScoresMap.clear(); // 科目切替時のみキャッシュをリセット
  studentState.finalScores.clear();

  infoMessageEl?.classList.remove("warning-message");
  setInfoMessage("評価基準と名簿を読み込んでいます…");

  // 評価基準読み込み → ヘッダ生成（キャッシュ利用）
  if (criteriaCache.has(subjectId)) {
    Object.assign(criteriaState, structuredClone(criteriaCache.get(subjectId)));
  } else {
    await loadCriteria(db, currentYear, subjectId, criteriaState);
    criteriaCache.set(subjectId, structuredClone(criteriaState));
  }
  // 評価基準ロード直後に調整点表示を更新
  updateAdjustPointDisplay();
  renderTableHeader(headerRow, criteriaState);
  // isSkillLevel===true の場合のみ「習熟度」thを先頭に追加
  if (currentSubjectMeta.isSkillLevel) {
    const th = document.createElement("th");
    th.textContent = "習熟度";
    headerRow.insertBefore(th, headerRow.firstChild);
  }

  // 学生全件ロード（subjectRoster優先 → 学年キャッシュ）
  const rosterIds = await loadSubjectRoster(db, currentYear, subjectId);
  if (DEBUG) console.group(`📊 [READ CHECK] subject=${subjectId}`);
  if (DEBUG) console.log("📘 subjectRoster read = 1");
  if (DEBUG) console.log("👥 rosterIds length =", Array.isArray(rosterIds) ? rosterIds.length : 0);
 
  if (Array.isArray(rosterIds) && rosterIds.length > 0) {
    const rosterStudents = await loadStudentsByIds(db, rosterIds);
    if (DEBUG) console.log("🎓 students read by IDs =", rosterStudents.length);
    studentState.allStudents = rosterStudents;
  } else {
    alert("名簿データが未生成です。教務に連絡してください。");
    throw new Error("subjectRoster missing");
  }
if (DEBUG) console.groupEnd();
  // 科目に応じて学生フィルタ＆ソート
  const students = filterAndSortStudentsForSubject(subject, studentState);

  // ▼ 選択科目(required=false)の場合は、electiveStudents でさらに絞り込む
  let displayStudents = students;
  if (subject.required === false) {
    const list = studentState.electiveStudents || [];
    if (list.length > 0) {
      const allowedIds = new Set(list.map(s => s.studentId));
      displayStudents = students.filter(s => allowedIds.has(s.studentId));
    } else {
      displayStudents = []; // 登録が無い場合は0名
    }
  } else {
    displayStudents = students;
  }

// ★ STEP C フィルタ用：現在の表示学生を保持
studentState.baseStudents = displayStudents.slice();
studentState.currentStudents = displayStudents.slice();

  if (DEBUG) console.log('[DEBUG] subject:', subject);
  if (DEBUG) console.log('[DEBUG] displayStudents(before sort):', displayStudents);
  // 習熟度ソート（isSkillLevel===true時のみ）
  if (currentSubjectMeta.isSkillLevel) {
    displayStudents = sortStudentsBySkillLevel(displayStudents, studentState.skillLevelsMap);
    if (DEBUG) console.log('[DEBUG] displayStudents(after skill sort):', displayStudents);
  }
  await loadScoreUpdatedAtBase(subjectId, displayStudents);
  if (DEBUG) console.log('[DEBUG] renderStudentRows call:', { subject, displayStudents });
  // 学生行描画（入力時にその行の最終成績を計算）
  isRenderingTable = true;
  const handleScoreInputChange = (tr) => {
    if (!tr) return;
    updateFinalScoreForRow(tr, criteriaState, modeState);
    syncFinalScoreForRow(tr);
      const finalCell = tr.querySelector(".final-score");
      if (finalCell) {
        const flags = computeRiskFlags(finalCell.textContent, buildRiskContext());
        applyRiskClassesToCell(finalCell, flags);
      }
    applyRiskClassForRow(tr);
    if (avgUpdateRafId) cancelAnimationFrame(avgUpdateRafId);
    avgUpdateRafId = requestAnimationFrame(() => {
      updateAveragePointDisplay();
    });
  };
  try {
    renderStudentRows(
      tbody,
      subject,
      displayStudents,
      criteriaState.items,
      handleScoreInputChange,
      studentState
    );
  } finally {
    isRenderingTable = false;
  }
  restoreStashedScores(tbody);
  // --- ★ STEP D:保存済み scores を読み込み、途中再開用に反映 ---
    try {
      let savedData;
      if (scoresCache.has(subjectId)) {
        savedData = scoresCache.get(subjectId);
      } else {
        savedData = await loadSavedScoresForSubject(currentYear, subjectId);
        scoresCache.set(subjectId, savedData);
      }
      const savedScores = savedData?.students || null;
      
 // ===== 途中再開：savedScores を input に反映 → 表示を再構築（Firestore reads 追加なし） =====
if (savedScores) {
  console.log(savedScores);

  // 1) savedScores → input.value へ反映（イベントは発火しない）
  applySavedScoresToTable(savedScores, tbody);

  // 2) 通常科目のみ：数値評価の再計算
  if (!isSkillLevel) {
    const rows = tbody.querySelectorAll("tr");
    rows.forEach((tr, index) => {
      updateFinalScoreForRow(tr, criteriaState, modeState, null, index);
    });
  }
  updateAveragePointDisplay();
}

      // savedScores が存在したらフラグを立てる（後で復元時のみ再計算を行うため）
      didApplySavedScores = !!savedScores;
      if (savedScores) {
        tempScoresMap.clear();
        Object.entries(savedScores).forEach(([sid, data]) => {
          if (data?.scores) {
            tempScoresMap.set(sid, { ...data.scores });
          }
        });
      }

      // 保存済みの超過学生情報があれば state に復元（reads 追加なし）
      if (savedData?.excessStudents) {
        excessStudentsState = {};
        Object.entries(savedData.excessStudents).forEach(([sid, v]) => {
          if (v && typeof v.hours === 'number') {
            excessStudentsState[sid] = { hours: v.hours };
          }
        });
        excessDirty = false;
      } else {
        excessStudentsState = {};
        excessDirty = false;
      }
    setUnsavedChanges(false);
  } catch (e) {
    console.warn("[WARN] failed to restore saved scores", e);
  }


  if (!unsavedListenerInitialized && tbody) {
    tbody.addEventListener("input", (ev) => {
      if (isRenderingTable) return;
      if (isProgrammaticInput) return;
      const target = ev.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.classList.contains("skill-level-input")) return;
      if (!target.dataset.index) return;
      setUnsavedChanges(true);
      const tr = target.closest("tr");
      handleScoreInputChange(tr);
    });
    unsavedListenerInitialized = true;
  }
  // --- 新規追加: 習熟度値の反映 ---
  if (currentSubjectMeta.isSkillLevel && studentState.skillLevelsMap) {
    const inputs = tbody.querySelectorAll('input.skill-level-input');
    inputs.forEach(input => {
      const sid = input.dataset.studentId;
      input.value = studentState.skillLevelsMap[sid] || "";
    });
  }
  updateStudentCountDisplay(displayStudents.length);
  updateAveragePointDisplay();

  // ▼ 貼り付け処理の接続（初回だけ）
  if (!pasteInitialized) {
    tbody.addEventListener("paste", (ev) => {
      ev.preventDefault();
      const text = ev.clipboardData?.getData("text/plain") ?? "";
      if (!text) return;

      // skill-level-inputにフォーカス中なら縦貼り
      const active = document.activeElement;
      if (active && active.classList && active.classList.contains("skill-level-input")) {
        const lines = text.split(/\r?\n/);
        const allow = ["", "S", "A1", "A2", "A3"];
        // tbody内のすべてのskill-level-inputを配列で取得
        const inputs = Array.from(tbody.querySelectorAll(".skill-level-input"));
        // 現在のinputのindexを特定
        const startIdx = inputs.indexOf(active);
        let i = 0;
        for (; i < lines.length && (startIdx + i) < inputs.length; i++) {
          let v = lines[i].toUpperCase();
          if (!allow.includes(v)) v = "";
          inputs[startIdx + i].value = v;
          // inputイベントも発火させる（他ロジック連動用）
          const event = new Event("input", { bubbles: true });
          inputs[startIdx + i].dispatchEvent(event);
        }
        return;
      }

      // それ以外は既存の点数貼り付けロジック
      if (
        applyPastedScores(
          text,
          tbody,
          criteriaState,
          modeState,
          (msg) => window.alert(msg)
        )
      ) {
        setUnsavedChanges(true);
      }
    });
    pasteInitialized = true;
  }

  // 評価基準がない場合は注意メッセージ
  if (!criteriaState.items.length) {
    setInfoMessage(
      "この科目には評価基準が登録されていません。評価基準画面で登録してください。"
    );
    infoMessageEl?.classList.add("warning-message");
  } else {
    infoMessageEl?.classList.remove("warning-message");
    setInfoMessage("成績を入力してください。（モード：自動換算モードがデフォルトです）");
  }

  // 評価基準画面へのリンクを subjectId 付きに更新
  if (toEvaluationLink) {
    toEvaluationLink.href = `evaluation.html?subjectId=${encodeURIComponent(
      subjectId
    )}`;
  }

// STEP C：フィルタ UI を生成
if (currentSubjectMeta.isSkillLevel) {
  renderSkillLevelFilter(subject);
} else {
  renderGroupOrCourseFilter(subject);
}

  recalcFinalScoresAfterRestore(tbody);

  // ★途中再開直後・描画直後に一括適用（Firestore readなし）
  applyRiskClassesToAllRows();

  // （再計算は上で1回実行済みのため、ここでの再呼び出しは不要）


  // 保存ボタンの有効/無効は setUnsavedChanges() で一元管理する
}

// ================================
// スコア保存（楽観ロック付き・学生単位）
// ================================
export async function saveStudentScores(subjectId, studentId, scoresObj, teacherEmail) {
  if (!subjectId || !studentId) {
    throw new Error("subjectId と studentId は必須です");
  }

  const sid = String(studentId);
  const ref = doc(db, `scores_${currentYear}`, subjectId);
  const baseUpdatedAt = scoreUpdatedAtBaseMap.get(sid) ?? null;
  const email = teacherEmail || currentUser?.email || "";

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const latestData = snap.exists() ? snap.data() || {} : {};
    const latestUpdatedAt = latestData.students?.[sid]?.updatedAt ?? null;

    const baseMillis = typeof baseUpdatedAt?.toMillis === "function" ? baseUpdatedAt.toMillis() : null;
    const latestMillis = typeof latestUpdatedAt?.toMillis === "function" ? latestUpdatedAt.toMillis() : null;

    const conflict =
      (baseMillis === null && latestMillis !== null) ||
      (baseMillis !== null && latestMillis === null) ||
      (baseMillis !== null && latestMillis !== null && baseMillis !== latestMillis);

    if (conflict) {
      throw new Error("SCORE_CONFLICT");
    }

    tx.set(
      ref,
      {
        students: {
          [sid]: {
            scores: scoresObj || {},
            updatedAt: serverTimestamp(),
            updatedBy: email,
          },
        },
        // 保存時に超過学生情報を同時に書き込む
        excessStudents: excessStudentsState,
      },
      { merge: true }
    );
  });
  ignoreNextSnapshot = true;
  lastSavedByMeAt = Date.now();
  scoreUpdatedAtBaseMap.set(sid, "SAVED");
}

export async function saveBulkStudentScores(bulkScores) {
  const subjectId = currentSubjectId;
  if (!subjectId) {
    throw new Error("subjectId is required for bulk save");
  }
  if (!bulkScores || typeof bulkScores !== "object") {
    throw new Error("bulkScores is required");
  }

  const studentIds = Object.keys(bulkScores)
    .map((id) => String(id ?? "").trim())
    .filter((id) => id.length > 0);

  const ref = doc(db, `scores_${currentYear}`, subjectId);
  const email = currentUser?.email || "";

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const latestData = snap.exists() ? snap.data() || {} : {};
    const latestStudents = latestData.students || {};
    const payload = {};

    for (const studentId of studentIds) {
      const baseUpdatedAt = scoreUpdatedAtBaseMap.get(studentId) ?? null;
      const latestUpdatedAt = latestStudents[studentId]?.updatedAt ?? null;
      const baseMillis = typeof baseUpdatedAt?.toMillis === "function" ? baseUpdatedAt.toMillis() : null;
      const latestMillis = typeof latestUpdatedAt?.toMillis === "function" ? latestUpdatedAt.toMillis() : null;

      const conflict =
        (baseMillis === null && latestMillis !== null) ||
        (baseMillis !== null && latestMillis === null) ||
        (baseMillis !== null && latestMillis !== null && baseMillis !== latestMillis);

      if (conflict) {
        throw new Error("SCORE_CONFLICT");
      }

      payload[studentId] = {
        ...bulkScores[studentId],
        updatedAt: serverTimestamp(),
        updatedBy: email,
      };
    }

    const writeData = {
      updatedAt: serverTimestamp(),
    };

    if (studentIds.length > 0) {
      writeData.students = payload;
    }

    if (excessDirty) {
      writeData.excessStudents = excessStudentsState;
    }

    tx.set(ref, writeData, { merge: true });
  });
  ignoreNextSnapshot = true;
  lastSavedByMeAt = Date.now();

  studentIds.forEach((sid) => scoreUpdatedAtBaseMap.set(sid, "SAVED"));
  if (excessDirty) {
    excessDirty = false;
  }
}

export async function saveStudentScoresWithAlert(subjectId, studentId, scoresObj, teacherEmail) {
  try {
    await saveStudentScores(subjectId, studentId, scoresObj, teacherEmail);
    setUnsavedChanges(false);
    setInfoMessage("保存しました。");
    return true;
  } catch (err) {
    if (err?.code === "conflict" || err?.message === "SCORE_CONFLICT") {
      alert("他の教員がこの学生の成績を更新しました。再読み込みしてください。");
      await handleSubjectChange(subjectId);
      return false;
    }
    throw err;
  }
}

// ================================
// ★ STEP C：共通科目フィルタ UI 生成
// ================================
function renderGroupOrCourseFilter(subject) {
  const area = document.getElementById("groupFilterArea");
  if (!area) return;

  area.innerHTML = ""; // クリア

  const grade = String(subject.grade || "");
  const course = String(subject.course || "").toUpperCase();

  const isCommon = (!course || course === "G" || course === "COMMON");

  if (!isCommon) {
    // 共通科目でなければ非表示
    return;
  }

  let filters = [];

  if (grade === "1" || grade === "2") {
    // 1～2年は組フィルタ（1〜5組）
    filters = ["all", "1", "2", "3", "4", "5"];
  } else {
    // 3年以上はコースフィルタ（M/E/I/CA）
    filters = ["all", "M", "E", "I", "CA"];
  }

  const container = document.createElement("div");
  container.className = "filter-button-group";

  filters.forEach(key => {
    const btn = document.createElement("button");
    btn.className = "filter-btn";
    btn.dataset.filterKey = key;
    btn.textContent = (key === "all") ? "全員" : key;

    // 初期状態は「全員」をアクティブに
    if (key === "all") {
      btn.classList.add("active");
    }

    btn.addEventListener("click", () => {
      // いったん全ボタンの active を外す
      container.querySelectorAll(".filter-btn").forEach(b => {
        b.classList.remove("active");
      });
      // 自分だけ active
      btn.classList.add("active");

      // フィルタ適用
      applyGroupOrCourseFilter(subject, key);
    });

    container.appendChild(btn);
  });

  area.appendChild(container);
}

// ================================
// STEP C：フィルタ処理本体
// ================================
function applyGroupOrCourseFilter(subject, filterKey) {
  // baseList = 科目ごとの初期並び済リスト（共通科目なら全学生）
  const baseList = (studentState.baseStudents || studentState.currentStudents || []).slice();

  import("./score_input_students.js").then(({ filterStudentsByGroupOrCourse }) => {
    const filtered = filterStudentsByGroupOrCourse(subject, baseList, filterKey);

    // tbody 再描画
    stashCurrentInputScores(tbody);
    isRenderingTable = true;
    try {
      renderStudentRows(
        tbody,      
        subject,    
        filtered,   
        criteriaState.items,                 
        (tr) => updateFinalScoreForRow(tr, criteriaState, modeState),                        
        studentState
      );
    } finally {
      isRenderingTable = false;
    }
    restoreStashedScores(tbody);
    updateStudentCountDisplay(filtered.length);
    studentState.currentStudents = filtered.slice();

    // 再計算 + 行ハイライト適用
    applyRiskClassesToAllRows();
  });
}

// ================================
// 初期化
// ================================
export function initScoreInput() {
  // モードタブを生成（infoMessage の直下）
  initModeTabs({ infoMessageEl }, modeState);

  if (!beforeUnloadListenerInitialized) {
    window.addEventListener("beforeunload", (e) => {
      if (!hasUnsavedChanges) return;
      e.preventDefault();
      e.returnValue = "";
    });
    beforeUnloadListenerInitialized = true;
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      if (!currentSubjectId) {
        alert("科目を選択してください。");
        return;
      }

      if (hasInputErrors(tbody)) {
        showSaveErrorModal();
        return;
      }

      saveBtn.disabled = true;
      saveBtn.dataset.saving = "1";

      try {
        const rows = getSaveTargetRows(tbody);
        if (rows.length === 0) {
          alert("保存対象の学生がありません。");
          return;
        }

        const riskContext = buildRiskContext();
        const bulkScores = {};

        for (const tr of rows) {
          const studentId = String(tr.dataset.studentId || "");
          if (!studentId) continue;

          const scoresObj = buildScoresObjFromRow(tr, criteriaState);
          if (!scoresObj || Object.keys(scoresObj).length === 0) {
            continue;
          }

          const finalCell = tr.querySelector(".final-score");
          const finalText = finalCell?.textContent?.trim() ?? "";
          const finalNumeric = finalText === "" ? null : Number(finalText);
          const flags = computeRiskFlags(finalText, riskContext);
          bulkScores[studentId] = {
            scores: { ...scoresObj },
            finalScore: Number.isFinite(finalNumeric) ? finalNumeric : null,
            isRed: !!flags.isFail,
            isOver: !!flags.isExcess,
          };
        }

        const saveCount = Object.keys(bulkScores).length;
        if (saveCount === 0 && !excessDirty) {
          showSaveSuccessToast();
          setInfoMessage(`保存しました（0件）`);
          setUnsavedChanges(false);
          return;
        }

        try {
          await saveBulkStudentScores(bulkScores);
        } catch (err) {
          const isQuotaError =
            err?.code === "resource-exhausted" ||
            String(err?.message ?? "").includes("Quota exceeded");
          if (isQuotaError) {
            activateQuotaErrorState();
            return;
          }
          if (err?.code === "conflict" || err?.message === "SCORE_CONFLICT") {
            alert("他の教員がこの学生の成績を更新しました。再読み込みしてください。");
            await handleSubjectChange(currentSubjectId);
            return;
          }
          console.error("[save click]", err);
          return;
        }

        showSaveSuccessToast();
        scoresCache.delete(currentSubjectId);
        setInfoMessage(`保存しました（${saveCount}件）`);
        setUnsavedChanges(false);
      } catch (e) {
        console.error("[save click]", e);
        alert("保存中にエラーが発生しました。コンソールログを確認してください。");
      } finally {
        if (saveBtn) delete saveBtn.dataset.saving;
        if (saveBtn) saveBtn.disabled = !hasUnsavedChanges;
      }
    });
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }

    currentUser = user;

    // 教員名表示
    const teacherName = await loadTeacherName(user);
    if (headerUserDisplay) {
      headerUserDisplay.textContent = `ログイン中：${teacherName}`;
    }

    // 科目一覧ロード
    const subjects = await loadTeacherSubjects(user);

    // URLで科目指定があれば自動選択
    if (subjectIdFromURL && subjects.length) {
      const exists = subjects.some((s) => s.subjectId === subjectIdFromURL);
      if (exists) {
        subjectSelect.value = subjectIdFromURL;
        await handleSubjectChange(subjectIdFromURL);
      } else {
        subjectIdFromURL = null;
      }
    }

    // URL指定が無く、科目が1つ以上あれば先頭を自動選択
    if (!subjectIdFromURL && subjects.length) {
      const first = subjects[0];
      subjectSelect.value = first.subjectId;
      await handleSubjectChange(first.subjectId);
    }

    // 科目変更イベント
    subjectSelect.addEventListener("change", async () => {
      const selected = subjectSelect.value;
      await handleSubjectChange(selected);
    });
  });

  // ログアウト
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await signOut(auth);
      window.location.href = "index.html";
    });
  }

  // ホームへ戻る
  if (backHomeBtn) {
    backHomeBtn.addEventListener("click", () => {
      window.location.href = "start.html";
    });
  }
}

function showSaveErrorModal() {
  const modal = document.getElementById("saveErrorModal");
  const okBtn = document.getElementById("saveErrorOkBtn");
  if (!modal || !okBtn) return;

  modal.classList.remove("hidden");

  okBtn.onclick = () => {
    modal.classList.add("hidden");
  };
}

function showSaveSuccessToast() {
  const toast = document.getElementById("saveSuccessToast");
  if (!toast) return;

  toast.classList.remove("hidden");
  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => {
      toast.classList.add("hidden");
    }, 300);
  }, 1800);
}
