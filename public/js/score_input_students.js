// js/score_input_students.js
// STEP A：学生名簿の取得・フィルタ・テーブル行レンダリング専用モジュール

import {
  collection,
  getDocs,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/**
 * 学生関連の状態オブジェクトを作成
 * - allStudents: students コレクション全件
 * - currentStudents: 現在選択中科目の学生リスト
 */
export function createStudentState() {
  return {
    allStudents: [],
    currentStudents: [],
    electiveStudents: [],   // 選択科目用（追加するだけ）
  };
}

/**
 * Firestore から students を全件取得して state に格納
 *
 * @param {import("firebase/firestore").Firestore} db
 * @param {{ allStudents: any[] }} studentState
 */
export async function loadAllStudents(db, studentState) {
  const snap = await getDocs(collection(db, "students"));
  studentState.allStudents = snap.docs.map((d) => d.data() || {});
}

/**
 * 共通科目の並び順 M→E→I→C→A
 *
 * @param {string} courseClass
 * @returns {number}
 */
function getCoursePriority(courseClass) {
  const c = String(courseClass || "").toUpperCase();
  const priority = { M: 1, E: 2, I: 3, C: 4, A: 5 };
  return priority[c] ?? 99;
}

/**
 * 科目に応じて学生をフィルタ＆ソート
 *
 * 仕様（これまで通り）:
 * - 1,2年：学年全員（コース問わず）
 * - 3〜5年：
 *    ・course=G（共通） or 空：その学年の全員
 *    ・course=C ：C + A
 *    ・course=CC：C のみ
 *    ・course=CA：A のみ
 *    ・その他(M/E/I/C/A)：そのコースのみ
 * - 並び順：
 *    ・共通：M→E→I→C→A のコース順 → 番号
 *    ・C＋A の混在：C→A → 番号
 *    ・単一コース：番号順
 *
 * @param {object|null} subject Firestoreの科目データ(subjects配列の1要素想定)
 * @param {{ allStudents: any[], currentStudents: any[] }} studentState
 * @returns {any[]} フィルタ後の学生配列
 */
export function filterAndSortStudentsForSubject(subject, studentState) {
  if (!subject) {
    studentState.currentStudents = [];
    return [];
  }

  const allStudents = studentState.allStudents || [];

  const targetGrade = String(subject.grade ?? "");
  const subjectCourse = String(subject.course ?? "").toUpperCase();

  const byGrade = allStudents.filter(
    (s) => String(s.grade ?? "") === targetGrade
  );

  // 1・2年は学年全体
  if (targetGrade === "1" || targetGrade === "2") {
    const result = byGrade.slice().sort((a, b) => {
      const ca = getCoursePriority(a.courseClass);
      const cb = getCoursePriority(b.courseClass);
      if (ca !== cb) return ca - cb;
      return (a.number || 0) - (b.number || 0);
    });
    studentState.currentStudents = result;
    return result;
  }

  // 3〜5年
  const commonLike =
    !subjectCourse || subjectCourse === "G" || subjectCourse === "COMMON";

  if (commonLike) {
    // 共通科目：全コース
    const result = byGrade.slice().sort((a, b) => {
      const ca = getCoursePriority(a.courseClass);
      const cb = getCoursePriority(b.courseClass);
      if (ca !== cb) return ca - cb;
      return (a.number || 0) - (b.number || 0);
    });
    studentState.currentStudents = result;
    return result;
  }

  if (subjectCourse === "C") {
    // C科目：C + A
    const target = byGrade.filter((s) => {
      const c = String(s.courseClass || "").toUpperCase();
      return c === "C" || c === "A";
    });
    const courseOrder = { C: 1, A: 2 };
    const result = target.sort((a, b) => {
      const ca =
        courseOrder[String(a.courseClass || "").toUpperCase()] ?? 99;
      const cb =
        courseOrder[String(b.courseClass || "").toUpperCase()] ?? 99;
      if (ca !== cb) return ca - cb;
      return (a.number || 0) - (b.number || 0);
    });
    studentState.currentStudents = result;
    return result;
  }

  if (subjectCourse === "CC") {
    // CC：C のみ
    const target = byGrade.filter(
      (s) => String(s.courseClass || "").toUpperCase() === "C"
    );
    const result = target.sort(
      (a, b) => (a.number || 0) - (b.number || 0)
    );
    studentState.currentStudents = result;
    return result;
  }

  if (subjectCourse === "CA") {
    // CA：A のみ
    const target = byGrade.filter(
      (s) => String(s.courseClass || "").toUpperCase() === "A"
    );
    const result = target.sort(
      (a, b) => (a.number || 0) - (b.number || 0)
    );
    studentState.currentStudents = result;
    return result;
  }

  // 一般：単一コース（M/E/I/C/A など）
  const target = byGrade.filter(
    (s) => String(s.courseClass || "").toUpperCase() === subjectCourse
  );
  const result = target.sort(
    (a, b) => (a.number || 0) - (b.number || 0)
  );
  studentState.currentStudents = result;
  return result;
}

/**
 * 科目セレクトボックスに担当科目一覧を設定
 *
 * @param {HTMLSelectElement} subjectSelect
 * @param {any[]} teacherSubjects teacherSubjects_YYYY の subjects 配列
 * @param {(s: any) => string} buildSubjectLabel  科目表示用ラベル関数
 */
export function populateSubjectSelect(subjectSelect, teacherSubjects, buildSubjectLabel) {
  subjectSelect.innerHTML = "";

  if (!teacherSubjects || teacherSubjects.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "担当科目が登録されていません";
    subjectSelect.appendChild(opt);
    subjectSelect.disabled = true;
    return;
  }

  teacherSubjects.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.subjectId;
    opt.textContent = buildSubjectLabel(s);
    subjectSelect.appendChild(opt);
  });

  subjectSelect.disabled = false;
}

