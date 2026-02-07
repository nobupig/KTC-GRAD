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
  document.body.classList.add("edit-mode");
  const ctx = getEditContext();

  if (!ctx) {
    console.warn("[EDIT] editContext not found");
    safeRedirect("start.html");
    return;
  }
  // ★ 年度（4/1〜3/31）に正規化
ctx.year = Number(ctx.year) || getSchoolYearFromDate();
  console.log("🛠 [EDIT MODE] context =", ctx);

  window.__isEditMode = true;
  window.__submissionContext = ctx;


  document.querySelectorAll(".edit-only").forEach(el => {
  el.style.display = "";
});

  const title = document.getElementById("editSubjectDisplay");
  if (title) title.textContent = `対象科目：${ctx.subjectId}`;

const crit = await fetchEvaluationCriteria(ctx);
window.__editCriteria = crit; // { raw, items } を保持
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

function getConvertedMax(item) {
  const rawMax = Number(item?.maxScore ?? 100);
  const percent = Number(item?.percent ?? 0);
  return Math.floor(rawMax * (percent / 100));
}

function recalcFinalScoreFromConvertedScores(scoresObj) {
  const sum = Object.values(scoresObj || {})
    .filter((v) => typeof v === "number" && !Number.isNaN(v))
    .reduce((a, b) => a + b, 0);
  return Math.floor(sum);
}

/* ========= Firestore snapshot ========= */
function startSnapshot(ctx) {
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
      const v = Number(inp.value);
      scores[key] = Number.isFinite(v) ? v : 0;
    });

    const finalVal = recalcFinalScoreFromConvertedScores(scores);
    const finalEl = panel.querySelector(`.edit-finalScore[data-sid="${sid}"]`);
    if (finalEl) finalEl.value = String(finalVal);
  });
}
/* ========= snapshot → DOM ========= */
async function renderEditFromSnapshot(data, ctx) {
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
  
  window.__editOriginalStudents = mergedStudents; // 元の学生データ（version等を継承）
  const profiles = await fetchStudentSnapshots(sids, ctx.year);

  tbody.innerHTML = "";

  if (sids.length === 0) {
    tbody.innerHTML = `<tr><td colspan="2">学生データがありません</td></tr>`;
    return;
  }

  sids.sort((a, b) => Number(a) - Number(b));

  for (const sid of sids) {
    const scoreObj = mergedStudents[sid] ?? {};
    const p = profiles[sid] || {};

   
   const critItems = window.__editCriteria?.items || [];
const scoreMap = scoreObj?.scores || {};
const isOver = !!scoreObj?.isOver;
const isRed = !!scoreObj?.isRed;

// scores は「換算後点数」を編集する前提
// finalScore は自動再計算（小数切り捨て）
let convertedScores = {};
for (const item of critItems) {
  const name = String(item?.name ?? "").trim();
  if (!name) continue;
  const v = scoreMap[name];
  convertedScores[name] = (typeof v === "number" && !Number.isNaN(v)) ? v : 0;
}
const autoFinal = recalcFinalScoreFromConvertedScores(convertedScores);

const row = document.createElement("div");
row.className = "edit-row compact";

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
        const convMax = getConvertedMax(item);
        const val = convertedScores[name] ?? 0;
        return `
          <div class="score-item-row compact">
            <span class="score-item-name">${name}</span>
            <span class="score-item-meta">${percent}%｜最大${convMax}点</span>
            <input
              type="number"
              class="edit-score-input"
              data-sid="${sid}"
              data-item="${name}"
              min="0"
              max="${convMax}"
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
      const v = Number(inp.value);
      scores[key] = Number.isFinite(v) ? v : 0;
    });

    const finalEl = panel.querySelector(`.edit-finalScore[data-sid="${sid}"]`);
    const finalScore = finalEl ? Number(finalEl.value) : recalcFinalScoreFromConvertedScores(scores);

    
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

  await updateDoc(ref, {
    // ① 修正履歴（スナップショット）
    submittedSnapshot: {
      units: {
        ...units,
        [unitKeyForFs]: {
          students,
          savedAt: serverTimestamp(),
          savedBy: auth.currentUser.email,
          isEdit: true,
        },
      },
    },

    // ② ★最終確定成績（ここが重要）
    students: {
      ...(current.students || {}),
      ...students, // ← 修正した学生だけ上書き
    },

    updatedAt: serverTimestamp(),
  });

  alert("修正内容を保存しました（最終成績も更新済み）");
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
  initEditMode();
  // --- UI 表示制御（Step3-A） ---

const editWrapper = document.getElementById("editSimpleTableWrapper");
if (editWrapper) editWrapper.style.display = "block";

const editSaveBtn = document.getElementById("editSaveBtn");
if (editSaveBtn) editSaveBtn.style.display = "inline-block";

const editSubmitBtn = document.getElementById("editSubmitBtn");
if (editSubmitBtn) editSubmitBtn.style.display = "inline-block";

// 修正モード注意文（上部）を表示
const notice = document.getElementById("editNoticeArea");
if (notice) {
  notice.style.display = "block";
}

})();