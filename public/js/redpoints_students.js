import { db } from "./firebase_init.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/* ============================== */
let subjectsCache = [];
let studentsCache = [];
let preloaded = false;
let currentMode = "students";
/* ============================== */

export async function initRedpointsStudentsView({ mountId = "redpointsApp" } = {}) {

  const root = document.getElementById(mountId);
  if (!root) return;

  root.innerHTML = `
    <div class="rp-mode-switch">
      <button id="rp-mode-students" class="rp-mode active">学生別</button>
      <button id="rp-mode-subjects" class="rp-mode">科目別</button>
    </div>

    <div class="rp-controls">
      <select id="rp-grade">
        <option value="">学年</option>
        <option value="1">1年</option>
        <option value="2">2年</option>
        <option value="3">3年</option>
        <option value="4">4年</option>
        <option value="5">5年</option>
      </select>

      <select id="rp-course"></select>

      <select id="rp-term">
  <option value="" disabled selected>前期 / 後期</option>
  <option value="前期">前期</option>
  <option value="後期通年">後期・通年</option>
</select>

      <select id="rp-subject" style="display:none;" multiple size="5"></select>

      <button id="rp-run">検索</button>
      <button id="rp-print">印刷</button>
    </div>

    <div id="rp-summary"></div>
    <div id="rp-table"></div>
  `;

  if (!preloaded) {
    await preload();
    preloaded = true;
  }

  document.getElementById("rp-grade").addEventListener("change", updateCourseOptions);
  document.getElementById("rp-course").addEventListener("change", updateSubjectOptions);
  document.getElementById("rp-term").addEventListener("change", updateSubjectOptions);
  document.getElementById("rp-run").addEventListener("click", run);
  document.getElementById("rp-print").addEventListener("click", printCurrentView);
  document.getElementById("rp-mode-students").addEventListener("click", () => {
    currentMode = "students";
    toggleMode();
  });

  document.getElementById("rp-mode-subjects").addEventListener("click", () => {
    currentMode = "subjects";
    toggleMode();
  });
}

/* ============================== */
function toggleMode() {
  const subjectSelect = document.getElementById("rp-subject");

  document.querySelectorAll(".rp-mode").forEach(b => b.classList.remove("active"));

  if (currentMode === "students") {
    document.getElementById("rp-mode-students").classList.add("active");
    subjectSelect.style.display = "none";
  } else {
    document.getElementById("rp-mode-subjects").classList.add("active");
    subjectSelect.style.display = "inline-block";
  }
}

/* ============================== */
async function preload() {

  const subjectsSnap = await getDocs(collection(db, "subjects"));
  subjectsCache = subjectsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const studentsSnap = await getDocs(collection(db, "studentSnapshots_2025"));
  studentsCache = studentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function parseSubjectId(id) {

  const parts = id.split("_");

  const grade = Number(parts[0]);   // "1"
  const course = parts[1];          // "G"
  const term = parts[2];            // "後期"

  return { grade, course, term };
}

/* ============================== */
function updateCourseOptions() {

  const grade = Number(document.getElementById("rp-grade").value);
  const courseSelect = document.getElementById("rp-course");

  courseSelect.innerHTML = "";

  if (!grade) return;

  // ===== 1・2年 =====
  if (grade <= 2) {

    // 学生別は組選択を出す
    if (currentMode === "students") {
      courseSelect.style.display = "inline-block";

      ["1","2","3","4","5"].forEach(c => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c + "組";
        courseSelect.appendChild(opt);
      });

    } else {
      // 科目別は組選択を出さない（全員対象）
      courseSelect.style.display = "none";
    }

    updateSubjectOptions();
    return;
  }

  // ===== 3年以上 =====
  courseSelect.style.display = "inline-block";

 ["共通","M","E","I","CA"].forEach(c => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    courseSelect.appendChild(opt);
  });

  updateSubjectOptions();
}

