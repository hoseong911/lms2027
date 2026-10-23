/* 2027 LMS 데이터 모델 — 반(Course)이 1년 단위로 생기고 없어지는 구조
 *
 * 클래스룸처럼 "반을 개설하고 그 안에 학생을 불러와 넣는다". 그래서
 * 202n년도 n학년 n반은 그 해에만 유효하고, 학생 명단도 그 반에 속한
 * 1년짜리 데이터다. 학생의 영구 신원(Person)은 두지 않는다 —
 * 해마다 다시 만들면 되므로 그 층이 필요 없다(2026-10-23 선생님 결정).
 *
 *   courses          반 하나. { year, grade, classNo } 가 곧 이름이다.
 *   course_students  그 반의 명단. 학번은 이 반 안에서만 유효하다.
 *   course_lessons   그 반이 쓰는 강의. 몇 강인지, 공개했는지, 수업일.
 *   lesson_library   강의 내용(슬라이드 본문). 연도와 무관하게 남는다.
 *
 * 학생 활동 데이터(제출, 성적, 경험치)는 전부 courseId와 학번을 함께 들고
 * 저장한다. 학번만으로 저장하면 2026 구조처럼 다음 해 같은 학번이 작년
 * 기록을 물려받는다 — 반이 1년짜리여도 그릇은 반 단위로 갈려 있어야 한다.
 *
 * 강의만 lesson_library로 따로 두는 이유는 수업 자료를 해마다 다시 만들
 * 필요가 없게 하려는 것이다(클래스룸의 수업 재사용). 반은 사라지지만
 * 강의 내용은 남아서 다음 해 반에 다시 끌어다 쓴다.
 *
 * 컬렉션 이름에 연도를 넣지 않는다(CLAUDE.md 이름 규칙). 연도는 courses.year로만.
 */

