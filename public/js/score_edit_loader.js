/*************************************************
 * 修正モード専用・最小JS（保存処理 完全統合版）
 *************************************************/
import { auth, db } from "/js/firebase_init.js";
import {
  doc,
  onSnapshot,
  getDoc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

// ===============================
// redirect ガード（多重遷移防止）
// ===============================
let __redirected = false;
function safeRedirect(url) {
  if (__redirected) return;
  __redirected = true;
  console.warn("[NAV] redirect =>", url);
  location.href = url;
}

/* ========= editContext ========= */
function getEditContext() {
  const raw = sessionStorage.getItem("editContext");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error("[EDIT] invalid editContext", e);
    return null;
  }
}

function getSchoolYearFromDate(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1; // 1-12
  return m >= 4 ? y : y - 1;
}

/* ========= unitKey 正規化 ========= */
function normalizeUnitKey(k) {
  if (k == null) return "";
  return String(k)
    .trim()
    .replaceAll("＿", "_")
    .replaceAll("　", " ");
}



/* ========= 修正モード初期化 ========= */// Firestore保存用 unitKey 変換
function toFirestoreUnitKey(unitKey) {
  if (!unitKey) return "";
  return String(unitKey)
    .trim()
    .replace(/^__/, "")
    .replace(/__$/, "");
}
async function initEditMode() {
  const ctx = getEditContext();

  // ★ 修正モードでなければ何もしない（最重要）
   if (!ctx || ctx.editMode !== true) {
    console.log("[EDIT MODE] skip init (normal view)");
    return;
  }

  // ★ ここから先は「修正モード確定」
  document.body.classList.add("edit-mode");

  // 年度（4/1〜3/31）に正規化
  ctx.year = Number(ctx.year) || getSchoolYearFromDate();
  console.log("🛠 [EDIT MODE] context =", ctx);

  window.__isEditMode = true;
  window.__submissionContext = ctx;

  // 修正モード専用UIを表示
  document.querySelectorAll(".edit-only").forEach(el => {
    el.style.display = "";
  });

  const title = document.getElementById("editSubjectDisplay");
  if (title) title.textContent = `対象科目：${ctx.subjectId}`;

  const crit = await fetchEvaluationCriteria(ctx);
  window.__editCriteria = crit;

  // ★ 修正モードでのみ実行
  startSnapshot(ctx);
  bindSaveButton();
  bindEditScoreInputHandler();
}


/* ========= evaluationCriteria ========= */
async function fetchEvaluationCriteria(ctx) {
  const ref = doc(db, `evaluationCriteria_${ctx.year}`, ctx.subjectId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error(`evaluationCriteria_${ctx.year} に科目 ${ctx.subjectId} が存在しません`);
  }
  const data = snap.data() || {};
  const items = Array.isArray(data.items) ? data.items : [];
  return { raw: data, items };
}

 function recalcFinalScoreFromRawScores(rawScores, criteriaItems) {
  let sumWeighted = 0;

  // --- ① percent 合計を算出 ---
  let totalPercent = 0;
  for (const item of criteriaItems || []) {
    const p = Number(item?.percent ?? 0);
    if (Number.isFinite(p)) totalPercent += p;
  }

  // --- ② 正規化係数（100%に補正） ---
  const factor = totalPercent > 0 ? 100 / totalPercent : 0;

  // --- ③ 正規化後 percent で比率計算 ---
  for (const item of criteriaItems || []) {
    const name = String(item?.name ?? "").trim();
    if (!name) continue;

    const raw = Number(rawScores?.[name]);
    if (!Number.isFinite(raw)) continue;

    const max = Number(item?.maxScore ?? 100);
    const percent = Number(item?.percent ?? 0) * factor;

    sumWeighted += (raw / max) * percent;
  }

  // --- ④ 最終成績：切り捨て ---
  return Math.floor(sumWeighted);
}


/* ========= Firestore snapshot ========= */
function startSnapshot(ctx) {
   if (!ctx || ctx.editMode !== true) {
    console.warn("[EDIT MODE] snapshot skipped (normal view)");
    return;
  }
  const ref = doc(db, `scores_${ctx.year}`, ctx.subjectId);
  console.log("📡 [EDIT MODE] snapshot listen:", ref.path);

  onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    window.__latestScoresDocData = data;
    renderEditFromSnapshot(data, ctx);
  });
}

