/*************************************************
 * Firebase 初期化（全画面共通・確定版）
 *************************************************/

import {
  initializeApp,
  getApps,
  getApp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";

import {
  getAuth,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/* ========= Firebase 設定 ========= */
const firebaseConfig = {
  apiKey: "AIzaSyB-ykIzRvYbc5osV6WATu6BSOJt_zlHkgM",

  // ★ authDomain は web.app で正解（firebaseapp.com でも動くが統一）
  authDomain: "ktc-grade-system.web.app",

  projectId: "ktc-grade-system",
  storageBucket: "ktc-grade-system.appspot.com",
  messagingSenderId: "490169300362",
  appId: "1:490169300362:web:7c6e7b47a394d68d514473",
};

/* ========= App 初期化（二重生成防止） ========= */
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

/* ========= Auth / Firestore ========= */
export const auth = getAuth(app);

setPersistence(auth, browserLocalPersistence)
  .then(() => {
    console.log("[AUTH] persistence = browserLocalPersistence");
  })
  .catch(console.error);

export const db = getFirestore(app);

/* ========= ★超重要：Auth 永続方式を明示 ========= */
await setPersistence(auth, browserLocalPersistence);

console.log("[AUTH] persistence = browserLocalPersistence");