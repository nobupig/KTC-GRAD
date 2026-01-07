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
                   studentState.allStudentsGrade = String(grade);
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
    where("grade", "==", Number(grade))
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
studentState.allStudentsGrade = String(grade);

// ★ 0件はキャッシュしない（重要）
if (studentState.allStudents.length > 0) {
  try {
    sessionStorage.setItem(
      cacheKey,
      JSON.stringify({ ts: Date.now(), data: studentState.allStudents })
    );
  } catch (e) {
    // ignore
  }
} else {
  // 念のため壊れたキャッシュを削除
  sessionStorage.removeItem(cacheKey);
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
  studentState,
  completion
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
      const isAllView = String(window.__currentFilterKey || "all") === "all";
      input.disabled = isAllView ? (subject?.isSkillLevel !== true) : false;
      input.className = "skill-level-input skill-input";
      input.maxLength = 2;
      input.dataset.studentId = studentId;
      input.readOnly = false;
     
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

input.type = "text";
input.inputMode = "decimal"; // ← モバイル用
input.addEventListener("input", () => {
  // 数字と . 以外を即座に除去（valueは破壊しない）
  input.value = input.value.replace(/[^\d.]/g, "");
});
input.addEventListener("blur", () => {
  if (input.value === "") return;

  const v = Number(input.value);
  if (!Number.isFinite(v)) {
    input.value = "";
    return;
  }

  const max = Number(item.max);
  if (Number.isFinite(max) && v > max) {
    // 値は残す（A仕様）
    input.classList.add("ktc-input-error");
  } else {
    input.classList.remove("ktc-input-error");
  }
    // ★ これを追加：最終成績を即時再計算
  updateAllFinalScores(
    input.closest("tbody"),
    window.criteriaState,
    window.currentContext
  );
});

input.pattern = "^\\d*(\\.\\d*)?$"; // 数値＋小数のみ
input.placeholder = `0～${item.max}`;


 const isAllView = String(window.__currentFilterKey || "all") === "all";
if (isAllView) input.disabled = true;

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
// ================================
// 提出済ユニットの編集ロックUI（completion基準）
// ================================

let unitKey = null;

// 習熟度科目では unitKey（組）を生成しない
if (!subject?.isSkillLevel) {
  unitKey = getUnitKeyForStudent(stu, subject);
}


const completedUnits =
  Array.isArray(completion?.completedUnits)
    ? completion.completedUnits
    : [];


// ================================
// ★ ロック判定（科目タイプ別）
// ================================
let isLocked = false;

// 習熟度科目：unitKey（組）という概念を使わない
if (subject?.isSkillLevel === true) {
  const currentUnit = String(window.currentSkillFilter || "").toUpperCase();
  isLocked = completion?.completedUnits?.includes(currentUnit);
}

 else if (completedUnits.includes("__SINGLE__")) {
  isLocked = true;

// 通常・共通科目（組／コース単位）
} else {
  isLocked = completedUnits.includes(unitKey);
}

if (isLocked) {
  tr.classList.add("locked-row");

  // 行内の input / select を全て無効化
  tr.querySelectorAll("input, select").forEach(el => {
    el.disabled = true;
  });

  tr.title = "このユニットは既に提出済みのため編集できません";
}

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


function buildSubmittedSnapshotByUnit({ scoresDocData, subject, scope}) {

// ★ 習熟度科目：S / A1 / A2 / A3 を unitKey として扱う
if (subject?.isSkillLevel === true) {
  const rows = document.querySelectorAll("#scoreTableBody tr");
  const units = {};

  // ★ 現在のフィルタ（S / A1 / A2 / A3）
  const unitKey = String(window.currentSkillFilter || "").toUpperCase();

if (!["S", "A1", "A2", "A3"].includes(unitKey)) {
  console.warn("[skill submit] invalid unitKey:", unitKey);
  return {
    units: {},
    scope: "skill"
  };
}

  rows.forEach(tr => {
    if (tr.offsetParent === null) return;

    const studentId = String(tr.dataset.studentId);
    if (!studentId) return;

    const studentData = scoresDocData.students?.[studentId];
    if (!studentData) return;

    if (!units[unitKey]) {
      units[unitKey] = { students: {} };
    }

    units[unitKey].students[studentId] = { ...studentData };
  });

  return { units, scope };
}

    // ★ 現在選択中ユニット（UI単位）を保持
  if (scope && scope.unitKey) {
    window.currentUnitKey = scope.unitKey;
  }
  
  const rows = document.querySelectorAll("#scoreTableBody tr");

  const units = {};

  rows.forEach(tr => {
    if (tr.offsetParent === null) return;

    const studentId = String(tr.dataset.studentId);
    if (!studentId) return;

    const studentData = scoresDocData.students?.[studentId];
    if (!studentData || typeof studentData !== "object") return;
// student 情報は DOM 行（stu）ではなく students マスタから引く
// student マスタ（全学生）から取得（★window.studentState を参照）
const master = window.studentState?.allStudents?.find(
  s => String(s.studentId) === String(studentId)
);
if (!master) return;

const student = {
  studentId,
    group: master.group || "",
  courseClass: master.courseClass || "",
  classGroup: master.classGroup || "",
};


const unitKey = getUnitKeyForStudent(student, subject);

    if (!unitKey) return;

    if (!units[unitKey]) {
      units[unitKey] = {
        students: {}
      };
    }

    units[unitKey].students[studentId] = { ...studentData };
  });

  return {
    units,
    scope
  };
}



// ==========================================
// completion 用：requiredUnits 解決関数
// loader.js と同一ロジック（students.js 用）
// ==========================================
function resolveRequiredUnits({ grade, subjectMeta }) {
  const isCommon = subjectMeta?.isCommon === true;

  // ★ 単一科目：提出が1回でもあれば完了扱い
  if (!isCommon) {
    return ["__SINGLE__"];
  }

  // 共通科目
  if (grade === "1" || grade === "2") {
    return ["1", "2", "3", "4", "5"];
  }

  return ["M", "E", "I", "CA"];
}




// ================================
// STEP C: 成績送信（教務提出）
// ================================
window.submitScoresForSubject = async function () {
  // ================================
// ★ Auth 完了保証（teacherEmail missing 対策）
// ================================
if (!window.currentUser || !window.currentUser.email) {
  console.error("[submit] currentUser not ready", window.currentUser);
  alert("ログイン情報の取得が完了していません。\n数秒待ってから再度送信してください。");
  return;
}

  // 1) 送信可否チェック（既存）
  const check = canSubmitScoresByVisibleRows();
  if (!check.ok) {
    alert("未入力の学生がいます。表示中の全員分を入力してから送信してください。");
    return;
  }

  // 2) 成績データ確認
  if (!window.__latestScoresDocData || !window.__latestScoresDocData.students) {
    alert("成績データを取得できません。画面を再読み込みしてください。");
    return;
  }

  const subject = window.currentSubject;
  const subjectId = subject?.subjectId;
  if (!subjectId) {
    alert("科目情報を取得できません。画面を再読み込みしてください。");
    return;
  }
if (!window.studentState || !window.studentState.allStudents) {
  console.error("studentState not ready", studentState);
  alert("学生データがまだ読み込まれていません。少し待ってから再度送信してください。");
  return;
}
  // ★ 教務送信時：現在表示中のユニットを必ず確定させる
if (!window.currentUnitKey) {
  const firstVisibleRow = document.querySelector(
    "#scoreTableBody tr:not([style*='display: none'])"
  );
  if (firstVisibleRow) {
    const sid = String(firstVisibleRow.dataset.studentId);
  const master = window.studentState.allStudents.find(
  s => String(s.studentId) === sid
);
    if (master) {
      window.currentUnitKey = getUnitKeyForStudent(master, subject);
    }
  }
}

  // 3) 表示中データを unitKey 単位で分解
  const snapshotByUnit = buildSubmittedSnapshotByUnit({
    scoresDocData: window.__latestScoresDocData,
    subject,
    scope: {
      subjectId,
      filter: "currentView",
      unitKey: window.currentUnitKey
    }
  });

  // 4) Firestore 更新
  try {
    const ref = doc(db, `scores_${currentYear}`, subjectId);

    const updatePayload = {};
    const now = serverTimestamp();
    const userEmail = window.currentUser?.email || "";

    if (!snapshotByUnit || !snapshotByUnit.units) {
  alert("送信対象の成績データがありません。");
  return;
}

    Object.entries(snapshotByUnit.units).forEach(([unitKey, unitData]) => {
      updatePayload[`submittedSnapshot.units.${unitKey}`] = {
        students: unitData.students,
        submittedAt: now,
        submittedBy: userEmail,
        scope: snapshotByUnit.scope
      };
    });

    if (Object.keys(updatePayload).length === 0) {
      alert("送信対象の成績データがありません。");
      return;
    }

 // ================================
// completion 再計算（提出成功前に確定値を作って一緒に保存）
// ================================

let completion;

if (subject?.isSkillLevel === true) {
  const requiredUnits = ["S", "A1", "A2", "A3"];

  const existingUnits = Object.keys(
    window.__latestScoresDocData?.submittedSnapshot?.units || {}
  );
  const newUnits =
  snapshotByUnit && snapshotByUnit.units
    ? Object.keys(snapshotByUnit.units)
    : [];

  const completedUnits = Array.from(
    new Set([...existingUnits, ...newUnits])
  );

  const isCompleted = requiredUnits.every(u =>
    completedUnits.includes(u)
  );

  completion = {
    requiredUnits,
    completedUnits,
    isCompleted,
    completedAt: isCompleted ? now : null,
    completedBy: isCompleted ? userEmail : null,
  };
}

 else {
  // ================================
  // 既存：unitKey ベース completion
  // ================================
  const requiredUnits = resolveRequiredUnits({
    grade: String(subject?.grade ?? ""),
    subjectMeta: window.currentSubjectMeta
  });

  const existingUnits = Object.keys(
    window.__latestScoresDocData?.submittedSnapshot?.units || {}
  );
  const newUnits =
  snapshotByUnit && snapshotByUnit.units
    ? Object.keys(snapshotByUnit.units)
    : [];
  const submittedAny = Array.from(new Set([...existingUnits, ...newUnits]));

  let completedUnits;
  let isCompleted;

  if (requiredUnits?.[0] === "__SINGLE__") {
    isCompleted = submittedAny.length > 0;
    completedUnits = submittedAny;
  } else {
    completedUnits = submittedAny;
    isCompleted =
      requiredUnits.length > 0 &&
      requiredUnits.every(u => completedUnits.includes(u));
  }

  completion = {
    requiredUnits,
    completedUnits,
    isCompleted,
    completedAt: isCompleted ? now : null,
    completedBy: isCompleted ? userEmail : null,
  };
}

await updateDoc(ref, {
  ...updatePayload,
  completion,      // ★これを追加
  updatedAt: now,
});

// ================================
// STEP3-B: completion を teacherSubjects に複写（確実版）
// ================================
try {
  const teacherEmail = window.currentUser?.email || "";
  if (!teacherEmail) throw new Error("teacherEmail missing (window.currentUser.email)");

  const tsRef = doc(db, `teacherSubjects_${currentYear}`, teacherEmail);

  // まず読めるか確認（読めないならルール or 認証）
  const tsSnap = await getDoc(tsRef);
  if (!tsSnap.exists()) {
    throw new Error(`teacherSubjects doc not found: ${teacherEmail}`);
  }

  const data = tsSnap.data() || {};
  const subjects = Array.isArray(data.subjects) ? data.subjects : [];

  // subjectId 一致を “ログで” 必ず確認
  const hitIndex = subjects.findIndex(s => s?.subjectId === subjectId);
console.log("[completion copy] subjectId=", subjectId, "hitIndex=", hitIndex);

const completionSummary = {
  isCompleted: completion.isCompleted,
  completedUnits: completion.completedUnits,
  requiredUnits: completion.requiredUnits,
  completedAt: completion.isCompleted ? true : null,
};
// ★ ここが唯一の修正点
const updatedSubjects =
  hitIndex >= 0
    ? subjects.map(s => {
        if (s?.subjectId === subjectId) {
          return {
            ...s,
            completionSummary,
          };
        }
        return s;
      })
    : [
        ...subjects,
        {
          subjectId,
          completionSummary,
        },
      ];

await setDoc(
  tsRef,
  {
    subjects: updatedSubjects,
  },
  { merge: true }
);

// ★ 配列と分けて更新する
await updateDoc(tsRef, {
  completionUpdatedAt: serverTimestamp(),
});


  console.log("[completion copy] DONE", { teacherEmail, subjectId, completionSummary });

} catch (e) {
  // ★ 握りつぶさず “エラー” にする（あなたが気づけるように）
  console.error("[completion copy] FAILED", e);
}


    // ★ 送信直後フラグ（自動UI更新による復活防止）
    window.__justSubmitted = true;

// ===============================
// STEP3-1：送信直後に即ロック
// ===============================
try {
  // 提出ボタンを即ロック
  const submitBtn = document.getElementById("submitScoresBtn");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "提出済み";
  }

  // 一時保存も無効化
  const saveBtn = document.getElementById("saveTempBtn");
  if (saveBtn) saveBtn.disabled = true;

  // 表示中の行を即ロック
  const tbody = document.getElementById("scoreTableBody");
  if (tbody) {
    tbody.querySelectorAll("tr").forEach((tr) => {
      if (tr.offsetParent === null) return;
      tr.classList.add("locked-row");
      tr.querySelectorAll("input, select, textarea").forEach((el) => {
        el.disabled = true;
      });
    });
    if (typeof window.showSubmittedLockNotice === "function") {
  window.showSubmittedLockNotice();
}
  }
} catch (e) {
  console.warn("[STEP3-1] immediate lock skipped:", e);
}
const goNext = window.confirm(
  "送信しました。\n別の組・コースの入力を続けますか？"
);
if (!goNext) {
  document.getElementById("backHomeBtn")?.click();
  return;
}

    // 送信完了案内は confirm 済み

  } catch (e) {
    console.error(e);
    alert("成績送信に失敗しました。時間をおいて再度お試しください。");
  }
};


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

 // 初期状態（提出UIの最終判定に委譲）
