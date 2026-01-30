// ================================
// ユニット選択（共通科目）
// ================================
export function renderUnitList(units) {
  const list = document.getElementById("unitList");
  const btn = document.getElementById("unitConfirmBtn");
  list.innerHTML = "";
  
  let selectedKey = null;

  Object.entries(units)
    .filter(([, u]) => u.isSubmitted === true)
    .forEach(([unitKey, u]) => {
      const label = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "unit";
      radio.value = unitKey;
      radio.onchange = () => {
        selectedKey = unitKey;
        btn.disabled = false;
      };
      label.appendChild(radio);
      label.append(` ${unitKey}（${new Date(u.submittedAt).toLocaleString()}）`);
      list.appendChild(label);
      list.appendChild(document.createElement("br"));
    });

  btn.onclick = () => {
    document.getElementById("unitSelectSection").hidden = true;
    document.getElementById("studentListSection").hidden = false;
    renderStudentTable(units[selectedKey].scores, { editable: CAN_EDIT });


  };
}

// ================================
// 学生一覧（読み取り専用）
// ================================
// ================================
// 学生一覧（修正モード：編集可能）
// ================================
export function renderStudentTable(scores, options = {}) {
  const {
    editable = true,          // 成績入力期間中か
  } = options;

  const tbody = document.getElementById("studentTableBody");
  tbody.innerHTML = "";

  scores.forEach((s) => {
    const tr = document.createElement("tr");

if (!editable) {
  tr.classList.add("locked-row");
}


    // 点数 input
    const scoreInput = document.createElement("input");
    scoreInput.type = "number";
    scoreInput.min = 0;
    scoreInput.max = 100;
    scoreInput.value = s.score ?? "";
    scoreInput.disabled = !editable;
    scoreInput.style.width = "60px";

    scoreInput.addEventListener("change", () => {
      s.score = Number(scoreInput.value);
      s.isRed = s.score < 60;
      s.__dirty = true;
      updateRedDot();
    });

    // 赤点表示
    const redDot = document.createElement("span");
    const updateRedDot = () => {
      redDot.textContent = s.isRed ? "●" : "";
      redDot.style.color = "red";
    };
    updateRedDot();

    // 超過 checkbox
    const excessCheckbox = document.createElement("input");
    excessCheckbox.type = "checkbox";
    excessCheckbox.checked = s.isExcess === true;
    excessCheckbox.disabled = !editable;

    // 超過時間 input
    const excessHoursInput = document.createElement("input");
    excessHoursInput.type = "number";
    excessHoursInput.min = 1;
    excessHoursInput.style.width = "50px";
    excessHoursInput.value = s.excessHours ?? "";
    excessHoursInput.disabled = !editable || !excessCheckbox.checked;

    excessCheckbox.addEventListener("change", () => {
      s.isExcess = excessCheckbox.checked;
      if (!s.isExcess) {
        s.excessHours = "";
        excessHoursInput.value = "";
      }
      excessHoursInput.disabled = !editable || !s.isExcess;
      s.__dirty = true;
    });

    excessHoursInput.addEventListener("change", () => {
      s.excessHours = Number(excessHoursInput.value);
      s.__dirty = true;
    });

    tr.innerHTML = `
      <td>${s.studentNo}</td>
      <td>${s.name}</td>
      <td style="text-align:center">${s.course}</td>
      <td style="text-align:center">${s.no}</td>
    `;

    // 点数
    const tdScore = document.createElement("td");
    tdScore.appendChild(scoreInput);
    tr.appendChild(tdScore);

    // 赤点
    const tdRed = document.createElement("td");
    tdRed.style.textAlign = "center";
    tdRed.appendChild(redDot);
    tr.appendChild(tdRed);

    // 超過
    const tdExcess = document.createElement("td");
    tdExcess.style.textAlign = "center";
    tdExcess.appendChild(excessCheckbox);
    tr.appendChild(tdExcess);

    // 超過時間
    const tdHours = document.createElement("td");
    tdHours.style.textAlign = "center";
    tdHours.appendChild(excessHoursInput);
    tr.appendChild(tdHours);

    tbody.appendChild(tr);
  });
}




