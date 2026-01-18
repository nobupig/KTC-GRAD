// js/score_input_excel.js
// ⚠ Excelダウンロード処理では Firestore を再 read しない（設計固定）

function ensureXLSX() {
  if (typeof window.XLSX === "undefined") {
    throw new Error("XLSX (SheetJS) が読み込まれていません。score_input.html に CDN script を追加してください。");
  }
  return window.XLSX;
}

function sanitizeSheetName(name) {
  // Excelシート名は 31 文字、禁止文字: : \ / ? * [ ]
  return String(name || "入力")
    .replace(/[:\\\/\?\*\[\]]/g, " ")
    .slice(0, 31);
}

function buildHowToSheetAoA(subjectMeta) {
  const subjectName = subjectMeta?.name ?? "（科目名不明）";
  return [
    ["近大高専 成績入力（Excel補助） 使い方"],
    [],
    ["目的", "このExcelは成績入力の補助ツールです。最終確定・保存はWebで行ってください。"],
    [],
    ["手順"],
    ["1", "入力方式（素点入力専用）を確認"],
    ["2", "点数欄に入力（編集できるのはモードと点数のみ）"],
    ["3", "必要に応じてWeb画面に転記して保存"],
    [],
    ["編集できる", "入力モード / 点数欄"],
    ["編集できない", "名簿 / 評価項目名 / 並び順 / 計算セル"],
    [],
    ["重要な注意"],
    ["このExcelでは、点数は必ず《素点》を入力してください。"],
    ["換算後の点数（例：16点など）を直接入力しないでください。"],
    [],
    ["対象科目", subjectName],
  ];
}

/**
 * 共通科目/習熟度科目：DL時に対象クラスを尋ねる
 * - Firestore read はしない
 * - studentState.allStudents を JS で filter
 */
async function promptTargetStudentsIfNeeded({ subject, currentSubjectMeta, studentState }) {
  const all = Array.isArray(studentState?.allStudents) ? studentState.allStudents : [];
  const visible = Array.isArray(studentState?.visibleStudents) ? studentState.visibleStudents : all;

  if (!subject) return { students: visible, label: "all" };

 
// 習熟度科目（学年は問わない）
if (currentSubjectMeta?.isSkillLevel === true) {
  const levels = studentState?.skillLevelsMap || {};

  const options = [
    { key: "all", label: "全員" },
    { key: "S", label: "S" },
    { key: "A1", label: "A1" },
    { key: "A2", label: "A2" },
    { key: "A3", label: "A3" },
    { key: "unset", label: "未設定" },
  ];

  const picked = await openSimplePickModal(
    "ダウンロード対象（習熟度）を選択",
    options
  );

  const filtered =
    picked.key === "all"
      ? all.filter(s => String(s.grade || "") === String(subject.grade))
      : all.filter(s => {
          if (String(s.grade || "") !== String(subject.grade)) return false;

          const raw = levels[String(s.studentId)];

          // 未設定
          if (picked.key === "unset") {
            return raw == null || String(raw).trim() === "";
          }

          // S / A1 / A2 / A3
          return String(raw || "").trim() === picked.key;
        });

  return {
    students: sortStudentsForExcel(filtered, String(subject.grade || "")),
    label: picked.key,
    showSkillLevelColumn: true
  };
}

  // 共通科目判定（loader側のロジックと合わせる）
  const course = String(subject.course || "").toUpperCase();
  const grade = String(subject.grade || "");
  const isCommon = (!course || course === "G" || course === "COMMON");

  if (!isCommon) {
    // 通常は「今表示している名簿」と一致させるのが安全
    return { students: visible, label: "visible" };
  }

  let options;
  if (grade === "1" || grade === "2") {
    options = [
      { key: "all", label: "全員" },
      { key: "1", label: "1組" },
      { key: "2", label: "2組" },
      { key: "3", label: "3組" },
      { key: "4", label: "4組" },
      { key: "5", label: "5組" },
    ];
  } else {
    options = [
      { key: "all", label: "全員" },
      { key: "M", label: "M" },
      { key: "E", label: "E" },
      { key: "I", label: "I" },
      { key: "CA", label: "CA" },
    ];
  }

  const picked = await openSimplePickModal("ダウンロード対象（共通フィルタ）を選択", options);

const filtered =
  picked.key === "all"
    ? all.filter(s => String(s.grade || "") === grade)
    : all.filter(s => {
        // 1・2年：組
        if (grade === "1" || grade === "2") {
          return (
            String(s.grade || "") === grade &&
            String(s.courseClass || "") === picked.key
          );
        }

        // 3年以上：CA（C + A）
        if (picked.key === "CA") {
          return (
            String(s.grade || "") === grade &&
            ["C", "A"].includes(String(s.courseClass || "").toUpperCase())
          );
        }

        // 3年以上：単一コース（M/E/I/C/A）
        return (
          String(s.grade || "") === grade &&
          String(s.courseClass || "").toUpperCase() === picked.key
        );
      });

  return {
  students: sortStudentsForExcel(filtered, grade),
  label: picked.key
};

}

