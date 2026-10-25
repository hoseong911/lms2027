/* 2027 LMS 데이터 모델 — 반(Course)이 1년 단위로 생기고 없어지는 구조
 *
 * 클래스룸처럼 "반을 개설하고 그 안에 학생을 불러와 넣는다". 그래서
 * 202n년도 n학년 n반은 그 해에만 유효하고, 학생 명단도 그 반에 속한
 * 1년짜리 데이터다. 학생의 영구 신원(Person)은 두지 않는다 —
 * 해마다 다시 만들면 되므로 그 층이 필요 없다(2026-10-23 선생님 결정).
 *
 *   school_years     학년도 하나. 반이 없어도 학년도는 있다.
 *   courses          반 하나. { year, subject, grade, classNo } 가 곧 이름이다(문서 id는 자동).
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
  collection, query, where, getDocs, getDoc, doc, documentId,
  addDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const COLL = {
  schoolYears:    'school_years',
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

/* ── 학년도 ──
 *
 * 학년도는 반이 하나도 없어도 있을 수 있어야 한다(선생님이 먼저 만들고 나중에
 * 반을 채운다). 그래서 school_years/{2027} 문서가 따로 있다.
 * 반 문서도 year를 숫자로 들고 있어서, 학년도 숫자를 바꾸면 그 해 반 문서를 같이 고친다. */

export const LIMITS = { yearMin: 2000, yearMax: 2100, gradeMin: 1, gradeMax: 9, classMin: 1, classMax: 99, subjectMax: 20 };
const inRange = (n, a, b) => Number.isInteger(n) && n >= a && n <= b;
export const validYear    = n => inRange(n, LIMITS.yearMin,  LIMITS.yearMax);
export const validGrade   = n => inRange(n, LIMITS.gradeMin, LIMITS.gradeMax);
export const validClass   = n => inRange(n, LIMITS.classMin, LIMITS.classMax);
export const validSubject = s => typeof s === 'string' && s.trim().length > 0 && s.trim().length <= LIMITS.subjectMax;

const yearRef = (db, year) => doc(db, COLL.schoolYears, String(year));

