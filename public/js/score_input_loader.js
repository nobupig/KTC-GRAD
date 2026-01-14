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
  isCommon: false,
  isSkillLevel: false,
  usesAdjustPoint: false, // isSkillLevel と同義（将来拡張用）
  passRule: null,
  required: false,
  specialType: 0,
};

window.currentSubjectMeta = currentSubjectMeta;


// 選択科目モーダル用ソートモード
// "group" | "course" | null
let electiveModalSortMode = null;
let electiveModalSourceStudents = [];
let isSavedAfterLastEdit = false;
let lastAutoAppliedCommonFilterSubjectId = null;
// ===== 受講者登録ボタン：安全無効化制御 =====
const electiveAddBtn = document.getElementById("electiveAddBtn");
const electiveRemoveBtn = document.getElementById("electiveRemoveBtn");

function disableElectiveButtons() {
  [electiveAddBtn, electiveRemoveBtn].forEach((btn) => {
    if (!btn) return;
    btn.disabled = true;
    btn.style.pointerEvents = "none";
    btn.style.opacity = "0";
    btn.setAttribute("aria-hidden", "true");
  });
}

function enableElectiveButtons() {
  [electiveAddBtn, electiveRemoveBtn].forEach((btn) => {
    if (!btn) return;
    btn.disabled = false;
    btn.style.pointerEvents = "";
    btn.style.opacity = "";
    btn.removeAttribute("aria-hidden");
  });
}
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
// 簡易エラートースト表示（入力エラー用）
// ================================
// ================================
// ★ 点数入力の最大値を取得する唯一の関数（正本）
// ================================
function getMaxScoreForInput(target) {
  if (!target) return null;

  // ① criteriaState（最優先）
  const idx = Number(target.dataset.index);
  const item = criteriaState?.items?.[idx];
  if (item && Number.isFinite(item.max)) {
    return item.max;
  }

  // ② input の max 属性
  if (target.max && Number.isFinite(Number(target.max))) {
    return Number(target.max);
  }

  // ③ ヘッダ表示から取得（例: 期末考査(100%)）
  const th = target
    .closest("table")
    ?.querySelector(`th[data-index="${idx}"]`);

  if (th) {
    const m = th.textContent.match(/(\d+)\s*%|\((\d+)\)/);
    if (m) return Number(m[1] || m[2]);
  }

  return null; // 不明な場合
}

let __scoreInputErrorToastTimer = null;

