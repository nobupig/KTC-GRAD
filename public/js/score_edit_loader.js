/*************************************************
 * 修正モード専用・最小JS（実コード）
 *************************************************/

import { auth, db } from "/js/firebase_init.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
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

/* ========= editContext 読み取り ========= */
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

/* ========= 修正モード初期化 ========= */
async function initEditMode() {
  const ctx = getEditContext();
  if (!ctx) {
    console.warn("[EDIT] editContext not found → redirect");
    location.href = "start.html";
    return;
  }

  console.log("🛠 [EDIT MODE] context =", ctx);

  // グローバル固定（重要）
  window.__isEditMode = true;
  window.__submissionContext = ctx;

  // UI 切替
  document.querySelectorAll(".normal-only").forEach(el => el.style.display = "none");
  document.querySelectorAll(".edit-only").forEach(el => el.style.display = "block");

  const title = document.getElementById("editSubjectDisplay");
  if (title) {
    title.textContent = `対象科目：${ctx.subjectId}`;
  }

  // Firestore snapshot 開始
  startSnapshot(ctx);
}

/* ========= Firestore snapshot ========= */
function startSnapshot(ctx) {
  const { year, subjectId } = ctx;

  const ref = doc(db, `scores_${year}`, subjectId);
  console.log("📡 [EDIT MODE] snapshot listen:", ref.path);

onSnapshot(ref, (snap) => {
  if (!snap.exists()) {
    console.warn("[EDIT MODE] scores doc not found");
    return;
  }

  const data = snap.data();
  console.log("📥 [EDIT MODE] snapshot data =", data);

  // ★ 修正モード用：Firestore の最新スナップショットを保持
  window.__latestScoresDocData = data;

  // ★ ここが軽量化の本体：snapshot → DOM
  renderEditFromSnapshot(data, ctx);
});
}

function normalizeUnitKey(k) {
  if (k == null) return "";
  return String(k).trim()
    .replaceAll("＿", "_")   // 全角っぽいの混入対策（念のため）
    .replaceAll("　", " "); // 全角スペース対策
}

function renderEditFromSnapshot(data, ctx) {
  const tbody = document.getElementById("editScoreTableBody");
  if (!tbody) {
    console.warn("[EDIT MODE] editScoreTableBody not found");
    return;
  }

  const units = data?.submittedSnapshot?.units || {};
  const unitKeys = Object.keys(units).map(normalizeUnitKey);

  const ctxUnit = normalizeUnitKey(ctx?.unitKey);
  console.log("[EDIT MODE] ctx.unitKey =", ctxUnit);
  console.log("[EDIT MODE] submitted units =", unitKeys);

  // 1) まず ctx.unitKey が一致する unit があればそれを採用
  let mergedStudents = {};
  if (ctxUnit && units[ctxUnit]?.students && Object.keys(units[ctxUnit].students).length > 0) {
    mergedStudents = units[ctxUnit].students;
    console.log("[EDIT MODE] use unit students:", ctxUnit);
  } else {
    // 2) ctxUnit が見つからない/空なら、submittedSnapshot.units を全部マージ
    //    （部分提出・複数提出・共通科目の途中状態でもこれが一番安全）
    for (const kRaw of Object.keys(units)) {
      const k = normalizeUnitKey(kRaw);
      const st = units?.[kRaw]?.students || {};
      const sids = Object.keys(st);
      if (sids.length === 0) continue;

      console.log("[EDIT MODE] merge unit:", k, "students:", sids.length);
      for (const sid of sids) mergedStudents[sid] = st[sid];
    }
  }

  // 3) submittedSnapshot に何も無ければ最終 fallback として data.students
  if (Object.keys(mergedStudents).length === 0) {
    console.warn("[EDIT MODE] submittedSnapshot empty → fallback to data.students");
    mergedStudents = data?.students || {};
  }

  const sids = Object.keys(mergedStudents);
  console.log("[EDIT MODE] renderEditFromSnapshot students =", sids);

  tbody.innerHTML = "";

  if (sids.length === 0) {
    tbody.innerHTML = `<tr><td colspan="2">学生データがありません</td></tr>`;
    return;
  }

  // 安定表示のためソート（数値っぽい学籍番号なら数値順）
  sids.sort((a, b) => Number(a) - Number(b));

  for (const sid of sids) {
    const scoresObj = mergedStudents[sid] ?? {};
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${sid}</td>
      <td>
        <textarea data-sid="${sid}" style="width:100%; min-height:80px; font-family: monospace;">${JSON.stringify(scoresObj, null, 2)}</textarea>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

// textarea用（最低限）
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/* ========= auth 待ち ========= */
let authResolved = false;

// ===============================
// Auth 待ち（確定・安全版）
// ===============================
function waitForAuthUserStable(auth, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        console.warn("[AUTH] timeout → user still null");
        resolved = true;
        resolve(null);
      }
    }, timeoutMs);

    const unsub = onAuthStateChanged(auth, (user) => {
      if (user && !resolved) {
        clearTimeout(timer);
        resolved = true;
        unsub();
        resolve(user);
      }
    });

    // ★ すでに復元済みの場合
    if (auth.currentUser && !resolved) {
      clearTimeout(timer);
      resolved = true;
      unsub();
      resolve(auth.currentUser);
    }
  });
}

// ===============================
// 起動
// ===============================
(async () => {
  const user = await waitForAuthUserStable(auth, 5000);

  if (!user) {
    console.warn("[AUTH] user still null → redirect");
    location.href = "index.html";
    return;
  }

  console.log("🔐 auth ready:", user.email);
  initEditMode();
})();