/* ========= studentSnapshots JOIN ========= */
async function fetchStudentSnapshots(studentIds, year) {
  const results = {};
  for (const sid of studentIds) {
    try {
      const ref = doc(db, `studentSnapshots_${year}`, String(sid));
      const snap = await getDoc(ref);
      if (snap.exists()) results[sid] = snap.data();
    } catch {}
  }
  return results;
}
/* ========= edit input handler ========= */
function bindEditScoreInputHandler() {
  const tbody = document.getElementById("editScoreTableBody");
  if (!tbody) return;
  if (tbody.__editInputBound) return; // 二重防止

  tbody.__editInputBound = true;

  tbody.addEventListener("input", (e) => {
    const t = e.target;
    if (!t || !t.classList) return;
    if (!t.classList.contains("edit-score-input")) return;

    const sid = t.dataset.sid;
    const panel = tbody.querySelector(`.edit-student-panel[data-sid="${sid}"]`);
    if (!panel) return;

    const scores = {};
panel.querySelectorAll(`.edit-score-input[data-sid="${sid}"]`).forEach((inp) => {
  const key = inp.dataset.item;

  // ===============================
  // ① 数字と小数点以外を除去（途中入力も許可）
  // ===============================
  let raw = String(inp.value ?? "");
  raw = raw.replace(/[^0-9.]/g, "");

  // 小数点は1つまで
  const parts = raw.split(".");
  if (parts.length > 2) {
    raw = parts[0] + "." + parts.slice(1).join("");
  }

  // ★ 途中状態は value を上書きしない（ここが肝）
  // 例: "", ".", "20." は入力継続のため許可
  if (raw === "" || raw === "." || raw.endsWith(".")) {
    inp.value = raw;
    scores[key] = 0; // 計算に入れない（※必要なら前回値保持でもOK）
    return;
  }

  // ===============================
  // ② ここから先は確定数値のみ
  // ===============================
  let v = Number(raw);
  const max = Number(inp.dataset.max);

  if (!Number.isFinite(v)) v = 0;
  if (v < 0) v = 0;
  if (Number.isFinite(max) && max > 0 && v > max) v = max;

  // ★ 確定値のときだけ同期
  inp.value = String(v);
  scores[key] = v;
});

    const finalVal = recalcFinalScoreFromRawScores(
  scores,
  window.__editCriteria.items
);
    const finalEl = panel.querySelector(`.edit-finalScore[data-sid="${sid}"]`);
    if (finalEl) finalEl.value = String(finalVal);
  });
}
/* ========= snapshot → DOM ========= */
async function renderEditFromSnapshot(data, ctx) {
    if (!ctx || ctx.editMode !== true) {
    console.warn("[EDIT MODE] render skipped (normal view)");
    return;
  }
  const tbody = document.getElementById("editScoreTableBody");
  if (!tbody) return;

  const units = data?.submittedSnapshot?.units || {};
  const ctxUnit = normalizeUnitKey(ctx.unitKey);

  let mergedStudents = {};
  if (units[ctxUnit]?.students) {
    mergedStudents = units[ctxUnit].students;
  } else {
    for (const u of Object.values(units)) {
      Object.assign(mergedStudents, u.students || {});
    }
  }

  if (Object.keys(mergedStudents).length === 0) {
    mergedStudents = data.students || {};
  }

 const sids = Object.keys(mergedStudents);

// --- 修正モード：初回のみ学生選択モーダル ---
if (
  window.__isEditMode &&
  !window.__editTargetModalOpened &&
  !window.__editTargetStudentIds
) {
  // ★ ローディング表示
  showLoadingToast("学生情報を読み込んでいます…");

  // ★ プロフィール取得
  const profiles = await fetchStudentSnapshots(sids, ctx.year);

  const modalStudents = sids.map(sid => {
    const p = profiles[sid] || {};
    return {
      sid,

      // ★ 学年は含めない（表示用）
      groupCourse: p.courseClass ?? p.course ?? "",

      number: Number(p.number ?? 0),
      name: p.name ?? ""
    };
  });

  // ===============================
  // 並び順制御（完成版）
  // 優先順：組(1-5) → コース(M,E,I,C,A) → 番号
  // ===============================
  const GROUP_ORDER = ["1", "2", "3", "4", "5"];
  const COURSE_ORDER = ["M", "E", "I", "C", "A"];

  modalStudents.sort((a, b) => {
    const ga = String(a.groupCourse ?? "");
    const gb = String(b.groupCourse ?? "");

    // ① 組（1〜5）
    const gi = GROUP_ORDER.indexOf(ga);
    const gj = GROUP_ORDER.indexOf(gb);
    if (gi !== gj) {
      return (gi === -1 ? 999 : gi) - (gj === -1 ? 999 : gj);
    }

    // ② コース（M/E/I/C/A）
    const ci = COURSE_ORDER.indexOf(ga);
    const cj = COURSE_ORDER.indexOf(gb);
    if (ci !== cj) {
      return (ci === -1 ? 999 : ci) - (cj === -1 ? 999 : cj);
    }

    // ③ 番号順
    return Number(a.number ?? 0) - Number(b.number ?? 0);
  });

  // ★ ローディング解除 → モーダル表示
  hideLoadingToast();

  openEditTargetSelectModal(modalStudents);
  window.__editTargetModalOpened = true;
  return; // ← ここ超重要（以降の描画を止める）
}

// --- 選択された学生だけに絞る ---
let displaySids = sids;
if (Array.isArray(window.__editTargetStudentIds)) {
  displaySids = sids.filter(sid =>
    window.__editTargetStudentIds.includes(String(sid))
  );
}

  window.__editOriginalStudents = mergedStudents; // 元の学生データ（version等を継承）
  const profiles = await fetchStudentSnapshots(displaySids, ctx.year);

  tbody.innerHTML = "";

  if (displaySids.length === 0) {
    tbody.innerHTML = `<tr><td colspan="2">学生データがありません</td></tr>`;
    return;
  }

   displaySids.sort((a, b) => Number(a) - Number(b));
 // ★ 現在表示中の学生を記録
 window.__currentDisplayStudentIds = [...displaySids];

  for (const sid of displaySids) {
    const scoreObj = mergedStudents[sid] ?? {};
    const p = profiles[sid] || {};

   
   const critItems = window.__editCriteria?.items || [];
const scoreMap = scoreObj?.scores || {};

// ★ ここで rawScores を定義（←今回の修正点）
const rawScores = {};
for (const item of critItems) {
  const name = String(item?.name ?? "").trim();
  if (!name) continue;

  const v = scoreMap[name];
  rawScores[name] = (typeof v === "number" && !Number.isNaN(v)) ? v : 0;
}

const autoFinal = recalcFinalScoreFromRawScores(
  rawScores,
  critItems
);

const row = document.createElement("div");
row.className = "edit-row compact edit-student-panel";
row.dataset.sid = sid;

row.innerHTML = `
  <div class="student-cell compact">
    <span class="student-id">${sid}</span>
    <span class="student-meta-inline">
      ${p.grade ? `${p.grade}年` : ""}${p.courseClass ? ` ${p.courseClass}` : ""}
    </span>
    <span class="student-name">${p.name || "氏名不明"}</span>
  </div>

  <div class="score-cell compact">
    <div class="final-score-box">
      <label>
        最終成績 <span class="auto-label">（自動計算）</span>
      </label>
      <input
        type="number"
        class="edit-finalScore"
        data-sid="${sid}"
        value="${autoFinal}"
        readonly
      />
    </div>

    <div class="score-items compact">
      ${critItems.map((item) => {
        const name = String(item?.name ?? "").trim();
        if (!name) return "";
        const percent = Number(item?.percent ?? 0);
        const rawMax = Number(item?.maxScore ?? 100);
        const val = rawScores[name] ?? 0;
        return `
          <div class="score-item-row compact">
            <span class="score-item-name">${name}</span>
          <span class="score-item-meta">${percent}%｜最大${rawMax}点</span>
          <input
  type="text"
  class="edit-score-input"
  inputmode="decimal"
  data-sid="${sid}"
  data-item="${name}"
  data-max="${rawMax}"
  value="${val}"
/>
          </div>
        `;
      }).join("")}
    </div>
  </div>
`;
    document
  .getElementById("editScoreTableBody")
  .appendChild(row);
  }
   

  // --- 入力変更イベント（scores変更 → finalScore再計算） ---
  // 既にバインド済みなら多重登録しない

}

