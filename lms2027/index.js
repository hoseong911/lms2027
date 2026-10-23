/* 2027 LMS 학생 화면 — 큰 틀
 *
 * 2026(lms/index.js, 2490줄)과 가장 크게 달라진 곳은 로그인이다.
 * 2026에서는 학번이 전역 식별자여서 RTDB 명단 하나를 보면 끝났다.
 * 지금은 반이 1년 단위로 생기고 없어지므로 학번은 그 반의 명단 안에서만
 * 뜻을 가진다. 그래서 로그인이
 *   학번 입력, 그 해 개설된 반에서 명단 찾기, 반과 학생 확정
 * 순서로 간다. 자세한 근거는 LMS2027.md 참고.
 *
 * 메뉴 구성(개념, 미션, 생각, 성적, 콘텐츠, 경험치)은 2026과 같다.
 * 어드민이 반별 또는 메뉴별로 관리하는 대상이 이 칸들이며, 양쪽이 같은
 * MENUS 표(model.js)를 읽으므로 한쪽만 늘어나는 일이 없다.
 *
 * 아직 안 옮긴 것: 각 메뉴의 실제 내용, 공지, 뽑기, 비밀번호와 권한.
 * 비밀번호는 인증 모델이 정해진 뒤에 넣는다 — 지금 2026 방식을 그대로
 * 베껴 두면 그때 두 번 고치게 된다.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "../shared/firebase-config.js";
import { icon } from "../shared/icons.js?v=20260918";
import {
  MENUS, schoolYear, courseLabel, listCourses, getCourse,
  findStudentAcrossCourses, listCourseLessons, lessonTag
} from "./model.js?v=20261023b";

// 여기까지 왔으면 모듈은 다 받았다. 디자인(index.css)도 들어왔는지 확인해서 본문을 연다.
// 디자인이 빠졌으면 깨진 화면 대신 새로고침 안내를 띄운다(index.html의 bootFail).
if (getComputedStyle(document.documentElement).getPropertyValue('--lms-css-ok').trim() === '1') {
  document.documentElement.classList.add('lms-ready');
} else {
  document.documentElement.classList.add('lms-fail');
}

const app = initializeApp(firebaseConfig);
// getFirestore(app) 대신 initializeFirestore로 여는 이유 —
// iOS 사파리(특히 홈 화면에 추가한 standalone)나 학교 와이파이 프록시 조합에서
// WebChannel 스트리밍이 열린 채 멈춰 쓰기가 영영 pending으로 남는 일이 있다.
// autoDetectLongPolling을 켜면 막히는 환경에서 롱폴링으로 자동 전환한다.
// 2026 lms에서 실제로 겪은 문제라 처음부터 켜 둔다.
const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* 정적 HTML에 박아 둔 아이콘 자리를 SVG로 채운다(CLAUDE.md 아이콘 규칙). */
function mountIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => {
    el.innerHTML = icon(el.dataset.icon, el.dataset.iconSize ? +el.dataset.iconSize : 24);
  });
}

/* ── 세션 ──
 * 반이 1년짜리이므로 학번만으로는 어느 반 학생인지 알 수 없다. courseId를 함께 남긴다.
 * lms_sid와 lms_sname은 다른 앱(ox, j_sahwa 등)이 읽는 2026 키라 이름을 그대로 둔다. */
const SESSION_KEY = 'lms2027_session';

function saveSession(s) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    sessionStorage.setItem('lms_sid', s.studentNo);
    sessionStorage.setItem('lms_sname', s.name);
  } catch (_) {}
}
function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
  catch (_) { return null; }
}
function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem('lms_sid');
    sessionStorage.removeItem('lms_sname');
  } catch (_) {}
}

/* ── 로그인 ── */

let _found = null; // 학번으로 찾아 둔 { student, course }

function msg(text, kind = '') {
  const el = $('loginMsg');
  el.textContent = text;
  el.className = 'login-msg' + (kind ? ' ' + kind : '');
}

function resetConfirm() {
  _found = null;
  $('confirmBox').hidden = true;
  $('btnLookup').hidden = false;
}

