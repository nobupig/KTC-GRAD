  // ================================
// 修正モード確定（EDIT ONLY）
// ================================
window.__isEditMode = true;

const params = new URLSearchParams(location.search);

const year = params.get("year");
const subjectId = params.get("subjectId");
const unitKeyFromUrl = params.get("unitKey") || null;

// ================================
// ★ submissionContext 正本の初期化（最重要）
// ================================
window.__submissionContext = {
  unitKey: unitKeyFromUrl,   // ← ★ ここで初めて確定させる
  requiredUnits: []
};

console.log("🧭 edit mode params", { year, subjectId, unitKeyFromUrl });

if (!year || !subjectId) {
  alert("修正対象の年度または科目が指定されていません。");
  location.href = "start.html";
  throw new Error("missing params");
}
  
  
  // ================================
  // 現在表示中の調整点を数値で取得
  // ================================
  const DEBUG = false; // set true for local debug

function isUnitSubmittedByUI(subjectDocData, unitKey) {
   if (!subjectDocData || !unitKey) return false;

    // ★ unitKey の大小文字ゆれに強くする（保存キーが M / m / CA / ca など混在しても拾えるように）
    const raw = String(unitKey);
    const keys = [raw, raw.toLowerCase(), raw.toUpperCase()];

    // 新方式（submittedByUnit）
    if (subjectDocData.submittedByUnit) {
      for (let i = 0; i < keys.length; i++) {
        if (subjectDocData.submittedByUnit[keys[i]]) return true;
      }
   }

    // 旧方式（submittedSnapshot.units）
    const units = subjectDocData.submittedSnapshot?.units;
    if (units) {
      for (let j = 0; j < keys.length; j++) {
        if (units[keys[j]]) return true;
      }
    }

    return false;
  }



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
  // ================================
  // Step D-① UI 状態ストア（unitKey 単位）
  // ================================
  window.uiStateByUnit = Object.create(null);

  /**
   * unitKey の UI 状態を初期化（存在しなければ）
   */
  function ensureUIStateForUnit(unitKey) {
    if (!unitKey) return;

    window.uiStateByUnit = window.uiStateByUnit || {};

    if (!window.uiStateByUnit[unitKey]) {
      // NOTE: Do not store `isSubmitted` in uiStateByUnit anymore.
      // Only keep hasSaved / hasInput as requested.
      window.uiStateByUnit[unitKey] = {
        hasSaved: false,
        hasInput: false
      };
    }
  }

  // Helper: determine whether the currently selected unit is submitted
  function isCurrentUnitSubmitted() {
    const subjectMeta = window.currentSubjectMeta;
    const doc = window.__latestScoresDocData;
    if (!doc) return null;

    // ============================
    // 習熟度科目
    // ============================
    if (subjectMeta?.isSkillLevel) {
      const filter = String(window.currentSkillFilter || "").toUpperCase();
      // all 表示は「判定不能」
      if (!filter || filter === "ALL") return null;

      return !!isUnitSubmittedByUI(doc, filter);
    }

    // ============================
    // 通常／共通科目
    // ============================
    const unitKey = window.__submissionContext?.unitKey;

    // unitKey 未確定は「判定不能」
    if (!unitKey) return null;

    return !!isUnitSubmittedByUI(doc, unitKey);
  }



  window.isCurrentUnitSubmitted = isCurrentUnitSubmitted;


  /**
   * ★ Step D-③
   * 現在の unitKey に対応する UI 状態を返すヘルパー
   * （存在しない場合は null）
   */
  function getCurrentUIState() {
  let unitKey = window.__submissionContext?.unitKey;

  // ================================
  // ★ 単一提出科目（1・2年 特別科目）の補完
  // ================================
  if (!unitKey) {
    const subject = window.currentSubject;
    const grade = String(subject?.grade ?? "");
    const isSpecial = Number(subject?.specialType ?? 0) === 1;

    // 1・2年の特別科目は常に単一提出
    if (isSpecial && (grade === "1" || grade === "2")) {
      unitKey = "__SINGLE__";
    window.__submissionContext.unitKey = "__SINGLE__";
window.__submissionContext.requiredUnits = ["__SINGLE__"];
    }
  }

  if (!unitKey) return null;

  // ★ 必ず state を初期化
  ensureUIStateForUnit(unitKey);

  return window.uiStateByUnit[unitKey];
}


  // ★ グローバル公開（必須）
  window.getCurrentUIState = getCurrentUIState;

  /**
   * applyUIState
   * - 集中関数: `submit` ボタンおよびステータスバッジの UI 操作を一か所に集約します。
   * - `updateSubmitUI` は判定ロジック（状態の評価）を担当し、実際の DOM 反映は本関数に委譲します。
   * - 本関数は apply の役割を担い、呼び出し回数は `updateSubmitUI` が単一に管理します。
   * - Params accepted (may be unused): subject, subjectMeta, ui, completion, saveState
   */




  // ================================
  // ★ Step C-②: 再描画後に適用する「保存済みスコア」の正本を返す
  // 優先順位：直近保存（UI正本）→ snapshot listener → 何も無ければ空
  // ================================
  function getLatestSavedStudentsMap() {
    return (
      window.__latestSavedSnapshot?.students ||
      window.__latestScoresDocData?.students ||
      {}
    );
  }
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
  // ★ 提出確定後は dirty を絶対に立てない（特別科目も含む）
  const ui = window.getCurrentUIState?.();
  const sid = ui?.subject?.subjectId || null;
  const map = window.__submissionFinalizedBySubject || {};
  const isFinalized = (window.__submissionFinalized === true) || (sid && map[sid] === true);