import {
  collection, query, where, getDocs, getDoc, doc,
  addDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const COLL = {
  courses:        'courses',
  courseStudents: 'course_students',
  courseLessons:  'course_lessons',
  lessonLibrary:  'lesson_library',
  courseAuth:     'course_auth',     // 학생이 스스로 정한 비밀번호(해시)
  courseConsent:  'course_consent',  // 개인정보 수집 동의
};

/* 관리 축의 한쪽 — 메뉴. 2026 어드민의 사이드바 항목을 그대로 옮겼다.
 * 반별 보기와 메뉴별 보기가 같은 표를 읽으므로 항목을 늘리려면 여기 한 줄만 더한다. */
export const MENUS = [
  { key: 'concept',  label: '개념 체크',   icon: 'book-open' },
  { key: 'mission',  label: '미션 체크',   icon: 'layout-grid' },
  { key: 'think',    label: '생각 체크',   icon: 'feather' },
  { key: 'grade',    label: '성적',        icon: 'clipboard-list' },
  { key: 'contents', label: '각종 콘텐츠', icon: 'compass' },
  { key: 'xp',       label: '경험치',      icon: 'trophy' },
];

export const menuByKey = key => MENUS.find(m => m.key === key) || null;

/* ── 학년도 ── */

// 3월 시작이므로 1월과 2월은 전년도 학년도로 센다.
// (2027년 2월은 아직 2026학년도다. 학년 전환 시점을 여기 한 곳에서 판단한다.)
export function schoolYear(d = new Date()) {
  const kst = new Date(d.getTime() + (d.getTimezoneOffset() + 540) * 60000);
  return kst.getMonth() + 1 <= 2 ? kst.getFullYear() - 1 : kst.getFullYear();
}

/* ── 학번 ──
 * 5자리 체계: 1자리 학년, 2~3자리 반, 4~5자리 번호 (CLAUDE.md 공통 스택).
 * 학번에서 반을 뽑아낼 수 있으므로 한 학년 명단을 통째로 올려 반별로 흩을 수 있다. */
export function parseStudentNo(no) {
  const s = String(no ?? '').trim();
  if (!/^\d{5}$/.test(s)) return null;
  return { grade: +s[0], classNo: +s.slice(1, 3), num: +s.slice(3, 5) };
}

/* ── 반(Course) ── */

export function courseLabel(c) {
  if (!c) return '';
  if (c.title) return c.title;
  // 가운뎃점은 화면 문구에 쓰지 않는다(CLAUDE.md 디자인 원칙).
  return `${c.year}학년도 ${c.grade}학년 ${c.classNo}반`;
}
export const courseShort = c => c ? `${c.grade}학년 ${c.classNo}반` : '';

export async function listCourses(db, { year = null, includeArchived = false } = {}) {
  const snap = await getDocs(collection(db, COLL.courses));
  let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (year != null) rows = rows.filter(r => r.year === year);
  if (!includeArchived) rows = rows.filter(r => r.status !== 'archived');
  return rows.sort((a, b) => (b.year - a.year) || (a.grade - b.grade) || (a.classNo - b.classNo));
}

export async function listYears(db) {
  const snap = await getDocs(collection(db, COLL.courses));
  return [...new Set(snap.docs.map(d => d.data().year).filter(y => y != null))].sort((a, b) => b - a);
}

export async function getCourse(db, cid) {
  const s = await getDoc(doc(db, COLL.courses, cid));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

// 반 문서 id를 년도와 학년과 반으로 못박는다. 같은 반을 두 번 개설하는 사고를 구조로 막는다
// (자동 id를 받으면 "2027 1학년 3반"이 둘 생겨도 아무 데서도 안 걸린다).
export const courseId = (year, grade, classNo) => `y${year}g${grade}c${classNo}`;

export async function createCourse(db, { year, grade, classNo }) {
  const id = courseId(year, grade, classNo);
  const exists = await getDoc(doc(db, COLL.courses, id));
  if (exists.exists()) return { id, created: false };
  await setDoc(doc(db, COLL.courses, id), {
    year, grade, classNo, status: 'active', createdAt: serverTimestamp()
  });
  return { id, created: true };
}

// 학년 통째 개설 — 1반부터 count반까지 한 번에. 이미 있는 반은 건너뛴다.
export async function createGrade(db, { year, grade, count }) {
  const made = [], skipped = [];
  for (let n = 1; n <= count; n++) {
    const r = await createCourse(db, { year, grade, classNo: n });
    (r.created ? made : skipped).push(n);
  }
  return { made, skipped };
}

// 아카이브 — 지우지 않고 내린다. 지난 해 반은 이 상태로 남아 기록을 지킨다.
export const archiveCourse   = (db, id) => updateDoc(doc(db, COLL.courses, id), { status: 'archived' });
export const unarchiveCourse = (db, id) => updateDoc(doc(db, COLL.courses, id), { status: 'active' });

// 반 삭제 — 명단과 강의 연결까지 같이 지운다. 되돌릴 수 없으므로 호출부에서 꼭 확인받는다.
export async function deleteCourse(db, id) {
  for (const coll of [COLL.courseStudents, COLL.courseLessons]) {
    const snap = await getDocs(query(collection(db, coll), where('courseId', '==', id)));
    // 배치 한 번에 500건 제한이 있어 나눠 커밋한다.
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  }
  await deleteDoc(doc(db, COLL.courses, id));
}

/* ── 명단(course_students) ── */

// 문서 id를 반과 학번으로 못박아 같은 학생이 두 번 들어가는 것을 막는다.
export const studentDocId = (cid, studentNo) => `${cid}_${studentNo}`;

export async function listStudents(db, cid) {
  const snap = await getDocs(query(collection(db, COLL.courseStudents), where('courseId', '==', cid)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.studentNo).localeCompare(String(b.studentNo)));
}

// 반마다 몇 명인지. 반 목록 화면이 한 번에 쓰므로 반별로 따로 묻지 않는다.
export async function countStudentsByCourse(db) {
  const snap = await getDocs(collection(db, COLL.courseStudents));
  const n = {};
  snap.docs.forEach(d => { const c = d.data().courseId; if (c) n[c] = (n[c] || 0) + 1; });
  return n;
}

export async function findStudent(db, cid, studentNo) {
  const s = await getDoc(doc(db, COLL.courseStudents, studentDocId(cid, studentNo)));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

// 학번만 알 때 — 진행 중인 반을 훑어 찾는다. 학생 로그인이 쓴다.
// 학번에서 학년과 반을 뽑을 수 있으므로 해당하는 반을 먼저 보고 나머지를 본다.
export async function findStudentAcrossCourses(db, studentNo, year = schoolYear()) {
  const courses = await listCourses(db, { year });
  if (!courses.length) return null;
  const p = parseStudentNo(studentNo);
  const score = c => (p && c.grade === p.grade && c.classNo === p.classNo) ? 0 : 1;
  const ordered = p ? [...courses].sort((a, b) => score(a) - score(b)) : courses;
  for (const c of ordered) {
    const st = await findStudent(db, c.id, studentNo);
    if (st) return { student: st, course: c };
  }
  return null;
}

/* 그 해 전체 명단을 한 번에 읽어 "학번 -> { name, courseId }" 표로 만든다.
 *
 * 로그인 화면이 글자를 칠 때마다 조용히 명단과 대조하는데(2026과 같은 동작),
 * 그때마다 Firestore에 물으면 읽기가 타이핑 수만큼 늘어난다. 2026은
 * shared/auth.js가 RTDB 명단을 localStorage에 24시간 캐시해서 이 문제를 풀었고,
 * 여기서도 같은 방식을 쓴다. 다른 점은 표에 courseId가 함께 들어간다는 것이다 —
 * 학번만으로는 어느 반 학생인지 알 수 없으므로. */
const ROSTER_CACHE_KEY = 'lms2027_roster';
const ROSTER_TTL = 24 * 60 * 60 * 1000;

export async function loadYearRoster(db, year = schoolYear(), { fresh = false } = {}) {
  if (!fresh) {
    try {
      const c = JSON.parse(localStorage.getItem(ROSTER_CACHE_KEY) || 'null');
      if (c && c.year === year && Date.now() - c.at < ROSTER_TTL) return c.map;
    } catch (_) {}
  }
  const courses = await listCourses(db, { year });
  const ids = new Set(courses.map(c => c.id));
  const snap = await getDocs(collection(db, COLL.courseStudents));
  const map = {};
  snap.docs.forEach(d => {
    const v = d.data();
    if (ids.has(v.courseId)) map[String(v.studentNo)] = { name: v.name, courseId: v.courseId };
  });
  try {
    localStorage.setItem(ROSTER_CACHE_KEY, JSON.stringify({ year, at: Date.now(), map }));
  } catch (_) {}
  return map;
}

export function clearRosterCache() {
  try { localStorage.removeItem(ROSTER_CACHE_KEY); } catch (_) {}
}

// 한 반의 명단을 통째로 교체한다. 2026의 엑셀 업로드와 같은 동작이지만
// 지우는 범위가 그 반으로 제한된다(예전에는 전교생 명단을 지웠다).
export async function replaceRoster(db, cid, rows) {
  const old = await getDocs(query(collection(db, COLL.courseStudents), where('courseId', '==', cid)));
  for (let i = 0; i < old.docs.length; i += 400) {
    const batch = writeBatch(db);
    old.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  for (let i = 0; i < rows.length; i += 400) {
    const batch = writeBatch(db);
    rows.slice(i, i + 400).forEach(r => {
      batch.set(doc(db, COLL.courseStudents, studentDocId(cid, r.studentNo)),
        { courseId: cid, studentNo: String(r.studentNo), name: r.name });
    });
    await batch.commit();
  }
  return rows.length;
}

/* 한 학년 명단을 통째로 받아 학번의 반 자리로 흩어 넣는다.
 * 반이 아직 없으면 같이 개설한다 — 엑셀 한 장으로 학년 하나가 끝난다.
 * 올린 학년과 다른 학년의 학번은 건드리지 않고 그대로 돌려준다(오타나 섞인 줄). */
export async function replaceGradeRoster(db, { year, grade, rows }) {
  const byClass = {}, foreign = [];
  for (const r of rows) {
    const p = parseStudentNo(r.studentNo);
    if (!p || p.grade !== grade) { foreign.push(r); continue; }
    (byClass[p.classNo] ||= []).push(r);
  }
  const classes = [];
  for (const classNo of Object.keys(byClass).map(Number).sort((a, b) => a - b)) {
    const { id } = await createCourse(db, { year, grade, classNo });
    const n = await replaceRoster(db, id, byClass[classNo]);
    classes.push({ classNo, courseId: id, count: n });
  }
  return { classes, foreign };
}

/* ── 비밀번호와 동의 ──
 *
 * 2026(lms_auth)의 방식을 그대로 옮겼다. 다만 문서 id에 반을 넣어
 * 해가 바뀌어도 같은 학번이 작년 비밀번호를 물려받지 않게 했다.
 *
 * !! 2026의 약점을 그대로 물려받은 상태다 !!
 * 학생이 Firebase Auth 사용자가 아니라서 규칙에 "본인 것만"을 쓸 수 없고,
 * 결국 이 문서는 공개 읽기이자 공개 쓰기가 된다(누구든 임의 학번의 비밀번호를
 * 덮어쓸 수 있다). 성적과 제출물을 넣기 전에 인증 모델을 정하고 이 자리를
 * 바꿔야 한다(LMS2027.md 4). 지금은 로그인 화면을 2026과 같게 두려고
 * 같은 방식으로 돌려놓은 것이다.
 */
export const authDocId = (cid, studentNo) => `${cid}_${studentNo}`;

// SHA-256. 소금은 학번이고 앞머리까지 2026 lms/index.js의 hashPw와 같게 둔다.
export async function hashPw(pw, salt) {
  const data = new TextEncoder().encode(`lms:${salt}:${pw}`);
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const isHash = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

export async function getAuthHash(db, cid, studentNo) {
  const s = await getDoc(doc(db, COLL.courseAuth, authDocId(cid, studentNo)));
  return s.exists() ? (s.data().pw || '') : '';
}

export async function setPw(db, cid, studentNo, pw) {
  await setDoc(doc(db, COLL.courseAuth, authDocId(cid, studentNo)),
    { pw: await hashPw(pw, studentNo) });
}

// 선생님이 초기화하면 문서를 지운다. 다음 로그인 때 새로 정하게 된다.
export const clearPw = (db, cid, studentNo) =>
  deleteDoc(doc(db, COLL.courseAuth, authDocId(cid, studentNo)));

export async function hasConsent(db, cid, studentNo) {
  const s = await getDoc(doc(db, COLL.courseConsent, authDocId(cid, studentNo)));
  return s.exists();
}

export const saveConsent = (db, cid, studentNo, name) =>
  setDoc(doc(db, COLL.courseConsent, authDocId(cid, studentNo)),
    { agreedAt: serverTimestamp(), name });

/* ── 강의 ── */

export async function listCourseLessons(db, cid, { openOnly = false } = {}) {
  const snap = await getDocs(query(collection(db, COLL.courseLessons), where('courseId', '==', cid)));
  let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (openOnly) rows = rows.filter(r => r.isOpen);
  return rows.sort((a, b) => lessonOrderKey(a.lessonNo) - lessonOrderKey(b.lessonNo));
}

export async function countLessonsByCourse(db) {
  const snap = await getDocs(collection(db, COLL.courseLessons));
  const n = {};
  snap.docs.forEach(d => {
    const c = d.data().courseId;
    if (!c) return;
    n[c] ||= { total: 0, open: 0 };
    n[c].total++;
    if (d.data().isOpen) n[c].open++;
  });
  return n;
}

export async function listLibrary(db) {
  const snap = await getDocs(collection(db, COLL.lessonLibrary));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => lessonOrderKey(a.lessonNo) - lessonOrderKey(b.lessonNo));
}

export async function getLibraryLesson(db, lessonId) {
  const s = await getDoc(doc(db, COLL.lessonLibrary, lessonId));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

export const addLibraryLesson = (db, data) =>
  addDoc(collection(db, COLL.lessonLibrary), { ...data, createdAt: serverTimestamp() });

export const deleteLibraryLesson = (db, id) => deleteDoc(doc(db, COLL.lessonLibrary, id));

// 라이브러리 강의를 반에 붙인다. 클래스룸의 수업 재사용에 해당하는 자리.
export const attachLesson = (db, { courseId: cid, lessonId, lessonNo, title }) =>
  addDoc(collection(db, COLL.courseLessons), {
    courseId: cid, lessonId, lessonNo, title, isOpen: false, createdAt: serverTimestamp()
  });

export const setLessonOpen = (db, id, on) =>
  updateDoc(doc(db, COLL.courseLessons, id), { isOpen: !!on });

export const detachLesson = (db, id) => deleteDoc(doc(db, COLL.courseLessons, id));

// 강 번호 정렬 키 — 2026 admin.js의 lecOrderKey와 같은 규칙.
// "28강. ..."은 28, OT 같은 비숫자는 맨 아래(-1).
export function lessonOrderKey(v) {
  const m = String(v ?? '').trim().match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : -1;
}

// 강 번호 표기 — 숫자면 "N강", 문자(OT 등)면 그대로. 2026 규칙 유지.
export const lessonTag = n => /^\d+$/.test(String(n ?? '').trim()) ? `${n}강` : `${n}`;

/* ── firestore.rules 상태 (2026-10-23) ──
 * 위 컬렉션들은 아직 firestore.rules에 전용 블록이 없다. 맨 끝 catch-all
 * (match 전체 경로에 read 공개, write 관리자)로 떨어지므로 지금 당장
 * 학생 읽기와 선생님 쓰기는 된다. 규칙을 배포하지 않아도 돌아간다.
 *
 * 다만 그 catch-all이 곧 "공개 읽기"다. 2026에서 전교생 성적이 공개 읽기였던 것과
 * 같은 상태이므로, 성적과 제출물을 넣기 전에 전용 블록을 반드시 쓴다.
 */
