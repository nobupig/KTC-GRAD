// js/schoolYear.js

/**
 * 学校年度を返す
 * 4/1〜12/31 → 当年
 * 1/1〜3/31  → 前年
 */
export function getSchoolYear(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return month <= 3 ? year - 1 : year;
}

/**
 * グローバルに年度をセットする
 * （HTML 側から1行で呼ぶ用）
 */
export function initSchoolYear() {
  const year = getSchoolYear();
  window.CURRENT_YEAR = year;
  return year;
}