function showScoreInputErrorToast(message) {
  let toast = document.getElementById("score-input-error-toast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "score-input-error-toast";
    toast.style.position = "fixed";
    toast.style.top = "20px";
    toast.style.left = "50%";
    toast.style.transform = "translateX(-50%)";
    toast.style.background = "#d32f2f";
    toast.style.color = "#fff";
    toast.style.padding = "10px 18px";
    toast.style.borderRadius = "6px";
    toast.style.boxShadow = "0 4px 10px rgba(0,0,0,0.2)";
    toast.style.fontSize = "14px";
    toast.style.zIndex = "9999";
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.25s ease";
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.style.opacity = "1";

  if (__scoreInputErrorToastTimer) {
    clearTimeout(__scoreInputErrorToastTimer);
  }

  __scoreInputErrorToastTimer = setTimeout(() => {
    toast.style.opacity = "0";
  }, 2500);
}
window.showScoreInputErrorToast = showScoreInputErrorToast;
// ================================
// ★ 評価基準 max 超過を検査して即クリア（入力/貼り付け共通）
// ================================
function enforceMaxForScoreInput(inputEl) {
  if (!(inputEl instanceof HTMLInputElement)) return { ok: true };
 
  // 点数欄だけ対象（data-index が無い個体が混ざるので救済する）
  if (inputEl.classList.contains("skill-level-input")) return { ok: true }; // 念のため

  const idx =
    Number.isFinite(Number(inputEl.dataset.index))
      ? Number(inputEl.dataset.index)
      : Number(inputEl.getAttribute("data-criteria-index"));

  if (!Number.isFinite(idx)) return { ok: true };

  const item = criteriaState?.items?.[idx];
  if (!item) return { ok: true };

  const maxVal = Number(item.max);
  if (!Number.isFinite(maxVal)) return { ok: true };

  const raw = (inputEl.value ?? "").toString().trim();
  if (raw === "") {
    inputEl.classList.remove("input-over-max");
    return { ok: true };
  }

  const val = Number(raw);
  if (!Number.isFinite(val)) return { ok: true };

  if (val > maxVal) {
    inputEl.value = "";
    inputEl.classList.add("input-over-max");
    return { ok: false, max: maxVal, idx };
  }

  inputEl.classList.remove("input-over-max");
  return { ok: true };
}

function enforceMaxForAllScoreInputs(tbodyEl) {
  const items = criteriaState?.items || [];
  if (!tbodyEl || !items.length) return { ok: true, cleared: 0 };

  const inputs = Array.from(
    tbodyEl.querySelectorAll("input[data-index]:not(.skill-level-input)")

  ).filter((el) => !el.classList.contains("skill-level-input"));

  let cleared = 0;
  let firstMax = null;

  for (const input of inputs) {
    const r = enforceMaxForScoreInput(input);
    if (!r.ok) {
      cleared++;
      if (firstMax == null) firstMax = r.max;
    }
  }

  if (cleared > 0) {
    showScoreInputErrorToast(
      `上限超過の入力が ${cleared} 件あったためクリアしました（上限例: ${firstMax} 点）`
    );
    return { ok: false, cleared };
  }

  return { ok: true, cleared: 0 };
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


import { fetchIsSkillLevelFromSubjects } from "./fetch_isSkillLevel.js";

import { applyPastedScores } from "./score_input_paste.js";
import { CURRENT_YEAR } from "./config.js";
import { initExcelDownloadFeature } from "./score_input_excel.js";
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
  updateDoc,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { deleteDoc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { activateQuotaErrorState } from "./quota_banner.js";
// ★ ここを必ず入れる
import {
  createStudentState,
  loadStudentsForGrade,
  canSubmitScoresByVisibleRows,
  loadSubjectRoster,
  filterAndSortStudentsForSubject,
  renderStudentRows,
  updateElectiveRegistrationButtons,
  sortStudentsBySkillLevel,
} from "./score_input_students.js";

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
}

// ================================
// 新規追加: 習熟度フィルタ適用
// ================================
function applySkillLevelFilter(subject, key) {
  const normalizedKey = String(key ?? "all").toLowerCase();
  const isSkill = !!window.currentSubjectMeta?.isSkillLevel;

  // ★ 表示状態の正本
  window.currentSkillFilter = normalizedKey;

  const baseList =
    (studentState.baseStudents || studentState.currentStudents || []).slice();
  const levelsMap = studentState.skillLevelsMap || {};
  let filtered = baseList;

  if (normalizedKey === "all") {
    filtered = baseList;
       } else if (["s", "a1", "a2", "a3"].includes(normalizedKey)) {
    filtered = baseList.filter(
      stu => (levelsMap[stu.studentId] || "").toLowerCase() === normalizedKey
    );
  } else if (normalizedKey === "unset") {
    filtered = baseList.filter(
      stu => !levelsMap[stu.studentId] || levelsMap[stu.studentId] === ""
    );
  }

  stashCurrentInputScores(tbody);
  isRenderingTable = true;
  try {
    renderStudentRows(
      tbody,
      subject,
      filtered,
      criteriaState.items,
      () => {
        recalcFinalScoresAfterRestore(tbody);
      },
      studentState,
      window.__latestScoresDocData?.completion
    );

    window.__currentFilterKey = normalizedKey;

    applySavedScoresToTable(
      window.__latestScoresDocData?.students || {},
      tbody
    );
  } finally {
    isRenderingTable = false;
  }

  restoreStashedScores(tbody);

  // 習熟度値の反映
  if (isSkill && studentState.skillLevelsMap) {
    tbody.querySelectorAll("input.skill-level-input").forEach(input => {
      const sid = input.dataset.studentId;
      input.value = studentState.skillLevelsMap[sid] || "";
    });
  }

  studentState.currentStudents = filtered.slice();
  updateStudentCountDisplay(filtered.length);

  const hasNumberInputs =
    tbody &&
    tbody.querySelectorAll(
      "input[data-index]:not(.skill-level-input)"
    ).length > 0;

  if (hasNumberInputs) {
    recalcFinalScoresAfterRestore(tbody);
  } else {
    updateAveragePointDisplay();
  }

  // ★ UI 状態の再評価は「ここで1回だけ」
  window.updateSubmitUI?.({
    subjectDocData: window.__latestScoresDocData
  });
  // ===============================
// ★ Step A：全員表示時のロック制御（最終位置）
// ===============================
if (normalizedKey === "all") {
  applyReadOnlyState("all");
} else {
  applyReadOnlyState(normalizedKey);
}

}



function syncSubmittedLockForSkillFilter(filterKey) {
  if (!window.currentSubjectMeta?.isSkillLevel) return;
  if (String(filterKey) === "all") return;
  const completion = window.__latestScoresDocData?.completion;
  const key = String(filterKey || "").toUpperCase();
  const isSkillUnit = ["S", "A1", "A2", "A3"].includes(key);
  const isSubmitted = isSkillUnit && completion?.completedUnits?.includes(key);

  if (isSubmitted) {
    showSubmittedLockNotice();
    lockScoreInputUI();
  } else {
    hideSubmittedLockNotice();
    unlockScoreInputUI();
  }
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
window.studentState = studentState;
studentState.lastElectiveGrade = null;
const scoreVersionBaseMap = new Map(); 
let pasteInitialized = false;

const currentYear = CURRENT_YEAR;
let teacherSubjects = []; // 教員の担当科目リスト（teacherSubjects_YYYY の subjects 配列）
let currentUser = null;
let hasUnsavedChanges = false;
let hasSavedSnapshot = false; // ★一時保存（Firestore保存）済みかどうか
let unsavedListenerInitialized = false;
let beforeUnloadListenerInitialized = false;
let currentSubjectId = null;
let electiveMode = null;           // "add" | "remove"
let enrolledStudentIds = [];       // Firestore の studentIds
let electiveRegistrations = null;  // electiveRegistrations_{year} ドキュメントのキャッシュ
const subjectCache = new Map();
const criteriaCache = new Map();
const scoresCache = new Map();
const skillCache = new Map();
const tempScoresMap = new Map();
let stashedUnsavedChanges = false;
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
   const scoreInputs = Array.from(
    tr.querySelectorAll('input[data-index]:not(.skill-level-input)')
  );
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
// ================================
// 赤点・超過判定（最終成績ベース）
// ================================
function computeRiskFlags(finalText, context) {
  const result = {
    isFail: false,
    isExcess: false,
  };

  // finalText が数値でない場合は何もしない
  const score = Number(finalText);
  if (!Number.isFinite(score)) {
    return result;
  }

  const { useAdjustment, adjustPoint, subjectType } = context || {};

  // 赤点判定
  // ・調整点科目：adjustPoint 未満
  // ・通常科目：60 未満
  if (useAdjustment && Number.isFinite(adjustPoint)) {
    result.isFail = score < adjustPoint;
  } else {
    result.isFail = score < 60;
  }

  // 超過判定は別ロジック（state 依存）
  // ※ 行単位では studentId で判定するため、ここでは false 固定
  result.isExcess = false;

  return result;
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

// ================================
// ★ 未入力行は「赤点のみ」判定しない
// ★ 超過はそのまま表示する
// ================================
if (!finalText) {
  tr.classList.remove(
    "row-fail",
    "row-fail-excess",
    "red-failure-row"
  );

  if (excessStudentsState?.[studentId]) {
    tr.classList.add("row-excess");
  } else {
    tr.classList.remove("row-excess");
  }
  return;
}

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
        recalcFinalScoresAfterRestore(tbody);
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

  // items と weights を確定（weights は 1(=100%) に正規化して扱う）
  const items = criteriaState?.items || [];
  const rawW = (criteriaState?.normalizedWeights || []).slice();
  const weights = [];

  if (items.length) {
    if (rawW.length === items.length) {
      // normalizedWeights が「合計1」or「合計100」どちらでも来ても吸収
      const sumW = rawW.reduce((a, b) => a + (Number(b) || 0), 0);
      const base = (sumW > 1.5) ? 100 : 1; // 100系なら100、1系なら1
      for (let i = 0; i < items.length; i++) weights[i] = (Number(rawW[i]) || 0) / base;
    } else {
      // weights 不在時：max 比率で代替（事故回避）
      const sumMax = items.reduce((a, it) => a + (Number(it?.max) || 0), 0);
      for (let i = 0; i < items.length; i++) {
        const m = Number(items[i]?.max) || 0;
        weights[i] = sumMax > 0 ? (m / sumMax) : 0;
      }
    }
  }

  const rows = tbodyEl.querySelectorAll("tr");

  rows.forEach((tr) => {
    const studentId = tr.dataset.studentId;
    if (!studentId) return;

    // specialType は対象外
    if (currentSubjectMeta?.specialType === 1 || currentSubjectMeta?.specialType === 2) return;

    if (!items.length) return;

    let sumWeighted = 0;
    let hasAnyInput = false;
    let allPerfect = true; // 99%対策（満点判定）

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      const max = Number(item?.max || 0);
      const w = Number(weights[idx] || 0);

      const input = tr.querySelector(`input[data-index="${idx}"][data-student-id="${studentId}"]`);
      if (!input) continue;

      const raw = (input.value ?? "").toString().trim();
      if (raw === "") {
        allPerfect = false;
        continue;
      }

      const val = Number(raw);
      if (!Number.isFinite(val)) {
        allPerfect = false;
        continue;
      }

      hasAnyInput = true;
      if (!(Number.isFinite(max) && max > 0 && val >= max)) allPerfect = false;

            // ★ 上限超過は「赤枠」＋「計算に含めない」
             if (Number.isFinite(max) && max > 0 && val > max) {
                input.classList.add("ktc-input-error");
                allPerfect = false;
                continue;
              } else {
                input.classList.remove("ktc-input-error");
              }

      // 比率計算： (val/max) * weight を合算 → 最終的に 0..100
      if (Number.isFinite(max) && max > 0 && w > 0) {
        sumWeighted += (val / max) * w;
      }

    }

    const finalCell = tr.querySelector(".final-score");

    // 未入力行
    if (!hasAnyInput || !finalCell) {
      if (finalCell) finalCell.textContent = "";
      try { studentState.finalScores.delete(studentId); } catch (e) {}
      return;
    }

    // 0..100 に換算
    let finalScoreFloat = sumWeighted * 100;

    // 99%対策：浮動小数の誤差で 99.xx → 99 に落ちる/満点が 99 になる事故を救済
    if (allPerfect) {
      finalScoreFloat = 100;
    } else if (finalScoreFloat >= 99.5) {
      finalScoreFloat = 100;
    }

    const finalScore = Math.round(finalScoreFloat);

    finalCell.textContent = String(finalScore);
    try { studentState.finalScores.set(studentId, finalScore); } catch (e) {}
  });

  // 平均点・調整点更新
  try { syncFinalScoresFromTbody(tbodyEl); } catch (e) {}
  try { updateAveragePointDisplay(); } catch (e) {}
}


// consume-and-clear 用ヘルパ（1回だけ消費する）
export function consumeDidApplySavedScores() {
  const v = !!didApplySavedScores;
  didApplySavedScores = false;
  return v;
}




function renderSpecialTableHeader(headerRow, meta) {
  if (!headerRow) return;
  headerRow.innerHTML = "";

  const base = ["学籍番号", "学年", "組・コース", "番号", "氏名"];
  base.forEach((t) => {
    const th = document.createElement("th");
    th.textContent = t;
    headerRow.appendChild(th);
  });

  const thSpecial = document.createElement("th");
  thSpecial.textContent = (meta?.specialType === 1) ? "合否" : "認定";
  headerRow.appendChild(thSpecial);

  const thFinal = document.createElement("th");
  thFinal.textContent = "最終成績";
  headerRow.appendChild(thFinal);
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
  // ★未保存の変更が入った瞬間に「保存済み」状態を解除する（提出事故防止）
   if (hasUnsavedChanges) {
     hasSavedSnapshot = false;
  }

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
  // ★提出ボタンUIも即時更新
 try {
     if (typeof window.updateSubmitUI === "function") {
       window.updateSubmitUI({
         subjectDocData: window.__latestScoresDocData || {},
         periodData: window.__latestPeriodData || {},
       });
     }
   } catch (e) {
     // noop
   }
}

function buildScoresObjFromRow(tr, criteriaState) {
  console.log("[BUILD DEBUG] criteriaState", criteriaState);
  console.log("[BUILD DEBUG] criteriaState items", criteriaState?.items);
  console.log("[BUILD DEBUG] criteriaState items length", criteriaState?.items?.length);
  const items = (criteriaState?.items) || [];
  // criteriaState.items may be empty while criteria data is still loading or before initialization finishes,
  // so zero length can occur during initial render/subject switch before criteriaState is hydrated.
  const scores = {};
  const inputs = Array.from(tr.querySelectorAll('input[type="number"], input[type="text"]'));
  const inputMap = new Map();

  inputs.forEach((input) => {
    const customKey = input.dataset.criteriaName || input.dataset.itemName;
    if (customKey) {
      inputMap.set(String(customKey), input);
    }
    const idx = Number(input.dataset.index);
    if (!Number.isNaN(idx)) {
      inputMap.set(`__idx_${idx}`, input);
    }
  });

  const resolveInputForItem = (item, index) => {
    const keyName = String(item?.name || `item_${index}`);
    return (
      inputMap.get(keyName) ||
      inputMap.get(`__idx_${index}`) ||
      (items.length === 1 ? inputs[0] : null)
    );
  };

  items.forEach((item, index) => {
    const input = resolveInputForItem(item, index);
    if (!input) return;
    const key = item?.name || input.dataset.itemName || `item_${index}`;
    const raw = (input.value ?? "").trim();
    if (raw === "") return;
    const num = Number(raw);
    if (!Number.isFinite(num)) return;
    scores[key] = num;
  });

  if (Object.keys(scores).length === 0) {
    console.log("[BUILD DEBUG] empty scoresObj", tr.dataset.studentId);
  }
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

  // ★ 未保存フラグも退避（これがないと「保存ボタンが死ぬ」）
  stashedUnsavedChanges = hasUnsavedChanges;

  // ★ 前回の退避が残ると混ざるので必ずクリア
  tempScoresMap.clear();

  // 点数入力：criteriaName をキーに全て退避（空欄も含める）
  const scoreInputs = tbodyEl.querySelectorAll("input[data-student-id][data-criteria-name]");
  scoreInputs.forEach((input) => {
    const sid = String(input.dataset.studentId || "");
    const crit = String(input.dataset.criteriaName || "");
    if (!sid || !crit) return;

    if (!tempScoresMap.has(sid)) tempScoresMap.set(sid, {});
    // ★ 空欄も保持（戻ったときの状態再現のため）
    tempScoresMap.get(sid)[crit] = (input.value ?? "").toString();
  });

  // 習熟度入力も退避（同じMap内に _skill で保存）
  const skillInputs = tbodyEl.querySelectorAll("input.skill-level-input[data-student-id]");
  skillInputs.forEach((input) => {
    const sid = String(input.dataset.studentId || "");
    if (!sid) return;
    if (!tempScoresMap.has(sid)) tempScoresMap.set(sid, {});
    tempScoresMap.get(sid).__skill = (input.value ?? "").toString();
  });
}

function restoreStashedScores(tbodyEl) {
  if (!tbodyEl) return;
  if (!tempScoresMap.size) return;

  isProgrammaticInput = true;
  try {
    // 点数入力の復元
    const scoreInputs = tbodyEl.querySelectorAll("input[data-student-id][data-criteria-name]");
    scoreInputs.forEach((input) => {
      const sid = String(input.dataset.studentId || "");
      const crit = String(input.dataset.criteriaName || "");
      if (!sid || !crit) return;
      const v = tempScoresMap.get(sid)?.[crit];
      if (v === undefined) return;
      input.value = String(v);
    });

    // 習熟度入力の復元
    const skillInputs = tbodyEl.querySelectorAll("input.skill-level-input[data-student-id]");
    skillInputs.forEach((input) => {
      const sid = String(input.dataset.studentId || "");
      const v = tempScoresMap.get(sid)?.__skill;
      if (v === undefined) return;
      input.value = String(v);
    });
  } finally {
    isProgrammaticInput = false;
  }

  // ★ 復元後にまとめて再計算（ここが初回入力の効き/赤点ハイライトの根本）
  try { recalcFinalScoresAfterRestore(tbodyEl); } catch (e) {}
  try { syncFinalScoresFromTbody(tbodyEl); } catch (e) {}
  try { refreshRiskClassesForVisibleRows(); } catch (e) {}
  try { updateAveragePointDisplay(); } catch (e) {}

  // ★ 保存ボタン状態を戻す（これがないと「保存が死ぬ」）
  setUnsavedChanges(!!stashedUnsavedChanges);
  if (stashedUnsavedChanges) isSavedAfterLastEdit = false;
   // ★ フィルタ／ソート後に状態を完全に復元する（重要）
  recalcFinalScoresAfterRestore(tbodyEl);
  syncFinalScoresFromTbody(tbodyEl);
  applyRiskClassesToAllRows();
  updateAveragePointDisplay();
  refreshSaveButtonState();
  // ★ フィルタ再描画後に未保存状態と保存ボタンを正しく戻す
  if (stashedUnsavedChanges) {
    setUnsavedChanges(true);
  }
  // specialType 以外は DOM から保存可否を再評価（既存方針に合わせる）
  if (!(currentSubjectMeta?.specialType === 1 || currentSubjectMeta?.specialType === 2)) {
    refreshSaveButtonState();
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
    'input[data-student-id][data-criteria-name]'
  );

  isProgrammaticInput = true;
  try {
    // ① 通常科目（数値 input）の復元
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

    // ② specialType=1：合／否 select の復元
    const passFailSelects = tbodyEl.querySelectorAll(
      'select.pass-fail-select[data-student-id]'
    );
    passFailSelects.forEach((sel) => {
      const studentId = sel.dataset.studentId;
      const studentData = savedStudentsMap[studentId];
      const v = studentData?.scores?.passFail;
      if (v === "pass" || v === "fail") {
        sel.value = v;
      } else {
        sel.value = "pass";
      }
    });

    // ③ specialType=2：認定 select の復元
    const certSelects = tbodyEl.querySelectorAll(
      'select.cert-select[data-student-id]'
    );
    certSelects.forEach((sel) => {
      const studentId = sel.dataset.studentId;
      const studentData = savedStudentsMap[studentId];
      const v = studentData?.scores?.cert;
      if (v === "cert1" || v === "cert2") {
        sel.value = v;
      } else {
        sel.value = "cert1";
      }
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

  // ★ 追加：同一科目なら Firestore を再読しない（reads削減）
  if (electiveRegistrations?.subjectId === subject.subjectId) {
    return;
  }

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
    studentState.electiveStudents = students.slice();

    // ★ subjectId を必ずキャッシュに保持
    electiveRegistrations = { ...data, subjectId: subject.subjectId };

  } else {
    studentState.electiveStudents = [];
    electiveRegistrations = { subjectId: subject.subjectId, students: [] };
  }
}


function showElectivePostRegisterModal() {
  const modal = document.getElementById("electivePostRegisterModal");
  if (!modal) return;
  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");
}

function hideElectivePostRegisterModal() {
  const modal = document.getElementById("electivePostRegisterModal");
  if (!modal) return;
  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");
}

// ★初回登録も add/remove と同じモーダル・同じ登録処理(confirmElectiveChange)に統一する
async function openElectiveRegistrationModal(subject) {
  const modal = document.getElementById("electiveModal");
  if (!modal) return;

  // Reads 0 固定：モーダルは allStudents（学年名簿）だけを参照する
  if (!Array.isArray(studentState.allStudents) || studentState.allStudents.length === 0) {
    console.warn("[elective modal] allStudents is empty (Reads0 policy).");
    return;
  }

  // すでに登録済みならモーダルは出さない（正本＝electiveRegistrations を優先）
  const hasRegistered =
    (Array.isArray(electiveRegistrations?.students) && electiveRegistrations.students.length > 0) ||
    (Array.isArray(studentState.electiveStudents) && studentState.electiveStudents.length > 0);

  if (hasRegistered) return;

  // 初回登録モード
  electiveMode = "initial";

  // 念のため currentSubjectId/currentSubject を揃える
  if (subject?.subjectId) currentSubjectId = subject.subjectId;
  window.currentSubject = subject || window.currentSubject;

  // add/remove と同じ表示ロジックを使う（ソートボタン表示条件も統一される）
  openElectiveModal();
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
async function loadScoreVersionBase(subjectId, studentsList) {
  scoreVersionBaseMap.clear();
  if (!subjectId) return;

  const list = Array.isArray(studentsList) ? studentsList : [];
  const ref = doc(db, `scores_${currentYear}`, subjectId);

  let snap;
  try {
    snap = await getDoc(ref);
  } catch (err) {
    if (err.code === "resource-exhausted" || String(err.message).includes("Quota exceeded")) {
      activateQuotaErrorState();
    }
    throw err;
  }

  const data = snap.exists() ? snap.data() || {} : {};
  const studentsMap = data.students || {};

  list.forEach((stu) => {
    const sid = String(stu.studentId ?? "");
    if (!sid) return;
    const row = studentsMap[sid] || {};
    // version が無い既存データは 0 扱い
    scoreVersionBaseMap.set(sid, Number.isFinite(row.version) ? row.version : 0);
  });
}


function cleanupScoresSnapshotListener() {
  if (scoresSnapshotUnsubscribe) {
    scoresSnapshotUnsubscribe();
    scoresSnapshotUnsubscribe = null;
  }
}


// ================================
// 提出済みユニット判定（CA互換対応）
// ================================
function hasSubmittedUnit(unitsMap, unitKey) {
  if (!unitsMap || !unitKey) return false;
  const k = String(unitKey);

  // 表示側が CA のとき、保存側が C/A/CA のどれでも拾う（過去データ救済）
  if (k === "CA") {
    return (
      Object.prototype.hasOwnProperty.call(unitsMap, "CA") ||
      Object.prototype.hasOwnProperty.call(unitsMap, "C") ||
      Object.prototype.hasOwnProperty.call(unitsMap, "A")
    );
  }

  // 保存側が CA のとき、表示側が C/A でも拾う（逆方向救済）
  if (k === "C" || k === "A") {
    return (
      Object.prototype.hasOwnProperty.call(unitsMap, k) ||
      Object.prototype.hasOwnProperty.call(unitsMap, "CA")
    );
  }

  return Object.prototype.hasOwnProperty.call(unitsMap, k);
}

function isCompletionOnlySubmission(subjectMeta, subjectDocData) {
  return (
    subjectMeta?.specialType === 1 &&
    subjectDocData?.completion?.isCompleted === true
  );
}


// ============================================
// 提出UI更新（提出済み表示 / 再提出表示 / 期間外ロック）
// ============================================
window.updateSubmitUI = function ({ subjectDocData, periodData } = {}) {
  try {
    const btn = document.getElementById("submitScoresBtn");
    if (!btn) return;

    const data = subjectDocData || {};
    const submitted = data.submittedSnapshot || null;

    // ---- 期間チェック（settings/period の持ち方が揺れても落ちないようにする）
    const now = Date.now();
    const toMillis = (v) => {
      if (!v) return null;
      // Firestore Timestamp 対応
      if (typeof v.toMillis === "function") return v.toMillis();
      // 文字列/数値も一応
      const n = (typeof v === "number") ? v : Date.parse(v);
      return Number.isFinite(n) ? n : null;
    };

    const p = periodData || {};
    const submitStart =
      toMillis(p.submitStart) ?? toMillis(p.submitStartAt) ?? toMillis(p.submit_from) ?? null;
    const submitEnd =
      toMillis(p.submitEnd) ?? toMillis(p.submitEndAt) ?? toMillis(p.submit_to) ?? null;

    const inSubmitPeriod =
      (submitStart == null || now >= submitStart) &&
      (submitEnd == null || now <= submitEnd);

    // ---- ステータス表示用の小さなラベル（無ければ作る）
    let badge = document.getElementById("submitStatusBadge");
    if (!badge) {
      badge = document.createElement("span");
      badge.id = "submitStatusBadge";
      badge.style.marginLeft = "10px";
      badge.style.fontSize = "12px";
      badge.style.opacity = "0.9";
      btn.insertAdjacentElement("afterend", badge);
    }

  // ---- 提出済み判定（unitKey 単位）
   // フィルタ（全員/1〜5/M/E/I/CA）で「現在表示している unitKey」を特定し、
    // submittedSnapshot.units にその unitKey があれば提出済みと判定する。
    const unitsMap = (submitted && submitted.units) ? submitted.units : {};
    const activeFilterBtn = document.querySelector("#groupFilterArea .filter-btn.active");
    const currentUnitKey =
     activeFilterBtn?.dataset?.filterKey ??
      window.__lastAppliedUnitKey ??
      "all";

    const completionOnly = isCompletionOnlySubmission(window.currentSubjectMeta, data);
    const isSubmitted = completionOnly
      ? true
      : (currentUnitKey !== "all") &&
        hasSubmittedUnit(unitsMap, String(currentUnitKey));

    // ---- UI反映
    if (!inSubmitPeriod) {
      // 期間外：完全ロック
      btn.disabled = true;
      btn.textContent = isSubmitted ? "提出済み（期間外）" : "提出（期間外）";
      badge.textContent = "提出期間外です";
      badge.style.color = "#666";
      return;
    }

    // 期間内でも、提出済み unit はこの画面では常にロック（再提出はトップ画面のみ）
    if (isSubmitted) {
      btn.disabled = true;
      btn.textContent = "提出済み";
      badge.textContent = "提出済みです（再提出はトップ画面から行ってください）";
      badge.style.color = "#666";
      return;
    }

const rowCheck = canSubmitScoresByVisibleRows();
const okByRows = !!rowCheck.ok;
    const okBySave = !!hasSavedSnapshot;     // ★保存済みであること
    const okByDirty = !hasUnsavedChanges;    // ★未保存変更が無いこと

// ★提出可能条件（最終基準）
// 「最後の修正以降に一時保存されている」ことが必須
if (!isSavedAfterLastEdit) {
  btn.disabled = true;

  // ✅ 提出済みだが、まだ一切修正していない（＝未保存変更ではない）
  if (isSubmitted && !hasUnsavedChanges) {
    btn.textContent = "再提出する";
    badge.textContent = "提出済みです。修正→一時保存すると再提出できます。";
    badge.style.color = "#666";
    return;
  }

  // ✅ 通常の未保存変更
  btn.textContent = "保存してから提出";
  badge.textContent = "未保存の変更があります";
  badge.style.color = "#c00";
  return;
}
    // ★ 行条件NG（未入力など）はここで止める（文言も出す）
if (!okByRows) {
  btn.disabled = true;
  btn.textContent = isSubmitted ? "提出済み" : "教務へ送信";
  badge.textContent = rowCheck.reason || "未入力があります。全員分入力してください。";
  badge.style.color = "#c00";
  return;
}

// ここまで来たら「保存済み」「未保存変更なし」「行条件OK」
// → 提出ボタンを有効化
btn.disabled = false;

if (isSubmitted) {
    btn.disabled = true;
  btn.textContent = "提出済み";
  badge.textContent = "提出済みです（再提出はトップ画面から行ってください）";
  badge.style.color = "#666";
} else {
  btn.textContent = "教務へ送信";
  badge.textContent = "";
}
  } catch (e) {
    console.warn("[updateSubmitUI]", e);
  }
};



function setupScoresSnapshotListener(subjectId) {
  cleanupScoresSnapshotListener();
  if (!subjectId) return;
  const ref = doc(db, `scores_${currentYear}`, subjectId);
  let initialized = false;
  scoresSnapshotUnsubscribe = onSnapshot(ref, (snapshot) => {
    console.log("[scores snapshot fired]", subjectId);

  // ★★★ ここ（最重要）★★★
  console.log(
    "[SNAPSHOT FIRED]",
    "exists=", snapshot?.exists?.(),
    "hasPendingWrites=", snapshot?.metadata?.hasPendingWrites
  );

        if (!snapshot || !snapshot.exists()) return;
        const data = snapshot.data?.() || {};
   // ★ 送信用に students.js に渡す（グローバル登録）
   const subjectDocData = window.__latestScoresDocData || {};
window.__latestScoresDocData = data;

// ===== 送信後UIロック／再提出判定 =====
(async () => {
  try {
    const periodRef = doc(db, "settings", "period");
    const periodSnap = await getDoc(periodRef);
    if (!periodSnap.exists()) return;

    const periodData = periodSnap.data();
    window.__latestPeriodData = periodData; // ★提出UI再計算用に保持

  if (typeof window.updateSubmitUI === "function") {
  window.updateSubmitUI({
    subjectDocData: data,
    periodData
  });
} else {
  console.warn("[updateSubmitUI missing] window.updateSubmitUI is not a function");
}
  } catch (e) {
    console.warn("[updateSubmitUI skipped]", e);
  }
})();

if (!initialized) {
      initialized = true;
      return;
    }
    if (ignoreNextSnapshot) {
      ignoreNextSnapshot = false;
      return;
    }
    
    const currentUserEmail = currentUser?.email || "";
  const updatedBy =
  data.updatedBy ||
  Object.values(data.students || {})
    .map(s => s?.updatedBy)
    .find(Boolean);

if (updatedBy === currentUserEmail) return;
    if (Date.now() - lastSavedByMeAt < 3000) {
      return;
    }
    const ok = !hasUnsavedChanges
  ? true
  : confirm("他の教員がこのクラスの成績を更新しました。\n未保存の入力がありますが、最新を再読み込みしますか？");

if (ok) {
  // 同一科目スキップを確実に避ける
  currentSubjectId = null;
  handleSubjectChange(subjectId);
} else {
  // 保存しない場合でも、誤保存防止のため警告は残す
  setInfoMessage("他の教員が更新しました。保存前に再読み込みしてください。");
  infoMessageEl?.classList.add("warning-message");
}

  });
}

// ================================
// 科目選択時の処理
// ================================
async function handleSubjectChange(subjectId) {
    // ★ 科目切替時：提出済み文言は必ず最初に消す（唯一の消去ポイント）
   hideSubmittedLockNotice();

  // ★ 追加：習熟度の注意文言は科目切替の最初に必ず消す（残留防止の唯一の消去ポイント）
  hideAllReadOnlyNotice();

  lastAutoAppliedCommonFilterSubjectId = null;

  setUnsavedChanges(false);
    // ★重要：前科目の scoresDoc（completion 等）が残留すると、別科目が提出済みロックになる
  // 例：国語で completedUnits=["4","5"] が残ったまま数学を開くと 4組・5組が誤ロックされる
  window.__latestScoresDocData = null;

  
  hasSavedSnapshot = false; // ★科目切替直後はいったん未保存扱い（復元でtrueにする）
 
  const subject = findSubjectById(subjectId);
  try { window.currentSubject = subject; } catch (e) { /* noop */ }

  if (!subjectId) {
    cleanupScoresSnapshotListener();
    infoMessageEl?.classList.remove("warning-message");
    scoreVersionBaseMap.clear();
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
      isCommon: false,
      isSkillLevel: false,
      usesAdjustPoint: false,
      passRule: null,
      required: false,
      specialType: 0,
    };

    // ★ 重要：window 側も必ず最新参照に更新
    window.currentSubjectMeta = currentSubjectMeta;
    // ★ 任意①：dataset にも反映（mode 側の最優先参照）
try {
  document.body.dataset.subjectType = "unknown";
} catch (e) {}
    window.__currentSubjectMeta = currentSubjectMeta;

    return;

  }

  // ★ 習熟度科目：同一科目でも初回は必ず全員ロックを適用
if (
  subjectId === currentSubjectId &&
  window.currentSubjectMeta?.isSkillLevel &&
  window.currentSkillFilter == null
) {
  applySkillLevelFilter(window.currentSubject, "all");
}

  // ▼ 同一科目の再読込防止（Reads削減の核心）
  if (subjectId === currentSubjectId) {
  if (DEBUG) console.log("[SKIP] same subjectId, reload skipped");
  return;
}
  currentSubjectId = subjectId;
  setupScoresSnapshotListener(subjectId);
  const grade = String(subject?.grade ?? "");
  console.log("[GRADE CACHE] grade=", grade,
    "hasCache=", studentState.gradeStudentsCache?.has?.(grade),
    "cacheSize=", studentState.gradeStudentsCache?.size);

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

// ★ 共通判定は「ここで1回だけ」
const isCommon = String(subjectId).includes("_G_");
// ★【ここが不足していた】科目メタをここで確定させる
currentSubjectMeta = {
  subjectId,
  isCommon,
  isSkillLevel,
  usesAdjustPoint,
  passRule,
  required,
  specialType,
};

// ★ mode / 赤点 / 貼り付けの正本をここで同期
window.currentSubjectMeta = currentSubjectMeta;
window.__currentSubjectMeta = currentSubjectMeta;

// ★ 任意①：dataset にも反映（最優先参照）
try {
  document.body.dataset.subjectType = getSubjectType(currentSubjectMeta);
} catch (e) {}


 // renderStudentRows 側が参照できるように subject にも載せる
  subject.specialType = specialType;
  subject.isSkillLevel = isSkillLevel;


  if (subject?.required === false) {
    await ensureElectiveRegistrationLoaded(subject);
  }

  if (currentSubjectMeta.isSkillLevel) {
    await ensureSkillLevelsLoaded(subject);
  }
  if (currentSubjectMeta.isSkillLevel) {
    if (DEBUG) console.log("[SKILL LEVEL MODE] enabled");
  } else {
    if (DEBUG) console.log("[SKILL LEVEL MODE] disabled");
    window.currentSkillFilter = null; // ★通常科目では習熟度フィルタを必ずリセット
  }
  // NOTE: call moved below to ensure students (sourceStudents) are determined first
  if (!subject) {
    infoMessageEl?.classList.remove("warning-message");
    scoreVersionBaseMap.clear();
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
  // ===== 科目切替：UI完全初期化（DOMのみ / Firestore reads 0）=====
// ===== 科目切替時：UIを必ず完全初期化（DOMのみ）=====
headerRow.innerHTML = "";
tbody.innerHTML = "";

const filterArea = document.getElementById("groupFilterArea");
if (filterArea) filterArea.innerHTML = "";

// ===== specialType 判定 =====
const isSpecial =
  currentSubjectMeta.specialType === 1 ||
  currentSubjectMeta.specialType === 2;

if (isSpecial) {
  console.log(
    "[INFO] specialType subject -> skip criteria flow:",
    currentSubjectMeta.specialType
  );

  // 評価基準は使わない
  criteriaState.items = [];

  // ★ここが一番重要（これが無かった）
  renderSpecialTableHeader(headerRow, currentSubjectMeta);

  
  // ★ 追加①：評価基準UIを完全に隠す
  document
    .querySelectorAll(".evaluation-related")
    .forEach(el => el.style.display = "none");
  updateAdjustPointDisplay();

} else {
  // ★ 将来事故防止：通常科目では評価基準UIを必ず復帰
document
  .querySelectorAll(".evaluation-related")
  .forEach(el => el.style.display = "");

  // ===== 通常科目 =====
  if (criteriaCache.has(subjectId)) {
    Object.assign(criteriaState, structuredClone(criteriaCache.get(subjectId)));
  } else {
    await loadCriteria(db, currentYear, subjectId, criteriaState);
    criteriaCache.set(subjectId, structuredClone(criteriaState));
  }
// ★ 通常科目の評価基準ヘッダー描画（これが無いとヘッダーが出ない）
  renderTableHeader(headerRow, criteriaState, subject);
  updateAdjustPointDisplay();
  

  if (currentSubjectMeta.isSkillLevel) {
    const th = document.createElement("th");
    th.textContent = "習熟度";
    headerRow.insertBefore(th, headerRow.firstChild);
  }

 
}


 
  // 学年名簿は「学年キャッシュ」からのみ供給する（subjectRosterは混ぜない）
  const targetGrade = String(subject?.grade ?? "");

  // === ① 学年名簿（正本）を確保：gradeStudentsCache → なければ Firestore（学年クエリ） ===
  try {
    const cachedGradeStudents = studentState.gradeStudentsCache?.get(targetGrade);

    if (Array.isArray(cachedGradeStudents) && cachedGradeStudents.length > 0) {
      if (DEBUG) console.log("[CACHE HIT] gradeStudentsCache for grade=", targetGrade);

      // 参照汚染防止：必ずコピーで持つ
      studentState.allStudents = cachedGradeStudents.slice();
      
    } else {
      console.log("[GRADE CACHE] FETCH students for grade=", targetGrade);

      // ★ 学年名簿は「学年で取得」する（subjectRosterで代用しない）
      // loadStudentsForGrade は studentState.allStudents に正規化済み配列を入れてくれる
      await loadStudentsForGrade(db, targetGrade, studentState);

         console.log(
  "[CHECK allStudents]",
  "grade=", studentState.allStudentsGrade,
  "len=", studentState.allStudents.length,
  "grades=", [...new Set(studentState.allStudents.map(s => s.grade))]
);
      // gradeStudentsCache には「学年名簿」だけを保存する
      try {
        studentState.gradeStudentsCache.set(targetGrade, studentState.allStudents.slice());
      } catch (e) { /* noop */ }

          }
  } catch (e) {
    throw e;
  }

  // === ② subjectRoster は「enrolledStudentIds」用にだけ読む（学年キャッシュには保存しない） ===
  let rosterIds = null;
  try {
    rosterIds = await loadSubjectRoster(db, currentYear, subjectId);
  } catch (e) {
    // subjectRoster 取得エラーはここでは握りつぶさず上に投げる運用に合わせる
    throw e;
  }

  if (!Array.isArray(rosterIds) || rosterIds.length === 0) {
    alert("名簿データが未生成です。教務に連絡してください。");
    throw new Error("subjectRoster missing");
  }

  enrolledStudentIds = Array.from(
    new Set(
      rosterIds
        .map((id) => String(id ?? "").trim())
        .filter((id) => id.length > 0)
    )
  );

  // 科目に応じて学生フィルタ＆ソート
  const students = filterAndSortStudentsForSubject(subject, studentState);

  // ▼ 選択科目(required=false)の場合は、electiveStudents でさらに絞り込む
  let displayStudents = students;
  if (subject.required === false) {
    const list = studentState.electiveStudents || [];
    // electiveStudents を正本として使う（subjectRoster 由来の students を再フィルタしない）
    displayStudents = list.slice();
  } else {
    displayStudents = students;
  }

// ★ STEP C フィルタ用：現在の表示学生を保持
studentState.baseStudents = displayStudents.slice();
studentState.currentStudents = displayStudents.slice();

if (currentSubjectMeta.isSkillLevel) {
  renderSkillLevelFilter(subject);
  window.currentSkillFilter = "all"; // 初期状態を全員に固定
}

  // 選択科目モーダルは students が確定した後に表示（Reads0 方針）
  if (subject && subject.required === false) {
    // ===== elective modal: grade boundary reset (Reads0) =====
    if (studentState.lastElectiveGrade !== grade) {
      console.log("[elective modal] grade changed -> reset modal state", {
        from: studentState.lastElectiveGrade,
        to: grade,
      });

      // モーダル表示に使う候補データや一時状態を必ず破棄
      if (studentState.electiveCandidates) studentState.electiveCandidates = [];
      if (studentState.electiveSelected) studentState.electiveSelected = [];
      // もし allStudents をモーダル側が参照していて汚染しているなら、ここはリセットしない（全画面で使うため）
      // 代わりに「モーダル内部で使う配列」だけを消す

      studentState.lastElectiveGrade = grade;
    }

    await openElectiveRegistrationModal(subject);
  }

  if (DEBUG) console.log('[DEBUG] subject:', subject);
  if (DEBUG) console.log('[DEBUG] displayStudents(before sort):', displayStudents);
  // 習熟度ソート（isSkillLevel===true時のみ）
  if (currentSubjectMeta.isSkillLevel) {
    displayStudents = sortStudentsBySkillLevel(displayStudents, studentState.skillLevelsMap);
    if (DEBUG) console.log('[DEBUG] displayStudents(after skill sort):', displayStudents);
  }
  await loadScoreVersionBase(subjectId, displayStudents);
  if (DEBUG) console.log('[DEBUG] renderStudentRows call:', { subject, displayStudents });


// ================================
// 提出済ユニット判定（UI用）
// ================================

// ★ snapshot listener が保存している最新データを使う
const subjectDocData = window.__latestScoresDocData || {};

const unitsMap =
  subjectDocData.submittedSnapshot?.units ||
  {};

// 提出済みユニット（提出＝ロック）
const lockedUnits = new Set(Object.keys(unitsMap));
// ★ STEP3-1 方針：
// 成績入力画面では再提出しないため、editableUnits は常に空
  const editableUnits = new Set();

// UI 用にまとめて students.js に渡す
studentState.lockedUnitInfo = {
  lockedUnits,      // すべての提出済ユニット
  editableUnits     // 常に空（トップ画面からの解除・再提出フェーズで拡張）
};


  // 学生行描画（入力時にその行の最終成績を計算）
  isRenderingTable = true;
  const handleScoreInputChange = (tr) => {
    if (!tr) return;
    recalcFinalScoresAfterRestore(tbody);
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
      studentState,
      window.__latestScoresDocData?.completion
    );
// ★ 初回描画直後に状態を確定させる（超重要）
    requestAnimationFrame(() => {
      recalcFinalScoresAfterRestore(tbody);
      syncFinalScoresFromTbody(tbody);
      applyRiskClassesToAllRows();
      updateAveragePointDisplay();
      refreshSaveButtonState();
    });

// ================================
// STEP1: 提出単位・完了条件の確定
// （名簿描画が完了した直後）
// ================================
window.__submissionContext = {
  requiredUnits: resolveRequiredUnits({
    grade,          // loader.js で既に使っている学年変数
    subjectMeta: currentSubjectMeta // 科目メタ（isCommon を含む）
  }),
  unitKey: resolveCurrentUnitKey({
    grade,
    subjectMeta: currentSubjectMeta,
    visibleStudents: displayStudents
  })
};


console.log(
  "[STEP1] submissionContext",
  window.__submissionContext
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
     recalcFinalScoresAfterRestore(tbody);
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
      hasSavedSnapshot = !!savedData; // ★保存済みデータがある科目は「保存済み」とみなす
      setUnsavedChanges(false);
  } catch (e) {
    console.warn("[WARN] failed to restore saved scores", e);
  }


if (!unsavedListenerInitialized && tbody) {
   // ==========================================
  // ★ 数値欄に「e」「-」「+」などが入るのを事前にブロック
  //   type="number" は value と表示がズレることがあるため
  //   beforeinput で「入る前」に止めるのが確実
  // ==========================================
  tbody.addEventListener("beforeinput", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement)) return;
    
    if (!t.dataset.index) return; // 点数欄だけ対象

    // IME系や削除系は通す
    const it = ev.inputType || "";
    if (it.startsWith("delete") || it === "historyUndo" || it === "historyRedo") return;

    const data = ev.data ?? "";
    // 1文字入力（insertText）で、数字と . 以外は拒否
    if (it === "insertText") {
      if (!/^[0-9.]$/.test(data)) {
        ev.preventDefault();
        return;
      }
      // 小数点は1つだけ
      if (data === "." && (t.value || "").includes(".")) {
        ev.preventDefault();
        return;
      }
    }
  }, true);

  tbody.addEventListener("keydown", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (t.type !== "number") return;
    if (!t.dataset.index) return;

    // 操作キーは許可
    if (
      ev.key === "Backspace" || ev.key === "Delete" ||
      ev.key === "Tab" || ev.key === "Enter" ||
      ev.key === "ArrowLeft" || ev.key === "ArrowRight" ||
      ev.key === "Home" || ev.key === "End"
    ) return;

    // 禁止キー
    if (ev.key === "e" || ev.key === "E" || ev.key === "+" || ev.key === "-") {
      ev.preventDefault();
      return;
    }
  }, true);



// ================================
// ★ STEP3-③：確定時（フォーカスアウト）の最終ガード
// ================================
tbody.addEventListener(
  "focusout",
  (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (t.classList.contains("skill-level-input")) return;
    if (!t.dataset.index) return; // 点数セルだけ対象

    const raw = t.value;
    if (raw === "") return;

    const v = Number(raw);
    if (!Number.isFinite(v)) {
      t.value = "";
      return;
    }

    const idx = Number(t.dataset.index);
    const max = criteriaState.maxByIndex?.[idx];

    // ★ max 超過は「確定時」に強制修正
    if (Number.isFinite(max) && v > max) {
      t.value = String(max);
      t.classList.add("ktc-input-error");
      showScoreInputErrorToast(`この項目の上限は ${max} 点です`);

      // 即時再計算を保証
      t.dispatchEvent(new Event("input", { bubbles: true }));
    }
  },
  true // ← capture で確実に拾う
);

tbody.addEventListener("input", (ev) => {
    if (isRenderingTable) return;
    if (isProgrammaticInput) return;

    const target = ev.target;

    // ================================
    // ★ 数値入力の正規化（e / - / -- 防止）
    // ================================
    if (
      target instanceof HTMLInputElement &&
     
      target.dataset.index
    ) {
      let v = target.value ?? "";

      // 数字と小数点以外を除去
      v = v.replace(/[^0-9.]/g, "");

      // 小数点は1つまで
      const parts = v.split(".");
      if (parts.length > 2) {
        v = parts[0] + "." + parts.slice(1).join("");
      }

      if (target.value !== v) {
        target.value = v;
      }
    }

    if (
      criteriaState.ready &&
      target instanceof HTMLInputElement &&
      
      target.dataset.index &&
      !target.classList.contains("skill-level-input")
    ) {
      const idx = Number(target.dataset.index);
      const max = criteriaState.maxByIndex?.[idx];

      const v = Number(target.value);
      if (Number.isFinite(max) && Number.isFinite(v) && v > max) {
        target.value = "";
        showScoreInputErrorToast(`この項目の上限は ${max} 点です`);
        return;
      }
    }

    if (
      target instanceof HTMLInputElement &&
      target.classList.contains("skill-level-input")
    ) {
      return;
    }

    const isNumberScoreInput =
      target instanceof HTMLInputElement &&
      
      !!target.dataset.index;

    const isSpecialSelect =
      target instanceof HTMLSelectElement &&
      (target.classList.contains("pass-fail-select") ||
       target.classList.contains("cert-select"));

    if (!isNumberScoreInput && !isSpecialSelect) return;

    setUnsavedChanges(true);
    isSavedAfterLastEdit = false;

recalcFinalScoresAfterRestore(tbody);
  // ★★★ ここに追加 ★★★
  const tr = target.closest("tr");
  if (tr) {
    handleScoreInputChange(tr);
  }

  });
// ★ 入力した行だけ即時再計算（ソートしなくても反映される）

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
          
          (msg) => window.alert(msg)
        )
      ) {
        setUnsavedChanges(true);
        enforceMaxForAllScoreInputs(tbody);
         // ★ 貼り付け直後に必ず再評価
        recalcFinalScoresAfterRestore(tbody);
        applyRiskClassesToAllRows();
      }
    });
    pasteInitialized = true;
  }

