// ================================
// score_input_loader.js（完全版）
// STEP A + STEP B-1〜B-4 統合
// ================================

import {
  createCriteriaState,
  loadCriteria,
  renderTableHeader,
} from "./score_input_criteria.js";

import {
  createStudentState,
  loadAllStudents,
  filterAndSortStudentsForSubject,
  renderStudentRows,
} from "./score_input_students.js";

import {
  createModeState,
  initModeTabs,
  updateFinalScoreForRow,
  updateAllFinalScores,   // ★これを追加！
} from "./score_input_modes.js";


// Firebase SDK
import {applyPastedScores} from "./score_input_paste.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";



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
let pasteInitialized = false;

const currentYear = new Date().getFullYear();
let teacherSubjects = []; // 教員の担当科目リスト（teacherSubjects_YYYY の subjects 配列）

// ================================
// 共通：メッセージ表示ヘルパ
// ================================
function setInfoMessage(text) {
  if (!infoMessageEl) return;
  infoMessageEl.textContent = text || "";
}


// ================================
// 教員名を読み込む
// ================================
async function loadTeacherName(user) {
  const ref = doc(db, "teachers", user.email);
  const snap = await getDoc(ref);
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
  const snap = await getDoc(subjectsRef);

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
  const snap = await getDoc(regRef);

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
  const listEl = document.getElementById("electiveStudentList");
  const cancelBtn = document.getElementById("electiveCancelBtn");
  const registerBtn = document.getElementById("electiveRegisterBtn");

  if (!modal || !listEl) return;

  // すでに登録済みならモーダルは出さない
  if (studentState.electiveStudents && studentState.electiveStudents.length > 0) {
    return;
  }

  // 学年一致の全学生表示
  const grade = String(subject.grade);
  const candidates = studentState.allStudents.filter(s => String(s.grade) === grade);

  listEl.innerHTML = "";
  candidates.forEach(stu => {
    const row = document.createElement("div");
    row.className = "ktc-student-item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.dataset.studentId = stu.studentId;

    const label = document.createElement("label");
    label.textContent = `${stu.studentId} / ${stu.courseClass} / ${stu.number} / ${stu.name}`;

    row.appendChild(cb);
    row.appendChild(label);
    listEl.appendChild(row);
  });

  modal.style.display = "flex";

  cancelBtn.onclick = () => {
    modal.style.display = "none";
  };

  registerBtn.onclick = async () => {
    const checked = Array.from(listEl.querySelectorAll("input[type='checkbox']:checked"))
      .map(cb => cb.dataset.studentId);

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
// 科目選択時の処理
// ================================
async function handleSubjectChange(subjectId) {
  if (!subjectId) {
    setInfoMessage("科目が選択されていません。");
    headerRow.innerHTML = "";
    tbody.innerHTML = `
      <tr>
        <td class="no-data" colspan="6">科目が選択されていません。</td>
      </tr>
    `;
    return;
  }

  const subject = findSubjectById(subjectId);
  await ensureElectiveRegistrationLoaded(subject);
  if (subject && subject.required === false) { await openElectiveRegistrationModal(subject); }
  if (!subject) {
    setInfoMessage("選択された科目情報が見つかりません。");
    headerRow.innerHTML = "";
    tbody.innerHTML = `
      <tr>
        <td class="no-data" colspan="6">科目情報が見つかりません。</td>
      </tr>
    `;
    return;
  }

  setInfoMessage("評価基準と名簿を読み込んでいます…");

  // 評価基準読み込み → ヘッダ生成
  await loadCriteria(db, currentYear, subjectId, criteriaState);
  renderTableHeader(headerRow, criteriaState);

  // 学生全件ロード（まだなら）
  if (!studentState.allStudents.length) {
    await loadAllStudents(db, studentState);
  }

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

  // 学生行描画（入力時にその行の最終成績を計算）
  renderStudentRows(
    tbody,
    subject,
    displayStudents,
    criteriaState.items,
    (tr) => {
      updateFinalScoreForRow(tr, criteriaState, modeState);
    }
  );

  // ▼ 貼り付け処理の接続（初回だけ）
  if (!pasteInitialized) {
    tbody.addEventListener("paste", (ev) => {
      ev.preventDefault();
      const text = ev.clipboardData?.getData("text/plain") ?? "";
      if (!text) return;

      applyPastedScores(
        text,
        tbody,
        criteriaState,
        modeState,
        (msg) => window.alert(msg)
      );
    });
    pasteInitialized = true;
  }

  // 評価基準がない場合は注意メッセージ
  if (!criteriaState.items.length) {
    setInfoMessage(
      "この科目には評価基準が登録されていません。評価基準画面で登録してください。"
    );
  } else {
    setInfoMessage("成績を入力してください。（モード：自動換算モードがデフォルトです）");
  }

  // 評価基準画面へのリンクを subjectId 付きに更新
  if (toEvaluationLink) {
    toEvaluationLink.href = `evaluation.html?subjectId=${encodeURIComponent(
      subjectId
    )}`;
  }

// STEP C：フィルタ UI を生成
renderGroupOrCourseFilter(subject);


  // 保存ボタンはまだ本保存未実装なので disable のまま
  if (saveBtn) {
    saveBtn.disabled = true;
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
  const baseList = studentState.currentStudents.slice();

  import("./score_input_students.js").then(({ filterStudentsByGroupOrCourse }) => {
    const filtered = filterStudentsByGroupOrCourse(subject, baseList, filterKey);

    // tbody 再描画
    renderStudentRows(
      tbody,
      subject,
      filtered,
      criteriaState.items,
      (tr) => updateFinalScoreForRow(tr, criteriaState, modeState)
    );

    // 再計算
    updateAllFinalScores(tbody, criteriaState, modeState);
  });
}

// ================================
// 初期化
// ================================
export function initScoreInput() {
  // モードタブを生成（infoMessage の直下）
  initModeTabs({ infoMessageEl }, modeState);

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }

    // 教員名表示
    const teacherName = await loadTeacherName(user);
    if (headerUserDisplay) {
      headerUserDisplay.textContent = `ログイン中：${teacherName}`;
    }

    // 学生全件を先にロード（名簿フィルタ用）
    await loadAllStudents(db, studentState);

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