/* ============================== */
function updateSubjectOptions() {

  const grade = Number(document.getElementById("rp-grade").value);
  const course = document.getElementById("rp-course").value;
  const term = document.getElementById("rp-term").value;
  const subjectSelect = document.getElementById("rp-subject");

  subjectSelect.innerHTML = "";
  subjectSelect.appendChild(new Option("科目を選択", ""));

  if (!grade || !term) return;

  const termMatch = term === "後期通年"
    ? ["後期","通年"]
    : ["前期"];

  const filtered = subjectsCache.filter(sub => {

    const { grade: subGrade, course: subCourseType, term: subTerm }
      = parseSubjectId(sub.id);

    if (Number(subGrade) !== grade) return false;
    if (!termMatch.includes(subTerm)) return false;

    // ===== 1・2年 =====
    if (grade <= 2) {
      return subCourseType === "G";
    }

    // ===== 3年以上 =====
    if (!course) return false;

    // 共通選択 → Gのみ
    if (course === "共通") {
      return subCourseType === "G";
    }

    // CA選択 → C / CC / CA
    if (course === "CA") {
      return ["C","CC","CA"].includes(subCourseType);
    }

    // M / E / I
    return subCourseType === course;
  });

  filtered.forEach(sub => {
    const name = sub.id.split("_").slice(3).join("_");
    subjectSelect.appendChild(new Option(name, sub.id));
  });
}

/* ============================== */
async function run() {

  const btn = document.getElementById("rp-run");
  const toast = document.getElementById("rp-toast");

  btn.disabled = true;
  toast.classList.add("show");

  try {

    const grade = document.getElementById("rp-grade").value;
    const course = document.getElementById("rp-course").value;

    if (!grade) {
      alert("学年を選択してください。");
      return;
    }

const targetStudents = studentsCache.filter(s => {

  if (s.grade != grade) return false;

  const gradeNum = Number(grade);

  // ===== 1・2年 =====
  if (gradeNum <= 2) {
    if (!course) return true;
    return s.courseClass === course;
  }

  // ===== 3年以上 =====
  if (!course) return true;

  // 共通は全コース対象
  if (course === "共通") {
    return true;
  }

  // CAは C / A 両方対象
  if (course === "CA") {
    return ["C","A"].includes(s.courseClass);
  }

  // M / E / I
  return s.courseClass === course;
});

    if (currentMode === "students") {
      await renderStudentsStable(targetStudents);
    } else {
      await renderSubjectsStable(targetStudents);
    }

  } finally {
    btn.disabled = false;
    toast.classList.remove("show");
  }
}

/* ============================== */

async function renderStudentsStable(targetStudents) {

  const grade = Number(document.getElementById("rp-grade").value);
  const course = document.getElementById("rp-course").value;
  const term = document.getElementById("rp-term").value;

  const termMatch = term === "後期通年"
    ? ["後期","通年"]
    : ["前期"];

  const targetSubjects = subjectsCache.filter(sub => {

    const { grade: subGrade, course: subCourseType, term: subTerm }
  = parseSubjectId(sub.id);

    if (Number(subGrade) !== grade) return false;
    if (!termMatch.includes(subTerm)) return false;

    if (grade <= 2) return subCourseType === "G";
    if (course === "共通") return subCourseType === "G";
    if (course === "CA") return ["C","CC","CA","G"].includes(subCourseType);

    return subCourseType === course || subCourseType === "G";
  });

  // 横断取得
const scoreMap = {};

for (const sub of targetSubjects) {

  const snap = await getDoc(doc(db, "scores_2025", sub.id));
  if (!snap.exists()) continue;

  const data = snap.data();

scoreMap[sub.id] = data.students || {};
}

  const results = [];

  for (const student of targetStudents) {

    let requiredRed = 0;
    let electiveRed = 0;
   const requiredList = [];
const electiveList = [];

const requiredCount = targetSubjects.filter(sub => sub.required).length;

for (const sub of targetSubjects) {

  const st = scoreMap[sub.id]?.[student.studentId];
  if (!st || !st.isRed) continue;

 const name = sub.id.split("_").slice(3).join("_");

  if (sub.required) {
    requiredRed++;
    requiredList.push(name);
  } else {
    electiveRed++;
    electiveList.push(name);
  }
}

    const totalRed = requiredRed + electiveRed;
    if (totalRed === 0) continue;

    let dangerLevel = 0;
    if (requiredRed >= requiredCount / 2) dangerLevel = 2;
    else if (requiredRed >= requiredCount / 3) dangerLevel = 1;

    let subjectHtml = "";

if (requiredList.length) {
  subjectHtml += `
    <div class="rp-required-title">■ 必修（${requiredList.length}）</div>
    ${requiredList.join("<br>")}
  `;
}

if (electiveList.length) {
  subjectHtml += `
    <div class="rp-elective-title">■ 選択（${electiveList.length}）</div>
    ${electiveList.join("<br>")}
  `;
}

results.push({
  number: student.number,
  name: student.name,
  classGroup: student.courseClass || "",   // ←ここ修正
  totalRed,
  dangerLevel,
  subjectHtml
});
  }

const gradeNum = Number(document.getElementById("rp-grade").value);

results.sort((a,b) => {

  // 1・2年は組順優先
  if (gradeNum <= 2) {
    if (a.classGroup !== b.classGroup)
      return a.classGroup.localeCompare(b.classGroup);
  }

  if (b.dangerLevel !== a.dangerLevel)
    return b.dangerLevel - a.dangerLevel;

  if (b.totalRed !== a.totalRed)
    return b.totalRed - a.totalRed;

  return a.number - b.number;
});
  renderStudentTable(results, targetStudents.length);
}

