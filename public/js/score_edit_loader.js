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
  if (!ctx) {
    console.warn("[EDIT] editContext not found");
    safeRedirect("start.html");
    return;
  }

  console.log("🛠 [EDIT MODE] context =", ctx);

  window.__isEditMode = true;
  window.__submissionContext = ctx;

  document.querySelectorAll(".normal-only").forEach(el => el.style.display = "none");
  document.querySelectorAll(".edit-only").forEach(el => el.style.display = "block");

  const title = document.getElementById("editSubjectDisplay");
  if (title) title.textContent = `対象科目：${ctx.subjectId}`;

  startSnapshot(ctx);
  bindSaveButton();
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
async function fetchStudentSnapshots(studentIds) {
  const results = {};
  for (const sid of studentIds) {
    try {
      const ref = doc(db, "studentSnapshots_2025", String(sid));
      const snap = await getDoc(ref);
      if (snap.exists()) results[sid] = snap.data();
    } catch {}
  }
  return results;
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
  const profiles = await fetchStudentSnapshots(sids);

  tbody.innerHTML = "";

  if (sids.length === 0) {
    tbody.innerHTML = `<tr><td colspan="2">学生データがありません</td></tr>`;
    return;
  }

  sids.sort((a, b) => Number(a) - Number(b));

  for (const sid of sids) {
    const scoreObj = mergedStudents[sid] ?? {};
    const p = profiles[sid] || {};

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div style="font-weight:600;">${sid}</div>
        <div style="font-size:0.85rem; color:#555;">
          ${(p.name || "氏名不明")}
          ${p.grade ? ` / ${p.grade}年` : ""}
          ${p.courseClass ? ` ${p.courseClass}` : ""}
        </div>
      </td>
      <td>
        <textarea
          data-sid="${sid}"
          style="width:100%; min-height:80px; font-family:monospace;"
        >${JSON.stringify(scoreObj, null, 2)}</textarea>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

/* ========= textarea → students ========= */
function collectEditedStudents() {
  const result = {};
  document.querySelectorAll("textarea[data-sid]").forEach((ta) => {
    const sid = ta.dataset.sid;
    const raw = ta.value.trim();
    if (!raw) return;
    try {
      result[sid] = JSON.parse(raw);
    } catch {
      throw new Error(`JSON形式エラー：学籍番号 ${sid}`);
    }
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
})();