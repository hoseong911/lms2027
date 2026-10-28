/* 미션 앱이 "이 학생이 냈다"를 LMS에 알리는 **단 하나의 길**.
 *
 * 왜 이 파일이 생겼나 (2026-10-26)
 *   2026에는 앱마다 제출 컬렉션을 새로 팠고, 성적 쪽이 그 목록을 코드에 적어 두어야 했다
 *   (lms/admin.js의 MISSION_SOURCES). 그래서 채점이 있는 앱 11개 중 4개만 성적에 연동됐고,
 *   제출 시각 칸 이름도 submittedAt / createdAt / timestamp로 갈렸다.
 *   이제 **요약 한 줄만** 공용 컬렉션에 쓰고, 성적은 앱 키로 그 컬렉션만 읽는다.
 *   앱 목록을 어디에도 적지 않으므로 새 앱이 코드 수정 없이 성적에 붙는다.
 *
 * 나누는 기준
 *   mission_submissions   "냈다 / 통과했다"  ← LMS가 읽는다. 가볍게 유지한다
 *   {앱키}_{기능}          작품 내용, 좌표, 그림  ← 앱만 읽는다. 마음대로 만든다
 *   그림이나 긴 글을 요약 문서에 넣지 말 것. 목록을 통째로 받는 자리가 있어서 느려진다.
 *
 * 쓰는 법
 *   import { getStudent } from '../../shared/lms-session.js';
 *   import { markSubmitted } from '../../shared/lms-submit.js';
 *   await markSubmitted(db, 'j_interview', getStudent());
 *
 * 채점은 선생님(앱 어드민)만 쓴다.
 *   await setStatus(db, 'j_interview', 2027, '30112', 'pass');
 */

import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const MISSION_SUBMISSIONS = 'mission_submissions';

/* 문서 id: 앱 하나에 학생 하나에 한 줄. 다시 내도 같은 줄을 고친다.
   학년도가 들어가 있어 다음 해 같은 학번이 작년 기록을 물려받지 않는다. */
export const submitId = (appKey, year, studentNo) => `${appKey}_${year}_${studentNo}`;

/* 학생이 냈을 때 부른다.
 *
 * 처음 낸 시각(submittedAt)은 **한 번 적히면 그대로 둔다**: 기한 판정의 기준이기 때문이다.
 * 다시 내면 updatedAt만 바뀐다. (2026 네컷에서 다시 낼 때마다 제출 시각을 덮어써
 *  기한이 지각으로 뒤집힌 적이 있다. 같은 실수를 막는 자리다.)
 *
 * status는 **싣지 않는다.** 채점은 선생님만 쓴다: 규칙도 그렇게 막는다.
 */
export async function markSubmitted(db, appKey, student, extra = {}) {
  if (!appKey) throw new Error('appKey가 필요합니다.');
  if (!student || !student.studentId) throw new Error('학생 정보가 없습니다.');
  // 2027은 반(courseId)이 있어야 성적이 제자리로 간다. 보안 규칙도 반 명단을 확인하므로
  // 여기서 막지 않으면 뜻 모를 권한 오류로 떨어진다. 수업 홈을 거쳐 들어오면 늘 있다.
  if (!student.courseId) throw new Error('수업 홈에서 반을 고르고 들어와 주세요.');
  const year = student.year ?? new Date().getFullYear();
  const ref = doc(db, MISSION_SUBMISSIONS, submitId(appKey, year, student.studentId));

  let first = true;
  try { first = !(await getDoc(ref)).exists(); } catch (e) { /* 못 읽으면 처음으로 본다 */ }

  const row = {
    appKey, year,
    courseId:    student.courseId || '',
    studentId:   student.studentId,
    studentName: student.name || '',
    grade:       student.grade ?? null,
    classNo:     student.classNo ?? null,
    updatedAt:   serverTimestamp(),
    ...extra,
  };
  if (first) row.submittedAt = serverTimestamp();

  await setDoc(ref, row, { merge: true });
  return ref.id;
}

/* 선생님이 통과나 미흡을 누를 때. 'pass' | 'fail' 두 값뿐이고,
   칸이 아예 없으면 아직 안 매긴 것이다(2026 규약 그대로). */
export async function setStatus(db, appKey, year, studentNo, status) {
  if (status !== 'pass' && status !== 'fail' && status !== null) {
    throw new Error("status는 'pass', 'fail', null 중 하나입니다.");
  }
  await updateDoc(doc(db, MISSION_SUBMISSIONS, submitId(appKey, year, studentNo)),
    { status, gradedAt: serverTimestamp() });
}

/* 한 앱의 제출을 전부 읽는다(앱 어드민의 채점 목록, LMS 성적). */
export async function listSubmissions(db, appKey, year, courseId = null) {
  const parts = [where('appKey', '==', appKey), where('year', '==', year)];
  if (courseId) parts.push(where('courseId', '==', courseId));
  const snap = await getDocs(query(collection(db, MISSION_SUBMISSIONS), ...parts));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getSubmission(db, appKey, year, studentNo) {
  const s = await getDoc(doc(db, MISSION_SUBMISSIONS, submitId(appKey, year, studentNo)));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

/* 앱이 자기 데이터를 담을 컬렉션 이름: {앱키}_{기능} snake_case.
   연도나 학기 번호를 이름에 넣지 않는다(CLAUDE.md 이름 규칙). 연도는 필드로만. */
export function appCollection(appKey, what) {
  const name = `${appKey}_${what}`;
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`컬렉션 이름 규칙에 어긋난다: ${name}`);
  if (/\d{2,}/.test(name)) throw new Error(`컬렉션 이름에 연도나 번호를 넣지 않는다: ${name}`);
  return name;
}