/**
 * 学生行を tbody に描画する
 *
 * @param {HTMLTableSectionElement} tbody
 * @param {object|null} subject
 * @param {any[]} students currentStudents
 * @param {Array<{name:string,percent:number}>} criteriaItems
 * @param {(tr: HTMLTableRowElement) => void} onScoreInputChange
 */
export function renderStudentRows(
  tbody,
  subject,
  students,
  criteriaItems,
  onScoreInputChange
) {
  tbody.innerHTML = "";

  // 科目未選択
  if (!subject) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.className = "no-data";
    td.textContent = "科目が選択されていません。";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  // 学生ゼロ
  if (!students || students.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.className = "no-data";
    td.textContent = "学生情報が登録されていません。";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const stu of students) {
    const tr = document.createElement("tr");
    tr.dataset.studentId = stu.studentId;

    const addCell = (text) => {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
      return td;
    };

    addCell(stu.studentId || "");
    addCell(stu.grade ?? "");
    addCell(stu.courseClass ?? "");
    addCell(stu.number ?? "");
    addCell(stu.name ?? "");

    if (!criteriaItems || criteriaItems.length === 0) {
      const td = document.createElement("td");
      td.textContent = "-";
      tr.appendChild(td);
    } else {
      criteriaItems.forEach((item, index) => {
        const td = document.createElement("td");
        const input = document.createElement("input");
          // ▼ 評価項目の満点（percent）を data に保持（素点モードの最大値判定に必要）
          input.dataset.weightPercent = String(item.percent ?? 0);

        input.type = "number";
        input.min = "0";
        input.max = "100";
        input.step = "0.1";
        input.dataset.index = String(index);
        input.dataset.itemName = item.name || "";
        input.addEventListener("paste", (ev) => ev.preventDefault());
        input.addEventListener("input", () => {
          if (typeof onScoreInputChange === "function") {
            onScoreInputChange(tr);
          }
        });
        td.appendChild(input);
        // ▼ 内部換算点表示用の <span>
          const span = document.createElement("span");
          span.className = "converted-score";
          span.style.marginLeft = "4px";
          span.textContent = "";  // 初期は空
          td.appendChild(span);
          tr.appendChild(td);
      });
    }

    const finalTd = document.createElement("td");
    finalTd.className = "final-score";
    finalTd.textContent = "";
    tr.appendChild(finalTd);

    tbody.appendChild(tr);
  }
}
// =============================================
// STEP C：組/コースフィルタ関数
// =============================================
export function filterStudentsByGroupOrCourse(subject, baseList, filterKey) {
  if (!subject || !Array.isArray(baseList)) return baseList;

  filterKey = String(filterKey || "").toUpperCase();
  if (filterKey === "ALL") return baseList;

  const grade = String(subject.grade || "");

  if (grade === "1" || grade === "2") {
    // 1〜2年 → 組フィルタ
    return baseList.filter(stu => String(stu.classGroup || stu.courseClass || "") === filterKey);
  }

  // 3年以上 → コースフィルタ
  if (filterKey === "CA") {
    return baseList.filter(stu => {
      const c = String(stu.courseClass || "").toUpperCase();
      return c === "C" || c === "A";
    });
  }

  return baseList.filter(stu => {
    const c = String(stu.courseClass || "").toUpperCase();
    return c === filterKey;
  });
}