// メッセージ表示（specialType は評価基準を使わない）
if (currentSubjectMeta?.specialType === 1) {
  infoMessageEl?.classList.remove("warning-message");
  setInfoMessage("特別科目：合／否を選択してください。");
} else if (currentSubjectMeta?.specialType === 2) {
  infoMessageEl?.classList.remove("warning-message");
  setInfoMessage("特別科目：認定(1)／認定(2)を選択してください。");
} 
// ★ 特別科目は初期値が確定値なので、初回表示時点で保存可能にする
if (currentSubjectMeta?.specialType === 1 || currentSubjectMeta?.specialType === 2) {
  setUnsavedChanges(true);
}
else if (!criteriaState.items.length) {
  setInfoMessage(
    "この科目には評価基準が登録されていません。評価基準画面で登録してください。"
  );
  infoMessageEl?.classList.add("warning-message");
} else {
  infoMessageEl?.classList.remove("warning-message");
  setInfoMessage("成績を入力してください。（0〜100点で入力）");

}


  // 評価基準画面へのリンクを subjectId 付きに更新
  if (toEvaluationLink) {
    toEvaluationLink.href = `evaluation.html?subjectId=${encodeURIComponent(
      subjectId
    )}`;
  }

;
if (isSpecial || currentSubjectMeta.isSkillLevel) {
  // 特別科目・習熟度科目では組ソートを出さない
} else {
  renderGroupOrCourseFilter(subject);
}

