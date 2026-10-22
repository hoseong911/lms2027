/* 2027 LMS 데이터 모델 — 클래스룸 스타일의 세 축(사람·수업·등록)
 *
 * 설계 근거는 LMS2027.md §2. 요점만 다시 적으면:
 *
 *   people       영구 학생 신원. 학번이 아니다. 학년이 올라가도 같은 문서를 쓴다.
 *   courses      연도·학년·반 하나. 지우지 않고 archived로 내려 영구 보존한다.
 *   enrollments  사람 × 수업. 그 수업에서의 학번(studentNo)이 여기 붙는다.
 *
 * 학생 활동 데이터(제출·성적·경험치)는 전부 enrollmentId 기준으로 저장한다.
 * 그러면 해마다 기록이 자동으로 갈리면서도 personId로 묶으면 한 학생의
 * 여러 해 이력을 통째로 볼 수 있다. 학번을 문서 ID로 쓰던 2026 구조의
 * 학번 충돌 문제(2027년 10101번이 2026년 10101번 기록을 물려받던 것)가
 * 이 한 가지로 사라진다.
 *
 * 강의는 "내용"과 "그 해의 쓰임"을 가른다 — 클래스룸의 수업 재사용에 해당한다.
 *   lesson_library  강의 내용(슬라이드 본문). 영구, 연도 무관.
 *   course_lessons  그 수업에서 몇 강인지·공개했는지·수업일이 언제인지.
 *
 * 컬렉션 이름은 CLAUDE.md 규칙대로 snake_case이고 연도를 넣지 않는다.
 * 연도는 courses.year 필드로만 표현한다 — 이름에 연도를 넣으면 영구 시스템이 안 된다.
 */

import {
  collection, query, where, orderBy, limit, getDocs, getDoc, doc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const COLL = {
  people:        'people',
  courses:       'courses',
  enrollments:   'enrollments',
  lessonLibrary: 'lesson_library',
  courseLessons: 'course_lessons',
};

/* ── 수업(Course) ── */

// 학년도 표기: 3월 시작이므로 1·2월은 전년도 학년도로 센다.
// (2027년 2월은 아직 2026학년도다 — 학년 전환 시점을 여기 한 곳에서 판단한다.)
export function schoolYear(d = new Date()) {
  const kst = new Date(d.getTime() + (d.getTimezoneOffset() + 540) * 60000);
  return kst.getMonth() + 1 <= 2 ? kst.getFullYear() - 1 : kst.getFullYear();
}

export function courseLabel(c) {
  if (!c) return '';
  if (c.title) return c.title;
  const grade = c.grade != null ? `${c.grade}학년 ` : '';
  const cls   = c.classNo != null ? `${c.classNo}반` : '';
  // 가운뎃점(·)은 화면 문구에 쓰지 않는다(CLAUDE.md 디자인 원칙).
  return `${c.year}학년도 ${grade}${cls}`.trim();
}

// 진행 중인 수업만. 아카이브된 지난 수업은 뺀다.
export async function listActiveCourses(db, year = schoolYear()) {
  const snap = await getDocs(query(
    collection(db, COLL.courses),
    where('year', '==', year),
    where('status', '==', 'active')
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.grade - b.grade) || (a.classNo - b.classNo));
}

export async function getCourse(db, courseId) {
  const s = await getDoc(doc(db, COLL.courses, courseId));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

/* ── 등록(Enrollment) ── */

// 학번으로 등록을 찾는다. 학번은 수업 안에서만 유효하므로 courseId가 함께 필요하다.
// 이것이 2026과 달라진 핵심 — 학번은 더 이상 전역 식별자가 아니다.
export async function findEnrollment(db, courseId, studentNo) {
  const snap = await getDocs(query(
    collection(db, COLL.enrollments),
    where('courseId', '==', courseId),
    where('studentNo', '==', String(studentNo)),
    limit(1)
  ));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

// 학번만 알 때 — 진행 중인 수업 전체를 훑어 찾는다. 로그인 화면이 쓴다.
// 학생은 수업을 모르고 자기 학번만 아니까.
export async function findEnrollmentAcrossCourses(db, studentNo, year = schoolYear()) {
  const courses = await listActiveCourses(db, year);
  for (const c of courses) {
    const e = await findEnrollment(db, c.id, studentNo);
    if (e) return { enrollment: e, course: c };
  }
  return null;
}

// 한 사람의 모든 등록 — 여러 해에 걸친 이력. 영구 모델의 값이 나오는 자리.
export async function listEnrollmentsOfPerson(db, personId) {
  const snap = await getDocs(query(
    collection(db, COLL.enrollments),
    where('personId', '==', personId)
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function listRoster(db, courseId) {
  const snap = await getDocs(query(
    collection(db, COLL.enrollments),
    where('courseId', '==', courseId)
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.studentNo).localeCompare(String(b.studentNo)));
}

/* ── 사람(Person) ── */

export async function getPerson(db, personId) {
  const s = await getDoc(doc(db, COLL.people, personId));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

/* ── 강의 ── */

// 그 수업이 쓰는 강의 목록. 내용은 lesson_library에 있고 여기엔 참조와 운영 정보만 있다.
// openOnly=true면 학생에게 공개된 것만(학생 화면용).
export async function listCourseLessons(db, courseId, { openOnly = false } = {}) {
  const snap = await getDocs(query(
    collection(db, COLL.courseLessons),
    where('courseId', '==', courseId)
  ));
  let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (openOnly) rows = rows.filter(r => r.isOpen);
  return rows.sort((a, b) => lessonOrderKey(a.lessonNo) - lessonOrderKey(b.lessonNo));
}

// 강 번호 정렬 키 — 2026 admin.js의 lecOrderKey와 같은 규칙을 유지한다.
// "28강. ..."은 28, OT 같은 비숫자는 맨 아래(-1).
export function lessonOrderKey(v) {
  const m = String(v == null ? '' : v).trim().match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : -1;
}

// 강 번호 표기 — 숫자면 "N강", 문자(OT 등)면 그대로. 2026 규칙 유지.
export function lessonTag(n) {
  return /^\d+$/.test(String(n == null ? '' : n).trim()) ? `${n}강` : `${n}`;
}

export async function getLibraryLesson(db, lessonId) {
  const s = await getDoc(doc(db, COLL.lessonLibrary, lessonId));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

/* ── firestore.rules 상태 (2026-10-23) ──
 * 위 컬렉션들은 아직 firestore.rules에 전용 블록이 없다. 맨 끝 catch-all
 * (`match /{document=**}` → read: if true, write: if isAdmin())로 떨어지므로
 * 지금 당장 학생 읽기와 선생님 쓰기는 된다 — 규칙을 배포하지 않아도 돌아간다.
 *
 * 다만 그 catch-all이 곧 "공개 읽기"다. 2026에서 전교생 성적이 공개 읽기였던 것과
 * 같은 상태이므로, 인증 모델(LMS2027.md 2.4)을 정하는 단계에서 이 컬렉션들의
 * 전용 블록을 반드시 함께 쓴다. 성적과 제출물을 넣기 전에 끝내야 한다.
 */