// ★ 再提出対応済みガード（唯一ここだけ）
if (isFinalized || (isCurrentUnitSubmitted() && !window.__isEditMode)) {
  return;
}

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


  // debug: DIRTY logging removed in production
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
          // Drafts are disabled in edit-only mode: do not populate excessDraftState
          excessDraftState = null;

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
              // Draft changes are disabled in edit-only mode; do nothing on change.
              cb.addEventListener('change', () => {});
            }

            if (hoursInput) {
              hoursInput.style.width = '100%';
              hoursInput.style.boxSizing = 'border-box';
              hoursInput.style.textAlign = 'right';
              // Draft edits disabled in edit-only mode: ignore input events
              hoursInput.addEventListener('input', () => {});
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

import { renderEditModeNoticeOnce } from "./edit_mode_notice.js";
import { lockSubjectSelectInEditMode } from "./edit_mode_subject_lock.js";
import { lockUnitButtonsInEditMode } from "./edit_mode_unit_lock.js";

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
      { key: "UNSET", label: "未設定" }
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
    const normalizedKey = String(key ?? "ALL").toUpperCase();
      // ================================
    // ★ 提出済み文言判定用：unitKey の正本を更新（習熟度）
    // ================================
if (!window.__isEditMode) {
  window.__submissionContext.unitKey =
    normalizedKey !== "ALL" ? normalizedKey : null;
}


    const isSkill = !!window.currentSubjectMeta?.isSkillLevel;

    // ★ 表示状態の正本
    window.currentSkillFilter = normalizedKey;
    window.currentUnitKey = normalizedKey;
    ensureUIStateForUnit(window.currentUnitKey);

    const baseList =
      (studentState.baseStudents || studentState.currentStudents || []).slice();
    const levelsMap = studentState.skillLevelsMap || {};
    let filtered = baseList;

  // normalizedKey は常に大文字（"ALL","S","A1","A2","A3","UNSET"）
  if (normalizedKey === "ALL") {
    filtered = baseList;
  } else if (["S", "A1", "A2", "A3"].includes(normalizedKey)) {
    filtered = baseList.filter(stu => {
      const lv = String(levelsMap[stu.studentId] || "").toUpperCase();
      return lv === normalizedKey;
    });
  } else if (normalizedKey === "UNSET") {
    filtered = baseList.filter(stu => {
      const lv = String(levelsMap[stu.studentId] || "");
      return lv === "";
    });
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

        // ★ Step C-②: 再描画後は「直近保存→listener」の順で必ず反映
      applySavedScoresToTable(submitted.snapshot.students, tbody);
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
  window.updateSubmitUI?.({ subjectDocData: window.__latestScoresDocData });

    }



  function syncSubmittedLockForSkillFilter() {
    // Disabled: submission UI control is centralized in updateSubmitUI()
    // This function must not modify UI state, so return immediately.
    return;
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
  const saveBtn = document.getElementById("saveBtn"); // ★「一時保存」ボタン
  const backHomeBtn = document.getElementById("backHomeBtn");
  const toEvaluationLink = document.getElementById("toEvaluationLink");


  // ================================
  // URLパラメータから subjectId を取得
  // ================================
  const urlParams = new URLSearchParams(window.location.search);
  let subjectIdFromURL = urlParams.get("subjectId") || null;
  // ★ 追加：編集モード判定（再提出・修正用）



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

  // ================================
  // UnitKey ベースの小型 state store
  // - 既存のグローバルフラグを残しつつ、unit 単位での保存状態を保持する
  // ================================
  window.unitStateByKey = window.unitStateByKey || {};
  const defaultUnitState = {
    isSavedAfterLastEdit: false,
    hasUnsavedChanges: false,
    hasInput: false,
  };

  function getCurrentUnitKey() {
    return window.__submissionContext?.unitKey ?? null;
  }

  function getUnitState(unitKey) {
    if (!unitKey) return null;
    window.unitStateByKey = window.unitStateByKey || {};
    if (!window.unitStateByKey[unitKey]) {
      window.unitStateByKey[unitKey] = Object.assign({}, defaultUnitState);
    }
    return window.unitStateByKey[unitKey];
  }

  function getCurrentUnitState() {
    return getUnitState(getCurrentUnitKey());
  }

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
      // ★ 初回描画・復元中は未保存フラグを立てない
    if (isRenderingTable) {
      return;
    }
    const ui = deriveUIState(); // ★ ここで統一（all/isSubmittedが取れる）
    // ★ UI文言・ボタン状態を即時反映（未保存／途中再開表示など）
    if (typeof window.applyStudentUIState === "function") {
      window.applyStudentUIState(ui);
    }
    // ★ 提出済み / 全員表示では dirty を立てない（赤字も出さない）
    if (isCurrentUnitSubmitted() || ui?.isAllView) {
      hasUnsavedChanges = false;
      // 一時保存は常に無効
      document.getElementById("saveBtn")?.setAttribute("disabled", "true");
      // 赤字表示を消す
      infoMessageEl?.classList.remove("warning-message");
      // 既存フローに任せるが、残留しやすいので最低限クリア
      if (infoMessageEl?.textContent === "未保存の変更があります。保存してください。") {
        setInfoMessage("");
      }
      return;
    }

    hasUnsavedChanges = !!flag;

    // Unit-state にも反映（互換性のため既存グローバルは残す）
    try {
      const st = getCurrentUnitState();
      if (st) {
        st.hasUnsavedChanges = !!flag;
        if (flag) st.isSavedAfterLastEdit = false;
      }
    } catch (e) {}

    // ★未保存の変更が入った瞬間に「保存済み」状態を解除する（提出事故防止）
    if (hasUnsavedChanges) {
      hasSavedSnapshot = false;
      // ★修正D：submit判定の正本（uiStateByUnit）も必ず未保存に落とす
    try {
      const uiState = window.getCurrentUIState?.();
      if (uiState) {
        uiState.hasSaved = false;
      }
    } catch (e) {}
    }

    if (hasUnsavedChanges) {
      infoMessageEl?.classList.add("warning-message");
      setInfoMessage("未保存の変更があります。保存してください。");
    } else {
      infoMessageEl?.classList.remove("warning-message");
    }

    // 一時保存ボタンの正本は saveBtn
    if (saveBtn) {
      saveBtn.disabled = !hasUnsavedChanges;
  
      if (saveBtn) {
    saveBtn.disabled = !hasUnsavedChanges; // ★「一時保存」も同じ条件で同期
  }
    }

    // ★提出ボタンUIも即時更新
  // ★提出ボタンUIも即時更新（ただし updateSubmitUI 実行中は再帰を防ぐ）
  try {
    if (window.__inUpdateSubmitUI) return;
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
      // removed debug: empty scoresObj for production
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
    // Disabled in edit-only mode: do not stash current input scores (no drafts).
    return;
  }

  function restoreStashedScores(tbodyEl) {
    // Disabled in edit-only mode: do not restore any stashed/draft inputs.
    return;
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

// ================================
// 修正モード：URL の subjectId を表示に同期
// ================================
if (window.__isEditMode === true) {
  const subjectIdFromUrl =
    new URLSearchParams(location.search).get("subjectId");

  if (
    subjectIdFromUrl &&
    [...subjectSelect.options].some(o => o.value === subjectIdFromUrl)
  ) {
    subjectSelect.value = subjectIdFromUrl;

    // 内部 state / 連動UI を確実に更新
    subjectSelect.dispatchEvent(new Event("change"));

    console.log("[edit-mode] subjectSelect synced:", subjectIdFromUrl);
  }
}


// ★ 修正モードでは科目切り替え禁止
if (window.__isEditMode === true) {
  subjectSelect.disabled = true;
  subjectSelect.title = "修正モードでは科目の切り替えはできません";
} else {
  subjectSelect.disabled = false;
}

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
    return Object.prototype.hasOwnProperty.call(unitsMap, k);
  }

 // function isCompletionOnlySubmission(subjectMeta, subjectDocData) {
    //return (
     // subjectMeta?.specialType === 1 &&
     // subjectDocData?.completion?.isCompleted === true
 //   );
 // }

  function getActiveFilterKey() {
    const v = window.__currentFilterKey;
    if (v == null || v === "") return null;
    return String(v).toLowerCase();
  }


  // ================================
  // 提出済みバナー制御
  // ================================
  function showSubmittedBanner() {
    const banner = document.createElement("div");
    banner.id = "submittedBanner";
    banner.className = "submitted-banner";
    banner.textContent = "このユニットは提出済みです";

    const old = document.getElementById("submittedBanner");
    if (old) old.remove();

    const header = document.querySelector("#appHeader");
    if (!header) return;

    header.insertAdjacentElement("afterend", banner);
  }

  function removeSubmittedBanner() {
    const old = document.getElementById("submittedBanner");
    if (old) old.remove();
  }

  // ================================
  // UI STATE DERIVATION (NO SIDE EFFECTS)
  // ================================
export function deriveUIState() {
  const subject = window.currentSubject || null;
  const meta = window.currentSubjectMeta || {};
  const filterKey = getActiveFilterKey?.(); // "all" etc
  const isSkill = subject?.isSkillLevel === true;
  const isCommon = meta?.isCommon === true;
  const isSpecial = Number(subject?.specialType ?? 0) > 0;

  // ★ 特別科目は ALL表示ロックの対象外
  const isAllView =
    filterKey === "all" &&
    (isSkill === true || (isCommon === true && !isSpecial));

  const rawUnitKey = window.__submissionContext?.unitKey ?? null;

// ★ 単一科目（1・2年 特別科目含む）は __SINGLE__ に正規化
const unitKey = rawUnitKey;

  let isUnitSubmitted = false;
  let isUnitSubmissionKnown = false;

  if (unitKey && window.__latestScoresDocData) {
  const d = window.__latestScoresDocData || {};
  // ★ submitted 判定は isUnitSubmittedByUI に一本化
  const submitted =
    typeof isUnitSubmittedByUI === "function"
      ? isUnitSubmittedByUI(d, unitKey)
      : false;

  // ★ 特別科目の単一科目（1・2年含む）は completion を正とする
  isUnitSubmitted = submitted;
 isUnitSubmissionKnown = true;
}
// ★ 追加：特別科目・単一科目で unitKey が未確定でも completion を優先
if (
  !unitKey &&
  isSpecial === true &&
  window.__latestScoresDocData?.completion?.isCompleted === true
) {
  isUnitSubmitted = true;
  isUnitSubmissionKnown = true;
}


  const completion = window.__latestScoresDocData?.completion || null;
  const isSubjectCompleted = completion?.isCompleted === true;

  // ★ 正本：uiStateByUnit
const ui = window.getCurrentUIState?.(); // ensureUIStateForUnit も内部で呼ばれる
const hasInput = !!ui?.hasInput;
const hasSaved = !!ui?.hasSaved;

// ★ 特別科目は select 初期値があるため「入力あり」として扱う
const effectiveHasInput = isSpecial ? true : hasInput;

const isSpecialSingle =
  isSpecial === true &&
  (String(subject?.grade) === "1" || String(subject?.grade) === "2");

let canSubmit =
  !isAllView &&
  effectiveHasInput === true &&
  hasSaved === true &&
  (
     isSpecialSingle || isUnitSubmitted === false || window.__isEditMode === true
  );



  // deriveUIState: verbose debug logging removed
  // ================================
  // UIメッセージ（statusArea用）確定
  // ※ ここで勝者を1つに決める
  // ================================
  let message = null;

  // ★ 提出済み（最優先）
  // ★ 修正モードでは提出済み文言を一切表示しない
if (window.__isEditMode === true) {
  message = null;
}
else if (isSubjectCompleted === true && unitKey === "__SINGLE__") {
    message = {
      text: "提出済みです。成績修正は別途トップ画面から行ってください。",
      type: "completed",
    };
  }
  else if (isSubjectCompleted === true) {
    message = {
      text: "この科目はすべて提出済みです。",
      type: "completed",
    };
  }
  else if (isUnitSubmitted === true) {
    message = {
      text: "このユニットは提出済みです。",
      type: "submitted",
    };
  }
  // ★ 再提出（修正）モード時は文言を上書き
if (window.__isEditMode === true && message?.type === "completed") {
  message.text = "修正モードです。修正後、再度送信してください。";
}
else if (
  hasSaved === false &&
  isUnitSubmitted === false &&
  isSubjectCompleted === false
) {
  message = {
    text:
      "現在成績は未保存です。一時保存すると途中再開が可能です。※ 教務へ送信するには、全て入力済みの状態で保存が必要です。",
    type: "unsaved",
  };
}

  return {
  subject,
  isSkill,
  isAllView,
  unitKey,
  isUnitSubmitted,          // true / false
  isUnitSubmissionKnown,    // ★ 追加
  isCompleted: isSubjectCompleted, // ★ students.js が参照する名前
  isSubjectCompleted,              // ★ 互換のため残す
  hasInput,
  hasSaved,
  canSubmit,
  message, // ★ 追加
};

}

  // ================================
  // APPLY UI STATE (DOM SIDE EFFECTS)
  // ================================
  

  // ★ 単一科目（選択科目など）判定：学年に依らず unit なし
  function isSingleUnitSubject(meta) {
    if (!meta) return false;

      // ★ 特別科目は単一扱い
  if (Number(meta.specialType ?? 0) > 0) return true;

    // 1) requiredUnits がそもそも無い/空 => 単一扱い
    const ru = meta.requiredUnits;
    if (!Array.isArray(ru) || ru.length === 0) return true;

    // 2) 明示的に __SINGLE__ のみ
    if (ru.length === 1 && String(ru[0]) === "__SINGLE__") return true;

    // 3) 「共通科目」「習熟度」以外は unit なし、という運用ならここで単一扱い
    //    ※あなたの仕様「選択科目は学年に依らず単一科目」をここで確実に拾うため
    const isCommon = !!meta.isCommon;
    const isSkill = !!meta.isSkillLevel;
    if (!isCommon && !isSkill) return true;

    return false;
  }

  // ★ 単一科目用に submissionContext を固定
  function forceSingleSubmissionContext() {
    window.__submissionContext = {
      ...(window.__submissionContext || {}),
      unitKey: "__SINGLE__",
      requiredUnits: ["__SINGLE__"],
    };
  }

// ================================
// UIState: 編集フラグ（初期 false）
// ================================
window.__uiEditState = {
  hasUserEdited: false,
};

// ================================
// UIState: 編集開始通知（初回のみ）
// ================================
window.markInputChanged = function () {
  if (!window.__uiEditState) return;

  // ★ 初回編集のみ true にする
  if (window.__uiEditState.hasUserEdited !== true) {
    window.__uiEditState.hasUserEdited = true;
  }
};


  window.updateSubmitUI = function (_args = {}) {
  if (window.__inUpdateSubmitUI) return;
  window.__inUpdateSubmitUI = true;
  try {
    const uiState = deriveUIState();

     // ================================
    // ★ 科目切替検知：編集フラグをリセット
    // ================================
    const prevSubjectId = window.__prevSubjectId;
    const currentSubjectId = uiState?.subject?.subjectId || null;
    // ================================
// ★ 科目ごとの提出確定フラグを復元（科目切替/再開でも効かせる）
// ================================
try {
  const map = window.__submissionFinalizedBySubject || {};
  window.__submissionFinalized = !!(currentSubjectId && map[currentSubjectId]);
} catch (e) {}


  if (prevSubjectId == null) {
  // 初回は subjectId を記録するだけ（リセットしない）
  window.__prevSubjectId = currentSubjectId;
} else if (prevSubjectId !== currentSubjectId) {
  // 明示的な科目切替時のみリセット
  window.__uiEditState.hasUserEdited = false;
  window.__prevSubjectId = currentSubjectId;
}

    uiState.hasUserEdited = !!window.__uiEditState?.hasUserEdited;
    // ★ UI反映を必ず実行する
    applyStudentUIState(uiState);

    // updateSubmitUI: verbose uiState logging removed
  } finally {
    window.__inUpdateSubmitUI = false;
  }
};


  // snapshot listener のセットアップ関数
function setupScoresSnapshotListener(subjectId) {
    cleanupScoresSnapshotListener();  // 既存のリスナーを削除
    if (!subjectId) return;

    const ref = doc(db, `scores_${currentYear}`, subjectId);  // Firestore から対象のデータを参照
    let initialized = false;

    // Firestore のデータが変更されたときに呼ばれるコールバック
    scoresSnapshotUnsubscribe = onSnapshot(ref, (snapshot) => {
        console.log("[scores snapshot fired]", subjectId);

        // もしスナップショットが無ければ何もしない
        if (!snapshot || !snapshot.exists()) return;

        // Firestore から取得したデータをグローバルに保存
        const data = snapshot.data() || {};
        window.__latestScoresDocData = data;

        // 初回のスナップショット受信時は何もしない（データが初期化されるタイミング）
        if (!initialized) {
            initialized = true;
            return;
        }

        // データが変更された場合に UI を更新する
        updateSubmitUI({ subjectDocData: window.__latestScoresDocData });

        // 他の条件で更新処理を行う（例: 他の教員が更新した場合）
        const currentUserEmail = currentUser?.email || "";
        const updatedBy = data.updatedBy || Object.values(data.students || {}).map(s => s?.updatedBy).find(Boolean);

        // 自分が更新した場合は何もしない
        if (updatedBy === currentUserEmail) return;

        // 自分以外が更新した場合、未保存の変更がある場合は再読み込みを促す
        if (Date.now() - lastSavedByMeAt < 3000) {
            return;
        }

        const ok = !hasUnsavedChanges
            ? true
            : confirm("他の教員がこのクラスの成績を更新しました。\n未保存の入力がありますが、最新を再読み込みしますか？");

        if (ok) {
            currentSubjectId = null;
            handleSubjectChange(subjectId);  // 科目の再読み込み
        } else {
            setInfoMessage("他の教員が更新しました。保存前に再読み込みしてください。");
            infoMessageEl?.classList.add("warning-message");
        }
    });
}


  // ================================
  // 科目選択時の処理
  // ================================
  async function handleSubjectChange(subjectId) {
    const submissionContext = window.__submissionContext;
 
    window.isSubjectChanging = true;

    // =====================================================
    // ★ 前科目の「全員表示ロック」残留を最優先で掃除する
    //  - __currentFilterKey が "all" のまま
    //  - __submissionContext.requiredUnits が複数のまま
    //  が残ると、単一科目でも applyReadOnlyState("all") が誤発火する
    // =====================================================
    window.__currentFilterKey = null;
    window.__lastAppliedUnitKey = null;
     if (!window.__isEditMode) {
   window.__submissionContext = { requiredUnits: [], unitKey: null };
 }

    // ★ 前科目の scoresDoc(completion等) を先に破棄（unlock の誤判定を防ぐ）
    window.__latestScoresDocData = null;

    // ★ 表示・ロック残留の掃除（前科目DOMが残っていても解除する）
    hideAllReadOnlyNotice();
    try { window.updateSubmitUI(); } catch (e) {}
    try { window.updateSubmitUI(); } catch (e) {}

    lastAutoAppliedCommonFilterSubjectId = null;

    setUnsavedChanges(false);

    // ★ Step D-②③
    window.currentUnitKey = null;
    hasSavedSnapshot = false; // ★科目切替直後はいったん未保存扱い（復元でtrueにする）
  
    const subject = findSubjectById(subjectId);

          // ★ ガード：subject が null のまま触らない
      if (!subject) {
        console.error("[handleSubjectChange] subject not found:", subjectId);
        setInfoMessage("科目情報が見つかりません。科目を選び直してください。");
        return;
      }
      // ★ 修正モードでも meta を必ず確定
      currentSubjectMeta = subject;


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
      window.isSubjectChanging = false;
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
    // skip reload for same subjectId (debug log removed)
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
  const isCommon =
    subjectMaster?.required === true &&
    String(subjectId).includes("_G_");

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
   


    if (subject?.required === false) {
      await ensureElectiveRegistrationLoaded(subject);
    }

    if (currentSubjectMeta.isSkillLevel) {
      await ensureSkillLevelsLoaded(subject);
    }
    if (currentSubjectMeta.isSkillLevel) {
      // skill level mode enabled (debug logs removed)
    } else {
      // skill level mode disabled (debug logs removed)
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

 // ===== subjectMeta を必ず確定させる（EDIT/通常 共通ガード）=====
if (!currentSubjectMeta) {
  currentSubjectMeta = subject; // ← Firestore から取得した subject
}

// ===== specialType 判定 =====
const isSpecial =
  currentSubjectMeta && currentSubjectMeta.specialType === 1 ||
  currentSubjectMeta && currentSubjectMeta.specialType === 2;


  if (isSpecial) {
    console.log(
      "[INFO] specialType subject -> skip criteria flow:",
      currentSubjectMeta && currentSubjectMeta.specialType
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
        // cache-hit debug log removed

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

// ================================
// Step3.5（最終）：修正モードでは確定ユニットの学生だけを対象にする
// ================================
if (window.__isEditMode === true) {
  const editUnitKey = submissionContext?.unitKey;

if (currentSubjectMeta?.isCommon === true && editUnitKey) {
  if (Number(currentSubjectMeta.grade) <= 2) {
      // 共通科目（1・2年）：組で限定
      studentState.allStudents = studentState.allStudents.filter(
        (s) => String(s.class) === String(editUnitKey)
      );
    } else {
      // 共通科目（3年以上）：コースで限定
      studentState.allStudents = studentState.allStudents.filter(
        (s) => String(s.course) === String(editUnitKey)
      );
    }
  }
  // 単一科目はフィルタしない
}

try {
  studentState.gradeStudentsCache.set(
    targetGrade,
    studentState.allStudents.slice()
  );
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

    // debug render logs removed
    // 習熟度ソート（isSkillLevel===true時のみ）
    if (currentSubjectMeta.isSkillLevel) {
      displayStudents = sortStudentsBySkillLevel(displayStudents, studentState.skillLevelsMap);
      // debug render logs removed
    }
    await loadScoreVersionBase(subjectId, displayStudents);
    // debug render logs removed


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

      updateSubmitUI({ subjectDocData: window.__latestScoresDocData });

  // ================================
  // ★ 修正③：フィルタ状態の正本を初期化
  // 科目切替時は必ず「全員表示」から開始する
  // ================================
  window.__currentFilterKey =
    (currentSubjectMeta.isCommon || currentSubjectMeta.isSkillLevel)
      ? "all"
      : null;

  // ★ 初回描画直後に状態を確定させる（超重要）
      requestAnimationFrame(() => {
        recalcFinalScoresAfterRestore(tbody);
        syncFinalScoresFromTbody(tbody);
        applyRiskClassesToAllRows();
        updateAveragePointDisplay();
          });

  // ================================
  // STEP1: 提出単位・完了条件の確定
  // （名簿描画が完了した直後）
  // ================================
 if (window.__isEditMode === true && !window.__submissionContext.unitKey) {
  console.error(
    "[FATAL] edit mode but submissionContext.unitKey is null",
    window.__submissionContext
  );
  throw new Error("edit mode requires fixed unitKey");
}

  const resolvedUnitKey =
     window.__isEditMode === true
    ? window.__submissionContext.unitKey
    : resolveCurrentUnitKey({
         grade,
         subjectMeta: currentSubjectMeta,
         visibleStudents: displayStudents
       });
  window.currentUnitKey = resolvedUnitKey;

  // ★ Step D-②②：通常／共通科目 unit の UI 状態を初期化
  ensureUIStateForUnit(resolvedUnitKey);

window.__submissionContext.requiredUnits =
  resolveRequiredUnits({
    grade,
    subjectMeta: currentSubjectMeta
  });

// unitKey は修正モードでは絶対に触らない
if (!window.__isEditMode) {
  window.__submissionContext.unitKey = resolvedUnitKey;
}

  // =====================================================
  // ★ 修正③（念押し）：選択科目は常に単一ユニット
  // =====================================================
  if (subject?.required === false) {
    window.currentUnitKey = "__SINGLE__";
    window.__currentFilterKey = "all";
    window.__submissionContext = {
      requiredUnits: ["__SINGLE__"],
      unitKey: "__SINGLE__",
    };
  }

  // ================================
  // ★ 症状①対策：unit 切替時に送信可否の正本をリセット
  // ================================
  hasSavedSnapshot = false;
  hasUnsavedChanges = false;
  isSavedAfterLastEdit = false;

  // Unit-state も初期化（現在の unit に対して）
  try {
    const st = getCurrentUnitState();
    if (st) {
      st.hasUnsavedChanges = false;
      st.isSavedAfterLastEdit = false;
    }
  } catch (e) {}



  // ================================
  // ★ 修正③：unitKey 切替時の UI 状態再評価
  // ================================
  const unitKey = window.__submissionContext?.unitKey;
  if (unitKey) {
    ensureUIStateForUnit(unitKey);

    const ui = window.uiStateByUnit[unitKey];
    // 🔒 提出済み unit は常に入力なし扱い
    const submitted = isUnitSubmittedByUI(window.__latestScoresDocData, unitKey);
 if (submitted && !window.__isEditMode) {
  ui.hasInput = false;
  ui.hasSaved = false;
} else {
      // 🆕 未提出 unit は「未入力」から必ず始める
      ui.hasInput = false;
      ui.hasSaved = false;
    }
  }



  console.log("[STEP1] submissionContext", window.__submissionContext);

    } finally {
      isRenderingTable = false;
    }
    restoreStashedScores(tbody);
    // --- ★ STEP D: 保存済み scores は取得するが、修正モードでは draft/途中再開を適用しない ---
    try {
      let savedData = null;
      if (scoresCache.has(subjectId)) {
        savedData = scoresCache.get(subjectId);
      } else {
        // still perform Firestore read to satisfy loader responsibilities
        savedData = await loadSavedScoresForSubject(currentYear, subjectId);
        scoresCache.set(subjectId, savedData);
      }

      // In edit-only mode we DO NOT apply saved/draft scores to the input table.
      // Keep temp structures empty and mark that no draft was applied.
      didApplySavedScores = false;
      tempScoresMap.clear();
      excessStudentsState = {};
      excessDirty = false;
      hasSavedSnapshot = false;
      setUnsavedChanges(false);
    } catch (e) {
      console.warn("[WARN] failed to fetch saved scores (ignored in edit mode)", e);
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
    const ui = window.getCurrentUIState?.();
      if (isCurrentUnitSubmitted() && !window.__isEditMode) return;
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
    
      if (ui && !isCurrentUnitSubmitted()) {
        ui.hasInput = true;
      }

      // ★ Step D-③③：提出済みなら編集禁止

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
  if (
  window.__isEditMode === true ||   
    isSpecial ||
    currentSubjectMeta.isSkillLevel ||
  subject?.required === false   // ★ 選択科目は単一
  ) {
    // ユニットUIなし
  } else {
    renderGroupOrCourseFilter(subject);
  }


  if (
    !isSpecial &&
    !currentSubjectMeta.isSkillLevel &&
    subject?.required !== false &&   // ★ 選択科目は除外
    currentSubjectMeta?.isCommon === true &&
    lastAutoAppliedCommonFilterSubjectId !== subjectId
  ) {
    lastAutoAppliedCommonFilterSubjectId = subjectId;
    applyGroupOrCourseFilter(subject, "all");
  }

    recalcFinalScoresAfterRestore(tbody);

    // ★途中再開直後・描画直後に一括適用（Firestore readなし）
  applyRiskClassesToAllRows();
  // removed dev logs: FINAL META / test marker
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

  // 最終表示制御は `updateSubmitUI` に一本化する
  try {
    updateSubmitUI({ subjectDocData: window.__latestScoresDocData });
  } catch (e) {
    console.warn('[handleSubjectChange] updateSubmitUI failed', e);
  }

  window.isSubjectChanging = false;

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
          
          return false;
        }
      },
      true // ★ capture=true（これが無いと意味がない）
    );
  })();

// ② 教務送信 確認モーダル制御（← これを追加）
(() => {
  const submitBtn = document.getElementById("submitScoresBtn");
  const modal = document.getElementById("submitConfirmModal");
  const okBtn = document.getElementById("submitConfirmOkBtn");
  const cancelBtn = document.getElementById("submitConfirmCancelBtn");

  if (!submitBtn || !modal || !okBtn || !cancelBtn) return;

  submitBtn.addEventListener("click", () => {
    modal.classList.remove("hidden");
  });

  cancelBtn.addEventListener("click", () => {
    modal.classList.add("hidden");
  });

  okBtn.addEventListener("click", async () => {
    modal.classList.add("hidden");
    await window.submitScoresForSubject();
  });
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

  // ================================
  // ★ Step C-②: UI復元用 正本スナップショットを更新
  // （再描画後の applySavedScoresToTable がこれを最優先で使う）
  // ================================
  window.__latestSavedSnapshot ??= {};
  window.__latestSavedSnapshot.students ??= {};
  window.__latestSavedSnapshot.students[sid] = {
    scores: scoresObj || {},
    version: baseVersion + 1,
    updatedAt: Date.now(),
    updatedBy: email,
  };
 // 送信後に即座に送信ボタンをロック
  
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
  // ================================
  // ★ Step C-②: UI復元用 正本スナップショットを更新（bulk）
  // ================================
  window.__latestSavedSnapshot ??= {};
  window.__latestSavedSnapshot.students ??= {};
  for (const sid of studentIds) {
    // bulkScores[sid] の中身は { scores: {...} } で来ている前提
    const row = bulkScores[sid] || {};
    window.__latestSavedSnapshot.students[sid] = {
      ...row,
      version: scoreVersionBaseMap.get(sid) ?? 0,
      updatedAt: Date.now(),
      updatedBy: email,
    };
  }
    if (excessDirty) {
      excessDirty = false;
    }
      // 送信後に即座に送信ボタンをロック
 
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
  // =====================================================
  // renderGroupOrCourseFilter
  // フェーズ2：フィルタUI構造のみを決める正本
  //  - 単一科目：フィルタUIなし
  //  - 共通／習熟度：フィルタUIあり、初期は「全員」
  // ※ ここでは入力可否・ロック・提出済みは一切触らない
  // =====================================================
  function renderGroupOrCourseFilter(subject) {
    const area = document.getElementById("groupFilterArea");
    if (!area) return;

    // いったんクリア
    area.innerHTML = "";

    if (!subject) return;

    const grade = String(subject.grade || "");
    const course = String(subject.course || "").toUpperCase();

  // -----------------------------------------------
// 単一科目判定
// ・選択科目は学年に依らず単一
// ・共通(G/COMMON) 以外は単一として扱う
// ・★特別科目(specialType>0) も単一として扱う
// -----------------------------------------------
const isCommon = (!course || course === "G" || course === "COMMON");
const isSpecial = Number(subject?.specialType ?? 0) > 0;
const isSingle = !isCommon || isSpecial;

// 単一科目：フィルタUIを出さない（ここで終了）
if (isSingle) {
  window.__currentFilterKey = null;

  window.__submissionContext = window.__submissionContext || {};
  window.__submissionContext.requiredUnits = ["__SINGLE__"];

  // ★ 修正モードでは unitKey を絶対に触らない
  if (window.__isEditMode !== true) {
    window.__submissionContext.unitKey = "__SINGLE__";
  }
  return;
}



    // -----------------------------------------------
    // 共通／習熟度科目：フィルタUIを構築
    // 初期表示は必ず「全員」
    // -----------------------------------------------

    let filters = [];
    if (grade === "1" || grade === "2") {
      // 1・2年：組フィルタ
      filters = ["all", "1", "2", "3", "4", "5"];
    } else {
      // 3年以上：コースフィルタ
      filters = ["all", "M", "E", "I", "C", "A"];
    }

    const container = document.createElement("div");
    container.className = "filter-button-group";

    filters.forEach((key) => {
      const btn = document.createElement("button");
      btn.className = "filter-btn";
      btn.dataset.filterKey = key;
      btn.textContent = (key === "all") ? "全員" : key;

      // 初期状態は必ず「全員」をアクティブ
      if (key === "all") {
        btn.classList.add("active");
      }

      btn.addEventListener("click", () => {
        // active 切り替え（UI正本）
        container.querySelectorAll(".filter-btn").forEach(b =>
          b.classList.remove("active")
        );
        btn.classList.add("active");

        // フィルタ状態の更新（ロック等は後フェーズ）
        window.__currentFilterKey = key;
        window.__submissionContext = window.__submissionContext || {};
window.__submissionContext.requiredUnits = filters.filter(k => k !== "all");

 
        applyGroupOrCourseFilter(subject, key);
      });

      container.appendChild(btn);
    });

    area.appendChild(container);

// 初期表示：必ず「全員」
window.__currentFilterKey = "all";
window.__submissionContext.requiredUnits =
  filters.filter(k => k !== "all");

// unitKey はここでは一切変更しない
applyGroupOrCourseFilter(subject, "all");

  }


  // ================================
  // STEP C：フィルタ処理本体
  // ================================
  function applyGroupOrCourseFilter(subject, filterKey) {
    window.__currentFilterKey = String(filterKey ?? "all");
  window.__lastAppliedUnitKey = filterKey;
      // ================================
    // ★ 提出済み文言判定用：unitKey の正本を更新
    // ================================
  window.__submissionContext = window.__submissionContext || {};

if (window.__isEditMode !== true) {
  const nextKey = filterKey && filterKey !== "all" ? String(filterKey) : null;
  window.__submissionContext.unitKey = nextKey;
}
      
      

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

      
// === 修正モード：提出済み snapshot を唯一のデータ源にする ===
// ★ 初期表示は filterKey="all" なので、修正モードでは URL の unitKey を使う
const effectiveUnitKey =
  window.__isEditMode === true
    ? window.__submissionContext?.unitKey
    : (filterKey && filterKey !== "all" ? String(filterKey) : null);

const units =
  window.__latestScoresDocData?.submittedSnapshot?.units || {};

const normalizedUnitKey = String(effectiveUnitKey);

const submitted =
  units[normalizedUnitKey] ??
  units[Number(normalizedUnitKey)] ??
  null;

const submittedStudents = submitted?.students;


if (!submitted || !submittedStudents) {
  console.error(
    "[FATAL] submitted snapshot missing",
    {
      normalizedUnitKey,
      unitKeys: Object.keys(units),
      submitted
    }
  );
  alert("提出済みデータが見つかりません。");
  throw new Error(`submitted snapshot missing: unitKey=${normalizedUnitKey}`);
}

// ★ Step C-②: 再描画直後に保存済みスコアを必ず反映
applySavedScoresToTable(submittedStudents, tbody);

  // ★ specialType（習熟度など）の場合は number input 依存の判定をスキップ
  if (!(currentSubjectMeta?.specialType === 1 || currentSubjectMeta?.specialType === 2)) {
    
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


      // ★ 最終的なボタン状態は updateSubmitUI に一本化
      updateSubmitUI({ subjectDocData: window.__latestScoresDocData });

      // 再計算 + 行ハイライト適用
      applyRiskClassesToAllRows();
      window.updateSubmitUI();
    });

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
      // 成績入力期間外は途中再開（モーダル内の続行）を無効化
      if (window.__isInputPeriod === false) {
        continueBtn.disabled = true;
        continueBtn.classList.add("is-disabled");
        continueBtn.title = "成績入力期間外のため再開できません";
      }

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
          console.log("[SAVE] rows length", rows.length);
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
            if (currentSubjectMeta && currentSubjectMeta.specialType === 1) {
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

          console.log("[SAVE] bulkScores keys", Object.keys(bulkScores));

          const saveCount = Object.keys(bulkScores).length;
          if (saveCount === 0 && !excessDirty) {
            showSaveSuccessToast();
            setInfoMessage(`保存しました（0件）`);
            setUnsavedChanges(false);
// ★ ① 0件保存でも「編集済み」扱い
window.__uiEditState.hasUserEdited = true;

// ★ ② 保存状態を更新
isSavedAfterLastEdit = true;
hasSavedSnapshot = true; // ★0件でも「保存済み」状態にする
try {
  const st = getCurrentUnitState();
  if (st) {
    st.isSavedAfterLastEdit = true;
    st.hasUnsavedChanges = false;
  }
} catch (e) {}

// ★ ③ UI を再評価してから return
window.updateSubmitUI?.();
return;

          }

          try {
            console.log("[SAVE] calling saveBulkStudentScores");
            await saveBulkStudentScores(bulkScores);
            
              const ui = window.getCurrentUIState?.();
            if (ui) {
            ui.hasSaved = true;
           }
            
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
  

 // ★ ① 先に「編集済み」を立てる（特別科目対応）
window.__uiEditState.hasUserEdited = true;

// ★ ② 保存状態を更新
isSavedAfterLastEdit = true;   // ★これがないと再提出が壊れる
hasSavedSnapshot = true;      // ★提出判定用
try {
  const st = getCurrentUnitState();
  if (st) {
    st.isSavedAfterLastEdit = true;
    st.hasUnsavedChanges = false;
  }
} catch (e) {}

// ★ ③ 最後に UI を再評価
window.updateSubmitUI?.();

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
    console.log("[edit_loader] before renderEditModeNotice");
    console.log("🔥 about to call renderEditModeNoticeOnce");
    
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
  // ★ 特別科目は常に単一
  if (Number(subjectMeta?.specialType ?? 0) > 0) {
    return ["__SINGLE__"];
  }

  // 非共通・非共通選択
  if (!subjectMeta?.isCommon) {
    return ["__SINGLE__"];
  }

  // 共通・共通選択
  if (Number(grade) <= 2) {
    // 1・2年 共通
    return ["1", "2", "3", "4", "5"];
  }

  // 3年以上 共通（C と A を分離）
  return ["M", "E", "I", "C", "A"];
}

  // ⚠️ 注意
  // resolveCurrentUnitKey は「初期表示・unitKey未確定時」専用。
  // window.__submissionContext.unitKey が存在する場合は
  // この関数を使ってはいけない。
  function resolveCurrentUnitKey({ grade, subjectMeta, visibleStudents }) {
      // ================================
  // ★ 修正モードでは unitKey を再解決しない
  // ================================
  if (window.__isEditMode === true) {
    return window.__submissionContext?.unitKey ?? null;
  }
    
    
    // ================================
    // ★ まず UI フィルタを正本にする（全科目共通）
    // ================================
    const activeBtn =
      document.querySelector("#groupFilterArea .filter-btn.active");
    const uiKey = activeBtn?.dataset?.filterKey;

    if (uiKey && uiKey !== "all") {
      // 習熟度：S / A1 / A2 / A3
      if (subjectMeta?.isSkillLevel === true) {
        return uiKey ? String(uiKey).toUpperCase() : null;
      }

      // 通常科目：M / E / I / CA
      return uiKey ? String(uiKey).toUpperCase() : null;
    }

    // ================================
    // ★ 以下はフォールバック（原則ここには来ない）
    // ================================
    if (!visibleStudents || visibleStudents.length === 0) return null;

    const first = visibleStudents[0] || {};

    if (Number(grade) <= 2) {
      const g =
        first.classGroup ??
        first.courseClass ??
        first.group ??
        first.class ??
        "";
      return g ? String(g) : null;
    }

    const c = String(first.courseClass ?? first.course ?? "").toUpperCase();
    if (!c) return null;

    if (subjectMeta?.isCommon && (c === "C" || c === "A")) return c;
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
    // confirmElectiveChange: removed verbose debug logs

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

    // selectedIds debug log removed
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
    // Firestore path debug log removed

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
      // Disabled in edit-only mode: do not apply saved/draft scores to the input table.
      // Keep function signature to avoid breaking callers, but make it a no-op.
      return;
  if (!submitted) return false;

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

  const required = completion.requiredUnits || [];
  const completed = completion.completedUnits || [];

  // ================================
  // ★ 単一科目（特別科目）
  // ================================
  // completedUnits に "__SINGLE__" があれば完了
  if (completed.includes("__SINGLE__")) {
    return true;
  }

  // ================================
  // ★ requiredUnits が無い場合
  // ================================
  if (!Array.isArray(required) || required.length === 0) {
    return completion.isCompleted === true;
  }

  // ================================
  // ★ 共通科目（複数ユニット）
  // ================================
  return required.every(unit => completed.includes(unit));
}

// ================================
// 修正モード起動（subjectSelect を使わない）
// ================================
// 既存の auth を使う（再宣言しない）
onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  console.log("🚀 start edit initialization (auth ready)");

  // ★ ① URL由来 unitKey を最初に確定
  const fixedUnitKey = String(unitKeyFromUrl);

  window.__editTargetUnitKey = fixedUnitKey;

 window.__editTargetUnitKey = fixedUnitKey;

// ★ submissionContext が未初期化なら最低限だけ補う
window.__submissionContext = window.__submissionContext || {};
window.__submissionContext.unitKey = fixedUnitKey;

// requiredUnits はここでは触らない（STEP1で確定させる）
window.__currentFilterKey = "all"; // UIは常に all から


  // ★ ② その状態で科目ロード
  await loadTeacherSubjects(user);

  // ★ ③ unitKey が確定した状態で handleSubjectChange
  await handleSubjectChange(subjectId);

  console.log("✅ edit initialization done");
  renderEditModeNoticeOnce();
  lockSubjectSelectInEditMode();
  lockUnitButtonsInEditMode();
});