try {
  if (typeof window.updateSubmitUI === "function") {
    window.updateSubmitUI({
      subjectDocData: window.__latestScoresDocData || {},
      periodData: window.__latestPeriodData || {},
    });
  } else {
    btn.disabled = !canSubmitScoresByVisibleRows().ok;
  }
} catch (_) {}


  // 成績表全体を監視（再描画・入力変更をすべて拾う）
  const tbody = document.getElementById("scoreTableBody");
  if (!tbody) return;

 const update = () => {
  try {
        // ★ 送信直後は自動更新を完全停止（即ロック維持）
    if (window.__justSubmitted) {
      btn.disabled = true;
      btn.textContent = "提出済み";
      
    }

    if (typeof window.updateSubmitUI === "function") {
      window.updateSubmitUI({
        subjectDocData: window.__latestScoresDocData || {},
        periodData: window.__latestPeriodData || {},
      });
    } else {
      const check = canSubmitScoresByVisibleRows();
      btn.disabled = !check.ok;
    }
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

// ★ unitKey 決定関数（確定仕様）
function getUnitKeyForStudent(student, subject) {
  if (!student || !subject) return null;

  // 1・2年 → 組
if (["1", "2"].includes(String(subject.grade))) {
  const unitKey = String(
    student.group ||
    student.classGroup ||
    student.courseClass ||
    ""
  );
 
  return unitKey;
}

  // 3年以上 → コース
  return String(student.courseClass || "");
  
}