async function lookup() {
  const no = $('inpStudentNo').value.trim();
  // 학번 형식은 조용히 검사만 한다. 규칙을 안내 문구로 설명하지 않는다.
  if (!/^\d{5}$/.test(no)) { msg('학번을 다시 확인해 주세요.'); return; }

  $('btnLookup').disabled = true;
  msg('확인하고 있습니다.', 'info');
  try {
    const hit = await findStudentAcrossCourses(db, no);
    if (!hit) {
      // 반이 아직 안 개설된 것과 학번이 틀린 것을 학생은 구분할 수 없으므로
      // 반이 하나도 없으면 그 사실을 알려 준다(개편 중에 특히 자주 만난다).
      const courses = await listCourses(db, { year: schoolYear() });
      msg(courses.length === 0
        ? '아직 개설된 반이 없습니다. 선생님께 문의해 주세요.'
        : '명단에서 찾을 수 없습니다. 학번을 다시 확인해 주세요.');
      return;
    }
    _found = hit;
    $('confirmCourse').textContent = courseLabel(hit.course);
    $('confirmName').textContent   = hit.student.name || '';
    $('confirmBox').hidden = false;
    $('btnLookup').hidden = true;
    msg('');
  } catch (e) {
    console.warn('[lookup]', e);
    msg('불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
  } finally {
    $('btnLookup').disabled = false;
  }
}

function confirmYes() {
  if (!_found) return;
  const { student, course } = _found;
  saveSession({
    courseId:  course.id,
    studentNo: student.studentNo,
    name:      student.name || '',
  });
  openCourse();
}

/* ── 수업 홈 ── */

async function openCourse() {
  const s = loadSession();
  if (!s) { showLogin(); return; }

  $('loginScreen').hidden = true;
  $('courseScreen').hidden = false;
  $('chipStudent').textContent = `${s.studentNo} ${s.name}`.trim();
  renderMenus();

  try {
    const course = await getCourse(db, s.courseId);
    // 반이 지워졌거나 아카이브됐으면 더 들어가지 않는다(학년이 바뀌면 생기는 상황).
    if (!course || course.status === 'archived') {
      clearSession();
      showLogin();
      msg('이 반은 더 이상 운영되지 않습니다. 학번을 다시 확인해 주세요.');
      return;
    }
    $('courseBadge').textContent = `${course.year}학년도`;
    $('courseTitle').textContent = courseLabel(course);
    renderLessons(await listCourseLessons(db, s.courseId, { openOnly: true }));
  } catch (e) {
    console.warn('[openCourse]', e);
    $('lessonList').innerHTML =
      '<p class="empty">수업을 불러오지 못했습니다. 새로고침해 주세요.</p>';
  }
}

/* 메뉴 칸 — 아직 내용이 없는 메뉴는 "준비 중"으로 둔다. 빈 칸을 숨기지 않는 쪽을
   고른 것은, 어드민에서 메뉴별로 관리할 때 학생 화면에 무엇이 있는지가 한눈에
   보여야 하기 때문이다. */
function renderMenus() {
  $('menuGrid').innerHTML = MENUS.map(m => `
    <button type="button" class="menu-card" data-menu="${esc(m.key)}" disabled>
      <span class="menu-ic">${icon(m.icon, 22)}</span>
      <span class="menu-label">${esc(m.label)}</span>
      <span class="menu-state">준비 중</span>
    </button>`).join('');
}

function renderLessons(rows) {
  const box = $('lessonList');
  if (!rows.length) {
    box.innerHTML = '<p class="empty">아직 공개된 강의가 없습니다.</p>';
    return;
  }
  box.innerHTML = rows.map(r => `
    <div class="lesson">
      <span class="lesson-no">${esc(lessonTag(r.lessonNo))}</span>
      <span class="lesson-title">${esc(r.title || '제목 없음')}</span>
    </div>`).join('');
}

function showLogin() {
  $('courseScreen').hidden = true;
  $('loginScreen').hidden = false;
  $('loginYear').textContent = `${schoolYear()}학년도`;
  resetConfirm();
}

/* ── 연결 ── */

mountIcons();

$('btnLookup').addEventListener('click', lookup);
$('btnConfirmYes').addEventListener('click', confirmYes);
$('btnConfirmNo').addEventListener('click', () => { resetConfirm(); msg(''); });
$('inpStudentNo').addEventListener('keydown', e => { if (e.key === 'Enter') lookup(); });
// 학번을 고치면 찾아 둔 결과를 버린다(다른 학생으로 들어가는 것을 막는다).
$('inpStudentNo').addEventListener('input', () => { if (_found) { resetConfirm(); msg(''); } });
$('btnLogout').addEventListener('click', () => { clearSession(); showLogin(); });

// 새로고침해도 세션이 남아 있으면 바로 수업 홈으로 간다.
if (loadSession()) openCourse(); else showLogin();