if (
  !isSpecial &&
  !currentSubjectMeta.isSkillLevel &&
  currentSubjectMeta?.isCommon === true &&
  lastAutoAppliedCommonFilterSubjectId !== subjectId
) {
  lastAutoAppliedCommonFilterSubjectId = subjectId;
  applyGroupOrCourseFilter(subject, "all");
}

  recalcFinalScoresAfterRestore(tbody);

  // ★途中再開直後・描画直後に一括適用（Firestore readなし）
applyRiskClassesToAllRows();
console.log("FINAL META", currentSubjectMeta);

console.log("TEST: handleSubjectChange called");
// ヘッダ側の受講者登録ボタン表示制御（科目変更時の最後に1回だけ）
  // ✅ Excelダウンロードボタン：科目が成立したら有効化（Firestore read はしない）
 const excelBtn = document.getElementById("excelDownloadBtn");
if (excelBtn) {
  const isNormal = Number(subject?.specialType ?? currentSubjectMeta?.specialType ?? 0) === 0;

  // 表示／非表示
  excelBtn.style.display = isNormal ? "" : "none";

  // 念のため disable も同期
  excelBtn.disabled = !isNormal;
}
updateElectiveRegistrationButtons(subject);
// 念のため：提出済ロック中は未保存警告を出さない
const isScoreLocked = document.body.classList.contains("score-locked");
// ※ ここで handleSubjectChange を終了しない（下の「提出済み文言再表示」まで必ず到達させる）