async function coursesOfYear(db, year) {
  const snap = await getDocs(query(collection(db, COLL.courses), where('year', '==', year)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// 학년도 목록(큰 해부터). school_years에 빠졌어도 반이 있는 해는 넣는다(반이 화면에서 사라지지 않게).
export async function listYears(db) {
  const [ys, cs] = await Promise.all([
    getDocs(collection(db, COLL.schoolYears)),
    getDocs(collection(db, COLL.courses)),
  ]);
  const set = new Set();
  ys.docs.forEach(d => { const y = d.data().year; if (y != null) set.add(y); });
  cs.docs.forEach(d => { const y = d.data().year; if (y != null) set.add(y); });
  return [...set].sort((a, b) => b - a);
}

export async function createYear(db, year) {
  if (!validYear(year)) throw new Error('학년도를 확인해 주세요.');
  if ((await listYears(db)).includes(year)) throw new Error(`${year}학년도가 이미 있습니다.`);
  await setDoc(yearRef(db, year), { year, createdAt: serverTimestamp() });
}

export async function renameYear(db, from, to) {
  if (from === to) return;
  if (!validYear(to)) throw new Error('학년도를 확인해 주세요.');
  if ((await listYears(db)).includes(to)) throw new Error(`${to}학년도가 이미 있습니다.`);
  const courses = await coursesOfYear(db, from);
  const batch = writeBatch(db);
  batch.set(yearRef(db, to), { year: to, createdAt: serverTimestamp() });
  courses.forEach(c => batch.update(doc(db, COLL.courses, c.id), { year: to }));
  batch.delete(yearRef(db, from));
  await batch.commit();
  // 비밀번호와 동의는 문서 id가 "학년도_학번"이라 새 학년도 id로 옮긴다.
  for (const coll of [COLL.courseAuth, COLL.courseConsent]) {
    const docs = await docsWithPrefix(db, coll, `${from}_`);
    for (let i = 0; i < docs.length; i += 200) {
      const b = writeBatch(db);
      docs.slice(i, i + 200).forEach(d => {
        b.set(doc(db, coll, `${to}_` + d.id.slice(`${from}_`.length)), d.data());
        b.delete(d.ref);
      });
      await b.commit();
    }
  }
}

// 학년도 삭제 — 그 해의 반을 전부 지운다(명단, 강의 연결, 비밀번호, 동의까지).
// 어드민이 지우기 전에 선생님 계정 비밀번호로 다시 인증받는다(admin.js).
export async function deleteYear(db, year) {
  for (const c of await coursesOfYear(db, year)) await deleteCourse(db, c.id);
  for (const coll of [COLL.courseAuth, COLL.courseConsent]) {
    await deleteDocs(db, await docsWithPrefix(db, coll, `${year}_`));
  }
  await deleteDoc(yearRef(db, year));
}

// 문서 id가 prefix로 시작하는 문서들(비밀번호와 동의는 courseId 칸 대신 id에 학년도가 들어 있다).
async function docsWithPrefix(db, coll, prefix) {
  const q = query(collection(db, coll),
    where(documentId(), '>=', prefix), where(documentId(), '<', prefix + ''));
  return (await getDocs(q)).docs;
}

/* ── 반(Course) ──
 * 반 하나 = 학년도 + 과목 + 학년 + 반. 과목은 선생님이 직접 적는다(정해 둔 목록이 없다). 그래서
 * 같은 해 같은 1학년 3반이라도 과목이 다르면 다른 반이다(2026-10-25). */

export function courseLabel(c) {
  if (!c) return '';
  if (c.title) return c.title;
  // 가운뎃점은 화면 문구에 쓰지 않는다(CLAUDE.md 화면 규칙).
  return `${c.year}학년도 ${courseShort(c)}`;
}
// 강의실 이름은 "사회 301"처럼 쓴다(학년 한 자리 + 반 두 자리, 선생님 지시 2026-10-25).
export const roomNo = (grade, classNo) => `${grade}${String(classNo).padStart(2, '0')}`;
export const courseShort = c => c ? `${c.subject ? c.subject + ' ' : ''}${roomNo(c.grade, c.classNo)}` : '';

// 과목, 학년, 반 순서. 화면의 반 목록과 고르기 줄이 모두 이 순서를 쓴다.
export const courseOrder = (a, b) =>
  (b.year - a.year) || String(a.subject || '').localeCompare(String(b.subject || ''), 'ko') ||
  (a.grade - b.grade) || (a.classNo - b.classNo);

export async function listCourses(db, { year = null, includeArchived = false } = {}) {
  let rows = year != null
    ? await coursesOfYear(db, year)
    : (await getDocs(collection(db, COLL.courses))).docs.map(d => ({ id: d.id, ...d.data() }));
  if (!includeArchived) rows = rows.filter(r => r.status !== 'archived');
  return rows.sort(courseOrder);
}

export async function getCourse(db, cid) {
  const s = await getDoc(doc(db, COLL.courses, cid));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

/* 반 문서 id는 자동 id다. 처음에는 y2027g1c3처럼 못박았는데, 선생님이 과목과
 * 학년과 반을 자유롭게 고칠 수 있어야 해서(2026-10-25) 바꿨다. id가 이름을
 * 들고 있으면 이름을 고칠 때마다 명단, 비밀번호, 동의 문서를 전부 새 id로 옮겨야 한다.
 * 같은 반이 둘 생기는 것은 만들 때와 고칠 때 이 함수로 막는다. */
const sameCourse = (c, subject, grade, classNo) =>
  (c.subject || '') === subject && c.grade === grade && c.classNo === classNo;

async function findCourse(db, year, subject, grade, classNo) {
  return (await coursesOfYear(db, year)).find(c => sameCourse(c, subject, grade, classNo)) || null;
}

function checkCourse({ year, subject, grade, classNo }) {
  if (!validYear(year))       throw new Error('학년도를 확인해 주세요.');
  if (!validSubject(subject)) throw new Error('과목을 확인해 주세요.');
  if (!validGrade(grade))     throw new Error('학년을 확인해 주세요.');
  if (!validClass(classNo))   throw new Error('반을 확인해 주세요.');
}

// 이미 있으면 그 반을 돌려준다(명단 올리기가 반을 찾거나 만들 때 쓴다).
export async function createCourse(db, { year, subject, grade, classNo }) {
  subject = String(subject ?? '').trim();
  checkCourse({ year, subject, grade, classNo });
  const found = await findCourse(db, year, subject, grade, classNo);
  if (found) return { id: found.id, created: false };
  const ref = await addDoc(collection(db, COLL.courses), {
    year, subject, grade, classNo, status: 'active', createdAt: serverTimestamp()
  });
  await setDoc(yearRef(db, year), { year }, { merge: true });
  return { id: ref.id, created: true };
}

// 반 여러 개를 한 번에(반 칸에 "1~6"을 적었을 때). 이미 있는 반은 건너뛴다.
export async function createCourses(db, { year, subject, grade, classNos }) {
  const made = [], skipped = [];
  for (const classNo of classNos) {
    const r = await createCourse(db, { year, subject, grade, classNo });
    (r.created ? made : skipped).push(classNo);
  }
  return { made, skipped };
}

export async function updateCourse(db, id, { subject, grade, classNo }) {
  subject = String(subject ?? '').trim();
  const c = await getCourse(db, id);
  if (!c) throw new Error('반을 찾을 수 없습니다.');
  checkCourse({ year: c.year, subject, grade, classNo });
  if (sameCourse(c, subject, grade, classNo)) return;
  const dup = await findCourse(db, c.year, subject, grade, classNo);
  if (dup && dup.id !== id) throw new Error(`${subject} ${roomNo(grade, classNo)} 강의실이 이미 있습니다.`);
  await updateDoc(doc(db, COLL.courses, id), { subject, grade, classNo });
}

// 아카이브 — 지우지 않고 내린다. 지난 해 반은 이 상태로 남아 기록을 지킨다.
export const archiveCourse   = (db, id) => updateDoc(doc(db, COLL.courses, id), { status: 'archived' });
export const unarchiveCourse = (db, id) => updateDoc(doc(db, COLL.courses, id), { status: 'active' });

async function deleteDocs(db, docs) {
  // 배치 한 번에 500건 제한이 있어 나눠 커밋한다.
  for (let i = 0; i < docs.length; i += 400) {
    const batch = writeBatch(db);
    docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

// 반 삭제 — 명단과 강의 연결을 같이 지운다. 되돌릴 수 없으므로 호출부에서 꼭 확인받는다.
// 비밀번호와 동의는 반이 아니라 "학년도 + 학번"에 붙어 있어서(한 학생이 여러 반에 들어가므로)
// 반을 지워도 남는다. 학년도를 지울 때 함께 지운다.
export async function deleteCourse(db, id) {
  for (const coll of [COLL.courseStudents, COLL.courseLessons]) {
    await deleteDocs(db, (await getDocs(query(collection(db, coll), where('courseId', '==', id)))).docs);
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

/* 그 해 전체 명단을 한 번에 읽어 로그인용 표로 만든다.
 *   students  학번 -> { name, courseIds: [...] }   한 학생이 여러 반(사회 반, 역사 반)에 들 수 있다
 *   courses   반id -> { subject, grade, classNo } 로그인 뒤 클래스 고르기 화면이 쓴다
 *
 * 로그인 화면이 글자를 칠 때마다 조용히 명단과 대조하는데(2026과 같은 동작),
 * 그때마다 Firestore에 물으면 읽기가 타이핑 수만큼 늘어난다. 2026은
 * shared/auth.js가 RTDB 명단을 localStorage에 24시간 캐시해서 이 문제를 풀었고,
 * 여기서도 같은 방식을 쓴다. */
const ROSTER_CACHE_KEY = 'lms2027_roster_v2';
const ROSTER_TTL = 24 * 60 * 60 * 1000;

export async function loadYearRoster(db, year = schoolYear(), { fresh = false } = {}) {
  if (!fresh) {
    try {
      const c = JSON.parse(localStorage.getItem(ROSTER_CACHE_KEY) || 'null');
      if (c && c.year === year && Date.now() - c.at < ROSTER_TTL) return c.data;
    } catch (_) {}
  }
  const list = await listCourses(db, { year });
  const courses = {};
  list.forEach(c => { courses[c.id] = { subject: c.subject || '', grade: c.grade, classNo: c.classNo }; });
  const snap = await getDocs(collection(db, COLL.courseStudents));
  const students = {};
  snap.docs.forEach(d => {
    const v = d.data();
    if (!courses[v.courseId]) return;
    const s = (students[String(v.studentNo)] ||= { name: v.name, courseIds: [] });
    s.courseIds.push(v.courseId);
  });
  const data = { students, courses };
  try {
    localStorage.setItem(ROSTER_CACHE_KEY, JSON.stringify({ year, at: Date.now(), data }));
  } catch (_) {}
  return data;
}

// 학생 한 명을 직접 넣는다(학생 관리의 추가 버튼). 학년, 반, 번호, 이름만 적으면
// 그 학년도에 이미 만든 "그 학년 그 반" 강의실 전부(과목 무관, 아카이브 제외)에 등록된다
// (선생님 지시 2026-10-25 — 3학년 1반 홍길동이면 사회 3학년 1반, 역사 3학년 1반에 다 들어간다).
// 그 반 강의실이 하나도 없으면 막는다. 이미 들어 있는 강의실은 건너뛴다.
export async function addStudent(db, { year, grade, classNo, num, name }) {
  const row = rosterRowFromSheet(['-', grade, classNo, num, name]);
  if (!row) throw new Error('학년, 반, 번호, 이름을 확인해 주세요.');
  const rooms = (await coursesOfYear(db, year))
    .filter(c => c.grade === row.grade && c.classNo === row.classNo && c.status !== 'archived')
    .sort(courseOrder);
  if (!rooms.length) throw new Error(`${roomNo(row.grade, row.classNo)} 강의실이 없습니다.`);
  const added = [], skipped = [];
  for (const c of rooms) {
    const ref = doc(db, COLL.courseStudents, studentDocId(c.id, row.studentNo));
    if ((await getDoc(ref)).exists()) { skipped.push(c); continue; }
    await setDoc(ref, { courseId: c.id, studentNo: row.studentNo, name: row.name });
    added.push(c);
  }
  if (!added.length) throw new Error(`${row.studentNo} 학생은 ${roomNo(row.grade, row.classNo)} 강의실에 이미 다 있습니다.`);
  return { row, added, skipped };
}


// 그 학년도에 한 학번이 든 명단 문서들(강의실마다 하나씩).
async function studentDocsOfYear(db, year, studentNo) {
  const snap = await getDocs(query(collection(db, COLL.courseStudents), where('studentNo', '==', String(studentNo))));
  const ids = new Set((await coursesOfYear(db, year)).map(c => c.id));
  return snap.docs.filter(d => ids.has(d.data().courseId));
}

// 학생 고치기 — 학년, 반, 번호, 이름. 학생 추가와 같게 그 반 강의실 전부에 다시 등록한다.
// 학번이 바뀌면 비밀번호와 동의 문서(학년도_학번)도 새 학번으로 옮긴다 — 학생이 다시 정하지 않아도 되게.
export async function updateStudent(db, year, oldNo, { grade, classNo, num, name }) {
  const row = rosterRowFromSheet(['-', grade, classNo, num, name]);
  if (!row) throw new Error('학년, 반, 번호, 이름을 확인해 주세요.');
  const rooms = (await coursesOfYear(db, year))
    .filter(c => c.grade === row.grade && c.classNo === row.classNo && c.status !== 'archived');
  if (!rooms.length) throw new Error(`${roomNo(row.grade, row.classNo)} 강의실이 없습니다.`);
  if (row.studentNo !== String(oldNo) && (await studentDocsOfYear(db, year, row.studentNo)).length) {
    throw new Error(`${row.studentNo} 학생이 이미 있습니다.`);
  }
  const old = await studentDocsOfYear(db, year, oldNo);
  const batch = writeBatch(db);
  old.forEach(d => batch.delete(d.ref));
  rooms.forEach(c => batch.set(doc(db, COLL.courseStudents, studentDocId(c.id, row.studentNo)),
    { courseId: c.id, studentNo: row.studentNo, name: row.name }));
  if (row.studentNo !== String(oldNo)) {
    for (const coll of [COLL.courseAuth, COLL.courseConsent]) {
      const s = await getDoc(doc(db, coll, authDocId(year, oldNo)));
      if (!s.exists()) continue;
      batch.set(doc(db, coll, authDocId(year, row.studentNo)), { ...s.data(), courseId: rooms[0].id });
      batch.delete(s.ref);
    }
  }
  await batch.commit();
  return row;
}

// 학생 삭제 — 그 학년도 강의실 전부에서 빼고 비밀번호와 동의도 지운다.
export async function deleteStudent(db, year, studentNo) {
  const batch = writeBatch(db);
  (await studentDocsOfYear(db, year, studentNo)).forEach(d => batch.delete(d.ref));
  batch.delete(doc(db, COLL.courseAuth, authDocId(year, studentNo)));
  batch.delete(doc(db, COLL.courseConsent, authDocId(year, studentNo)));
  await batch.commit();
}
// 학생 관리 화면 — 그 학년도 학생 전부와 각자 든 강의실(아카이브 포함). 학번 순.
export async function listYearStudents(db, year) {
  const courses = await listCourses(db, { year, includeArchived: true });
  const byId = Object.fromEntries(courses.map(c => [c.id, c]));
  const snap = await getDocs(collection(db, COLL.courseStudents));
  const map = {};
  snap.docs.forEach(d => {
    const v = d.data();
    const c = byId[v.courseId];
    if (!c) return;
    (map[v.studentNo] ||= { studentNo: String(v.studentNo), name: v.name, courses: [] }).courses.push(c);
  });
  return Object.values(map)
    .map(s => ({ ...s, courses: s.courses.sort(courseOrder) }))
    .sort((a, b) => a.studentNo.localeCompare(b.studentNo));
}

// 한 학생이 그 학년도에 든 반들(아카이브 제외). 로그인 뒤 클래스 고르기 화면이 쓴다.
// 캐시된 명단 대신 학번으로 바로 묻는다 — 선생님이 반을 더하면 바로 보여야 해서다(읽기는 반 수만큼).
export async function listStudentCourses(db, year, studentNo) {
  const snap = await getDocs(query(collection(db, COLL.courseStudents), where('studentNo', '==', String(studentNo))));
  const courses = await Promise.all(snap.docs.map(d => getCourse(db, d.data().courseId)));
  return courses.filter(c => c && c.year === year && c.status !== 'archived').sort(courseOrder);
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

/* 명단 엑셀 한 장 — A열 과목, B열 학년, C열 반, D열 번호, E열 이름(선생님 지시 2026-10-25).
 * 과목까지 줄마다 들어 있으므로 따로 묻지 않는다. 학번은 학년 한 자리 + 반 두 자리 + 번호
 * 두 자리로 만든다(10203 = 1학년 2반 3번). 한 학생이 사회와 역사 줄에 둘 다 있으면 두 반에 다 들어간다. */
export function rosterRowFromSheet(r) {
  const subject = String(r[0] ?? '').trim();
  const grade = +String(r[1] ?? '').trim(), classNo = +String(r[2] ?? '').trim(), num = +String(r[3] ?? '').trim();
  const name = String(r[4] ?? '').trim();
  if (!validSubject(subject) || !validGrade(grade) || !validClass(classNo) || !inRange(num, 1, 99) || !name) return null;
  const studentNo = `${grade}${String(classNo).padStart(2, '0')}${String(num).padStart(2, '0')}`;
  return { subject, grade, classNo, studentNo, name };
}

// 과목, 학년, 반이 같은 줄끼리 묶는다.
export function groupRosterRows(rows) {
  const by = {};
  for (const r of rows) {
    (by[`${r.subject}|${r.grade}|${r.classNo}`] ||= { subject: r.subject, grade: r.grade, classNo: r.classNo, rows: [] }).rows.push(r);
  }
  return Object.values(by).sort((a, b) =>
    a.subject.localeCompare(b.subject, 'ko') || (a.grade - b.grade) || (a.classNo - b.classNo));
}

// 묶음마다 이미 만든 강의실을 찾아 그 명단을 교체한다. 강의실이 없는 묶음은 넣지 않고 돌려준다
// (생성된 강의실에 한정해서 학생을 만든다, 선생님 지시 2026-10-25). 파일에 없는 강의실은 건드리지 않는다.
export async function replaceRosterRows(db, { year, rows }) {
  const classes = [], missing = [];
  for (const g of groupRosterRows(rows)) {
    const c = await findCourse(db, year, g.subject, g.grade, g.classNo);
    if (!c) { missing.push(g); continue; }
    const n = await replaceRoster(db, c.id, g.rows);
    classes.push({ ...g, courseId: c.id, count: n });
  }
  return { classes, missing };
}

/* ── 비밀번호와 동의 ──
 *
 * **학생에게 Firebase Auth 계정을 만들지 않는다.** 아이들이 일일이 가입해야 하고
 * 그건 개인정보상 부담이라는 것이 선생님 결정이다(2026-10-23). 로그인은 지금처럼
 * 학번과 이름과 본인이 정한 비밀번호의 일치 여부만 본다. 이 방식은 그대로 간다 —
 * 가짜 이메일 계정이나 익명 로그인 같은 제안을 다시 꺼내지 말 것.
 *
 * 문서 id는 "학년도_학번"(2027_10203). 한 학생이 사회 반과 역사 반에 다 들어갈 수 있어서
 * 비밀번호를 반이 아니라 학년도에 붙였다(2026-10-25). 반마다 따로면 비밀번호가 둘이 된다.
 * 학년도가 들어 있으니 해가 바뀌어도 같은 학번이 작년 비밀번호를 물려받지 않는다.
 *
 * 학생을 서버가 식별하지 못하므로 규칙에 "본인 것만"을 쓸 수 없다. 대신
 * firestore.rules에서 (1) 그 학년도 어느 반 명단에 있는 학번만 (2) create 한 번만 쓰게 했다.
 * 규칙이 명단을 찾아볼 수 있게 문서에 courseId(학생이 든 반 하나)를 같이 적는다.
 * 덮어쓰기는 선생님만 되고, 초기화는 문서를 지우는 것(clearPw)이다.
 * 읽기는 문서 하나(get)만 열고 목록(list)은 닫았다 — 해시를 통째로 긁어 가지 못한다.
 * 그래서 setPw는 비밀번호가 없을 때만 불러야 한다(있는 문서에 쓰면 update라 막힌다).
 * 남은 길 두 가지 — 해시를 PBKDF2로, 검증을 Cloud Function으로. LMS2027.md 4 참고.
 */
export const authDocId = (year, studentNo) => `${year}_${studentNo}`;

// SHA-256. 소금은 학번이고 앞머리까지 2026 lms/index.js의 hashPw와 같게 둔다.
export async function hashPw(pw, salt) {
  const data = new TextEncoder().encode(`lms:${salt}:${pw}`);
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const isHash = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

export async function getAuthHash(db, year, studentNo) {
  const s = await getDoc(doc(db, COLL.courseAuth, authDocId(year, studentNo)));
  return s.exists() ? (s.data().pw || '') : '';
}

export async function setPw(db, year, studentNo, courseId, pw) {
  await setDoc(doc(db, COLL.courseAuth, authDocId(year, studentNo)),
    { pw: await hashPw(pw, studentNo), courseId });
}

// 선생님이 초기화하면 문서를 지운다. 다음 로그인 때 새로 정하게 된다.
export const clearPw = (db, year, studentNo) =>
  deleteDoc(doc(db, COLL.courseAuth, authDocId(year, studentNo)));

export async function hasConsent(db, year, studentNo) {
  const s = await getDoc(doc(db, COLL.courseConsent, authDocId(year, studentNo)));
  return s.exists();
}

export const saveConsent = (db, year, studentNo, courseId, name) =>
  setDoc(doc(db, COLL.courseConsent, authDocId(year, studentNo)),
    { agreedAt: serverTimestamp(), name, courseId });

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

/* ── firestore.rules 상태 (2026-10-25 배포) ──
 * 위 여섯 컬렉션 모두 전용 블록이 있다("2027 LMS" 구역).
 *   courses, course_students, course_lessons, lesson_library — 읽기 공개, 쓰기 선생님
 *   course_auth, course_consent — get 공개, list 선생님, 명단 학생의 create 한 번만
 * 규칙은 겹치면 OR로 합쳐지므로 catch-all에서 course_auth와 course_consent를 뺐다.
 * 성적과 제출물 컬렉션을 새로 만들면 공개 읽기로 둘지 그때 따로 정한다 —
 * 블록이 없으면 catch-all(공개 읽기)로 떨어진다.
 */