function sortStudentsForExcel(students, grade) {
  const list = students.slice();

  // 1・2年：組 → 番号
  if (grade === "1" || grade === "2") {
    return list.sort((a, b) => {
      const gA = Number(a.courseClass || 0);
      const gB = Number(b.courseClass || 0);
      if (gA !== gB) return gA - gB;
      return Number(a.number || 0) - Number(b.number || 0);
    });
  }

  // 3年以上
  const COURSE_ORDER = { M: 1, E: 2, I: 3, C: 4, A: 5 };

  return list.sort((a, b) => {
    const cA = COURSE_ORDER[String(a.courseClass || "").toUpperCase()] ?? 99;
    const cB = COURSE_ORDER[String(b.courseClass || "").toUpperCase()] ?? 99;
    if (cA !== cB) return cA - cB;
    return Number(a.number || 0) - Number(b.number || 0);
  });
}


function openSimplePickModal(title, options) {
  return new Promise((resolve, reject) => {
    // 既存 modal と衝突しない最小モーダル
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.45)";
    overlay.style.zIndex = "20000";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";

    const panel = document.createElement("div");
    panel.style.background = "#fff";
    panel.style.borderRadius = "12px";
    panel.style.padding = "18px 18px 14px";
    panel.style.width = "min(520px, 92vw)";
    panel.style.boxShadow = "0 10px 30px rgba(0,0,0,0.25)";

    const h = document.createElement("h3");
    h.textContent = title;
    h.style.margin = "0 0 12px";
    h.style.fontSize = "16px";

    const select = document.createElement("select");
    select.style.width = "100%";
    select.style.padding = "8px 10px";
    select.style.borderRadius = "10px";
    select.style.border = "1px solid #d1d5db";
    options.forEach(o => {
      const opt = document.createElement("option");
      opt.value = o.key;
      opt.textContent = o.label;
      select.appendChild(opt);
    });

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    actions.style.gap = "10px";
    actions.style.marginTop = "14px";

    const cancel = document.createElement("button");
    cancel.textContent = "キャンセル";
    cancel.type = "button";
    cancel.style.padding = "8px 14px";
    cancel.style.borderRadius = "999px";
    cancel.style.border = "1px solid #d1d5db";
    cancel.style.background = "#fff";
    cancel.onclick = () => {
      overlay.remove();
      reject(new Error("cancel"));
    };

    const ok = document.createElement("button");
    ok.textContent = "ダウンロード";
    ok.type = "button";
    ok.style.padding = "8px 16px";
    ok.style.borderRadius = "999px";
    ok.style.border = "none";
    ok.style.background = "#004A99";
    ok.style.color = "#fff";
    ok.onclick = () => {
      const key = select.value;
      const picked = options.find(o => o.key === key) || options[0];
      overlay.remove();
      resolve(picked);
    };

    actions.appendChild(cancel);
    actions.appendChild(ok);

    panel.appendChild(h);
    panel.appendChild(select);
    panel.appendChild(actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  });
}

