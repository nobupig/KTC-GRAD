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

// ===============================
// 修正未送信フラグ
// ===============================
window.__editDirty = false;

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

  // ================================
  // ★ 追加：excessStudentsを保持
  // ================================
// ================================
// ★ excessStudents は「初回だけ」Firestoreから初期化する
//   （登録後に onSnapshot でローカルstateが消える事故を防ぐ）
// ================================
if (!window.__editExcessStudentsStateInitialized) {
  window.__editExcessStudentsState =
    data.excessStudents && typeof data.excessStudents === "object"
      ? { ...data.excessStudents }
      : {};
  window.__editExcessStudentsStateInitialized = true;
}

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

// ===============================
// 成績が編集された → 未送信フラグON
// ===============================
window.__editDirty = true;

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


// --- 選択された学生だけに絞る ---
// ===============================
// 修正モード：学生未選択なら描画しない
// ===============================
if (
  window.__isEditMode &&
  !Array.isArray(window.__editTargetStudentIds)
) {
  
  return;
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

  // ★ 表示順を「組・コース → 番号順」に統一
const GROUP_ORDER = ["1", "2", "3", "4", "5"];
const COURSE_ORDER = ["M", "E", "I", "C", "A"];

displaySids.sort((a, b) => {
  const pa = profiles[a] || {};
  const pb = profiles[b] || {};

  const ga = String(pa.courseClass ?? pa.course ?? "");
  const gb = String(pb.courseClass ?? pb.course ?? "");

  // ① 組
  const gi = GROUP_ORDER.indexOf(ga);
  const gj = GROUP_ORDER.indexOf(gb);
  if (gi !== gj) return (gi === -1 ? 999 : gi) - (gj === -1 ? 999 : gj);

  // ② コース
  const ci = COURSE_ORDER.indexOf(ga);
  const cj = COURSE_ORDER.indexOf(gb);
  if (ci !== cj) return (ci === -1 ? 999 : ci) - (cj === -1 ? 999 : cj);

  // ③ 番号
  return Number(pa.number ?? 0) - Number(pb.number ?? 0);
});
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



  const ref = doc(db, `scores_${ctx.year}`, ctx.subjectId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("scores doc not found");

  const current = snap.data() || {};
  // ===============================
// 科目メタ（調整点/固定基準）を先に取得して使い回す
// ===============================
let subjectMeta = {};
try {
  const subjectRef = doc(db, "subjects", ctx.subjectId);
  const subjectSnap = await getDoc(subjectRef);
  if (subjectSnap.exists()) subjectMeta = subjectSnap.data() || {};
} catch (e) {
  console.warn("[EDIT] subject meta fetch failed", e);
}
  // ===============================
// 変更前情報を取得
// ===============================
const beforeStudents = current.students || {};
const beforeExcess = current.excessStudents || {};

const beforeScores = Object.entries(beforeStudents)
  .filter(([sid, s]) => {
    const hours = Number((beforeExcess[sid] && beforeExcess[sid].hours) || 0);
    return !(Number.isFinite(hours) && hours > 0);
  })
  .map(([sid, s]) => Number(s?.finalScore))
  .filter(v => Number.isFinite(v));

const beforeAvg =
  beforeScores.length > 0
    ? beforeScores.reduce((a, b) => a + b, 0) / beforeScores.length
    : null;

// border（変更前）
let beforeBorder = 60;

// 調整点科目（useAdjustment=true）
if (subjectMeta.useAdjustment === true) {
  if (beforeAvg != null) beforeBorder = Math.ceil(beforeAvg * 0.7);
}
// 固定基準（fixedPassLine）
else if (Number.isFinite(Number(subjectMeta.fixedPassLine))) {
  beforeBorder = Number(subjectMeta.fixedPassLine);
}

// ===============================
// 変更前赤点者数を「当時の基準」で再計算
// ===============================
const beforeRedCount = Object.entries(beforeStudents)
  .filter(([sid, s]) => {
    const score = Number(s?.finalScore);
    if (!Number.isFinite(score)) return false;
    return score < beforeBorder;
  })
  .length;
  // ===============================
// 修正対象判定（超過解除 = {} でも差分があれば送信OK）
// ===============================
const newExcess = window.__editExcessStudentsState || {};
const oldExcess = current.excessStudents || {};

// ① 成績修正判定（現状は students が空かどうか）
// ※ 学生選択をしていないと students が空になりやすい
const hasScoreEdit = Object.keys(students).length > 0;

// ② 超過修正判定（差分があるか）
// old/new のキー集合を作って hours の差を比較
let hasExcessEdit = false;
const allIds = new Set([].concat(Object.keys(oldExcess), Object.keys(newExcess)));

allIds.forEach((sid) => {
  const oldHours = Number((oldExcess[sid] && oldExcess[sid].hours) || 0);
  const newHours = Number((newExcess[sid] && newExcess[sid].hours) || 0);
  if (oldHours !== newHours) hasExcessEdit = true;
});

if (!hasScoreEdit && !hasExcessEdit) {
  alert("修正対象がありません");
  return;
}
  
  const units = current.submittedSnapshot?.units || {};

  const unitKeyForFs = toFirestoreUnitKey(ctx.unitKey);
  const prevUnitStudents =
    units?.[unitKeyForFs]?.students || {};

  // ===============================
// 1) ユニット最新学生データ（prev + edited）
// ===============================
// ===============================
// 1) ユニット最新学生データ（prev + edited）
// ===============================
const mergedUnitStudents = {
  ...prevUnitStudents,
  ...students,
};

// ===============================
// 1.5) 科目全体の最新学生データ（current.students を基点に、当該ユニット分を差し替え）
// ===============================
const mergedAllStudents = {
  ...(current.students || {}),
  ...mergedUnitStudents,
};

// ===============================
// 2) 平均点再計算（超過学生は母数から除外）
// ===============================
const excessState = window.__editExcessStudentsState || {};

console.log(
  "[EDIT AVG] excluded excess ids =",
  Object.keys(window.__editExcessStudentsState || {}).filter(function (sid) {
    var state = window.__editExcessStudentsState || {};
    var h = Number((state[sid] && state[sid].hours) || 0);
    return Number.isFinite(h) && h > 0;
  })
);

const numericScores = Object.entries(mergedAllStudents)

  .filter(([sid, s]) => {
    const hours = Number(excessState?.[sid]?.hours || 0);
    const isExcess = Number.isFinite(hours) && hours > 0;
    return !isExcess; // ★超過は除外
  })
  .map(([sid, s]) => Number(s?.finalScore))
  .filter(v => Number.isFinite(v));

const avg =
  numericScores.length > 0
    ? numericScores.reduce((a, b) => a + b, 0) / numericScores.length
    : null;

// ===============================
// 3) 赤点基準決定（subjectMetaを再利用）
// ===============================
let border = 60;

// 調整点科目
if (subjectMeta.useAdjustment === true) {
  if (avg != null) {
    border = Math.ceil(avg * 0.7);
  }
}
// 固定基準
else if (Number.isFinite(Number(subjectMeta.fixedPassLine))) {
  border = Number(subjectMeta.fixedPassLine);
}


// ===============================
// 4) 科目全体の isRed 再評価（赤点は科目全体で更新）
// ===============================
const recalcedAllStudents = {};
Object.entries(mergedAllStudents).forEach(([sid, stu]) => {
  const score = Number(stu?.finalScore);
  const isRed = Number.isFinite(score) && score < border;

  recalcedAllStudents[sid] = {
    ...stu,
    isRed,
  };
});

// ===============================
// 変更後赤点者数（科目全体）
// ===============================
const afterRedCount = Object.values(recalcedAllStudents)
  .filter(s => s?.isRed === true)
  .length;
// ===============================
// 4.5) 当該ユニット分だけ抜き出し（submittedSnapshot.units 用）
// ===============================
const recalcedUnitStudents = {};
Object.keys(mergedUnitStudents).forEach((sid) => {
  recalcedUnitStudents[sid] = recalcedAllStudents[sid] || mergedUnitStudents[sid];
});

// ===============================
// 5) Firestore更新
// ===============================
const updatePayload = {
  updatedAt: serverTimestamp(),
  students: recalcedAllStudents,
};

// ===============================
// 6) 超過学生を保存
// ===============================
updatePayload.excessStudents = {
  ...(window.__editExcessStudentsState || {})
};

updatePayload[`submittedSnapshot.units.${unitKeyForFs}.students`] =
  recalcedUnitStudents;

updatePayload[`submittedSnapshot.units.${unitKeyForFs}.savedAt`] =
  serverTimestamp();

updatePayload[`submittedSnapshot.units.${unitKeyForFs}.savedBy`] =
  auth.currentUser.email;

updatePayload[`submittedSnapshot.units.${unitKeyForFs}.isEdit`] =
  true;

await updateDoc(ref, updatePayload);
window.__editDirty = false; location.href = "start.html?fromEdit=1";
console.log("[EDIT SAVE] excessStudents payload =", updatePayload.excessStudents);

// ===============================
// 保存後メッセージ分岐
// ===============================
let messageBlocks = [];

// 成績変更があったか
const scoreChanged = Object.keys(students).length > 0;

// 超過変更があったか
let excessChanged = false;
const allIds2 = new Set([
  ...Object.keys(beforeExcess),
  ...Object.keys(window.__editExcessStudentsState || {})
]);

allIds2.forEach((sid) => {
  const oldH = Number((beforeExcess[sid] && beforeExcess[sid].hours) || 0);
  const newH = Number((window.__editExcessStudentsState?.[sid]?.hours) || 0);
  if (oldH !== newH) excessChanged = true;
});

// ===============================
// ① 成績のみ修正
// ===============================
if (scoreChanged && !excessChanged) {
  messageBlocks.push(
    `成績修正を完了しました。\n平均点：${beforeAvg?.toFixed(1)} → ${avg?.toFixed(1)}\n赤点基準：${beforeBorder} → ${border}\n赤点者数：${beforeRedCount} → ${afterRedCount}`
  );
}

// ===============================
// ② 超過のみ修正
// ===============================
if (!scoreChanged && excessChanged) {

  const safeBeforeAvg =
  Number.isFinite(beforeAvg) ? Number(beforeAvg.toFixed(1)) : null;

const safeAfterAvg =
  Number.isFinite(avg) ? Number(avg.toFixed(1)) : null;

const avgChanged = safeBeforeAvg !== safeAfterAvg;

  if (!avgChanged) {
    messageBlocks.push("超過登録時間を変更しました。");
  } else {
    messageBlocks.push(
      `超過登録により平均点が変更されました。\n平均点：${beforeAvg?.toFixed(1)} → ${avg?.toFixed(1)}\n赤点基準：${beforeBorder} → ${border}\n赤点者数：${beforeRedCount} → ${afterRedCount}`
    );
  }
}

// ===============================
// ③ 両方修正
// ===============================
if (scoreChanged && excessChanged) {
  messageBlocks.push(
    `成績および超過を修正しました。\n平均点：${beforeAvg?.toFixed(1)} → ${avg?.toFixed(1)}\n赤点基準：${beforeBorder} → ${border}\n赤点者数：${beforeRedCount} → ${afterRedCount}`
  );
}

if (messageBlocks.length === 0) {
  messageBlocks.push("変更はありませんでした。");
}

alert(messageBlocks.join("\n\n"));

  
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

function openEditTargetSelectModal(students) {
  const modal = document.getElementById("editTargetSelectModal");
  const tbody = document.getElementById("editTargetTableBody");
  const okBtn = document.getElementById("editTargetOkBtn");
  const cancelBtn = document.getElementById("editTargetCancelBtn");
  const selectAllBtn = document.getElementById("editTargetSelectAllBtn");
const clearAllBtn = document.getElementById("editTargetClearAllBtn");

if (selectAllBtn) {
  selectAllBtn.onclick = () => {
    tbody.querySelectorAll("input[type=checkbox]").forEach(cb => {
      cb.checked = true;
    });
  };
}

if (clearAllBtn) {
  clearAllBtn.onclick = () => {
    tbody.querySelectorAll("input[type=checkbox]").forEach(cb => {
      cb.checked = false;
    });
  };
}
  tbody.innerHTML = "";

  // ===============================
// モーダル並び順制御
// 組 → コース → 番号
// ===============================
const GROUP_ORDER = ["1", "2", "3", "4", "5"];
const COURSE_ORDER = ["M", "E", "I", "C", "A"];

students.sort((a, b) => {
  const ga = String(a.groupCourse ?? "");
  const gb = String(b.groupCourse ?? "");

  // ① 組
  const gi = GROUP_ORDER.indexOf(ga);
  const gj = GROUP_ORDER.indexOf(gb);
  if (gi !== gj) return (gi === -1 ? 999 : gi) - (gj === -1 ? 999 : gj);

  // ② コース
  const ci = COURSE_ORDER.indexOf(ga);
  const cj = COURSE_ORDER.indexOf(gb);
  if (ci !== cj) return (ci === -1 ? 999 : ci) - (cj === -1 ? 999 : cj);

  // ③ 番号順
  return Number(a.number ?? 0) - Number(b.number ?? 0);
});
  
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

// ================================
// 修正モード：超過モーダル（行生成＋既存超過反映）
// ================================
// ================================
// 修正モード：超過モーダル（科目全学生対象）
// ================================
function bindEditExcessButton() {
    if (window.__editExcessBound) return;
  window.__editExcessBound = true;

  const btn = document.getElementById("editExcessStudentsBtn");
  const modal = document.getElementById("excessStudentModal");
  
  // ★ モーダル外クリック閉鎖を完全ブロック
modal.addEventListener("click", (e) => {
  if (e.target === modal) {
    e.stopPropagation();
    return; // 何もしない
  }
});

  const listArea = document.getElementById("excessStudentListArea");
  const cancelBtn = document.getElementById("excessStudentCancelBtn");
  const registerBtn = document.getElementById("excessStudentRegisterBtn");

  if (!btn || !modal || !listArea) return;

  // 閉じる
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      modal.classList.add("hidden");
    });
  }

registerBtn.addEventListener("click", (e) => {

  e.preventDefault();
  e.stopPropagation();   // ← これが重要

  const rows = Array.from(listArea.querySelectorAll("tr[data-sid]"));
  const newState = {};

  for (let i = 0; i < rows.length; i++) {

    const tr = rows[i];
    const sid = tr.dataset.sid;
    const cb = tr.querySelector(".excess-check");
    const inp = tr.querySelector(".excess-hours");

    const checked = cb && cb.checked;
    const rawVal = inp ? String(inp.value || "").trim() : "";
    const name = tr.children[5] ? tr.children[5].textContent : sid;

    if (checked && rawVal === "") {
      showExcessError(name + " の超過時間数を入力してください");
return;
    }

    if (checked) {
      const hours = Number(rawVal);
      if (!Number.isFinite(hours) || hours <= 0) {
        alert(name + " の超過時間数は1以上の数値を入力してください");
        return;
      }

      newState[sid] = {
        hours: hours,
        updatedAt: new Date(),
        updatedBy: auth.currentUser?.email || ""
      };
    }

    if (!checked && inp) {
      inp.value = "";
    }
  }

  window.__editExcessStudentsState = newState;
  modal.classList.add("hidden");
  window.__editDirty = true;

  alert("超過学生の変更を保持しました。続けて「修正内容を教務へ送信」を押してください。");
});

  // 開く（科目全学生）
  btn.addEventListener("click", async () => {
    const data = window.__latestScoresDocData;
    const ctx = window.__submissionContext;
    if (!data || !ctx) return;

    const units = data?.submittedSnapshot?.units || {};
    let mergedStudents = {};

    for (const u of Object.values(units)) {
      Object.assign(mergedStudents, u.students || {});
    }
    if (Object.keys(mergedStudents).length === 0) {
      mergedStudents = data.students || {};
    }

    const displayIds = Object.keys(mergedStudents);
    
    showLoadingToast("学生情報を読み込んでいます…");
    const profiles = await fetchStudentSnapshots(displayIds, ctx.year);
    hideLoadingToast();
    // ===============================
// 並び順：組(1-5) → コース(M,E,I,C,A) → 番号
// ===============================
const GROUP_ORDER = ["1", "2", "3", "4", "5"];
const COURSE_ORDER = ["M", "E", "I", "C", "A"];

displayIds.sort((a, b) => {

  const pa = profiles[a] || {};
  const pb = profiles[b] || {};

  const ga = String(pa.courseClass || pa.course || "");
  const gb = String(pb.courseClass || pb.course || "");

  // ① 組
  const gi = GROUP_ORDER.indexOf(ga);
  const gj = GROUP_ORDER.indexOf(gb);
  if (gi !== gj) return (gi === -1 ? 999 : gi) - (gj === -1 ? 999 : gj);

  // ② コース
  const ci = COURSE_ORDER.indexOf(ga);
  const cj = COURSE_ORDER.indexOf(gb);
  if (ci !== cj) return (ci === -1 ? 999 : ci) - (cj === -1 ? 999 : cj);

  // ③ 番号
  return Number(pa.number || 0) - Number(pb.number || 0);
});
    const state = window.__editExcessStudentsState || {};
    listArea.innerHTML = "";

    for (const sid of displayIds) {

  const p = profiles[sid] || {};
  const hours = state[sid]?.hours;

  const tr = document.createElement("tr");
  tr.dataset.sid = String(sid);

  tr.innerHTML = `
    <td style="text-align:center;">
      <input type="checkbox" class="excess-check" data-sid="${sid}">
    </td>
    <td>${sid}</td>
    <td>${p.grade ?? ""}</td>
    <td>${p.courseClass ?? p.course ?? ""}</td>
    <td>${p.number ?? ""}</td>
    <td>${p.name ?? ""}</td>
    <td>
      <input type="number" class="excess-hours" data-sid="${sid}" min="0" step="1" style="width:88px;">
    </td>
  `;

  const cb = tr.querySelector(".excess-check");
  const inp = tr.querySelector(".excess-hours");

  // ===============================
  // 初期状態設定
  // ===============================
  if (hours != null) {
    cb.checked = true;
    inp.value = String(hours);
    inp.disabled = false;
  } else {
    cb.checked = false;
    inp.value = "";
    inp.disabled = true;
  }

  // ===============================
  // チェック変更時の制御
  // ===============================
  cb.addEventListener("change", () => {
    if (cb.checked) {
      inp.disabled = false;
      inp.focus();
    } else {
      inp.value = "";
      inp.disabled = true;
    }
  });

  listArea.appendChild(tr);
}

    modal.classList.remove("hidden");
  });
}