const completion = window.__latestScoresDocData?.completion;
const completionOnly = isCompletionOnlySubmission(
  window.currentSubjectMeta,
  window.__latestScoresDocData
);

// ★習熟度は S/A1/A2/A3 で提出済み判定する
let shouldApplySubmittedLock = false;
if (completionOnly) {
  shouldApplySubmittedLock = true;
} else if (window.currentSubjectMeta?.isSkillLevel) {
  const k = String(window.currentSkillFilter || "").toUpperCase();
  shouldApplySubmittedLock = ["S", "A1", "A2", "A3"].includes(k) && completion?.completedUnits?.includes(k);
} else {
  const currentUnitKey = window.__submissionContext?.unitKey;
  shouldApplySubmittedLock = completion?.completedUnits?.includes(currentUnitKey);
}
const isSkillAllView =
  window.currentSubjectMeta?.isSkillLevel &&
  String(window.currentSkillFilter || "").toLowerCase() === "all";

// ================================
// ★最終：ロック状態は applyReadOnlyState に統一
// ================================
const filterKeyForReadOnly = (() => {
  if (window.currentSubjectMeta?.isSkillLevel) {
    return String(window.currentSkillFilter ?? "all").toLowerCase();
  }
  // 通常科目は "all" でも applyReadOnlyState が unlock してくれる
  return "all";
})();

