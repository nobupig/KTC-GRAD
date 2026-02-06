// ================================
// Firebase 初期化（既存設定を流用）
// ================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getFirestore, getDoc, doc, collection, getDocs } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { renderUnitList, renderStudentTable } from "./score_edit_view.js";

let CAN_EDIT = false;

// ================================
// 修正モード用 状態管理
// ================================
let allStudents = [];          // 全学生（読み取り専用）
let selectedStudentIds = [];   // 修正対象（studentNo）
let currentSubjectName = "";
// ★ 教務（期間外でも修正できる人）を明示
// ※ 必要なら追加してください（@ktc.ac.jp の教務担当）
const ADMIN_EMAILS = [
  "nyasui@ktc.ac.jp",
  // "xxx@ktc.ac.jp",
];

const firebaseConfig = {
  apiKey: "AIzaSyB-ykIzRvYbc5osV6WATu6BSOJt_zlHkgM",
  authDomain: "ktc-grade-system.web.app",
  projectId: "ktc-grade-system",
  storageBucket: "ktc-grade-system.appspot.com",
  messagingSenderId: "490169300362",
  appId: "1:490169300362:web:7c6e7b47a394d68d514473",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ================================
// URL から subjectId 取得（必須）
// ※ subjectId は scores_YYYY の docId を想定
// ================================
const params = new URLSearchParams(location.search);
const subjectId = params.get("subjectId");

if (!subjectId) {
  alert("subjectId が指定されていません。");
  location.href = "/";
  throw new Error("subjectId missing");
}

// ================================
// 認証 → 入口制御 → 期間判定 → 権限判定 → scores読取 → 描画
// ================================
onAuthStateChanged(auth, async (user) => {
  if (!user) return;
 const isAdmin = ADMIN_EMAILS.includes(user.email);
  // ================================
  // 修正モード入口制御
  // 教務は bypass、教員はトップ画面経由必須
  // ================================
  if (!isAdmin && sessionStorage.getItem("editEntry") !== "true") {
    alert("この画面にはトップ画面からのみアクセスできます。");
    location.href = "/start.html";
    return;
  }

  console.log("editEntry =", sessionStorage.getItem("editEntry"), "isAdmin =", isAdmin);

  // ================================
  // 成績入力期間判定（Firestore）
  // settings/period を唯一の正とする
  // ついでに year も取得して scores_YYYY を決定
  // ================================
  const periodRef = doc(db, "settings", "period");
  const periodSnap = await getDoc(periodRef);

  if (!periodSnap.exists()) {
    alert("成績入力期間の設定(settings/period)が見つかりません。");
    location.href = "/";
    return;
  }

  const period = periodSnap.data();
  const now = new Date();

  // year は必須（来年度はここを書き換えるだけ運用）
  const year = String(period.year || "").trim();
  if (!year) {
    alert("settings/period.year が未設定です（例: \"2025\"）。");
    location.href = "/";
    return;
  }

  const firstStart = new Date(period.firstStart);
  const firstEnd = new Date(period.firstEnd);
  const secondStart = new Date(period.secondStart);
  const secondEnd = new Date(period.secondEnd);

  const isWithinInputPeriod =
    (now >= firstStart && now <= firstEnd) ||
    (now >= secondStart && now <= secondEnd);

  console.log("isWithinInputPeriod =", isWithinInputPeriod, "year =", year);

// ================================
// 編集可否判定（B-1）
// ・期間内：教員も編集可
// ・期間外：教務(admin)のみ編集可
// ================================

CAN_EDIT = isWithinInputPeriod || isAdmin;

console.log("CAN_EDIT =", CAN_EDIT, {
  isWithinInputPeriod,
  isAdmin,
});



// ================================
// 権限判定（フェーズ2では無効化）
// ================================
// const role = detectRole(user.email);
//
// if (
//   (isWithinInputPeriod && role !== "teacher") ||
//   (!isWithinInputPeriod && role !== "admin")
// ) {
//   alert("修正モードの権限がありません。");
//   location.href = "/";
//   return;
// }


  // ================================
  // 現行仕様：提出済データは scores_YYYY に集約
  // ================================
  const scoresCol = `scores_${year}`;
  const subjectRef = doc(db, scoresCol, subjectId);
  const snap = await getDoc(subjectRef);

  if (!snap.exists()) {
    alert(`提出済みデータが見つかりません（${scoresCol}/${subjectId}）。`);
    location.href = "/";
    return;
  }

  const data = snap.data();
  currentSubjectName = data?.subjectName || subjectId;
  // ================================
// ★ 改善②：画面タイトル・注意文に科目名を反映
// ================================
document.querySelector("h1").textContent =
  `修正モード：${currentSubjectName}`;

const noticeEl = document.getElementById("notice");
if (noticeEl) {
  noticeEl.textContent =
    `※ 「${currentSubjectName}」の成績を修正しています。`;
}


  // students コレクションを一括取得（JOIN 用）
  const studentsSnap = await getDocs(collection(db, "students"));
  const studentMap = {};
  studentsSnap.forEach((doc) => {
    studentMap[doc.id] = doc.data();
  });

  // ================================
  // 画面描画
  // ※ 現フェーズは読み取り専用でOK
  // ================================
  // data.isCommon が無い場合に備えて保険（科目マスタ等から来ない場合）
  const isCommon = data?.isCommon === true;

  // units は submittedSnapshot.units の方にある可能性が高い（あなたの現行仕様）
  // まず submittedSnapshot.units を見て、無ければ data.units を見る
  const units = data?.submittedSnapshot?.units || data?.units || null;

  if (isCommon && units) {
    document.getElementById("unitSelectSection").hidden = false;
    renderUnitList(units); // 提出済ユニット一覧
    return;
  }

  // scores_YYYY.students を表示用配列に変換（students JOIN 完全版）
const studentRows = Object.entries(data.students || {}).map(
  ([studentId, s]) => {
    const student = studentMap[studentId] || {};
    const excess = data.excessStudents?.[studentId];

    return {
      // ===== 基本情報 =====
      studentNo: studentId,                    // 学籍番号
      name: student.name ?? "（氏名未登録）",
      course: student.courseClass ?? "",       // 組・コース（UI想定キー）
      no: student.number ?? "",                // 番号（UI想定キー）

      // ===== 成績 =====
      score: s?.finalScore ?? "",              // finalScore を表示

      // ===== 赤点（点数から自動判定）=====
      isRed:
        typeof s?.finalScore === "number" &&
        s.finalScore < 60,

      // ===== 超過 =====
      isExcess: Boolean(excess),
      excessHours: excess?.hours ?? "",
    };
  }
);
allStudents = studentRows;
// ================================
// 並び順制御：学年 → 組・コース → 番号
// ================================
// 組・コースの優先順（文字用）
const COURSE_ORDER = ["M", "E", "I", "C", "A"];

studentRows.sort((a, b) => {
  // 1. 学年
  const gA = Number(a.grade ?? 0);
  const gB = Number(b.grade ?? 0);
  if (gA !== gB) return gA - gB;

  // 2. 組・コース
  const cA = a.course ?? "";
  const cB = b.course ?? "";

  const isNumA = /^\d+$/.test(cA);
  const isNumB = /^\d+$/.test(cB);

  // 数字同士（1組,2組…）
  if (isNumA && isNumB) {
    if (Number(cA) !== Number(cB)) return Number(cA) - Number(cB);
  }

  // 文字同士（M,E,I,C,A）
  if (!isNumA && !isNumB) {
    const iA = COURSE_ORDER.indexOf(cA);
    const iB = COURSE_ORDER.indexOf(cB);
    if (iA !== iB) return iA - iB;
  }

  // 数字 → 文字 の順にしたい場合
  if (isNumA !== isNumB) {
    return isNumA ? -1 : 1;
  }

  // 3. 番号（出席番号）
  const nA = Number(a.no ?? 0);
  const nB = Number(b.no ?? 0);
  if (nA !== nB) return nA - nB;

  // 保険：学籍番号
  return String(a.studentNo).localeCompare(String(b.studentNo));
});

// 初回は学生選択モーダルを表示
openStudentSelectModal();

});

// ================================
// ユーティリティ
// ================================
function detectRole(email) {
  // 期間外に修正できる人（教務）
  if (ADMIN_EMAILS.includes(email)) return "admin";
  // それ以外は teacher 扱い（実際の最終判定は Firestore Rules が守る）
  return "teacher";
}

function showStudents(unitData) {
  document.getElementById("studentListSection").hidden = false;
  document.getElementById("subjectInfo").textContent =
    unitData.unitKey && unitData.unitKey !== "__SINGLE__"
      ? `${unitData.subjectName} / ${unitData.unitKey}`
      : unitData.subjectName;
  renderStudentTable(unitData.scores, { editable: CAN_EDIT });
  // ================================
  // ★ 修正対象 再選択ボタン
  // ================================
  const reselectBtn = document.getElementById("reselectStudentsBtn");
  if (reselectBtn) {
    reselectBtn.onclick = openStudentSelectModal;
  }
}

function openStudentSelectModal() {
  const modal = document.getElementById("studentSelectModal");
  const tbody = document.getElementById("studentSelectTableBody");
  const confirmBtn = document.getElementById("studentSelectConfirmBtn");

  tbody.innerHTML = "";

  allStudents.forEach((s) => {
    const tr = document.createElement("tr");

    const checked = selectedStudentIds.includes(s.studentNo);

    tr.innerHTML = `
      <td><input type="checkbox" data-id="${s.studentNo}" ${checked ? "checked" : ""}></td>
      <td>${s.studentNo}</td>
      <td>${s.name}</td>
      <td>${s.course}</td>
      <td>${s.no}</td>
      <td>${s.score ?? ""}</td>
      <td>${s.isExcess ? "あり" : "—"}</td>
    `;

    tbody.appendChild(tr);
  });

  confirmBtn.onclick = () => {
    selectedStudentIds = Array.from(
      tbody.querySelectorAll("input[type=checkbox]:checked")
    ).map((cb) => cb.dataset.id);

    modal.classList.add("hidden");

    const targetStudents = allStudents.filter((s) =>
      selectedStudentIds.includes(s.studentNo)
    );

    showStudents({
      subjectName: currentSubjectName,
      unitKey: "__SINGLE__",
      scores: targetStudents,
    });
  };

  modal.classList.remove("hidden");
}
