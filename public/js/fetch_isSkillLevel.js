// FirestoreのsubjectsコレクションからsubjectIdで科目を取得し、isSkillLevelを返す
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { db } from "./score_input_loader.js";

export async function fetchIsSkillLevelFromSubjects(subjectId) {
  if (!subjectId) return false;
  const ref = doc(db, "subjects", subjectId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return false;
  const data = snap.data();
  return data.isSkillLevel === true;
}