if (shouldApplySubmittedLock) {
  // 提出済み（最優先）→ ここだけは「全操作禁止」にしたいので専用キーを使う
  showSubmittedLockNotice();
  hideAllReadOnlyNotice();
  applyReadOnlyState("submitted"); // ★後述：applyReadOnlyState に追加する
} else if (isSkillAllView) {
  hideSubmittedLockNotice();
  showAllReadOnlyNotice(
    "📘 この画面は【全体閲覧用】です。習熟度の入力は「全員」で入力してください。"
  );
  applyReadOnlyState("all");
} else {
  hideSubmittedLockNotice();
  hideAllReadOnlyNotice();
  applyReadOnlyState(filterKeyForReadOnly);
}

}

// =====================================================
// 【最終安全ガード】未保存のまま教務送信を絶対にさせない
// =====================================================
(() => {
  const submitBtn = document.getElementById("submitScoresBtn");
  if (!submitBtn) return;

  // 二重登録防止
  if (submitBtn.__finalGuardInstalled) return;
  submitBtn.__finalGuardInstalled = true;

  submitBtn.addEventListener(
    "click",
    (e) => {
      // 🔴 未保存なら絶対に止める
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.stopImmediatePropagation();
        alert("未保存の変更があります。\n先に一時保存してください。");
        return false;
      }
    },
    true // ★ capture=true（これが無いと意味がない）
  );
})();

// ================================
// スコア保存（楽観ロック付き・学生単位）
// ================================
export async function saveStudentScores(subjectId, studentId, scoresObj, teacherEmail) {
  if (!subjectId || !studentId) {
    throw new Error("subjectId と studentId は必須です");
  }
 const email = currentUser?.email || teacherEmail || ""; // ★追加（安全フォールバック）
  const sid = String(studentId);
  const ref = doc(db, `scores_${currentYear}`, subjectId);
 const baseVersion = scoreVersionBaseMap.get(sid) ?? 0;

await runTransaction(db, async (tx) => {
  const snap = await tx.get(ref);
  const latestData = snap.exists() ? snap.data() || {} : {};
  const latestRow = latestData.students?.[sid] || {};
  const latestVersion = Number.isFinite(latestRow.version) ? latestRow.version : 0;

  // 競合判定：version がズレたら即アウト
  if (latestVersion !== baseVersion) {
    throw new Error("SCORE_CONFLICT");
  }

  const nextVersion = baseVersion + 1;

  tx.set(
    ref,
    {
      students: {
        [sid]: {
          scores: scoresObj || {},
          version: nextVersion,
          updatedAt: serverTimestamp(), // ログ用途
          updatedBy: email,
        },
      },
      // 単体保存時に超過情報もまとめて保存する設計は維持
      excessStudents: excessStudentsState,
    },
    { merge: true }
  );
});

// 保存成功後：base を更新（"SAVED"は禁止）
ignoreNextSnapshot = true;
lastSavedByMeAt = Date.now();
scoreVersionBaseMap.set(sid, baseVersion + 1);

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
const baseVersion = scoreVersionBaseMap.get(studentId) ?? 0;
const latestRow = latestStudents[studentId] || {};
const latestVersion = Number.isFinite(latestRow.version) ? latestRow.version : 0;

if (latestVersion !== baseVersion) {
  throw new Error("SCORE_CONFLICT");
}

const nextVersion = baseVersion + 1;

payload[studentId] = {
  ...bulkScores[studentId],
  version: nextVersion,
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

 studentIds.forEach((sid) => {
  const baseV = scoreVersionBaseMap.get(sid) ?? 0;
  scoreVersionBaseMap.set(sid, baseV + 1);
});
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
  window.__currentFilterKey = String(filterKey ?? "all");
 window.__lastAppliedUnitKey = filterKey;

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
        (tr) => recalcFinalScoresAfterRestore(tbody),                        
        studentState,
        window.__latestScoresDocData?.completion
      );
// ★ specialType（習熟度など）の場合は number input 依存の判定をスキップ
if (!(currentSubjectMeta?.specialType === 1 || currentSubjectMeta?.specialType === 2)) {
  refreshSaveButtonState();
}
// ===== 特別科目は初期値が有効なので、初回から保存可能にする =====
if (
  currentSubjectMeta &&
  (currentSubjectMeta.specialType === 1 || currentSubjectMeta.specialType === 2)
) {
  setUnsavedChanges(true);
}


    } finally {
      isRenderingTable = false;
    }
    restoreStashedScores(tbody);
    updateStudentCountDisplay(filtered.length);
    studentState.currentStudents = filtered.slice();

    // 再計算 + 行ハイライト適用
    applyRiskClassesToAllRows();
    applyReadOnlyState(filterKey);
  });
  // ★ 提出済みユニット判定（正本ベース）
// ★ 提出済みユニット判定（正本ベース）
// 単一科目では filterKey="all" になりがちなので submissionContext.unitKey を救済する
const unitsMap =
  window.__latestScoresDocData?.submittedSnapshot?.units || {};

const isCommon = !!window.currentSubjectMeta?.isCommon;

// 単一科目：all のときは unitKey を使う（例:"5","M"など）
// 共通科目：all のときは判定しない（今回の方針：文言を出さない）
const effectiveKey =
  (!isCommon && (filterKey === "all" || filterKey == null))
    ? window.__submissionContext?.unitKey
    : filterKey;

const completionOnly = isCompletionOnlySubmission(
  window.currentSubjectMeta,
  window.__latestScoresDocData
);
const hasUnitSubmission =
  !completionOnly &&
  effectiveKey &&
  effectiveKey !== "all" &&
  hasSubmittedUnit(unitsMap, String(effectiveKey));

if (completionOnly || hasUnitSubmission) {
  lockScoreInputUI();

  // 文言は単一科目のみ表示（共通科目は今回は出さない）
  if (!isCommon) {
    showSubmittedLockNotice();
  } else {
    // 共通科目で過去に出た文言が残らないように必ず消す
    hideSubmittedLockNotice();
  }
} else {
  unlockScoreInputUI();

  // ★重要：未提出側へ切り替えた瞬間に、提出済文言を必ず消す
  hideSubmittedLockNotice();
}


}

