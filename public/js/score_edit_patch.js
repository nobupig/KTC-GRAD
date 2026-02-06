console.log("🔥🔥🔥 score_edit_patch.js LOADED 🔥🔥🔥");

/**
 * 修正モード専用パッチ
 *
 * 方針：
 * - 通常処理（score_input_loader.js / score_input_students.js）は一切変更しない
 * - renderStudentRows を「外からラップ」して students だけ差し替える
 * - 修正モードの初期化完了を待ってから適用する
 */
(function () {
  /**
   * renderStudentRows をフックする本体
   */
  function hookRenderStudentRows() {
    if (typeof window.renderStudentRows !== "function") {
      setTimeout(hookRenderStudentRows, 50);
      return;
    }

    const originalRenderStudentRows = window.renderStudentRows;

    // 二重フック防止
    if (originalRenderStudentRows.__isEditPatched) {
      return;
    }

    console.log("[EDIT PATCH] renderStudentRows found, apply patch");

    function patchedRenderStudentRows(
      tbody,
      subject,
      students,
      criteriaItems,
      onScoreInputChange,
      studentState,
      completion
    ) {
      try {
        const unitKey = window.__editTargetUnitKey;
        const snapshotData = window.__latestScoresDocData;

        const snapshotStudents =
          snapshotData?.submittedSnapshot?.units?.[unitKey]?.students;

        if (
          snapshotStudents &&
          typeof snapshotStudents === "object" &&
          Object.keys(snapshotStudents).length > 0
        ) {
          console.log(
            "[EDIT PATCH] use snapshot students:",
            Object.keys(snapshotStudents)
          );
          students = snapshotStudents;
        }
      } catch (e) {
        console.warn("[EDIT PATCH] failed to replace students", e);
      }

      return originalRenderStudentRows(
        tbody,
        subject,
        students,
        criteriaItems,
        onScoreInputChange,
        studentState,
        completion
      );
    }

    patchedRenderStudentRows.__isEditPatched = true;
    window.renderStudentRows = patchedRenderStudentRows;
  }

  /**
   * 修正モードが有効になるのを待つ
   */
  function waitForEditMode() {
    if (!window.__isEditMode) {
      setTimeout(waitForEditMode, 50);
      return;
    }
    hookRenderStudentRows();
  }

  waitForEditMode();
})();