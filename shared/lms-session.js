/* 미션 앱이 "지금 이 학생이 누구인지"를 알아내는 **단 하나의 길**.
 *
 * 왜 이 파일이 생겼나 (2026-10-26)
 *   2026에는 앱마다 이 코드를 따로 적었다. 13개를 열어 보니 네 갈래로 갈라져 있었고,
 *   그중 다섯 앱은 localStorage만 봐서 **자동 로그인을 끈 학생이 못 들어왔다**
 *   (LMS에는 로그인돼 있는데 앱이 "로그인이 필요해요"를 띄웠다).
 *   학번 길이 검사도 3자와 5자로 갈렸고, 반을 뽑는 셈도 둘로 갈려 한쪽은 10반 이상에서 틀렸다.
 *   그래서 이 일은 여기 한 곳에서만 한다. **앱에서 이 코드를 복사하지 말 것.**
 *
 * 쓰는 법
 *   import { getStudent, requireStudent } from '../../shared/lms-session.js';
 *   const me = getStudent();              // 없으면 null
 *   const me = requireStudent(el);        // 없으면 안내를 el에 그리고 null
 *
 * LMS가 남기는 것 (lms2027/index.js)
 *   sessionStorage.lms_sid / lms_sname      이 탭에서 로그인한 학생
 *   sessionStorage.lms_cid                  그 학생이 고른 강의실(courseId)
 *   sessionStorage.lms_year                 학년도
 *   localStorage.lms_autosave_sid / _sname / _year   자동 로그인을 켠 경우에만
 *
 * 강의실(lms_cid)은 클래스 고르기에서 정해지므로 **세션에만** 있다.
 * 학생이 수업 홈에서 반을 고르고 활동을 누르면 같은 탭으로 넘어오므로 그대로 따라온다.
 * 세션을 **먼저** 본다: 자동 로그인을 꺼도 같은 탭에서 넘어왔으면 세션에는 있다.
 */

const S = { sid: 'lms_sid', sname: 'lms_sname', cid: 'lms_cid', year: 'lms_year' };
const L = { sid: 'lms_autosave_sid', sname: 'lms_autosave_sname', cid: null, year: 'lms_autosave_year' };

// 사생활 보호 모드나 저장 공간이 꽉 찬 기기에서는 읽기만 해도 예외가 난다.
function read(store, key) {
  try { return store.getItem(key) || ''; } catch (e) { return ''; }
}
const pick = key => read(sessionStorage, S[key]) || (L[key] ? read(localStorage, L[key]) : '');

/* 학번 5자리: 1자리 학년, 2~3자리 반, 4~5자리 번호.
   model.js의 parseStudentNo와 같은 셈이다. 앱은 firebase를 안 쓸 수도 있어
   model.js를 import하지 않고 같은 규칙을 여기 둔다. 둘 중 하나를 고치면 다른 쪽도 고친다. */
export function parseStudentNo(no) {
  const s = String(no ?? '').trim();
  if (!/^\d{5}$/.test(s)) return null;
  return { grade: +s[0], classNo: +s.slice(1, 3), num: +s.slice(3, 5) };
}

/* 지금 학생. 못 알아내면 null.
   돌려주는 칸 이름은 고정이다: studentId, name, courseId, year, grade, classNo, num.
   (2026에는 앱마다 name과 studentName이 갈려 있었다) */
export function getStudent() {
  const studentId = pick('sid').trim();
  const name = pick('sname').trim();
  const parsed = parseStudentNo(studentId);
  if (!parsed || !name) return null;
  const year = parseInt(pick('year'), 10);
  return { studentId, name, courseId: pick('cid').trim(), year: Number.isFinite(year) ? year : null, ...parsed };
}

export const isLoggedIn = () => getStudent() !== null;

/* 로그인 안내. 앱마다 안내 화면을 따로 만들지 않게 여기서 그린다.
   el에 그리고 null을 돌려주거나, 학생이 있으면 그대로 돌려준다. */
export function requireStudent(el) {
  const me = getStudent();
  if (me) return me;
  if (el) {
    el.innerHTML =
      '<div class="app-gate">' +
      '<div class="app-gate-title">수업 홈에서 열어 주세요</div>' +
      '<div class="app-gate-desc">로그인한 뒤 이 활동을 누르면 바로 들어옵니다.</div>' +
      '</div>';
    el.hidden = false;
  }
  return null;
}

/* iframe으로 LMS 어드민 안에 열렸는지. 앱 어드민이 자기 로그인 게이트와
   로고를 숨길 때 쓴다(2026 규약 그대로). */
export const isEmbedded = () => { try { return window.self !== window.top; } catch (e) { return true; } };

/* 어드민이 LMS 안에 열렸을 때 불러 둔다.
   - <html class="has-own-back">를 달아 LMS 쪽 중복 바를 숨기게 하고
   - <body class="embedded">로 자기 로고와 로그아웃을 숨긴다
   돌아가는 버튼은 backToLms()를 부른다. */
export function markEmbedded() {
  if (!isEmbedded()) return false;
  document.documentElement.classList.add('has-own-back');
  document.body.classList.add('embedded');
  return true;
}

export function backToLms() {
  try { window.parent.closeAppAdmin(); } catch (e) { history.back(); }
}