/* ============================== */
async function renderSubjectsStable(targetStudents) {

  const select = document.getElementById("rp-subject");
  const selected = Array.from(select.selectedOptions).map(o => o.value);
  if (!selected.length) return;

  const summaryDiv = document.getElementById("rp-summary");
  const tableDiv = document.getElementById("rp-table");

  summaryDiv.innerHTML = `選択科目数：${selected.length}科目`;

  let html = "";

  for (const subjectId of selected) {

    const snap = await getDoc(doc(db, "scores_2025", subjectId));

    const subjectName = subjectId.split("_").slice(3).join("_");

    if (!snap.exists()) {
      html += `
        <div class="rp-subject-title">${subjectName}</div>
        <div class="no-result">該当者なし（データ未作成）</div>
      `;
      continue;
    }

    const data = snap.data();

    let studentsData = {};

    // ===== 旧構造対応 =====
    if (data.students) {
      studentsData = { ...data.students };
    }

    // ===== 新構造対応 =====
    if (data.submittedSnapshot?.units) {
      for (const unitKey in data.submittedSnapshot.units) {
        const unitStudents =
          data.submittedSnapshot.units[unitKey].students || {};
        studentsData = { ...studentsData, ...unitStudents };
      }
    }

    let redCount = 0;
    let totalScore = 0;
    let count = 0;
    const redList = [];

    for (const student of targetStudents) {

      const key = student.studentId || student.id;

      const st = studentsData[key];
      if (!st) continue;

      const fs = Number(st.finalScore);
      if (!Number.isFinite(fs)) continue;

      totalScore += fs;
      count++;

      if (st.isRed) {
        redCount++;
        redList.push(`${student.courseClass} ${student.name}（${fs}）`);
      }
    }

    if (count === 0) {
      html += `
        <div class="rp-subject-title">${subjectName}</div>
        <div class="no-result">該当者なし（成績データなし）</div>
      `;
      continue;
    }

    if (redCount === 0) {
      html += `
        <div class="rp-subject-title">${subjectName}</div>
        <div class="no-result">該当者なし</div>
      `;
      continue;
    }

    const avgNum = totalScore / count;
    const avg = avgNum.toFixed(1);
    const adjust = Math.ceil(avgNum * 0.7);
    const redRate = ((redCount / targetStudents.length) * 100).toFixed(1);

    html += `
      <h3>${subjectName}</h3>
      <table class="rp-table">
        <tr>
          <th>赤点人数</th>
          <th>赤点率</th>
          <th>平均点</th>
          <th>調整点</th>
          <th>赤点者</th>
        </tr>
        <tr>
          <td>${redCount}名</td>
          <td>${redRate}%</td>
          <td>${avg}</td>
          <td>${adjust}</td>
          <td>${redList.join("<br>")}</td>
        </tr>
      </table>
      <br>
    `;
  }

  tableDiv.innerHTML = html;
}

