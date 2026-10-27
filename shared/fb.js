// shared/fb.js — Firebase 초기화 한 곳 (2026-10-27)
// model.js(데이터)와 admin.js(로그인)가 같은 app 인스턴스를 쓰도록 여기서 한 번만 만든다.
// 규칙(hoistory/firestore.rules): 2027 컬렉션은 read 공개, write는 로그인(isAdmin=auth!=null)만.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export { collection, getDocs, doc, setDoc, deleteDoc,
         signInWithEmailAndPassword, onAuthStateChanged, signOut };