/* ========= textarea → students ========= */
function collectEditedStudents() {
  const result = {};

  document.querySelectorAll(".edit-student-panel[data-sid]").forEach((panel) => {
    const sid = panel.dataset.sid;

    // scores（換算後点数）
    const scores = {};
    panel.querySelectorAll(`.edit-score-input[data-sid="${sid}"]`).forEach((inp) => {
const key = inp.dataset.item;

// ① 文字列の正規化（数字と小数点のみ）
let raw = String(inp.value ?? "");
raw = raw.replace(/[^0-9.]/g, "");
const parts = raw.split(".");
if (parts.length > 2) raw = parts[0] + "." + parts.slice(1).join("");

// ② 途中状態は保存時に未入力扱い（0にする）
if (raw === "" || raw === "." || raw.endsWith(".")) {
  inp.value = "";       // 保存時は確定させない
  scores[key] = 0;
  return;
}

let v = Number(raw);
const max = Number(inp.dataset.max);

if (!Number.isFinite(v)) v = 0;
if (v < 0) v = 0;
if (Number.isFinite(max) && max > 0 && v > max) v = max;

inp.value = String(v);
scores[key] = v;
    });

    const finalEl = panel.querySelector(`.edit-finalScore[data-sid="${sid}"]`);
    const finalScore = recalcFinalScoreFromRawScores(
  scores,
  window.__editCriteria.items
);

    
    // snapshot の学生オブジェクト構造に合わせて構築
    result[sid] = {
      ...(window.__editOriginalStudents?.[sid] || {}),
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser?.email || "",
      
      scores,
      version: Number((window.__editOriginalStudents?.[sid]?.version ?? 0)) + 1,
      finalScore: Math.floor(Number.isFinite(finalScore) ? finalScore : 0),
      
    };
  });

  return result;
}