function printCurrentView() {

  const grade = document.getElementById("rp-grade").value || "";
  const course = document.getElementById("rp-course").value || "";
  const subjectId = document.getElementById("rp-subject").value || "";
  const summary = document.getElementById("rp-summary").innerHTML;
  let table = "";

const pcTableEl = document.getElementById("pc-table");

if (pcTableEl) {
  table = pcTableEl.innerHTML;
} else {
  const rpTableEl = document.getElementById("rp-table");
  table = rpTableEl ? rpTableEl.innerHTML : "";
}

 const subjectName = subjectId
  ? subjectId.split("_").slice(3).join("_")
  : "";

  const headerInfo = `
    <div style="margin-bottom:20px;">
      <h2>赤点一覧 印刷</h2>
      <div>学年：${grade}年</div>
      <div>組・コース：${course}</div>
      ${subjectName ? `<div>科目：${subjectName}</div>` : ""}
    </div>
  `;

  const printWindow = window.open("", "", "width=1000,height=800");

  printWindow.document.write(`
    <html>
      <head>
        <title>赤点一覧</title>
        <style>
          body { font-family: sans-serif; padding:20px; }
          table { width:100%; border-collapse: collapse; }
          th, td { border:1px solid #000; padding:6px; }
          th { background:#eee; }
        </style>
      </head>
      <body>
        ${headerInfo}
        ${summary}
        ${table}
      </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function renderStudentTable(results, totalStudents) {

  const summaryDiv = document.getElementById("rp-summary");
  const tableDiv = document.getElementById("rp-table");

  const dangerCount = results.filter(r => r.dangerLevel === 2).length;
  const warningCount = results.filter(r => r.dangerLevel === 1).length;
  const noRedCount = totalStudents - results.length;

summaryDiv.innerHTML = `
  <span class="summary-chip chip-danger">🚨 危険 ${dangerCount}</span>
  <span class="summary-chip chip-warning">⚠ 要注意 ${warningCount}</span>
  <span class="summary-chip chip-safe">📘 赤点なし ${noRedCount}</span>
`;

  if (!results.length) {
    tableDiv.innerHTML = "<p>赤点者はいません。</p>";
    return;
  }

  let html = `
    <table class="rp-table">
      <thead>
        <tr>
          <th>番号</th>
          <th>氏名</th>
          <th>赤点数</th>
          <th>赤点科目</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const r of results) {

    const icon =
      r.dangerLevel === 2 ? "🚨 "
      : r.dangerLevel === 1 ? "⚠ "
      : "";

    const rowClass =
      r.dangerLevel === 2 ? "danger"
      : r.dangerLevel === 1 ? "warning"
      : "";

    html += `
      <tr class="${rowClass}">
        <td>${r.number}</td>
        <td>${icon}${r.name}</td>
        <td>${r.totalRed}</td>
        <td class="subject-cell">${r.subjectHtml}</td>
      </tr>
    `;
  }

  html += "</tbody></table>";
// ===== スマホカード生成 =====
let mobileHtml = "";

for (const r of results) {

  const rowClass =
    r.dangerLevel === 2 ? "danger"
    : r.dangerLevel === 1 ? "warning"
    : "";

  mobileHtml += `
    <div class="mobile-card ${rowClass}">
      <div class="mobile-name">
        ${r.number} ${r.name}（赤点${r.totalRed}）
      </div>
      ${r.subjectHtml}
    </div>
  `;
}

// PCテーブルとモバイルを分離して格納
tableDiv.innerHTML = `
  <div id="pc-table">${html}</div>
  <div id="mobile-cards">${mobileHtml}</div>
`;
}