// ===============================
// 修正モード：ホームへ戻る（確定版）
// ===============================
function bindBackHomeButton() {
  const backBtn = document.getElementById("backHomeBtn");
  if (!backBtn) return;

backBtn.addEventListener("click", () => {

  if (window.__editDirty) {
    const ok = confirm(
      "⚠ 修正内容が教務送信されていません。\n\nこのまま戻ると変更は保存されません。\n本当に戻りますか？"
    );
    if (!ok) return;
  }

  location.href = "start.html?fromEdit=1";
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

  // ★ 超過モーダル（科目全学生）を有効化
  bindEditExcessButton();

  // ★ ホームへ戻るボタンを有効化
  bindBackHomeButton();

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

// ================================
// 修正モード：学生選択モーダル
// ================================
window.__editTargetModalOpened = false;
window.__editTargetStudentIds = null;


})(); 

// ===============================
// ページ離脱防止（タブ閉じる / リロード / 戻る）
// ===============================
window.addEventListener("beforeunload", function (e) {
  if (!window.__editDirty) return;

  e.preventDefault();
  e.returnValue = "";
});

function showExcessError(message) {
  const modal = document.getElementById("saveErrorModal");
  const msg = modal.querySelector(".modal-message");
  const okBtn = document.getElementById("saveErrorOkBtn");

  if (!modal || !msg) return;

  msg.innerHTML = message;
  modal.classList.remove("hidden");

  okBtn.onclick = () => {
    modal.classList.add("hidden");
  };
}