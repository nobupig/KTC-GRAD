import { loadSubjectAndStudents } from "./score_input_students.js";
import { loadCriteriaAndRenderHeader } from "./score_input_criteria.js";
import { setupInputModeTabs } from "./score_input_modes.js";
import { setupPasteHandler } from "./score_input_paste.js";

window.addEventListener("DOMContentLoaded", async () => {
  await loadSubjectAndStudents();     // 名簿
  await loadCriteriaAndRenderHeader(); // 評価項目
  setupInputModeTabs();               // 素点/換算モードタブ
  setupPasteHandler();                // ペースト入力
});
