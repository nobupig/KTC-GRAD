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
  sortStudents,
  sortStudentsBySkillLevel
} from "./score_input_students.js";

import {
  createModeState,
  initModeTabs,
  updateFinalScoreForRow,
  updateAllFinalScores,
} from "./score_input_modes.js";

import { applyPastedScores } from "./score_input_paste.js";
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
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// ================================
// ★ 科目マスタ（subjects）を正本として取得
// ================================
async function loadSubjectMaster(subjectId) {
  if (!subjectId) return null;
  const ref = doc(db, "subjects", subjectId);
  const snap = await getDoc(ref);
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
  filterDefs.forEach(def => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = def.label;
    btn.className = "btn btn-secondary";
    btn.onclick = () => applySkillLevelFilter(subject, def.key);
    container.appendChild(btn);
  });
  area.appendChild(container);
}

// ================================
// 新規追加: 習熟度フィルタ適用
// ================================
function applySkillLevelFilter(subject, key) {
  const baseList = studentState.currentStudents.slice();
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
  renderStudentRows(
    tbody,
    subject,
    filtered,
    criteriaState.items,
    (tr) => {
      updateFinalScoreForRow(tr, criteriaState, modeState);
    }
  );
  // 習熟度値の反映
  if (currentIsSkillLevel && studentState.skillLevelsMap) {
    const inputs = tbody.querySelectorAll('input.skill-level-input');
    inputs.forEach(input => {
      const sid = input.dataset.studentId;
      input.value = studentState.skillLevelsMap[sid] || "";
    });
  }
  updateStudentCountDisplay(filtered.length);
  updateAllFinalScores();
}
// ================================
// 新規追加: 習熟度データを取得
// ================================
async function ensureSkillLevelsLoaded(subject) {
  if (!subject || subject.isSkillLevel !== true) return;
  const ref = doc(db, `skillLevels_${currentYear}`, subject.subjectId);
  const snap = await getDoc(ref);
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
const skillSaveBtn = document.getElementById("skillSaveBtn");
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
let currentIsSkillLevel = false;

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
  // ★ subjects 正本を参照
  const subjectMaster = await loadSubjectMaster(subjectId);
  // ★ isSkillLevel は subjects 正本だけを見る
  const isSkillLevel = subjectMaster?.isSkillLevel === true;
  // ★ downstream 安定化：subject にも注入しておく（teacherSubjects が欠けてても動く）
  if (subject) subject.isSkillLevel = isSkillLevel;
  currentIsSkillLevel = isSkillLevel;

  console.log("[DEBUG subjectMaster]", subjectMaster);
  console.log("[DEBUG isSkillLevel]", currentIsSkillLevel);
  console.log(
    "[DEBUG subject]",
    {
      subjectId: subject?.subjectId,
      name: subject?.name,
      isSkillLevel: currentIsSkillLevel,
      required: subject?.required
    }
  );
  await ensureElectiveRegistrationLoaded(subject);
  if (currentIsSkillLevel) {
    console.log("[SKILL LEVEL MODE] enabled");
  } else {
    console.log("[SKILL LEVEL MODE] disabled");
  }
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
  // currentIsSkillLevel===true の場合のみ「習熟度」thを先頭に追加
  if (currentIsSkillLevel) {
    const th = document.createElement("th");
    th.textContent = "習熟度";
    headerRow.insertBefore(th, headerRow.firstChild);
  }

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

// ★ STEP C フィルタ用：現在の表示学生を保持
studentState.currentStudents = displayStudents.slice();

  console.log('[DEBUG] subject:', subject);
  console.log('[DEBUG] displayStudents(before sort):', displayStudents);
  // 習熟度ソート（currentIsSkillLevel===true時のみ）
  if (currentIsSkillLevel) {
    displayStudents = sortStudentsBySkillLevel(displayStudents, studentState.skillLevelsMap);
    console.log('[DEBUG] displayStudents(after skill sort):', displayStudents);
  }
  console.log('[DEBUG] renderStudentRows call:', { subject, displayStudents });
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
  // --- 新規追加: 習熟度値の反映 ---
  if (currentIsSkillLevel && studentState.skillLevelsMap) {
    const inputs = tbody.querySelectorAll('input.skill-level-input');
    inputs.forEach(input => {
      const sid = input.dataset.studentId;
      input.value = studentState.skillLevelsMap[sid] || "";
    });
  }
  updateStudentCountDisplay(displayStudents.length);

  // --- 習熟度保存ボタンの表示切替 ---
  if (skillSaveBtn) {
    if (currentIsSkillLevel) {
      skillSaveBtn.style.display = "inline-block";
    } else {
      skillSaveBtn.style.display = "none";
    }
  }
  // --- 習熟度保存ボタンのonclick ---
  if (skillSaveBtn) {
    skillSaveBtn.onclick = async () => {
      if (!currentIsSkillLevel) return;
      const inputs = tbody.querySelectorAll('input.skill-level-input');
      const levelsMap = {};
      inputs.forEach(input => {
        const sid = input.dataset.studentId;
        levelsMap[sid] = input.value || "";
      });
      const ref = doc(db, `skillLevels_${currentYear}`, subject.subjectId);
      await setDoc(ref, {
        levels: levelsMap,
        updatedAt: serverTimestamp()
      }, { merge: true });
      setInfoMessage("習熟度を保存しました");
    };
  }

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
if (currentIsSkillLevel) {
  renderSkillLevelFilter(subject);
} else {
  renderGroupOrCourseFilter(subject);
}


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
    updateStudentCountDisplay(filtered.length);

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