// ================================
// 初期化
// ================================
export function initScoreInput() {
  // モードタブを生成（infoMessage の直下）
   
  
  if (electiveAddBtn) {
    electiveAddBtn.addEventListener("click", () => {
      electiveMode = "add";
      openElectiveModal();
    });
  }

  if (electiveRemoveBtn) {
    electiveRemoveBtn.addEventListener("click", () => {
      electiveMode = "remove";
      openElectiveModal();
    });
  }

  // Cancel ボタンは必ず共通ハンドラを接続（モーダルを閉じる）
  const electiveCancelBtn = document.getElementById("electiveCancelBtn");
  if (electiveCancelBtn) {
    electiveCancelBtn.addEventListener("click", closeElectiveModal);
  }

  const electiveRegisterBtn = document.getElementById("electiveRegisterBtn");
  if (electiveRegisterBtn) {
    electiveRegisterBtn.addEventListener("click", confirmElectiveChange);
  }

  // モーダル内ソートボタンのクリックハンドラ（データ属性の値を渡す）
  const electiveSortButtons = document.querySelectorAll(".elective-group-filter button");
  electiveSortButtons.forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      const value = btn.dataset.group || btn.dataset.course || "all";
      handleElectiveModalSortClick(value);
      // active クラスの更新
      electiveSortButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  const continueBtn = document.getElementById("electivePostRegisterContinueBtn");
  const finishBtn = document.getElementById("electivePostRegisterFinishBtn");

  if (continueBtn) {
    continueBtn.addEventListener("click", () => {
      hideElectivePostRegisterModal();
    });
  }

  if (finishBtn) {
  finishBtn.addEventListener("click", async () => {
    // reload すると科目プルダウンが先頭に戻るため、同一科目のまま再描画する
    hideElectivePostRegisterModal();

    const sid =
      currentSubjectId ||
      window.currentSubject?.subjectId ||
      document.getElementById("subjectSelect")?.value ||
      null;

    if (sid) {
      try {
        currentSubjectId = null; // ガード解除（同一科目でも再描画）
        await handleSubjectChange(String(sid));
      } catch (e) {
        console.error("[elective finish] rerender failed:", e);
        // 最終手段：subjectId 付きで遷移（状態保持）
        location.href = `score_input.html?subjectId=${encodeURIComponent(String(sid))}`;
      }
    } else {
      location.reload();
    }
  });
}

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
      console.log("[SAVE DEBUG] click");
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
        console.log("[SAVE DEBUG] rows length", rows.length);
        if (rows.length === 0) {
          alert("保存対象の学生がありません。");
          return;
        }

        const riskContext = buildRiskContext();
        const bulkScores = {};

        for (const tr of rows) {
          const studentId = String(tr.dataset.studentId || "");
          if (!studentId) continue;

          // ===== specialType=1：合／否 保存 =====
          if (currentSubjectMeta.specialType === 1) {
            const sel = tr.querySelector("select.pass-fail-select");
            const v = sel ? String(sel.value || "pass") : "pass";
            bulkScores[studentId] = {
              scores: { passFail: v },    // ←数値ではなく pass/fail を保存
              finalScore: null,           // ←数値計算しない
              isRed: false,
              isOver: false,
            };
            continue;
          }
// ===== specialType=2：認定 保存 =====
if (currentSubjectMeta.specialType === 2) {
  const sel = tr.querySelector("select.cert-select");
  const v = sel ? String(sel.value || "cert1") : "cert1";
  bulkScores[studentId] = {
    scores: { cert: v },        // ← cert1/cert2 を保存
    finalScore: null,           // ←数値計算しない
    isRed: false,
    isOver: false,
  };
  continue;
}

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

        console.log("[SAVE DEBUG] bulkScores keys", Object.keys(bulkScores));

        const saveCount = Object.keys(bulkScores).length;
        if (saveCount === 0 && !excessDirty) {
          showSaveSuccessToast();
          setInfoMessage(`保存しました（0件）`);
          setUnsavedChanges(false);
          isSavedAfterLastEdit = true;
          hasSavedSnapshot = true; // ★0件でも「保存済み」状態にする
          return;
        }

        try {
          console.log("[SAVE DEBUG] calling saveBulkStudentScores");
          await saveBulkStudentScores(bulkScores);
          // DOMと状態を再同期
          document
            .querySelectorAll('#scoreTableBody tr[data-student-id]')
            .forEach((tr) => {
              // 非表示行はスキップ
              if (tr.offsetParent === null) return;
              if (typeof syncRowFilledState === "function") {
                syncRowFilledState(tr);
              }
            });
          window.updateSubmitUI?.();
          // ===== 一時保存成功後：送信可否フラグをDOMから再構築 =====
document
  .querySelectorAll('#scoreTableBody tr[data-student-id]')
  .forEach(tr => {
    if (typeof syncRowFilledState === "function") {
      syncRowFilledState(tr);
    }
  });

// ★ 送信ボタン状態を再評価
window.updateSubmitUI?.();

          isSavedAfterLastEdit = true;   // ★これがないと再提出が壊れる
           hasSavedSnapshot = true;      // ★提出判定用
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
        hasSavedSnapshot = true; // ★保存成功 → 提出可能状態へ
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
    window.currentUser = user; // ★追加：score_input_students.js が参照する

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
    // ✅ Excelダウンロード（Firestore read は追加しない：既存state/DOMのみ使用）
  initExcelDownloadFeature({
    getCurrentSubject: () => window.currentSubject, // handleSubjectChange 内でセット済み
    getCurrentSubjectMeta: () => currentSubjectMeta,
    criteriaState,
    studentState,
    
  });
}

function openElectiveModal() {
  const isAddMode = (electiveMode === "add" || electiveMode === "initial");
    // ===== モーダル文言（登録/解除）をモードで切替 =====
  const titleEl = document.getElementById("electiveModalTitle");
  const descEl  = document.getElementById("electiveModalDescription");
  const btnEl   = document.getElementById("electiveRegisterBtn");

  if (titleEl) titleEl.textContent = isAddMode ? "受講者登録（選択科目）" : "受講者登録解除（選択科目）";
  if (descEl)  descEl.textContent  = isAddMode ? "受講する学生にチェックを入れてください。" : "登録を解除する学生にチェックを入れてください。";
  if (btnEl)   btnEl.textContent   = isAddMode ? "登録" : "解除";


  // ① 超過学生登録と同じ名簿取得
  const baseStudents = getStudentsForSubject();

  // ② electiveRegistrations の登録済 studentId を参照（electiveRegistrations doc を優先）
  const regList =
  (Array.isArray(electiveRegistrations?.students) && electiveRegistrations.students.length > 0)
    ? electiveRegistrations.students
    : (studentState.electiveStudents || []);

  const registeredIds = regList.map((s) => String(s.studentId));

  // ③ モード別に表示対象を決定
  let displayStudents = isAddMode
    ? baseStudents.filter((s) => !registeredIds.includes(String(s.studentId)))
    : baseStudents.filter((s) => registeredIds.includes(String(s.studentId)));

  // ④ ソート（超過学生登録と同一）
  displayStudents = (displayStudents || []).slice();

  // モーダル用ソートの元データを保持
  electiveModalSourceStudents = displayStudents.slice();

  // モーダル用ソートモードを決定し、表示/ボタンを更新
  const modalSubject = window.currentSubject || findSubjectById(currentSubjectId);
  electiveModalSortMode = determineElectiveModalSortMode(modalSubject);
  updateElectiveModalSortVisibility(modalSubject);
  updateElectiveModalSortButtons();

  // ⑤ 描画
  renderElectiveStudentList(displayStudents || []);

  // ⑦ モーダル表示
  const modal = document.getElementById("electiveModal");
  if (modal) modal.style.display = "flex";
}

// ================================
// STEP1: 提出単位・完了条件の解決
// ================================

function resolveRequiredUnits({ grade, subjectMeta }) {
  // 非共通・非共通選択・特別科目
  if (!subjectMeta?.isCommon) {
  return ["__SINGLE__"];
}

  // 共通・共通選択
  if (Number(grade) <= 2) {
    // 1・2年 共通
    return ["1", "2", "3", "4", "5"];
  }

  // 3年以上 共通（CA は統合）
  return ["M", "E", "I", "CA"];
}

function resolveCurrentUnitKey({ grade, subjectMeta, visibleStudents }) {
  if (!visibleStudents || visibleStudents.length === 0) return null;
  if (subjectMeta?.isSkillLevel === true) {
    // 習熟度は「現在のフィルタボタン」が unitKey
    const activeBtn =
      document.querySelector("#groupFilterArea .filter-btn.active");
    const key = activeBtn?.dataset?.filterKey;
    return key && key !== "all" ? key : null;
  }

  const first = visibleStudents[0] || {};

  // 1・2年：組（1〜5）を unitKey にする
  if (Number(grade) <= 2) {
    const g = first.classGroup ?? first.courseClass ?? first.group ?? first.class ?? "";
    return g ? String(g) : null;
  }

  // 3年以上：コース（M/E/I/C/A）を unitKey にする
  // ※重要：単一科目では C/A を CA にまとめない（提出済キーが 'C' だから）
  const c = String(first.courseClass ?? first.course ?? "").toUpperCase();
  if (!c) return null;

  // 共通科目だけ C/A を CA にまとめる（将来の完成形用）
  if (subjectMeta?.isCommon && (c === "C" || c === "A")) return "CA";

  // 単一科目（または共通以外）では 'C' / 'A' をそのまま返す
  return c;
}




// getStudentsForSubject: 超過学生登録等と共通の名簿取得ラッパー
function getStudentsForSubject() {
  const subject = findSubjectById(currentSubjectId);
  if (!subject) return [];
  return filterAndSortStudentsForSubject(subject, studentState) || [];
}

// 共通: 選択科目モーダルを閉じる
function closeElectiveModal() {
  const modal = document.getElementById("electiveModal");
  if (modal) {
    modal.style.display = "none";
  }
}

function determineElectiveModalSortMode(subject) {
  if (!subject || subject.required !== false) return null;
  if (String(subject.course ?? "").toUpperCase() !== "G") return null;
  const grade = Number(subject.grade);
  if (Number.isFinite(grade) && grade <= 2) return "group"; // 1–2年
  return "course"; // 3年以上
}

function updateElectiveModalSortVisibility(subject) {
  const sortArea = document.querySelector(".elective-group-filter");
  if (!sortArea) return;

  sortArea.style.display = electiveModalSortMode ? "flex" : "none";
}

function updateElectiveModalSortButtons() {
  const buttons = document.querySelectorAll(".elective-group-filter button");
  if (!buttons || buttons.length === 0) return;

  const courseKeys = ["all", "M", "E", "I", "C", "A"];
  const groupKeys = ["all", "1", "2", "3", "4", "5"];

  // ボタン数が 6 個ある前提（HTMLは変更しない）
  const keys = electiveModalSortMode === "course" ? courseKeys : groupKeys;

  buttons.forEach((btn, idx) => {
    const key = keys[idx] ?? null;
    if (electiveModalSortMode === "group") {
      btn.dataset.group = key || "";
      btn.dataset.course = "";
      btn.textContent = key === "all" ? "全員" : key || "";
      btn.style.display = key ? "inline-flex" : "none";
    } else if (electiveModalSortMode === "course") {
      btn.dataset.course = key || "";
      btn.dataset.group = "";
      // 学部キーが足りなければ非表示
      btn.textContent = key === "all" ? "全員" : key || "";
      btn.style.display = key ? "inline-flex" : "none";
    } else {
      // モード無し: 全て非表示
      btn.style.display = "none";
      btn.dataset.group = btn.dataset.group || "";
      btn.dataset.course = btn.dataset.course || "";
    }
    btn.classList.toggle("active", key === "all" && electiveModalSortMode !== null);
  });
}

function handleElectiveModalSortClick(value) {
  if (!electiveModalSortMode) return;
  if (electiveModalSortMode === "group") {
    applyElectiveGroupFilter(value);
  } else if (electiveModalSortMode === "course") {
    applyElectiveCourseFilter(value);
  }
}

function renderElectiveStudentList(students) {
  const tbody = document.getElementById("elective-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  (students || []).forEach((student) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <input type="checkbox" value="${student.studentId}">
      </td>
      <td>${student.studentId}</td>
      <td>${student.grade}</td>
      <td>${student.course}</td>
      <td>${student.number}</td>
      <td>${student.name}</td>
    `;
    tbody.appendChild(tr);
  });
}

function applyElectiveGroupFilter(value) {
  if (!Array.isArray(electiveModalSourceStudents)) return;
  const val = String(value || "all");
  const filtered = val === "all"
    ? electiveModalSourceStudents.slice()
    : electiveModalSourceStudents.filter((stu) => String(stu.courseClass || stu.classGroup || stu.group || "") === val);
  renderElectiveStudentList(filtered);
}

function applyElectiveCourseFilter(value) {
  if (!Array.isArray(electiveModalSourceStudents)) return;
  const val = String(value || "all").toUpperCase();
  const filtered = val === "ALL"
    ? electiveModalSourceStudents.slice()
    : electiveModalSourceStudents.filter((stu) => String(stu.courseClass || stu.course || "").toUpperCase() === val);
  renderElectiveStudentList(filtered);
}

async function confirmElectiveChange() {
  console.log("=== confirmElectiveChange START ===");
  console.log("currentSubject:", currentSubject);
  console.log("CURRENT_YEAR:", CURRENT_YEAR);
  console.log("electiveMode:", electiveMode);

  if (!currentSubject || !currentSubject.subjectId) {
    alert("科目情報が取得できません。");
    return;
  }

  const subjectId = currentSubject.subjectId;
  const year = CURRENT_YEAR;
  const db = getFirestore();

  // ✅ checkbox から studentId を取る：value を正本にする
  const checkedBoxes = Array.from(
    document.querySelectorAll("#electiveModal input[type='checkbox']:checked")
  );
  const selectedIds = checkedBoxes.map(cb => String(cb.value)).filter(Boolean);

  console.log("selectedIds:", selectedIds);
  if (selectedIds.length === 0) {
    alert("学生が選択されていません。");
    return;
  }

  // ✅ 追加/解除に使う「学生オブジェクト」を作る（モーダルに表示している一覧から抜く）
  // ※ ここがあなたのコードで別名なら置換してください
  const sourceList = (typeof electiveModalSourceStudents !== "undefined")
    ? electiveModalSourceStudents
    : [];

  // sourceList から対象学生を抽出（studentId一致）
  const selectedStudents = sourceList
    .filter(s => selectedIds.includes(String(s.studentId)))
    .map(s => ({
      // ✅ Firestoreの既存studentsが持っているキーに揃える（最低限このあたり）
      studentId: String(s.studentId),
      name: s.name ?? "",
      grade: s.grade ?? "",
      course: s.course ?? "",          // あるなら
      courseClass: s.courseClass ?? "",// あるなら
      number: s.number ?? "",
      classGroup: s.classGroup ?? "",
      group: s.group ?? ""
    }));

  if (selectedStudents.length === 0) {
    // sourceList が空/不一致のときに気づけるように
    alert("選択学生の詳細情報が取得できません（モーダル元リスト未取得）。");
    console.error("sourceList missing or mismatch. sourceList length=", sourceList.length);
    return;
  }

  const regRef = doc(db, `electiveRegistrations_${year}`, subjectId);
  console.log("Firestore path:", `electiveRegistrations_${year}/${subjectId}`);

   let nextStudents = null;
  try {
    // ✅ students配列は transaction で確定更新（IDベースで差分反映）
       
  await runTransaction(db, async (tx) => {
  const snap = await tx.get(regRef);
  const existing = snap.exists() ? (snap.data().students || []) : [];

  const byId = new Map();
  existing.forEach(stu => {
    if (stu && stu.studentId != null) byId.set(String(stu.studentId), stu);
  });

if (electiveMode === "initial") {
  // 初回登録：既存を見ず、選択した学生のみで置き換える
  byId.clear();
  selectedStudents.forEach(stu => byId.set(String(stu.studentId), stu));
} else if (electiveMode === "add") {
  selectedStudents.forEach(stu => byId.set(String(stu.studentId), stu));
} else if (electiveMode === "remove") {
  selectedStudents.forEach(stu => byId.delete(String(stu.studentId)));
} else {
  throw new Error("Invalid electiveMode: " + electiveMode);
}

nextStudents = Array.from(byId.values());


  tx.set(regRef, {
    students: nextStudents,
    updatedAt: serverTimestamp(),
  }, { merge: true });
});

  } catch (err) {
    console.error("elective registration update failed:", err);
    alert("登録情報の更新に失敗しました。");
    return;
  }

    // transaction成功後に nextStudents を state/cache に同期（この変数が上で宣言されている前提）
  if (Array.isArray(nextStudents)) {
    studentState.electiveStudents = nextStudents.slice();
    electiveRegistrations = {
      ...(electiveRegistrations || {}),
      subjectId: subjectId,
      students: studentState.electiveStudents,
    };
  }

  // モーダルを閉じる
  const modal = document.getElementById("electiveModal");
  if (modal) modal.style.display = "none";

  // 正本（electiveRegistrations.students）を基準に再描画
  currentSubjectId = null;
  await handleSubjectChange(subjectId);
}



async function rerenderScoreTable() {
  if (!currentSubjectId) return;
  await handleSubjectChange(currentSubjectId);
}

function updateStudentCount() {
  const count = Array.isArray(studentState.currentStudents)
    ? studentState.currentStudents.length
    : 0;
  updateStudentCountDisplay(count);
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

export async function checkIfSubmitted(db, subjectId, unitKey) {
  if (!subjectId) return false;

  const year = window.CURRENT_YEAR;
  const ref = doc(db, `scores_${year}`, subjectId);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return false;

 const data = snap.data();
const submitted = data.submittedSnapshot;
if (!submitted) return false;

// ★ students が1人以上いる場合のみ「提出済」とみなす
    const units = submitted.units || {};
    if (!unitKey) return false;
    return Object.prototype.hasOwnProperty.call(units, String(unitKey));
  } catch (e) {
    console.error("[checkIfSubmitted] Firestore error:", e);
    return false;
  }
}

// ================================
// 保存ボタン状態をDOMから再評価
// ================================
export function refreshSaveButtonState() {
  const saveBtn = document.getElementById("saveBtn");
  const tbody = document.getElementById("scoreTableBody");
  if (!saveBtn || !tbody) return;

  const rows = Array.from(tbody.querySelectorAll("tr"));

  // 1行でも「入力がある」行があれば保存可能
  const hasAnyInput = rows.some(tr => {
    const inputs = tr.querySelectorAll('input[data-index]:not(.skill-level-input)');
    return Array.from(inputs).some(inp => inp.value !== "");
  });

  saveBtn.disabled = !hasAnyInput;
}

export function disableScoreInputs() {
  document.querySelectorAll("#scoreTableBody input[data-index]:not(.skill-level-input)").forEach((input) => {
    input.disabled = true;
  });
}

export function enableScoreInputs() {
  document.querySelectorAll("#scoreTableBody input[data-index]:not(.skill-level-input)").forEach((input) => {
    input.disabled = false;
  });
}

if (typeof window !== "undefined") {
  window.enableScoreInputs = enableScoreInputs;
}


// ===============================
// 成績入力UIをロックする
// ===============================
function lockScoreInputUI() {
  // 入力ロック
}


// ===============================
// UI ロック解除（提出済み → 未提出 切替用）
// ===============================
function unlockScoreInputUI() {
  // ================================
  // ★ 提出済みユニットは解除しない
  // ================================
  const activeFilterBtn =
    document.querySelector("#groupFilterArea .filter-btn.active");
  const rawKey = activeFilterBtn?.dataset?.filterKey;
  const unitKey =
    (rawKey && rawKey !== "all")
      ? rawKey
      : (window.__submissionContext?.unitKey ?? "ALL");

  const unitsMap =
    window.__latestScoresDocData?.submittedSnapshot?.units || {};

  const completionOnly = isCompletionOnlySubmission(
    window.currentSubjectMeta,
    window.__latestScoresDocData
  );
  if (completionOnly || hasSubmittedUnit(unitsMap, String(unitKey))) {
    return;
  }

  const saveBtn = document.getElementById("saveBtn");
  const excelBtn = document.getElementById("excelDownloadBtn");
  const submitBtn = document.getElementById("submitScoresBtn");

  if (saveBtn) saveBtn.disabled = false;
  if (excelBtn) excelBtn.disabled = false;
  if (submitBtn) submitBtn.disabled = false;
}

// ================================
// 全員(all)表示時の閲覧専用ロック
// ================================
function applyReadOnlyState(filterKey) {
  const meta = window.currentSubjectMeta || {};
  const isCommon = !!meta.isCommon;
  const isSkill = !!meta.isSkillLevel;

 const key = String(filterKey || "").toLowerCase();
if (key === "submitted") {
  // 提出済みは完全ロック（習熟度も含めて編集不可）
  const controls = document.querySelectorAll(
    "#scoreTableBody input, #scoreTableBody select, #scoreTableBody textarea"
  );
  controls.forEach(el => { el.disabled = true; });

  const saveBtn = document.getElementById("saveBtn");
  const excelBtn = document.getElementById("excelDownloadBtn");
  const submitBtn = document.getElementById("submitScoresBtn");
  if (saveBtn) saveBtn.disabled = true;
  if (excelBtn) excelBtn.disabled = true;
  if (submitBtn) submitBtn.disabled = true;
  return;
}
  const isAll = key === "all";
  const isSkillUnit = ["s", "a1", "a2", "a3"].includes(key.toLowerCase());

  const controls = document.querySelectorAll(
    "#scoreTableBody input, #scoreTableBody select, #scoreTableBody textarea"
  );

  // まず全部ロック
  controls.forEach(el => {
    el.disabled = true;
  });

  if (isAll && isSkill) {
    // ================================
    // 全員 × 習熟度科目
    // → 習熟度だけ入力可
    // ================================
    document
      .querySelectorAll("#scoreTableBody input.skill-level-input")
      .forEach(el => {
        el.disabled = false;
      });

    showAllReadOnlyNotice(
      "✏️ この画面では【習熟度】のみ入力できます。"
    );
    return;
  }

  if (isSkillUnit) {
    // ================================
    // S / A1 / A2 / A3
    // → 習熟度は入力不可、点数は入力可
    // ================================
    document
      .querySelectorAll(
        "#scoreTableBody input[data-index]:not(.skill-level-input)"
      )
      .forEach(el => {
        el.disabled = false;
      });

    hideAllReadOnlyNotice();
    return;
  }

  // その他（通常科目など）
  controls.forEach(el => {
    el.disabled = false;
  });
  hideAllReadOnlyNotice();
}


// ================================
// 提出済み注意文言の表示（共通）
// ================================
function showSubmittedLockNotice() {
  // 既にあれば何もしない
  if (document.querySelector(".submitted-lock-notice")) return;

 const info = document.getElementById("infoMessage");

  const notice = document.createElement("div");
  notice.className = "submitted-lock-notice";
  notice.innerHTML = `
    <div style="
      background:#fff3e0;
      border:1px solid #ffb74d;
      border-radius:6px;
      padding:10px 12px;
      margin:8px 0;
      font-size:14px;
    ">
      ⚠ この科目の成績は
      <strong style="color:#c62828;">【すでに提出済み】</strong>
      のため、この画面では編集できません。
      再提出・修正は
      <strong>トップ画面の「成績入力済み一覧」</strong>
      から操作してください。
    </div>
  `;
   // ★ 正：科目プルダウン領域（top-controls）の直下に出す
  const topControls = document.querySelector(".top-controls");
  if (topControls && topControls.parentNode) {
    topControls.insertAdjacentElement("afterend", notice);
    return;
  }
  // フォールバック：infoMessage の直前（最低限表示）
  if (info && info.parentNode) {
    info.parentNode.insertBefore(notice, info);
  }
 
}

window.showSubmittedLockNotice = showSubmittedLockNotice; // ★追加：students.js から呼べるようにする
function hideSubmittedLockNotice() {
  document
    .querySelectorAll(".submitted-lock-notice")
    .forEach((el) => el.remove());
}

// ================================
// 全員(all)閲覧専用の注意文
// ================================
function showAllReadOnlyNotice(message) {
  const text =
    message ||
    "この画面は全体閲覧用です。成績の入力・編集はできません。入力する場合は組／コースを選択してください。";

  let notice = document.querySelector(".all-readonly-notice");

  // 既に存在する場合：内容が同じなら何もしない／違えば更新
  if (notice) {
    if (notice.textContent !== text) {
      notice.textContent = text;
    }
    return;
  }

  // 初回生成
  notice = document.createElement("div");
  notice.className = "all-readonly-notice";
  notice.textContent = text;

  // 科目プルダウン領域（top-controls）の直下に出す
  const topControls = document.querySelector(".top-controls");
  if (topControls && topControls.parentNode) {
    topControls.insertAdjacentElement("afterend", notice);
    return;
  }

  // フォールバック（infoMessage の直前）
  const info = document.getElementById("infoMessage");
  if (info && info.parentNode) {
    info.parentNode.insertBefore(notice, info);
  }
}

function hideAllReadOnlyNotice() {
  const el = document.querySelector(".all-readonly-notice");
  if (el) el.remove();
}

/**
 * 科目が「全 unit 提出済」かどうかを判定する
 * ※ 文言表示・UI制御専用（ロック処理には使わない）
 */
/**
 * 科目が「全 unit 提出済」かどうかを判定する
 * ※ 文言表示・UI制御専用（ロック処理には使わない）
 */
function isSubjectFullySubmitted(subjectDocData) {
  if (!subjectDocData) return false;

  const completion = subjectDocData.completion;
  if (!completion) return false;

  const required = completion.requiredUnits;
  const completed = completion.completedUnits || [];

  // ----------------------------------------
  // 単一科目（requiredUnits が無い or 空）
  // ----------------------------------------

if (Array.isArray(required) && required[0] === "__SINGLE__") {
  return completion.isCompleted === true || (completed && completed.length > 0);
}

  if (!Array.isArray(required) || required.length === 0) {
    return completion.isCompleted === true;
  }

  // ----------------------------------------
  // 共通科目（複数 unit）
  // ----------------------------------------
  // 全 requiredUnits が completedUnits に含まれているか
  return required.every(unit => completed.includes(unit));
}