function openExcelDownloadNoticeModal() {
  return new Promise((resolve) => {
    // overlay
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.4)";
    overlay.style.zIndex = "10000";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";

    // panel
    const panel = document.createElement("div");
    panel.style.background = "#fff";
    panel.style.borderRadius = "12px";
    panel.style.padding = "24px";
    panel.style.maxWidth = "520px";
    panel.style.width = "90%";
    panel.style.boxShadow = "0 10px 30px rgba(0,0,0,0.2)";

panel.innerHTML = `
  <h3 style="
    margin-top:0;
    color:#b91c1c;
    font-weight:700;
    display:flex;
    align-items:center;
    gap:8px;
  ">
    ⚠ Excelダウンロードの注意
  </h3>

  <p style="line-height:1.7; margin-bottom:12px;">
    このExcelは
    <span style="
      background:#fef3c7;
      color:#92400e;
      padding:2px 6px;
      border-radius:4px;
      font-weight:600;
    ">
      素点入力専用の補助ツール
    </span>
    です。
  </p>

  <ul style="line-height:1.7; padding-left:20px; margin:0;">
    <li>
      <span style="font-weight:600; color:#b91c1c;">
        換算後の点数や最終成績
      </span>
      は入力しないでください。
    </li>
    <li>
      最終成績の計算・確定は
      <span style="font-weight:600;">
        Web上
      </span>
      で行われます。
    </li>
    
   
    
  </ul>
`;


    // buttons
    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    actions.style.gap = "12px";
    actions.style.marginTop = "20px";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "キャンセル";
    cancelBtn.className = "btn btn-outline-secondary";

    const okBtn = document.createElement("button");
    okBtn.textContent = "OK";
    okBtn.className = "btn btn-primary";

    cancelBtn.onclick = () => {
      overlay.remove();
      resolve(false);
    };
    okBtn.onclick = () => {
      overlay.remove();
      resolve(true);
    };

    actions.append(cancelBtn, okBtn);
    panel.appendChild(actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  });
}

/**
 * DOM(表示中の表) から現在値を回収して、studentId -> scores[] にする
 * - Firestore read なし
 */
function collectScoresFromDOM(criteriaState) {
  const tbody = document.getElementById("scoreTableBody");
  if (!tbody) return new Map();

  const itemCount = Array.isArray(criteriaState?.items) ? criteriaState.items.length : 0;
  const map = new Map();

  const trs = Array.from(tbody.querySelectorAll("tr"));
  for (const tr of trs) {
    const sid = tr.dataset.studentId;
    if (!sid) continue;

    const inputs = Array.from(tr.querySelectorAll("input[type='number']"));
    const scores = new Array(itemCount).fill("");

    for (let i = 0; i < itemCount; i++) {
      const input = inputs[i];
      if (!input) continue;
      const v = input.value;
      if (v === "" || v == null) {
        scores[i] = "";
      } else {
        const n = Number(v);
        scores[i] = Number.isFinite(n) ? n : "";
      }
    }
    map.set(String(sid), scores);
  }
  return map;
}

function buildInputSheetAoA({ subject, criteriaState, students, scoreMap, showSkillLevelColumn,studentState}) {
  const items = Array.isArray(criteriaState?.items) ? criteriaState.items : [];
  const baseHeaders = ["学籍番号", "学年", "組・コース", "番号", "氏名"];

  const criteriaHeaders = items.map((item) => {
    const name = item?.name ?? "";
    const percentValue = Number(item?.percent);
    const percent = Number.isFinite(percentValue) ? percentValue : null;
    const maxValue = Number(item?.max);
    const max = Number.isFinite(maxValue) ? maxValue : null;

    if (percent != null && max != null) {
      return `${name}（${percent}%／${max}点満点）`;
    }
    if (percent != null) {
      return `${name}（${percent}%）`;
    }
    if (max != null) {
      return `${name}（${max}点満点）`;
    }
    return name;
  });

  const headers = showSkillLevelColumn
    ? ["習熟度", ...baseHeaders, ...criteriaHeaders]
    : [...baseHeaders, ...criteriaHeaders];

  const aoa = [];
  // 上部：モードセル（説明用。実際のプルダウン/保護は後で段階導入）
aoa.push([
  "【重要】",
  "このExcelは《入力補助用》です。名簿・項目名・合計欄は編集しないでください。"
]);
aoa.push([
  "",
  "入力できるのは【習熟度列】および【点数欄】のみです。最終確定は必ず Web 上で行ってください。"
]);
aoa.push([
  "",
  "※ 合計欄は参考表示です。ここを書き換えても成績には反映されません。"
]);
aoa.push([]);
aoa.push(headers);


  for (const s of students) {
    const sid = String(s.studentId ?? "");
    const scores = scoreMap.get(sid) || new Array(items.length).fill("");
  const level = String(
  (studentState?.skillLevelsMap ?? {})?.[String(s.studentId)] ?? ""
).trim();

const baseRow = [
  sid,
  String(s.grade ?? ""),
  String(s.courseClass ?? s.course ?? ""),
  String(s.number ?? ""),
  String(s.name ?? ""),
];

const row = showSkillLevelColumn
  ? [level, ...baseRow, ...scores, ""]
  : [...baseRow, ...scores, ""];

    aoa.push(row);
  }
  return aoa;
}

