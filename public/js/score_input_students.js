/**
 * 指定学年の学生のみ取得（Firestore Reads削減版）
 * @param {import("firebase/firestore").Firestore} db
 * @param {string|number} grade
 * @param {{ allStudents: any[] }} studentState
 */
export async function loadStudentsForGrade(db, grade, studentState) {
  if (!grade) return;
  const cacheKey = `students_cache_grade_${grade}`;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && Array.isArray(parsed.data) && typeof parsed.ts === "number") {
        const now = Date.now();
        if (now - parsed.ts < 6 * 60 * 60 * 1000) {
          studentState.allStudents = parsed.data;
          return;
        }
      }
    }
  } catch (e) {
    // キャッシュ破損時は無視してFirestoreへ
  }
  const q = query(
    collection(db, "students"),
    where("isActive", "==", true),
    where("grade", "==", String(grade))
  );
  let snap;
  try {
    snap = await getDocs(q);
  } catch (err) {
    if (err.code === "resource-exhausted" || String(err.message).includes("Quota exceeded")) {
      activateQuotaErrorState();
      throw err;
    } else {
      throw err;
    }
  }
  const students = snap.docs.map((d) => d.data() || {});
  // 正規化して UI 用フィールドを確実に持たせる
  const normalize = (d) => {
    const src = d || {};
    const studentId = src.studentId ?? src.id ?? "";
    const grade = src.grade ?? "";
    const course = src.course ?? src.courseClass ?? "";
    const group = src.group ?? src.class ?? src.classGroup ?? "";
    return {
      studentId: String(studentId),
      grade,
      group,
      course,
      courseClass: course,
      classGroup: src.classGroup ?? "",
      number: src.number ?? null,
      name: src.name ?? "",
    };
  };
  studentState.allStudents = students.map((d) => normalize(d));
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: studentState.allStudents }));
  } catch (e) {
    // sessionStorage容量超過等は無視
  }
}
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
  serverTimestamp,
  updateDoc,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { activateQuotaErrorState } from "./quota_banner.js";
import { CURRENT_YEAR } from "./config.js";
import { db } from "./score_input_loader.js";


/**
 * 習熟度・コース・番号・ID順でソート
 * @param {any[]} students
 * @param {Object} skillLevelsMap
 * @returns {any[]}
 */
export function sortStudentsBySkillLevel(students, skillLevelsMap) {
  const skillOrder = { S: 1, A1: 2, A2: 3, A3: 4, "": 5 };
  return students.slice().sort((a, b) => {
    const sa = (skillLevelsMap?.[a.studentId] ?? "").toUpperCase();
    const sb = (skillLevelsMap?.[b.studentId] ?? "").toUpperCase();
    const o1 = skillOrder[sa] ?? 99;
    const o2 = skillOrder[sb] ?? 99;
    if (o1 !== o2) return o1 - o2;
    const ca = Number(a.courseClass) || 0;
    const cb = Number(b.courseClass) || 0;
    if (ca !== cb) return ca - cb;
    const na = Number(a.number) || 0;
    const nb = Number(b.number) || 0;
    if (na !== nb) return na - nb;
    return String(a.studentId).localeCompare(String(b.studentId));
  });
}
const currentYear = CURRENT_YEAR;
const SKILL_LEVEL_COLLECTION_PREFIX = "skillLevels_";
const SKILL_LEVEL_SAVE_DEBOUNCE_MS = 500;
const FINAL_SKILL_ALLOWED = ["", "S", "A1", "A2", "A3"];
const LIVE_SKILL_ALLOWED = ["", "S", "A", "A1", "A2", "A3"];
const skillSaveTimers = new Map();