/* ========= 保存処理（Step②-3 本体） ========= */
async function saveEditedScores() {
  const ctx = window.__submissionContext;
  const students = collectEditedStudents();

  if (!Object.keys(students).length) {
    alert("保存対象の学生がありません");
    return;
  }

  const ref = doc(db, `scores_${ctx.year}`, ctx.subjectId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("scores doc not found");

  const current = snap.data() || {};
  const units = current.submittedSnapshot?.units || {};

  const unitKeyForFs = toFirestoreUnitKey(ctx.unitKey);
  const prevUnitStudents =
    units?.[unitKeyForFs]?.students || {};

  const updatePayload = {
    // --- 確定成績（students）
    students: {
      ...(current.students || {}),
      ...students,
    },
    updatedAt: serverTimestamp(),
  };

  // --- submittedSnapshot（安全なマージ）
  updatePayload[
    `submittedSnapshot.units.${unitKeyForFs}.students`
  ] = {
    ...prevUnitStudents,
    ...students,
  };

  updatePayload[
    `submittedSnapshot.units.${unitKeyForFs}.savedAt`
  ] = serverTimestamp();

  updatePayload[
    `submittedSnapshot.units.${unitKeyForFs}.savedBy`
  ] = auth.currentUser.email;

  updatePayload[
    `submittedSnapshot.units.${unitKeyForFs}.isEdit`
  ] = true;

  await updateDoc(ref, updatePayload);

  alert("修正内容を保存しました（最終成績・スナップショット更新済み）");
}

/* ========= 保存ボタン結線 ========= */
function bindSaveButton() {
  const btn = document.getElementById("editSaveBtn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    try {
      await saveEditedScores();
    } catch (e) {
      console.error("[EDIT SAVE] failed", e);
      alert(e.message || "保存に失敗しました");
    }
  });
}

function bindEditSelectStudentsButton() {
  const btn = document.getElementById("editSelectStudentsBtn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const data = window.__latestScoresDocData;
    const ctx = window.__submissionContext;
    if (!data || !ctx) return;

    const units = data?.submittedSnapshot?.units || {};
    let mergedStudents = {};

    const ctxUnit = normalizeUnitKey(ctx.unitKey);
    if (units[ctxUnit]?.students) {
      mergedStudents = units[ctxUnit].students;
    } else {
      for (const u of Object.values(units)) {
        Object.assign(mergedStudents, u.students || {});
      }
    }

    if (Object.keys(mergedStudents).length === 0) {
      mergedStudents = data.students || {};
    }

    const sids = Object.keys(mergedStudents);

    showLoadingToast("学生情報を読み込んでいます…");
    const profiles = await fetchStudentSnapshots(sids, ctx.year);
    hideLoadingToast();

    const modalStudents = sids.map(sid => {
      const p = profiles[sid] || {};
      return {
        sid,
        groupCourse: p.courseClass ?? p.course ?? "",
        number: Number(p.number ?? 0),
        name: p.name ?? ""
      };
    });

    openEditTargetSelectModal(modalStudents);
  });
}