function addSimpleSumFormula(ws, startRow1, startCol1, itemCount) {
  // 合計列：行ごとに SUM(F:...) を入れる（参考用）
  // startRow1: データ開始行(1-based)
  // startCol1: 点数開始列(1-based) 例: F=6
  const XLSX = ensureXLSX();
         const sumCol = startCol1 + itemCount; // 合計列
  for (let r = startRow1; ; r++) {
    const addrStudentId = XLSX.utils.encode_cell({ r: r - 1, c: 0 });
    if (!ws[addrStudentId]) break; // ここで終了（データが途切れた）
    const from = XLSX.utils.encode_cell({ r: r - 1, c: startCol1 - 1 });
    const to = XLSX.utils.encode_cell({ r: r - 1, c: sumCol - 2 }); // 点数列の最後
    const sumAddr = XLSX.utils.encode_cell({ r: r - 1, c: sumCol - 1 });
    ws[sumAddr] = { t: "n", f: `SUM(${from}:${to})` };
  }
}

/**
 * 入口：Excel DL 初期化
 * loader.js から state を渡して使う
 */
export function initExcelDownloadFeature({ getCurrentSubject, getCurrentSubjectMeta, criteriaState, studentState }) {
  const btn = document.getElementById("excelDownloadBtn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
   const ok = await openExcelDownloadNoticeModal();
if (!ok) return;

    
    btn.disabled = true;
    try {
      const XLSX = ensureXLSX();

      const subject = getCurrentSubject?.();
      if (!subject) {
        alert("科目が選択されていません。");
        return;
      }
      // specialType=0のみ（仕様）
   const meta = (typeof getCurrentSubjectMeta === "function") ? getCurrentSubjectMeta() : null;

// specialType=0のみ（仕様）
if (Number(meta?.specialType ?? 0) !== 0) {
  alert("この科目はExcel出力対象外です。");
  return;
}

      // 対象学生（共通/習熟度はDL時に選択）
   const { students, label, showSkillLevelColumn } =
  await promptTargetStudentsIfNeeded({ subject, currentSubjectMeta: meta, studentState });


      // DOMから点数回収（read増加なし）
      const scoreMap = collectScoresFromDOM(criteriaState);

      // AOA作成
      const inputAoA = buildInputSheetAoA({
  subject,
  criteriaState,
  students,
  scoreMap,
  showSkillLevelColumn,
  studentState 
});
      const howToAoA = buildHowToSheetAoA({ name: subject.name });

      // workbook
      const wb = XLSX.utils.book_new();

      const wsHow = XLSX.utils.aoa_to_sheet(howToAoA);
      XLSX.utils.book_append_sheet(wb, wsHow, "使い方");

const wsInput = XLSX.utils.aoa_to_sheet(inputAoA);

// ===============================
// Excel A-1：列の視覚ガイド設定
// ===============================
const HEADER_ROW = 3; // ヘッダ行（1-based）
const TOTAL_ROWS = inputAoA.length;
const TOTAL_COLS = inputAoA[HEADER_ROW - 1].length;

// 色定義
const COLOR_GRAY = "FFE5E7EB";      // 名簿用グレー
const COLOR_LIGHT_GRAY = "FFF3F4F6"; // 合計用グレー

for (let r = HEADER_ROW; r <= TOTAL_ROWS; r++) {
  for (let c = 0; c < TOTAL_COLS; c++) {
    const addr = XLSX.utils.encode_cell({ r: r - 1, c });
    const cell = wsInput[addr];
    if (!cell) continue;

    // 列判定
    const isSkillCol = (c === 0 && showSkillLevelColumn === true);
    const isRosterCol = (
      (showSkillLevelColumn && c >= 1 && c <= 5) ||
      (!showSkillLevelColumn && c <= 4)
    );
    const isTotalCol = (c === TOTAL_COLS - 1);

// 名簿列：グレー
if (isRosterCol) {
  cell.s = {
    fill: {
      patternType: "solid",
      fgColor: { rgb: COLOR_GRAY }
    }
  };
}

// 合計列：薄グレー
if (isTotalCol) {
  cell.s = {
    fill: {
      patternType: "solid",
      fgColor: { rgb: COLOR_LIGHT_GRAY }
    }
  };
}

    // 習熟度列・点数列は何もしない（入力可）
  }
}

// ===============================
// Excel A-2：列幅の視覚ガイド
// ===============================
const cols = [];
let colIndex = 0;

// 習熟度列（入力可）
if (showSkillLevelColumn === true) {
  cols[colIndex++] = { wch: 10 };
}

// 名簿列
cols[colIndex++] = { wch: 14 }; // 学籍番号
cols[colIndex++] = { wch: 6 };  // 学年
cols[colIndex++] = { wch: 10 }; // 組・コース
cols[colIndex++] = { wch: 6 };  // 番号
cols[colIndex++] = { wch: 16 }; // 氏名

// 点数列（評価項目）
const scoreColCount = (criteriaState?.items?.length ?? 0);
for (let i = 0; i < scoreColCount; i++) {
  cols[colIndex++] = { wch: 8 };
}

// 「合計(参考)」列は出力しないため、列幅定義も追加しない
// cols[colIndex++] = { wch: 12 };

wsInput["!cols"] = cols;

const baseColCount = 5 + (showSkillLevelColumn ? 1 : 0);
wsInput["!cols"] = wsInput["!cols"] || [];
for (let i = 0; i < scoreColCount; i++) {
  wsInput["!cols"][baseColCount + i] = { wch: 26 };
}

// ===============================
// Excel A-3：ヘッダ行固定
// ===============================
wsInput["!freeze"] = {
  xSplit: 0,
  ySplit: 3,
  topLeftCell: "A4",
  activePane: "bottomLeft",
  state: "frozen"
};

// ===============================
// 合計（参考）：SUM 数式を挿入
// ===============================

// Excel出力では「合計(参考)」列を作成しないため、SUM式も不要
// // ヘッダ行は headers を含む行（"合計(参考)" を含む行）
// const headerRowIndex = inputAoA.findIndex(row =>
//   Array.isArray(row) && row.includes("合計(参考)")
// ) + 1; // 1-based
//
// const dataStartRow = headerRowIndex + 1;
//
// // 点数開始列（1-based）
// const BASE_HEADERS_COUNT = 5;
// const scoreStartCol1 =
//   (showSkillLevelColumn ? 1 : 0) + BASE_HEADERS_COUNT + 1;
//
// const itemCount = (criteriaState?.items?.length ?? 0);
//
// if (itemCount > 0 && dataStartRow > 0) {
//   addSimpleSumFormula(wsInput, dataStartRow, scoreStartCol1, itemCount);
// }

XLSX.utils.book_append_sheet(wb, wsInput, sanitizeSheetName(subject.name || "入力"));


      // ファイル名
      const safe = String(subject.name || "subject").replace(/[\\\/:*?"<>|]/g, "_");
      const fname = `成績入力_${safe}_${label}.xlsx`;

      XLSX.writeFile(wb, fname, {
  bookType: "xlsx",
  cellStyles: true
});
    } catch (e) {
      if (String(e?.message || "").includes("cancel")) return;
      console.error(e);
      alert("Excelダウンロードに失敗しました。コンソールログを確認してください。");
    } finally {
      // 連打防止を兼ねて少し待って戻す
      setTimeout(() => (btn.disabled = false), 800);
    }
  });
}

  