function scheduleSkillLevelSave(subjectId, studentId, value) {
  if (!subjectId || !studentId) return;
  if (!FINAL_SKILL_ALLOWED.includes(value)) return;
  const key = `${subjectId}::${studentId}`;
  const existing = skillSaveTimers.get(key);
  if (existing) {
    clearTimeout(existing);
  }
  const timer = setTimeout(() => {
    skillSaveTimers.delete(key);
    performSkillLevelSave(subjectId, studentId, value).catch((err) => {
      console.error("[skill-level save]", err);
    });
  }, SKILL_LEVEL_SAVE_DEBOUNCE_MS);
  skillSaveTimers.set(key, timer);
}

async function performSkillLevelSave(subjectId, studentId, value) {
  const db = getFirestore();
  const ref = doc(db, `${SKILL_LEVEL_COLLECTION_PREFIX}${currentYear}`, subjectId);
  await setDoc(
    ref,
    {
      levels: {
        [studentId]: value,
      },
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
// js/score_input_students.js
// STEP A：学生名簿の取得・フィルタ・テーブル行レンダリング専用モジュール

/**
 * 学生関連の状態オブジェクトを作成
 * - allStudents: students コレクション全件
 * - currentStudents: 現在選択中科目の学生リスト
 */
export function createStudentState() {
  return {
    allStudents: [],
    allStudentsGrade: null,
    gradeStudentsCache: new Map(),
    baseStudents: [],
    currentStudents: [],
    electiveStudents: [],   // 選択科目用（追加するだけ）
    finalScores: new Map(),
  };
}

/**
 * Firestore から students を全件取得して state に格納
 *
 * @param {import("firebase/firestore").Firestore} db
 * @param {{ allStudents: any[] }} studentState
 */
export async function loadAllStudents(db, studentState) {
  const q = query(collection(db, "students"), where("isActive", "==", true));
  let snap;
  try {
    snap = await getDocs(q);
  } catch (err) {
    if (err.code === "resource-exhausted" || String(err.message).includes("Quota exceeded")) {
      activateQuotaErrorState();
      throw err;
    } else {
      throw err;
    }
  }
  // 正規化して UI 用フィールドを確実に持たせる
  const normalize = (d) => {
    const src = d || {};
    const studentId = src.studentId ?? src.id ?? "";
    const grade = src.grade ?? "";
    const course = src.course ?? src.courseClass ?? "";
    const group = src.group ?? src.class ?? src.classGroup ?? "";
    return {
      studentId: String(studentId),
      grade,
      group,
      course,
      courseClass: course,
      classGroup: src.classGroup ?? "",
      number: src.number ?? null,
      name: src.name ?? "",
    };
  };
  studentState.allStudents = snap.docs.map((d) => normalize(d.data() || {}));
}

const STUDENT_IN_BATCH_SIZE = 10;

/**
 * studentIdのリストから該当学生情報を取得（返却順は studentIds 順）
 */
export async function loadStudentsByIds(db, studentIds) {
  if (!Array.isArray(studentIds) || studentIds.length === 0) return [];
  const batches = [];
  for (let i = 0; i < studentIds.length; i += STUDENT_IN_BATCH_SIZE) {
    batches.push(studentIds.slice(i, i + STUDENT_IN_BATCH_SIZE));
  }
  const fetched = [];
  for (const batch of batches) {
    const ids = batch.map((id) => String(id));
    const q = query(
      collection(db, "students"),
      where("studentId", "in", ids)
    );
    let snap;
    try {
      snap = await getDocs(q);
    } catch (err) {
      if (err.code === "resource-exhausted" || String(err.message).includes("Quota exceeded")) {
        activateQuotaErrorState();
        throw err;
      } else {
        throw err;
      }
    }
    fetched.push(...snap.docs.map((d) => d.data() || {}));
  }
  const byId = new Map();
  // 正規化して byId に格納
  fetched.forEach((stu) => {
    const src = stu || {};
    const key = src.studentId != null ? String(src.studentId) : null;
    if (key !== null && !byId.has(key)) {
      const normalized = {
        studentId: String(src.studentId ?? src.id ?? ""),
        grade: src.grade ?? "",
        group: src.group ?? src.class ?? src.classGroup ?? "",
        course: src.course ?? src.courseClass ?? "",
        courseClass: src.course ?? src.courseClass ?? "",
        classGroup: src.classGroup ?? "",
        number: src.number ?? null,
        name: src.name ?? "",
      };
      byId.set(key, normalized);
    }
  });
  const ordered = [];
  studentIds.forEach((id) => {
    const key = id != null ? String(id) : null;
    if (key && byId.has(key)) {
      ordered.push(byId.get(key));
    }
  });
  return ordered;
}

/**
 * 科目ごとの名簿（studentIds）を取得
 * @param {import("firebase/firestore").Firestore} db
 * @param {string|number} year
 * @param {string} subjectId
 * @returns {Promise<null|any[]>}
 */
export async function loadSubjectRoster(db, year, subjectId) {
  const rosterYear = year || CURRENT_YEAR;
  if (!subjectId) return null;
  const ref = doc(db, `subjectRoster_${rosterYear}`, subjectId);
  let snap;
  try {
    snap = await getDoc(ref);
  } catch (err) {
    if (err.code === "resource-exhausted" || String(err.message).includes("Quota exceeded")) {
      activateQuotaErrorState();
      throw err;
    } else {
      throw err;
    }
  }
  if (!snap.exists()) return null;
  const data = snap.data() || {};
  return Array.isArray(data.studentIds) ? data.studentIds : null;
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
  // 1・2年は学年全体 → 組（1〜5）→番号 順で並べる（KTC仕様）
if (targetGrade === "1" || targetGrade === "2") {
  const result = byGrade.slice().sort((a, b) => {
    const classA = Number(a.courseClass || a.classGroup || 0);
    const classB = Number(b.courseClass || b.classGroup || 0);
    if (classA !== classB) return classA - classB;

    const numA = Number(a.number || 0);
    const numB = Number(b.number || 0);
    return numA - numB;
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
 * @param {{ skillLevelsMap?: object }} [studentState]
 */
export function renderStudentRows(
  tbody,
  subject,
  students,
  criteriaItems,
  onScoreInputChange,
  studentState
)
 {
  // ===== 表の総列数を動的に計算（specialType/習熟度/評価基準の違いで崩れないようにする） =====
  const getTotalColumnCount = () => {
    let count = 0;
    // 習熟度
    if (subject && subject.isSkillLevel === true) count += 1;
    // 基本情報（学籍番号, 学年, 組・コース, 番号, 氏名）
    count += 5;
    const sp = Number(subject?.specialType ?? 0);
     // 評価入力列（通常: criteriaItems数 / 無し:"-" / 特別: 合否 or 認定）
    if (sp === 1 || sp === 2) {
      count += 1;
    } else if (Array.isArray(criteriaItems) && criteriaItems.length > 0) {
      count += criteriaItems.length;
    } else {
      count += 1;
    }
    // 最終成績
    count += 1;
    return count;
  };

  const bodyTable = tbody?.closest("table");
  // 列幅を固定する colgroup をテーブル先頭に挿入（thead/tbody より前）
  if (bodyTable) {
    const existing = bodyTable.querySelector("colgroup");
    if (existing) existing.remove();

    const colgroup = document.createElement("colgroup");
    const addCol = (px) => {
      const col = document.createElement("col");
      col.style.width = px;
      colgroup.appendChild(col);
    };

    const enableSkillLevel = subject && subject.isSkillLevel === true;
    if (enableSkillLevel) addCol("72px");

    addCol("110px"); // 学籍番号
    addCol("56px");  // 学年
    addCol("84px");  // 組・コース
    addCol("56px");  // 番号
    addCol("160px"); // 氏名

    const spForCols = Number(subject?.specialType ?? 0);

    // 評価入力列（通常: criteriaItems数 / 無し:"-" / 特別: 合否 or 認定）
    if (spForCols === 1 || spForCols === 2) {
      addCol("140px");
    } else if (Array.isArray(criteriaItems) && criteriaItems.length > 0) {
      criteriaItems.forEach(() => addCol("140px"));
    } else {
      addCol("140px");
    }

    addCol("90px"); // 最終成績

    bodyTable.insertBefore(colgroup, bodyTable.firstElementChild || null);
  }

  tbody.innerHTML = "";

  // 科目未選択
  if (!subject) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = getTotalColumnCount();
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
    td.colSpan = getTotalColumnCount();
    td.className = "no-data";
    td.textContent = "学生情報が登録されていません。";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const stu of students) {
     let specialSelect = null; // ★ ここで宣言（行単位で共有）
    const tr = document.createElement("tr");
    tr.dataset.studentId = stu.studentId;

    const addCell = (text) => {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
      return td;
    };

    // isSkillLevel===true の場合のみ、先頭にinput[type=text]セルを追加
    if (subject && subject.isSkillLevel === true) {
      const subjectId = subject.subjectId || "";
      const studentId = String(stu.studentId ?? "");
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.type = "text";
      input.className = "skill-level-input skill-input";
      input.maxLength = 2;
      input.dataset.studentId = studentId;
      input.readOnly = false;
      input.disabled = false;
      input.addEventListener("input", () => {
        let v = input.value
          .toUpperCase()
          .replace(/　/g, "")
          .replace(/\s+/g, "");
        if (LIVE_SKILL_ALLOWED.includes(v)) {
          input.value = v;
        } else {
          input.value = "";
        }
        const saveValue = FINAL_SKILL_ALLOWED.includes(v) ? v : "";
        if (!studentState.skillLevelsMap) {
          studentState.skillLevelsMap = {};
        }
        studentState.skillLevelsMap[studentId] = saveValue;
        scheduleSkillLevelSave(subjectId, studentId, saveValue);
      });
      input.addEventListener("blur", () => {
        if (!FINAL_SKILL_ALLOWED.includes(input.value)) {
          input.value = "";
        }
      });
      td.appendChild(input);
      tr.appendChild(td);
    }

    addCell(stu.studentId || "");
    addCell(stu.grade ?? "");
    addCell(stu.courseClass ?? "");
    addCell(stu.number ?? "");
    const nameTd = addCell(stu.name ?? "");
    if (nameTd) nameTd.classList.add("student-name");

    // ===== specialType=1：合／否（評価基準は使わない） =====
const sp = Number(subject?.specialType ?? 0);

// ===== specialType=1：合／否 =====
if (sp === 1) {
  const td = document.createElement("td");


specialSelect = document.createElement("select");
specialSelect.className = "pass-fail-select";
specialSelect.dataset.studentId = String(stu.studentId ?? "");
specialSelect.dataset.specialField = "passFail";

specialSelect.innerHTML = `
  <option value="pass">合</option>
  <option value="fail">否</option>
`;
specialSelect.value = "pass";

specialSelect.addEventListener("change", () => {
  specialSelect.dispatchEvent(new Event("input", { bubbles: true }));
});

td.appendChild(specialSelect);
tr.appendChild(td);
// ★ 特別科目（合/否）は選択式：初期値あり＝入力済みにする（送信可否判定用）
const selectEl1 = specialSelect;
const setFilled1 = () => {
  tr.dataset.allFilled = selectEl1.value ? "1" : "0";
};
setFilled1();
selectEl1.addEventListener("input", setFilled1);


// ===== specialType=2：認定(1)/(2) =====
} else if (sp === 2) {
  const td = document.createElement("td");

  specialSelect = document.createElement("select");
specialSelect.className = "cert-select";
specialSelect.dataset.studentId = String(stu.studentId ?? "");
specialSelect.dataset.specialField = "cert";

specialSelect.innerHTML = `
  <option value="cert1">認定(1)</option>
  <option value="cert2">認定(2)</option>
`;
specialSelect.value = "cert1";

specialSelect.addEventListener("change", () => {
  specialSelect.dispatchEvent(new Event("input", { bubbles: true }));
});

td.appendChild(specialSelect);
tr.appendChild(td);
// ★ 特別科目（認定）は選択式：初期値あり＝入力済みにする（送信可否判定用）
const selectEl2 = specialSelect;
const setFilled2 = () => {
  tr.dataset.allFilled = selectEl2.value ? "1" : "0";
};
setFilled2();
selectEl2.addEventListener("input", setFilled2);


// ===== 通常科目（評価基準なし） =====
} else if (!criteriaItems || criteriaItems.length === 0) {
  const td = document.createElement("td");
  td.textContent = "-";
  tr.appendChild(td);

// ===== 通常科目（数値入力） =====
} else {
  criteriaItems.forEach((item, index) => {
    const td = document.createElement("td");
    const input = document.createElement("input");
    input.dataset.weightPercent = String(item.percent ?? 0);

    input.type = "number";
    input.min = "0";
    input.max = "100";
    input.step = "0.1";
    input.dataset.index = String(index);
    input.dataset.criteriaName = item.name;
    input.dataset.studentId = String(stu.studentId);
    input.dataset.itemName = item.name || "";
    input.addEventListener("paste", (ev) => ev.preventDefault());
    td.appendChild(input);

    const span = document.createElement("span");
    span.className = "converted-score";
    span.style.marginLeft = "4px";
    span.textContent = "";
    td.appendChild(span);

    tr.appendChild(td);
  });
}

    const finalTd = document.createElement("td");
finalTd.className = "final-score";

// ===== 特別科目：最終成績は成績入力(select)の値をそのまま表示 =====
if (subject?.specialType === 1 || subject?.specialType === 2) {
  finalTd.textContent = toSpecialDisplay(
    subject.specialType,
    specialSelect?.value || ""
  );

  specialSelect?.addEventListener("input", () => {
    finalTd.textContent = toSpecialDisplay(
      subject.specialType,
      specialSelect?.value || ""
    );
  });
}

tr.appendChild(finalTd);
    tbody.appendChild(tr);
  }
}
// ===== 特別科目用：表示文字変換 =====
function toSpecialDisplay(specialType, value) {
  if (specialType === 1) {
    // 合否
    if (value === "fail") return "否";
    if (value === "pass") return "合";
    return "";
  }

  if (specialType === 2) {
    // 認定
    if (value === "cert2") return "認定(2)";
    if (value === "cert1") return "認定(1)";
    return "";
  }

  return "";
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
// =============================================
// 共通ソート関数（受講者モーダル用）
// =============================================
export function sortStudents(list) {
  if (!Array.isArray(list)) return [];

  return list.slice().sort((a, b) => {
    const ga = Number(a.grade || 0);
    const gb = Number(b.grade || 0);
    if (ga !== gb) return ga - gb;

    // 1〜2年 → 組（1〜5）→ 番号 の順（成績一覧と同じ）
    if (ga <= 2) {
      const classA = Number(a.courseClass || a.classGroup || 0);
      const classB = Number(b.courseClass || b.classGroup || 0);
      if (classA !== classB) return classA - classB;

      const numA = Number(a.number || 0);
      const numB = Number(b.number || 0);
      return numA - numB;
    }

    // 3年以降 → コース M/E/I/C/A → 番号 の順
    const coursePriority = { M: 1, E: 2, I: 3, C: 4, A: 5 };
    const pa =
      coursePriority[String(a.courseClass || "").toUpperCase()] ?? 99;
    const pb =
      coursePriority[String(b.courseClass || "").toUpperCase()] ?? 99;

    if (pa !== pb) return pa - pb;

    const numA = Number(a.number || 0);
    const numB = Number(b.number || 0);
    return numA - numB;
  });
}

// G科目対応の安定ソート（超過学生登録と同一の並び）
export function sortStudentsSameAsExcess(students, subject) {
  const COURSE_ORDER = ["M", "E", "I", "C", "A"];
  const subj = subject || (typeof window !== "undefined" ? window.currentSubject : null);
  const subjCourse = String(subj?.course ?? "").toUpperCase();

  if (subjCourse === "G") {
    return (students || []).slice().sort((a, b) => {
      const aCourse = String(a.courseClass ?? a.course ?? "").toUpperCase();
      const bCourse = String(b.courseClass ?? b.course ?? "").toUpperCase();
      const ca = COURSE_ORDER.indexOf(aCourse);
      const cb = COURSE_ORDER.indexOf(bCourse);
      if (ca !== cb) return ca - cb;
      const na = Number(a.number ?? 0);
      const nb = Number(b.number ?? 0);
      return na - nb;
    });
  }

  return (students || []).slice().sort((a, b) => {
    const ag = String(a.group ?? a.class ?? a.classGroup ?? "");
    const bg = String(b.group ?? b.class ?? b.classGroup ?? "");
    if (ag !== bg) return ag.localeCompare(bg, "ja");
    const na = Number(a.number ?? 0);
    const nb = Number(b.number ?? 0);
    return na - nb;
  });
}

// ===== STEP B-1: 選択科目のみ受講者登録ボタンを表示 =====
export function updateElectiveRegistrationButtons(subject) {
  const electiveAddBtn = document.getElementById("electiveAddBtn");
  const electiveRemoveBtn = document.getElementById("electiveRemoveBtn");
  const electiveArea = document.getElementById("electiveButtonArea");

  if (!electiveAddBtn || !electiveRemoveBtn || !electiveArea) return;

  // 初期状態：必ず非表示
  electiveArea.classList.remove("is-visible");

  // 選択科目であれば必ず表示（Gかどうかは関係なし）
  if (subject && subject.required === false) {
    electiveArea.classList.add("is-visible");
  }
}

export function canSubmitScoresByVisibleRows() {
  const rows = document.querySelectorAll("#scoreTableBody tr");

  let total = 0;
  let filled = 0;

  rows.forEach(tr => {
    // 表示されていない行は対象外（保険）
    if (tr.offsetParent === null) return;

    total++;

    if (tr.dataset.allFilled === "1") {
      filled++;
    }
  });

  return {
    ok: total > 0 && total === filled,
    total,
    filled
  };  
}


function buildSubmittedSnapshot({ scoresDocData, scope }) {
  const rows = document.querySelectorAll("#scoreTableBody tr");

  const students = {};

  rows.forEach(tr => {
    if (tr.offsetParent === null) return;

    const studentId = String(tr.dataset.studentId);
    if (!studentId) return;

    const studentData = scoresDocData.students?.[studentId];
    if (!studentData || typeof studentData !== "object") return;

    // submittedSnapshot や updatedAt などの非学生キーを除外
    if (studentId === "submittedSnapshot" || studentId === "updatedAt") return;

    students[studentId] = { ...studentData };

  });

  return {
    scope,
    students,
    submittedAt: new Date()
  };
}

// ================================
// STEP C: 成績送信（教務提出）
// ================================
window.submitScoresForSubject =async function () {
  // 1) 送信可否チェック（既存ロジック）
  const check = canSubmitScoresByVisibleRows();
  if (!check.ok) {
    alert("未入力の学生がいます。表示中の全員分を入力してから送信してください。");
    return;
  }

  // 2) 最新の成績データ取得（STEP B で確認済み）
  if (!window.__latestScoresDocData || !window.__latestScoresDocData.students) {
  alert("成績データを取得できません。画面を再読み込みしてください。");
  return;
}

const subjectId = window.currentSubject?.subjectId;
if (!subjectId) {
  alert("科目情報を取得できません。画面を再読み込みしてください。");
  return;
}

const submittedSnapshot = buildSubmittedSnapshot({
  scoresDocData: window.__latestScoresDocData,
  scope: {
    subjectId,
    filter: "currentView"
  }
});

  // 4) Firestore 更新（1回だけ）
  try {
    const ref = doc(db, `scores_${currentYear}`, subjectId);

        await updateDoc(ref, {
      submittedSnapshot: {
        ...submittedSnapshot,
        submittedAt: serverTimestamp(),
      },
      updatedAt: serverTimestamp(),
    });

    // ✅ 提出成功直後にUIを即時反映（snapshot待ちにしない）
    try {
      const periodRef = doc(db, "settings", "period");
      const periodSnap = await getDoc(periodRef);
      const periodData = periodSnap.exists() ? periodSnap.data() : null;

      if (typeof window.updateSubmitUI === "function") {
        window.updateSubmitUI({
          subjectDocData: {
            ...(window.__latestScoresDocData || {}),
            submittedSnapshot: {
              ...submittedSnapshot,
              submittedAt: new Date(), // 表示用（Firestore側は serverTimestamp が入る）
            },
          },
          periodData,
        });
      }
    } catch (e) {
      console.warn("[submitScoresForSubject] immediate updateSubmitUI skipped", e);
    }

    alert("成績を送信しました（教務提出）。");
  } catch (e) {
    console.error(e);
    alert("成績送信に失敗しました。時間をおいて再度お試しください。");
  }
}

// ================================
// UI: 送信（教務提出）ボタン
// ================================
const submitBtn = document.getElementById("submitScoresBtn");
if (submitBtn) {
  submitBtn.addEventListener("click", async () => {
    const ok = confirm(
      "この操作は教務への正式提出です。\n" +
      "送信後は原則として修正できません。\n\n" +
      "本当に送信しますか？"
    );
    if (!ok) return;

    await window.submitScoresForSubject();
  });
}

// ============================================
// 自己完結型：送信ボタン状態の自動監視
// ============================================
(function setupSubmitButtonAutoWatcher() {
  const btn = document.getElementById("submitScoresBtn");
  if (!btn) return;

  // 初期状態
  try {
    btn.disabled = !canSubmitScoresByVisibleRows().ok;
  } catch (_) {}

  // 成績表全体を監視（再描画・入力変更をすべて拾う）
  const tbody = document.getElementById("scoreTableBody");
  if (!tbody) return;

  const update = () => {
    try {
      const check = canSubmitScoresByVisibleRows();
      btn.disabled = !check.ok;
    } catch (e) {
      btn.disabled = true;
    }
  };

  // ① 行の追加・削除・再描画を監視
  const observer = new MutationObserver(update);
  observer.observe(tbody, {
    childList: true,
    subtree: true,
  });

  // ② 入力変更をすべて拾う（input / change）
  tbody.addEventListener("input", update, true);
  tbody.addEventListener("change", update, true);
})();

// ============================================
// 提出状態に応じた送信ボタンUI制御
// ============================================
window.updateSubmitUI = function ({ subjectDocData, periodData } = {}) {
  const btn = document.getElementById("submitScoresBtn");
  if (!btn) return;

  const submitted = !!subjectDocData?.submittedSnapshot;

  // period は settings/period をそのまま想定
  const now = Date.now();
  const toMs = (v) => {
    if (!v) return null;
    if (typeof v.toMillis === "function") return v.toMillis();
    return Date.parse(v);
  };

  const p = periodData || {};
  const start = toMs(p.submitStart ?? p.submit_from);
  const end   = toMs(p.submitEnd   ?? p.submit_to);

  const inPeriod =
    (!start || now >= start) &&
    (!end   || now <= end);

  // ===== 状態別UI =====
  if (!inPeriod) {
    btn.textContent = submitted ? "提出済み（期間外）" : "提出（期間外）";
    btn.disabled = true;
    return;
  }

  if (submitted) {
    btn.textContent = "再提出する";
    btn.disabled = false;
    return;
  }

  // 未提出・期間内
  btn.textContent = "教務へ提出";
  btn.disabled = !canSubmitScoresByVisibleRows().ok;
};