/* ========= auth 待ち ========= */
function waitForAuthUserStable(timeoutMs = 5000) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) resolve(null);
    }, timeoutMs);

    const unsub = onAuthStateChanged(auth, (user) => {
      if (user && !done) {
        done = true;
        clearTimeout(timer);
        unsub();
        resolve(user);
      }
    });

    if (auth.currentUser && !done) {
      done = true;
      clearTimeout(timer);
      unsub();
      resolve(auth.currentUser);
    }
  });
}

/* ========= 起動 ========= */
(async () => {
  const user = await waitForAuthUserStable();
  if (!user) {
    safeRedirect("index.html");
    return;
  }
  console.log("🔐 auth ready:", user.email);

  const ctx = getEditContext();
  const isEditMode = !!(ctx && ctx.editMode === true);

  if (isEditMode) {
    await initEditMode();

      // ★ 学生の追加・解除ボタンを有効化
     bindEditSelectStudentsButton();

    // --- UI 表示制御（Step3-A） ---（修正モード時だけ）
    const editWrapper = document.getElementById("editSimpleTableWrapper");
    if (editWrapper) editWrapper.style.display = "block";

    const editSaveBtn = document.getElementById("editSaveBtn");
    if (editSaveBtn) editSaveBtn.style.display = "inline-block";

    const editSubmitBtn = document.getElementById("editSubmitBtn");
    if (editSubmitBtn) editSubmitBtn.style.display = "inline-block";

    const notice = document.getElementById("editNoticeArea");
    if (notice) notice.style.display = "block";
  } else {
    console.log("[EDIT MODE] normal view - do nothing");
  }
  bindBackHomeButton();
})();

// ===============================
// 修正モード：ホームへ戻る（確定版）
// ===============================
function bindBackHomeButton() {
  const backBtn = document.getElementById("backHomeBtn");
  if (!backBtn) return;

  backBtn.addEventListener("click", () => {
    // ★ URL パラメータで修正モード戻りを明示
    location.href = "start.html?fromEdit=1";
  });
}


// ================================
// 修正モード：ローディングトースト（中央）
// ================================
function showLoadingToast(message = "読み込み中です…") {
  const toast = document.getElementById("loadingToast");
  if (!toast) return;
  const textEl = toast.querySelector(".text");
  if (textEl) textEl.textContent = message;
  toast.classList.remove("hidden");
}

function hideLoadingToast() {
  const toast = document.getElementById("loadingToast");
  if (!toast) return;
  toast.classList.add("hidden");
}

// ================================
// 修正モード：学生選択モーダル
// ================================
window.__editTargetModalOpened = false;
window.__editTargetStudentIds = null;

function openEditTargetSelectModal(students) {
  const modal = document.getElementById("editTargetSelectModal");
  const tbody = document.getElementById("editTargetTableBody");
  const okBtn = document.getElementById("editTargetOkBtn");
  const cancelBtn = document.getElementById("editTargetCancelBtn");

  tbody.innerHTML = "";

  students.forEach(student => {
    const {
      sid,
      groupCourse,
      number,
      name
    } = student;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <input
   type="checkbox"
   data-sid="${sid}"
   ${window.__currentDisplayStudentIds?.includes(String(sid)) ? "checked" : ""}
   >
      </td>
      <td>${groupCourse ?? ""}</td>
      <td>${number ?? ""}</td>
      <td>${name ?? ""}</td>
    `;
    tbody.appendChild(tr);
  });

  okBtn.onclick = () => {
    const selected = [];
    tbody.querySelectorAll("input[type=checkbox]:checked").forEach(cb => {
      selected.push(String(cb.dataset.sid));
    });

    if (!selected.length) {
      alert("少なくとも1名は選択してください");
      return;
    }

    window.__editTargetStudentIds = selected;
    console.log("修正対象学生ID:", selected);

    modal.style.display = "none";
 // ★ ここが本丸：選択後に即再描画
  if (window.__latestScoresDocData && window.__submissionContext) {
    renderEditFromSnapshot(
      window.__latestScoresDocData,
      window.__submissionContext
    );
  }
};

  cancelBtn.onclick = () => {
    modal.style.display = "none";
  };

  modal.style.display = "flex";
}