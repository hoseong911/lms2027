/* 2027 LMS 어드민 — 큰 틀
 *
 *  1. 강의실 관리 — 학년도를 고르고, 그 해의 강의실(과목 + 학년 + 반)을 만들고 고치고 지운다.
 *                강의실은 학년 아래로 묶지 않고 한 줄로 늘어놓은 뒤 위의 태그(과목 한 줄,
 *                학년+반 301, 302 한 줄)로 골라 본다. 태그는 여러 개를 함께 켤 수 있다.
 *     학생 관리 — 명단을 엑셀 한 장으로 한꺼번에 만든다. 강의실마다 따로 올리지 않는다.
 *  2. 반별 관리 — 강의실 하나를 고르고 그 강의실의 메뉴들을 본다.
 *     메뉴들 — 사이드바에 한 줄씩 선다(개념 노트 등). 예전에는 "메뉴별 관리" 페이지를 한 번
 *             거쳤는데, 메뉴별 관리는 페이지가 아니라 구분선으로 묶은 카테고리라는
 *             선생님 지시로 없앴다(2026-10-26).
 *  3. 강의 라이브러리 — 강의 내용은 연도와 무관하게 남는다.
 *
 * 2026 admin.js(10,382줄)와 달리 인라인 onclick과 window 노출을 쓰지 않는다.
 * 전부 data-act 속성 + 컨테이너 이벤트 위임이다.
 *
 * 화면 규칙(CLAUDE.md) — 작은 글씨 설명을 붙이지 않는다. 입력 칸 위에 이름표를
 * 달지 않고 칸 안의 placeholder로 쓴다. 숫자 칸에 스크롤 화살표를 두지 않는다.
 * 액션 버튼은 아이콘만 두고 title과 aria-label로 이름을 단다. alert/confirm/prompt 대신 ask().
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut,
  EmailAuthProvider, reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./shared/firebase-config.js";
import { icon } from "./shared/icons.js?v=20261026a";
import { initConceptNote } from "./concept-note.js?v=20261026a";
import {
  MENUS, schoolYear, roomNo,
  validYear, validGrade, validClass, validSubject,
  listYears, createYear, renameYear, deleteYear,
  courseLabel, courseShort, listCourses,
  createCourses, updateCourse, archiveCourse, unarchiveCourse, deleteCourse,
  countStudentsByCourse, listYearStudents, addStudent, updateStudent, deleteStudent, clearPw, rosterRowFromSheet, groupRosterRows, replaceRosterRows,
  listLibrary, addLibraryLesson, deleteLessonEverywhere,
  listMissionLibrary, addMission, updateMission, listMissionCourses,
  setMissionCourses, syncMissionRows, deleteMissionEverywhere,
  resolveAppUrl, appKeyFromUrl,
  countLessonsByCourse, countMissionsByCourse, lessonTag, lessonOrderKey
} from "./model.js?v=20261026a";

const app  = initializeApp(firebaseConfig);
// 학생 화면과 같은 이유로 롱폴링 자동 감지를 켠다(index.js 주석 참고).
const db   = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
const auth = getAuth(app);

const $  = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function mountIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => {
    el.innerHTML = icon(el.dataset.icon, el.dataset.iconSize ? +el.dataset.iconSize : 24);
  });
}

// 아이콘 버튼 하나. 이름은 title과 aria-label로만 단다(화면에 글자를 늘어놓지 않는다).
const ib = (act, ic, name, data = '', cls = '') =>
  `<button type="button" class="ib${cls ? ' ' + cls : ''}" data-act="${act}" ${data} title="${esc(name)}" aria-label="${esc(name)}">${icon(ic, 16)}</button>`;

/* ── 상태 ──
 * 모듈 최상위 변수를 최소로 둔다. 2026 admin.js는 여기에 81개가 있었다. */
const state = {
  years: [],            // 학년도 숫자, 큰 해부터
  year: null,           // 고른 학년도
  courses: [],          // 고른 학년도의 반 전부(아카이브 포함)
  studentCount: {},     // courseId 별 학생 수
  lessonCount: {},      // courseId 별 { total, open }
  // 학급 관리 태그. 같은 줄 안에서는 하나라도 맞으면, 줄끼리는 모두 맞아야 보인다.
  // 아무것도 안 켠 줄은 거르지 않는다.
  filter: { subject: new Set(), room: new Set() },
  pickedCourse: null,   // 반별 관리에서 고른 반
  students: [],         // 학생 관리 목록(고른 학년도)
  stuRoom: '',          // 학생 관리 반별 구분에서 고른 반(301 등). 빈 값이 전체
  missions: [],         // 미션 라이브러리 목록
  missionCount: {},     // courseId 별 { total, open }
};

const activeCourses = () => state.courses.filter(c => c.status !== 'archived');

/* ── 토스트 ── 방금 한 일의 결과와 오류만 짧게 띄운다. */
let _toastTimer = null;
function toast(text, kind = 'ok') {
  const el = $('toast');
  el.textContent = text;
  el.className = 'toast ' + kind;
  el.hidden = false;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'err' ? 5000 : 2600);
}

/* ── 모달 ──
 * ask({ title, body, fields, check, info, danger }) 는 값 묶음이나 null(취소)을 돌려준다.
 *   fields: [{ key, type, value, placeholder, suffix, options }]
 *     type 'num'     숫자 칸. type="text" + inputmode="numeric"이라 스크롤 화살표가 없다
 *     type 'text' | 'email' | 'password'
 *     type 'choice'  칩 하나 고르기(options) + 직접 적는 칸. 과목 고르기에 쓴다
 *     type 'pick'    칩 하나 고르기만(options: [{ value, label }]). 학생 추가의 강의실 고르기에 쓴다
 *     type 'rooms'   강의실 여러 개를 체크로 고르기(선생님 지시 2026-10-26).
 *                    options: [{ value, label, subject, grade, classNo }], value: 체크해 둘 id 배열.
 *                    위에 과목, 학년, 반 일괄 선택 줄이 서고 아래에 체크 목록이 깔린다.
 *                    돌려주는 값은 체크된 id 배열이다
 *   입력 칸 위에 이름표를 달지 않는다. 무엇을 적는 칸인지는 placeholder로, 단위는 suffix로.
 *   check(values): 문제가 있으면 오류 문구를 돌려준다(Promise도 된다). 모달 안에 띄우고 닫지 않는다.
 *   info: 확인 버튼 하나만(명단 보기처럼 보기만 하는 창).
 */
let _modalDone = null;

function fieldHtml(f) {
  if (f.type === 'choice') {
    const opts = [...new Set([...(f.options || []), ...(f.value && !(f.options || []).includes(f.value) ? [f.value] : [])])];
    return `
      <div class="choice" data-key="${esc(f.key)}">
        ${opts.map(o => `<button type="button" class="tag${o === f.value ? ' on' : ''}" data-choice="${esc(o)}">${esc(o)}</button>`).join('')}
        <input class="inp choice-inp" type="text" placeholder="${esc(f.placeholder || "직접 입력")}" autocomplete="off">
      </div>`;
  }
  /* 'rooms' — 강의 하나를 올릴 강의실들을 체크로 고른다(선생님 지시 2026-10-26).
     강의실이 열 개를 넘으면 하나씩 누르는 게 일이라, 위에 과목, 학년, 반 일괄 선택 줄을 둔다.
     일괄 칩은 그에 맞는 강의실이 전부 켜져 있으면 켜진 것으로 보이고, 누르면 전부 끈다. */
  if (f.type === 'rooms') {
    const on = new Set(f.value || []);
    const opts = f.options || [];
    const uniq = key => [...new Set(opts.map(o => o[key]).filter(v => v != null && v !== ''))];
    const bulkRow = (kind, vals, label) => vals.length < 2 ? '' : `
      <div class="rooms-bulk">
        ${vals.map(v => `<button type="button" class="tag" data-bulk="${esc(kind)}" data-bulkv="${esc(String(v))}">${esc(label(v))}</button>`).join('')}
      </div>`;
    return `
      <div class="rooms" data-key="${esc(f.key)}">
        ${bulkRow('subject', uniq('subject'), v => v)}
        ${bulkRow('grade',   uniq('grade').sort((a, b) => a - b), v => v + '학년')}
        ${bulkRow('classNo', uniq('classNo').sort((a, b) => a - b), v => v + '반')}
        <div class="rooms-list">
          ${opts.map(o => `
            <label class="rooms-item">
              <input type="checkbox" data-room="${esc(o.value)}" data-subject="${esc(o.subject ?? '')}" data-grade="${esc(String(o.grade ?? ''))}" data-classno="${esc(String(o.classNo ?? ''))}"${on.has(o.value) ? ' checked' : ''}>
              <span>${esc(o.label)}</span>
            </label>`).join('')}
        </div>
      </div>`;
  }
  // 'pick' — 정해진 것 중에서만 고른다(직접 입력 칸 없음). options: [{ value, label }]
  if (f.type === 'pick') {
    return `
      <div class="choice" data-key="${esc(f.key)}">
        ${(f.options || []).map(o => `<button type="button" class="tag${o.value === f.value ? ' on' : ''}" data-choice="${esc(o.value)}">${esc(o.label)}</button>`).join('')}
      </div>`;
  }
  const type = f.type === 'num' ? 'text' : (f.type || 'text');
  return `
    <div class="fld">
      <input class="inp" data-key="${esc(f.key)}" type="${type}"
        ${f.type === 'num' ? 'inputmode="numeric"' : ''}
        value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder ?? '')}"
        autocomplete="${f.type === 'password' ? 'current-password' : f.type === 'email' ? 'username' : 'off'}">
      ${f.suffix ? `<span class="fld-suffix">${esc(f.suffix)}</span>` : ''}
    </div>`;
}

function readFields() {
  const vals = {};
  $('modalBody').querySelectorAll('input.inp[data-key]').forEach(i => { vals[i.dataset.key] = i.value.trim(); });
  $('modalBody').querySelectorAll('.choice').forEach(box => {
    const typed = box.querySelector('.choice-inp')?.value.trim() || '';
    const on = box.querySelector('.tag.on');
    vals[box.dataset.key] = typed || (on ? on.dataset.choice : '');
  });
  // 체크한 강의실은 배열로 돌려준다(아무것도 안 고르면 빈 배열).
  $('modalBody').querySelectorAll('.rooms').forEach(box => {
    vals[box.dataset.key] = [...box.querySelectorAll('input[data-room]:checked')].map(i => i.dataset.room);
  });
  return vals;
}

function ask({ title, body = '', fields = [], check = null, info = false, danger = false, wide = false }) {
  if (_modalDone) _modalDone(null);
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = `
    ${body ? `<div class="modal-text">${body}</div>` : ''}
    ${fields.map(fieldHtml).join('')}
    <div class="modal-err" id="modalErr"></div>`;
  $('modalCancel').hidden = info;
  $('modalOk').disabled = false;
  $('modalOk').classList.toggle('ib-danger', danger);
  $('modalOk').classList.toggle('ib-primary', !danger);
  // 강의실 체크 목록처럼 가로로 넓어야 하는 창
  $('modal').querySelector('.modal').classList.toggle('wide', wide);
  $('modal').hidden = false;
  $('modalBody').querySelectorAll('.rooms').forEach(syncRoomsBulk);
  const first = $('modalBody').querySelector('input.inp[data-key]') || $('modalBody').querySelector('.choice-inp');
  (first || $('modalOk')).focus();
  if (first) first.select();

  return new Promise(resolve => {
    _modalDone = v => { _modalDone = null; $('modal').hidden = true; resolve(v); };
    $('modalOk').onclick = async () => {
      const vals = readFields();
      $('modalOk').disabled = true;
      let err = '';
      try { err = check ? await check(vals) : ''; } catch (e) { err = e.message; }
      $('modalOk').disabled = false;
      if (err) { $('modalErr').textContent = err; return; }
      _modalDone && _modalDone(vals);
    };
  });
}

// 과목 칩 — 하나를 켜면 나머지는 끄고 직접 입력 칸을 비운다. 직접 적기 시작하면 칩을 끈다.
$('modalBody').addEventListener('click', e => {
  const b = e.target.closest('[data-choice]');
  if (!b) return;
  const box = b.closest('.choice');
  box.querySelectorAll('.tag').forEach(p => p.classList.toggle('on', p === b));
  const inp = box.querySelector('.choice-inp'); if (inp) inp.value = '';
});
/* 강의실 일괄 선택 — 칩 하나가 그 과목(또는 학년, 반)의 강의실을 전부 켜고 끈다.
   전부 켜져 있을 때 누르면 전부 끄고, 하나라도 빠져 있으면 전부 켠다. */
const roomsMatch = (inp, kind, v) =>
  (kind === 'subject' ? inp.dataset.subject : kind === 'grade' ? inp.dataset.grade : inp.dataset.classno) === v;

function syncRoomsBulk(box) {
  const boxes = [...box.querySelectorAll('input[data-room]')];
  box.querySelectorAll('[data-bulk]').forEach(chip => {
    const hit = boxes.filter(i => roomsMatch(i, chip.dataset.bulk, chip.dataset.bulkv));
    chip.classList.toggle('on', hit.length > 0 && hit.every(i => i.checked));
  });
}

$('modalBody').addEventListener('click', e => {
  const chip = e.target.closest('[data-bulk]');
  if (!chip) return;
  const box = chip.closest('.rooms');
  const hit = [...box.querySelectorAll('input[data-room]')]
    .filter(i => roomsMatch(i, chip.dataset.bulk, chip.dataset.bulkv));
  const turnOn = !hit.every(i => i.checked);
  hit.forEach(i => { i.checked = turnOn; });
  syncRoomsBulk(box);
});

$('modalBody').addEventListener('change', e => {
  if (e.target.matches('input[data-room]')) syncRoomsBulk(e.target.closest('.rooms'));
});
$('modalBody').addEventListener('input', e => {
  if (!e.target.classList.contains('choice-inp')) return;
  if (e.target.value.trim()) e.target.closest('.choice').querySelectorAll('.tag').forEach(p => p.classList.remove('on'));
});

$('modalCancel').addEventListener('click', () => _modalDone && _modalDone(null));
$('modal').addEventListener('click', e => { if (e.target.id === 'modal' && _modalDone) _modalDone(null); });
document.addEventListener('keydown', e => {
  if ($('modal').hidden) return;
  if (e.key === 'Escape') { e.preventDefault(); _modalDone && _modalDone(null); }
  // 버튼에 초점이 있을 때는 그 버튼이 Enter를 받게 둔다(취소 위에서 Enter가 확인이 되지 않게).
  if (e.key === 'Enter' && !e.isComposing && e.target.tagName === 'INPUT') { e.preventDefault(); $('modalOk').click(); }
});

// 숫자 칸 읽기 — 빈 칸이나 숫자가 아닌 글자는 NaN
const num = s => /^\d+$/.test(String(s ?? '').trim()) ? Number(s) : NaN;

// 반 칸 — "3", "1~6", "1-6", "1,3,5"를 받는다. 못 읽으면 null.
function parseClassNos(s) {
  const out = new Set();
  for (const part of String(s ?? '').split(',').map(x => x.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*[~-]\s*(\d+)$/);
    if (m) {
      const a = +m[1], b = +m[2];
      if (a > b || b - a > 50) return null;
      for (let n = a; n <= b; n++) out.add(n);
    } else if (/^\d+$/.test(part)) out.add(+part);
    else return null;
  }
  const arr = [...out].sort((a, b) => a - b);
  return arr.length && arr.every(validClass) ? arr : null;
}

// 되돌릴 수 없는 반 삭제는 이름을 그대로 적게 한다.
function askDelete(name, what) {
  return ask({
    title: `${name} 삭제`,
    body: `${esc(what)} 함께 지워지고 되돌릴 수 없습니다.`,
    fields: [{ key: 'name', type: 'text', placeholder: `${name} (그대로 입력)` }],
    check: v => v.name === name ? '' : `이름이 다릅니다. "${name}" 그대로 입력해 주세요.`,
    danger: true,
  });
}

/* 학년도 삭제는 이름 입력으로는 너무 허술하다(선생님 지시 2026-10-25).
   선생님 계정 이메일과 비밀번호로 다시 인증해야 지운다. Firebase의 재인증이라
   지금 로그인한 계정과 다른 계정이거나 비밀번호가 틀리면 통과하지 않는다. */
function askReauth(title, body) {
  return ask({
    title, body, danger: true,
    fields: [
      { key: 'email', type: 'email',    placeholder: '관리자 이메일' },
      { key: 'pw',    type: 'password', placeholder: '관리자 비밀번호' },
    ],
    check: async v => {
      if (!v.email || !v.pw) return '이메일과 비밀번호를 입력해 주세요.';
      const user = auth.currentUser;
      if (!user || user.email?.toLowerCase() !== v.email.toLowerCase()) return '이메일이나 비밀번호를 확인해 주세요.';
      try {
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(v.email, v.pw));
        return '';
      } catch (e) {
        console.warn('[reauth]', e.code);
        return e.code === 'auth/too-many-requests'
          ? '여러 번 틀려서 잠시 막혔습니다. 조금 뒤에 다시 해 주세요.'
          : '이메일이나 비밀번호를 확인해 주세요.';
      }
    },
  });
}

/* ── 로그인 ── */

onAuthStateChanged(auth, user => {
  if (user) {
    $('loginScreen').hidden = true;
    $('adminView').hidden = false;
    boot();
  } else {
    $('loginScreen').hidden = false;
    $('adminView').hidden = true;
  }
});

$('loginSubmitBtn').addEventListener('click', doLogin);
$('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
$('loginEmail').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginPassword').focus(); });

async function doLogin() {
  const email = $('loginEmail').value.trim();
  const pw    = $('loginPassword').value;
  $('loginError').textContent = '';
  $('loginSubmitBtn').disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, pw);
  } catch (e) {
    console.warn('[login]', e.code);
    $('loginError').textContent = '이메일이나 비밀번호를 확인해 주세요.';
  } finally {
    $('loginSubmitBtn').disabled = false;
  }
}

$('adminLogoutBtn').addEventListener('click', () => signOut(auth));

/* ── 사이드바 ── */

let _booted = false;

function boot() {
  if (_booted) return;
  _booted = true;
  mountIcons();

  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => showPage(el.dataset.nav));
  });
  $('admMenuBtn').addEventListener('click', toggleSidebar);
  $('admSidebarScrim').addEventListener('click', toggleSidebar);

  wireClasses();
  wireStudents();
  wireLibrary();
  reloadAll();
}

function toggleSidebar() {
  $('admSidebar').classList.toggle('open');
  $('admSidebarScrim').classList.toggle('on');
}

function showPage(nav) {
  // 앱 어드민을 띄워 둔 채 다른 메뉴를 누르면 오버레이를 먼저 닫는다.
  if (!$('appAdminOverlay').hidden) closeAppAdmin();
  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.nav === nav));
  document.querySelectorAll('.panel-page').forEach(el =>
    el.hidden = el.dataset.page !== nav);
  if (window.innerWidth <= 860 && $('admSidebar').classList.contains('open')) toggleSidebar();

  if (nav === 'students') renderStudents();
  if (nav === 'byclass') renderPickClass();
  if (nav === 'library') reloadLibrary();
  if (nav === 'concept') openConcept();
  if (nav === 'mission') reloadMissions();
}

/* ══════ 개념 노트 ══════
 * 사이드바에는 없다. 반별 관리와 메뉴별 관리의 "개념 노트" 칸에서 들어온다 —
 * 두 관리 축이 같은 자리에 도착한다는 규칙 그대로다.
 *
 * 편집기는 concept-note.js에 따로 있다(2026 lms/admin.js의 개념 체크를 옮긴 2,000줄).
 * 그 코드는 db와 모달, 토스트를 주입받고, 올릴 강의실 목록을 어드민이 고른 학년도에서 뽑는다.
 */
let _conceptBusy = false;
async function openConcept() {
  if (_conceptBusy) return;
  _conceptBusy = true;
  try {
    await initConceptNote({ db, ask, toast, esc, getYear: () => state.year });
  } catch (e) {
    console.warn('[openConcept]', e);
    toast('개념 노트를 불러오지 못했습니다. ' + e.message, 'err');
  } finally {
    _conceptBusy = false;
  }
}

// 콘텐츠와 디자인 — 디자인은 강의별이 아니라 전체 공통 설정이라 강의를 고르지 않아도 열린다.
$('ceSubBar').addEventListener('click', ev => {
  const b = ev.target.closest('[data-ce]');
  if (!b) return;
  const which = b.dataset.ce;
  $('ceSubBar').querySelectorAll('.pick').forEach(p => p.classList.toggle('on', p === b));
  $('cePageContent').hidden = which !== 'content';
  $('cePageDesign').hidden  = which !== 'design';
  // 미리보기는 숨어 있는 동안 폭이 0이라 배율이 틀어진다. 보일 때 다시 맞춘다.
  if (which === 'design' && window.rescalePreview) requestAnimationFrame(window.rescalePreview);
});

/* ── 공통: 다시 읽기 ──
 * 학생 수와 강의 수를 반마다 따로 묻지 않고 컬렉션을 한 번씩만 읽어 센다. */
async function reloadAll() {
  try {
    state.years = await listYears(db);
  } catch (e) {
    console.warn('[listYears]', e);
    $('classList').innerHTML = '<p class="empty">불러오지 못했습니다. 새로고침해 주세요.</p>';
    return;
  }
  if (!state.years.includes(state.year)) {
    const cur = schoolYear();
    state.year = state.years.includes(cur) ? cur : (state.years[0] ?? null);
  }
  await reloadCourses();
}

async function reloadCourses() {
  try {
    const [courses, sc, lc, mc] = await Promise.all([
      state.year != null ? listCourses(db, { year: state.year, includeArchived: true }) : [],
      countStudentsByCourse(db),
      countLessonsByCourse(db),
      countMissionsByCourse(db),
    ]);
    state.courses = courses;
    state.studentCount = sc;
    state.lessonCount = lc;
    state.missionCount = mc;
  } catch (e) {
    console.warn('[reloadCourses]', e);
    $('classList').innerHTML = '<p class="empty">불러오지 못했습니다. 새로고침해 주세요.</p>';
    return;
  }
  if (state.pickedCourse && !activeCourses().some(c => c.id === state.pickedCourse)) state.pickedCourse = null;
  renderClasses();
  renderPickClass();
}

/* ══════ 강의실 관리 ══════ (2026-10-25 "학급 관리"에서 이름을 바꿈)
 * 학년도 칩 줄, 그 아래 태그 두 줄(과목, 학년+반), 그 아래 강의실 목록 한 줄. 명단은 학생 관리에서.
 * 반을 학년 아래로 묶지 않는다(선생님 지시 2026-10-25). 과목별, 학년별, 반별로
 * 태그를 켜서 골라 본다. 태그는 여러 개를 함께 켤 수 있다. */

function wireClasses() {
  $('yearBar').addEventListener('click', onClassesClick);
  $('yearTools').addEventListener('click', onClassesClick);
  $('classTools').addEventListener('click', onClassesClick);
  $('tagBar').addEventListener('click', onTagClick);
  $('classList').addEventListener('click', onClassesClick);
}

// 그 해에 이미 쓰인 과목만 칩으로 보인다. 정해 둔 과목은 없다 — 처음엔 직접 적는다.
const subjectOptions = () =>
  [...new Set(state.courses.map(c => c.subject).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));

// 태그 두 줄 — 과목 한 줄, 학년+반(301, 302 …) 한 줄. 학생 관리의 반별 구분과 같은 모양(선생님 지시 2026-10-25).
const courseRoom = c => roomNo(c.grade, c.classNo);
const TAGS = [
  { key: 'subject', of: c => c.subject || '' },
  { key: 'room',    of: courseRoom },
].map(t => ({ ...t, values: () => [...new Set(state.courses.map(t.of))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko')) }));

function passesFilter(c) {
  return TAGS.every(t => {
    const on = state.filter[t.key];
    return !on.size || on.has(t.of(c));
  });
}

function renderClasses() {
  $('yearBar').innerHTML = state.years.map(y => `
    <button type="button" class="pick${y === state.year ? ' on' : ''}" data-act="pick-year" data-year="${y}">
      ${y}학년도
    </button>`).join('') + ib('add-year', 'plus', '학년도 추가');

  const hasYear = state.year != null;
  $('yearTools').innerHTML = hasYear
    ? ib('edit-year', 'pencil', `${state.year}학년도 수정`) + ib('del-year', 'trash-2', `${state.year}학년도 삭제`, '', 'ib-danger')
    : '';
  $('classTools').innerHTML = hasYear
    ? ib('add-class', 'plus', '강의실 만들기', '', 'ib-primary')
    : '';

  // 사라진 값의 태그는 끈다(반을 지우거나 고친 뒤).
  TAGS.forEach(t => {
    const vals = new Set(t.values());
    [...state.filter[t.key]].forEach(v => { if (!vals.has(v)) state.filter[t.key].delete(v); });
  });
  const tagBtns = t => t.values().map(v => `
        <button type="button" class="tag${state.filter[t.key].has(v) ? ' on' : ''}" data-tag="${t.key}" data-val="${esc(v)}">${esc(v)}</button>`).join('');
  $('tagBar').innerHTML = state.courses.length
    ? TAGS.filter(t => t.values().length).map(t => `<div class="tag-row">${tagBtns(t)}</div>`).join('') : '';

  if (!hasYear) { $('classList').innerHTML = '<p class="empty">학년도가 없습니다.</p>'; return; }
  const rows = state.courses.filter(passesFilter);
  $('classList').innerHTML = !state.courses.length ? '<p class="empty">강의실이 없습니다.</p>'
    : !rows.length ? '<p class="empty">맞는 강의실이 없습니다.</p>'
    : rows.map(classRow).join('');
}

function onTagClick(ev) {
  const b = ev.target.closest('[data-tag]');
  if (!b) return;
  const key = b.dataset.tag;
  const val = b.dataset.val;
  const set = state.filter[key];
  set.has(val) ? set.delete(val) : set.add(val);
  renderClasses();
}

function classRow(c) {
  const arch = c.status === 'archived';
  const n  = state.studentCount[c.id] || 0;
  const lc = state.lessonCount[c.id] || { total: 0, open: 0 };
  const name = courseShort(c);
  const ca = `data-id="${esc(c.id)}"`;
  return `
    <div class="cls-row${arch ? ' arch' : ''}">
      <span class="cls-name">${esc(name)}</span>
      ${arch ? '<span class="badge">아카이브</span>' : ''}
      <span class="cls-meta">학생 ${n}명, 강의 ${lc.total}개 중 ${lc.open}개 공개</span>
      <span class="acts">
        ${arch ? ib('unarchive', 'archive-restore', `${name} 아카이브 해제`, ca)
               : ib('archive', 'archive', `${name} 아카이브`, ca)}
        ${ib('edit-class', 'pencil', `${name} 수정`, ca)}
        ${ib('del-class', 'trash-2', `${name} 삭제`, ca, 'ib-danger')}
      </span>
    </div>`;
}

// 반 만들기와 고치기가 같은 칸을 쓴다 — 과목, 학년, 반.
function courseFields(c = null) {
  const lastSubject = [...state.filter.subject][0] || "";
  return [
    { key: 'subject', type: 'choice', options: subjectOptions(), value: c ? c.subject : lastSubject, placeholder: '과목' },
    { key: 'grade',   type: 'num', value: c ? c.grade : '',   placeholder: '학년 (숫자 입력)', suffix: '학년' },
    { key: 'classNo', type: c ? 'num' : 'text', value: c ? c.classNo : '',
      placeholder: c ? '반 (숫자 입력)' : '반 (3 또는 1~6)', suffix: '반' },
  ];
}

async function onClassesClick(ev) {
  const btn = ev.target.closest('[data-act]');
  if (!btn) return;
  const act  = btn.dataset.act;
  const c    = btn.dataset.id ? state.courses.find(x => x.id === btn.dataset.id) : null;
  const year = state.year;

  try {
    switch (act) {
      case 'pick-year':
        state.year = +btn.dataset.year;
        state.pickedCourse = null;
        await reloadCourses();
        return;

      case 'add-year': {
        const v = await ask({
          title: '학년도 추가',
          fields: [{ key: 'year', type: 'num', placeholder: '학년도 (숫자 입력)', suffix: '학년도' }],
          check: v => !validYear(num(v.year)) ? '학년도를 확인해 주세요.'
            : state.years.includes(num(v.year)) ? `${v.year}학년도가 이미 있습니다.` : '',
        });
        if (!v) return;
        await createYear(db, num(v.year));
        state.year = num(v.year);
        toast(`${v.year}학년도를 만들었습니다.`);
        break;
      }

      case 'edit-year': {
        const v = await ask({
          title: `${year}학년도 수정`,
          fields: [{ key: 'year', type: 'num', value: year, placeholder: '학년도 (숫자 입력)', suffix: '학년도' }],
          check: v => !validYear(num(v.year)) ? '학년도를 확인해 주세요.'
            : (num(v.year) !== year && state.years.includes(num(v.year))) ? `${v.year}학년도가 이미 있습니다.` : '',
        });
        if (!v || num(v.year) === year) return;
        await renameYear(db, year, num(v.year));
        state.year = num(v.year);
        toast(`${v.year}학년도로 바꿨습니다.`);
        break;
      }

      case 'del-year': {
        const n = state.courses.reduce((s, x) => s + (state.studentCount[x.id] || 0), 0);
        const ok = await askReauth(`${year}학년도 삭제`,
          `반 ${state.courses.length}개와 명단 ${n}명, 강의 연결, 학생 비밀번호가 함께 지워지고 되돌릴 수 없습니다.`);
        if (!ok) return;
        await deleteYear(db, year);
        state.year = null;
        toast(`${year}학년도를 삭제했습니다.`);
        break;
      }

      case 'add-class': {
        const v = await ask({
          title: `${year}학년도 강의실 만들기`,
          fields: courseFields(),
          check: v => {
            if (!validSubject(v.subject)) return '과목을 고르거나 적어 주세요.';
            if (!validGrade(num(v.grade))) return '학년을 확인해 주세요.';
            const nos = parseClassNos(v.classNo);
            if (!nos) return '반을 확인해 주세요.';
            const taken = nos.filter(n => state.courses.some(x => (x.subject || '') === v.subject && x.grade === num(v.grade) && x.classNo === n));
            return taken.length === nos.length ? `${v.subject} ${taken.map(n => roomNo(num(v.grade), n)).join(', ')} 강의실이 이미 있습니다.` : '';
          },
        });
        if (!v) return;
        const { made, skipped } = await createCourses(db, { year, subject: v.subject, grade: num(v.grade), classNos: parseClassNos(v.classNo) });
        const rn = n => roomNo(num(v.grade), n);
        toast(`${v.subject} ${made.map(rn).join(', ')} 강의실을 만들었습니다.` +
          (skipped.length ? ` 이미 있던 ${skipped.map(rn).join(', ')} 강의실은 그대로 두었습니다.` : ''));
        break;
      }

      case 'edit-class': {
        const v = await ask({
          title: `${courseShort(c)} 수정`,
          fields: courseFields(c),
          check: v => {
            if (!validSubject(v.subject)) return '과목을 고르거나 적어 주세요.';
            if (!validGrade(num(v.grade))) return '학년을 확인해 주세요.';
            if (!validClass(num(v.classNo))) return '반을 확인해 주세요.';
            const dup = state.courses.some(x => x.id !== c.id && (x.subject || '') === v.subject && x.grade === num(v.grade) && x.classNo === num(v.classNo));
            return dup ? `${v.subject} ${roomNo(num(v.grade), num(v.classNo))} 강의실이 이미 있습니다.` : '';
          },
        });
        if (!v) return;
        await updateCourse(db, c.id, { subject: v.subject, grade: num(v.grade), classNo: num(v.classNo) });
        toast(`${v.subject} ${roomNo(num(v.grade), num(v.classNo))}로 저장했습니다.`);
        break;
      }

      case 'del-class': {
        const n = state.studentCount[c.id] || 0;
        if (!await askDelete(courseShort(c), `명단 ${n}명과 강의 연결, 학생 비밀번호가`)) return;
        await deleteCourse(db, c.id);
        toast(`${courseShort(c)} 강의실을 삭제했습니다.`);
        break;
      }

      case 'archive':
        await archiveCourse(db, c.id);
        toast(`${courseShort(c)} 강의실을 아카이브했습니다.`);
        break;

      case 'unarchive':
        await unarchiveCourse(db, c.id);
        toast(`${courseShort(c)} 아카이브를 해제했습니다.`);
        break;

      default:
        return;
    }
    await reloadAll();
  } catch (e) {
    console.warn('[classes]', act, e);
    toast('처리하지 못했습니다. ' + e.message, 'err');
  }
}

/* 엑셀 첫 시트를 줄 배열로. 1행은 머리글로 보고 건너뛴다. */
function readSheet(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = e => {
      try {
        const wb  = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
        resolve(raw.slice(1).filter(r => r.some(v => String(v).trim() !== '')));
      } catch (err) { reject(err); }
    };
    reader.readAsArrayBuffer(file);
  });
}

/* ══════ 학생 관리 ══════
 * 명단은 여기서 한꺼번에 만든다(선생님 지시 2026-10-25). 강의실마다 따로 올리지 않는다.
 * 학년도는 강의실 관리와 같은 값(state.year)을 쓴다. 학년도를 만들고 고치는 것은 강의실 관리에서. */

function wireStudents() {
  $('stuYearBar').addEventListener('click', async ev => {
    const b = ev.target.closest('[data-year]');
    if (!b) return;
    state.year = +b.dataset.year;
    state.pickedCourse = null;
    await reloadCourses();
    renderStudents();
  });
  $('stuTools').addEventListener('click', ev => {
    if (ev.target.closest('[data-act="upload-all"]')) $('fileRoster').click();
    if (ev.target.closest('[data-act="add-student"]')) doAddStudent();
  });
  $('fileRoster').addEventListener('change', onRosterFile);
  $('stuList').addEventListener('click', onStudentClick);
  $('stuTagBar').addEventListener('click', ev => {
    const b = ev.target.closest('[data-room]');
    if (!b) return;
    const r = b.dataset.room;
    state.stuRoom = r;
    drawStudents();
  });
}

async function renderStudents() {
  $('stuYearBar').innerHTML = state.years.map(y => `
    <button type="button" class="pick${y === state.year ? ' on' : ''}" data-year="${y}">${y}학년도</button>`).join('');
  $('stuTools').innerHTML = state.year != null
    ? ib('add-student', 'plus', '학생 추가', '', 'ib-primary') + ib('upload-all', 'upload', '명단 올리기')
    : '';

  const box = $('stuList');
  if (state.year == null) { $('stuTagBar').innerHTML = ''; box.innerHTML = '<p class="empty">학년도가 없습니다.</p>'; return; }
  box.innerHTML = '<p class="empty">불러오는 중입니다.</p>';
  try { state.students = await listYearStudents(db, state.year); }
  catch (e) {
    console.warn('[students]', e);
    box.innerHTML = '<p class="empty">불러오지 못했습니다. 새로고침해 주세요.</p>';
    return;
  }
  drawStudents();
}

// 학생 반(학번의 앞 세 자리, 예: 301). 반별 구분 줄이 쓴다.
const stuRoom = s => String(s.studentNo).slice(0, 3);

/* 반별 구분 줄 + 학생 목록. 한 번에 한 반만 보인다. 맨 끝의 "전체"가 처음 값이다
   (선생님 지시 2026-10-25 — 누적해서 켜지 않고 한 반씩). */
function drawStudents() {
  const rooms = [...new Set(state.students.map(stuRoom))].sort();
  if (state.stuRoom && !rooms.includes(state.stuRoom)) state.stuRoom = '';
  $('stuTagBar').innerHTML = rooms.length ? `
    <div class="tag-row">${[...rooms, ''].map(r => `
      <button type="button" class="tag${state.stuRoom === r ? ' on' : ''}" data-room="${r}">${r || '전체'}</button>`).join('')}
    </div>` : '';

  const rows = state.students.filter(s => !state.stuRoom || stuRoom(s) === state.stuRoom);
  const sd = s => `data-no="${esc(s.studentNo)}" data-name="${esc(s.name)}"`;
  $('stuList').innerHTML = !state.students.length ? '<p class="empty">학생이 없습니다.</p>'
    : rows.map(s => `
    <div class="stu-row">
      <span class="stu-no">${esc(s.studentNo)}</span>
      <span class="stu-name">${esc(s.name)}</span>
      <span class="stu-courses">${s.courses.map(c => `<span class="stu-course">${esc(courseShort(c))}</span>`).join('')}</span>
      <span class="acts">
        ${ib('edit-student', 'pencil', `${s.studentNo} ${s.name} 수정`, sd(s))}
        ${ib('reset-pw', 'key', `${s.studentNo} ${s.name} 비밀번호 초기화`, sd(s))}
        ${ib('del-student', 'trash-2', `${s.studentNo} ${s.name} 삭제`, sd(s), 'ib-danger')}
      </span>
    </div>`).join('');
}

/* 학생 줄의 비밀번호 초기화, 수정, 삭제. 학생은 학번으로 그 학년도 강의실 전부에 묶여 있어서 한꺼번에 고치고 지운다. */
async function onStudentClick(ev) {
  const btn = ev.target.closest('[data-act]');
  if (!btn) return;
  const no = btn.dataset.no, name = btn.dataset.name;
  const p = parseNo(no);
  try {
    if (btn.dataset.act === 'edit-student') {
      const v = await ask({
        title: `${no} ${name} 수정`,
        fields: [
          { key: 'grade',   type: 'num',  value: p.grade,   placeholder: '학년 (숫자 입력)', suffix: '학년' },
          { key: 'classNo', type: 'num',  value: p.classNo, placeholder: '반 (숫자 입력)',   suffix: '반' },
          { key: 'num',     type: 'num',  value: p.num,     placeholder: '번호 (숫자 입력)', suffix: '번' },
          { key: 'name',    type: 'text', value: name,      placeholder: '이름' },
        ],
        check: v => {
          if (!validGrade(num(v.grade))) return '학년을 확인해 주세요.';
          if (!validClass(num(v.classNo))) return '반을 확인해 주세요.';
          if (!(num(v.num) >= 1 && num(v.num) <= 99)) return '번호를 확인해 주세요.';
          return v.name ? '' : '이름을 입력해 주세요.';
        },
      });
      if (!v) return;
      const row = await updateStudent(db, state.year, no, v);
      toast(`${row.studentNo} ${row.name} 학생으로 저장했습니다.`);
    }
    // 비밀번호 초기화 — 비밀번호 문서를 지운다. 학생이 다음에 로그인할 때 새로 정한다(로그인 화면의 "처음이시네요").
    if (btn.dataset.act === 'reset-pw') {
      const ok = await ask({
        title: `${no} ${name} 비밀번호 초기화`,
        body: '다음 로그인 때 학생이 새 비밀번호를 정합니다.',
      });
      if (!ok) return;
      await clearPw(db, state.year, no);
      toast(`${no} ${name} 학생의 비밀번호를 초기화했습니다.`);
      return;
    }
    if (btn.dataset.act === 'del-student') {
      if (!await askDelete(name, `${no} ${name} 학생이 이 학년도 강의실 전부에서 빠지고 비밀번호도`)) return;
      await deleteStudent(db, state.year, no);
      toast(`${no} ${name} 학생을 삭제했습니다.`);
    }
    await reloadAll();
    renderStudents();
  } catch (e) {
    console.warn('[student]', e);
    toast('처리하지 못했습니다. ' + e.message, 'err');
  }
}

// 학번 다섯 자리를 학년, 반, 번호로.
const parseNo = s => ({ grade: +String(s)[0], classNo: +String(s).slice(1, 3), num: +String(s).slice(3, 5) });


/* 학생 직접 추가 — 학년, 반, 번호, 이름만 적는다. 그 학년도에 만든 그 반 강의실 전부(과목 무관)에
   등록된다(선생님 지시 2026-10-25 — 3학년 1반 홍길동이면 사회 3학년 1반, 역사 3학년 1반에 다). */
async function doAddStudent() {
  let result = null;
  const v = await ask({
    title: `${state.year}학년도 학생 추가`,
    fields: [
      { key: 'grade',   type: 'num',  placeholder: '학년 (숫자 입력)', suffix: '학년' },
      { key: 'classNo', type: 'num',  placeholder: '반 (숫자 입력)',   suffix: '반' },
      { key: 'num',     type: 'num',  placeholder: '번호 (숫자 입력)', suffix: '번' },
      { key: 'name',    type: 'text', placeholder: '이름' },
    ],
    check: async v => {
      if (!validGrade(num(v.grade))) return '학년을 확인해 주세요.';
      if (!validClass(num(v.classNo))) return '반을 확인해 주세요.';
      if (!(num(v.num) >= 1 && num(v.num) <= 99)) return '번호를 확인해 주세요.';
      if (!v.name) return '이름을 입력해 주세요.';
      try {
        result = await addStudent(db, { year: state.year, ...v });
        return '';
      } catch (e) { return e.message; }
    },
  });
  if (!v || !result) return;
  toast(`${v.name} 학생을 ${result.added.map(courseShort).join(', ')}에 추가했습니다.`);
  await reloadAll();
  renderStudents();
}

/* 명단 올리기 — 엑셀 A열 과목, B열 학년, C열 반, D열 번호, E열 이름. 줄마다 강의실이 정해지므로
 * 따로 묻지 않는다. 이미 만든 강의실에만 넣는다(선생님 지시 2026-10-25). 없는 강의실 줄은
 * 미리 보기에 표시하고 넣지 않는다. 한 학생이 두 과목 줄에 있으면 두 강의실에 다 들어간다.
 * 파일에 나온 강의실의 명단만 교체하고, 다른 강의실은 건드리지 않는다.
 * 몇 명으로 바뀌는지 먼저 보여 주고 확인받는다. */
async function onRosterFile(ev) {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;

  try {
    const raw = await readSheet(file);
    const rows = raw.map(rosterRowFromSheet);
    const bad = rows.filter(r => !r).length;
    const good = rows.filter(Boolean);
    if (!good.length) { toast('읽을 수 있는 줄이 없습니다.', 'err'); return; }
    const groups = groupRosterRows(good);
    const has = g => state.courses.some(x => (x.subject || '') === g.subject && x.grade === g.grade && x.classNo === g.classNo);
    if (!groups.some(has)) { toast('엑셀에 있는 강의실이 하나도 없습니다. 강의실 관리에서 먼저 만들어 주세요.', 'err'); return; }
    const ok = await ask({
      title: `${state.year}학년도 명단 교체`,
      body: `<div class="roster">${groups.map(g => `
        <div class="roster-row${has(g) ? '' : ' off'}"><span class="roster-no">${esc(g.subject)} ${roomNo(g.grade, g.classNo)}</span><span>${g.rows.length}명${has(g) ? '' : ', 없는 강의실이라 넣지 않음'}</span></div>`).join('')}</div>` +
        (bad ? `<p class="modal-err">읽지 못한 줄 ${bad}개는 넣지 않습니다.</p>` : ''),
    });
    if (!ok) return;
    const { classes, missing } = await replaceRosterRows(db, { year: state.year, rows: good });
    toast(`${classes.length}개 강의실, ${classes.reduce((s, c) => s + c.count, 0)}명을 올렸습니다.` +
      (missing.length ? ` 없는 강의실 ${missing.length}개는 넣지 않았습니다.` : ''));
    await reloadAll();
    renderStudents();
  } catch (e) {
    console.warn('[roster]', e);
    toast('올리지 못했습니다. ' + e.message, 'err');
  }
}

/* ══════ 축 1: 반별 관리 ══════ */

function renderPickClass() {
  const bar = $('pickClassBar');
  const active = activeCourses();
  if (!active.length) {
    bar.innerHTML = '';
    $('byClassBody').innerHTML = '<p class="empty">반이 없습니다.</p>';
    return;
  }
  bar.innerHTML = active.map(c => `
    <button type="button" class="pick${state.pickedCourse === c.id ? ' on' : ''}" data-cid="${esc(c.id)}">
      ${esc(courseShort(c))}
    </button>`).join('');
  renderByClassBody();
}

$('pickClassBar').addEventListener('click', ev => {
  const b = ev.target.closest('[data-cid]');
  if (!b) return;
  state.pickedCourse = b.dataset.cid;
  renderPickClass();
});

/* 반 하나를 고르면 그 반의 메뉴들을 보여 준다. 메뉴 칸은 학생 화면과 같은
   MENUS 표를 읽으므로 어드민과 학생 화면의 메뉴가 어긋나지 않는다. */
function renderByClassBody() {
  const box = $('byClassBody');
  if (!state.pickedCourse) { box.innerHTML = ''; return; }
  const c = state.courses.find(x => x.id === state.pickedCourse);
  if (!c) { box.innerHTML = ''; return; }

  const n  = state.studentCount[c.id] || 0;
  const lc = state.lessonCount[c.id] || { total: 0, open: 0 };
  box.innerHTML = `
    <div class="ctx">
      <span>${esc(courseLabel(c))}</span>
      <span class="ctx-sub">학생 ${n}명, 강의 ${lc.total}개 중 ${lc.open}개 공개</span>
    </div>
    <div class="cell-grid">
      ${MENUS.map(m => (m.key === 'concept' || m.key === 'mission') ? `
        <button type="button" class="cell" data-act="open-menu" data-mkey="${m.key}">
          <span class="cell-top">
            <span class="cell-ic">${icon(m.icon, 20)}</span>
            <span class="cell-name">${esc(m.label)}</span>
          </span>
          <span class="cell-state">${m.key === 'concept' ? `강의 ${lc.total}개` : `미션 ${(state.missionCount[c.id] || { total: 0 }).total}개`}</span>
        </button>` : `
        <button type="button" class="cell" disabled>
          <span class="cell-top">
            <span class="cell-ic">${icon(m.icon, 20)}</span>
            <span class="cell-name">${esc(m.label)}</span>
          </span>
          <span class="cell-state">준비 중</span>
        </button>`).join('')}
    </div>`;
}

/* 반별 관리의 메뉴 칸을 누르면 그 메뉴 화면으로 간다(사이드바에서 바로 가는 것과 같은 자리).
   지금 열리는 것은 개념 노트뿐이고 나머지는 disabled라 눌리지 않는다. */
$('byClassBody').addEventListener('click', ev => {
  const b = ev.target.closest('[data-act="open-menu"]');
  if (b) showPage(b.dataset.mkey);
});

/* 메뉴별 관리 페이지(메뉴를 고르면 그 메뉴를 쓰는 반들을 보여 주던 화면)는 지웠다.
   메뉴별 관리는 페이지가 아니라 사이드바에서 구분선으로 묶은 카테고리다(선생님 지시 2026-10-26).
   메뉴 하나하나가 사이드바에 서고, 누르면 그 메뉴의 화면으로 바로 간다. */
/* ══════ 강의 라이브러리 ══════ */

function wireLibrary() {
  $('btnAddLesson').addEventListener('click', doAddLesson);
  $('inpLessonTitle').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) doAddLesson(); });
  $('libraryList').addEventListener('click', onLibraryClick);
}

async function reloadLibrary() {
  const box = $('libraryList');
  try {
    const rows = await listLibrary(db);
    box.innerHTML = rows.length
      ? rows.map(r => `
          <div class="lib-row">
            <span class="lib-no">${esc(lessonTag(r.lessonNo))}</span>
            <span class="lib-title">${esc(r.title || '제목 없음')}</span>
            ${ib('del', 'trash-2', `${lessonTag(r.lessonNo)} 삭제`, `data-id="${esc(r.id)}" data-name="${esc(r.title || '')}"`, 'ib-danger')}
          </div>`).join('')
      : '<p class="empty">강의가 없습니다.</p>';
  } catch (e) {
    console.warn('[reloadLibrary]', e);
    box.innerHTML = '<p class="empty">불러오지 못했습니다. 새로고침해 주세요.</p>';
  }
}

async function doAddLesson() {
  const lessonNo = $('inpLessonNo').value.trim();
  const title    = $('inpLessonTitle').value.trim();
  if (!lessonNo || !title) { toast('강 번호와 제목을 입력해 주세요.', 'err'); return; }
  $('btnAddLesson').disabled = true;
  try {
    // order는 2026과 같은 규칙으로 강 번호에서 뽑는다(OT 같은 비숫자는 맨 아래).
    await addLibraryLesson(db, { lessonNo, title, order: lessonOrderKey(lessonNo) });
    $('inpLessonNo').value = '';
    $('inpLessonTitle').value = '';
    toast(`${lessonTag(lessonNo)} 강의를 추가했습니다.`);
    await reloadLibrary();
  } catch (e) {
    console.warn('[addLesson]', e);
    toast('추가하지 못했습니다. ' + e.message, 'err');
  } finally {
    $('btnAddLesson').disabled = false;
  }
}

async function onLibraryClick(ev) {
  const btn = ev.target.closest('[data-act="del"]');
  if (!btn) return;
  const ok = await ask({
    title: '강의 삭제',
    // 올려 둔 줄을 남기면 학생 화면에 내용 없는 강의가 뜬다. 그래서 함께 지운다(2026-10-26).
    body: `${esc(btn.dataset.name || '이 강의')} 강의를 지웁니다. 올려 둔 강의실에서도 함께 사라집니다.`,
    danger: true,
  });
  if (!ok) return;
  try {
    await deleteLessonEverywhere(db, btn.dataset.id);
    await reloadLibrary();
  } catch (e) {
    console.warn('[delLesson]', e);
    toast('삭제하지 못했습니다. ' + e.message, 'err');
  }
}

/* ══════ 미션 체크 ══════ (2026-10-26)
 *
 * 미션은 따로 만든 웹앱이고 LMS는 주소로만 잇는다 — 2026에서 잘 돌던 구조를 그대로 가져왔다.
 * 다만 2026이 어드민 코드에 앱 목록을 박아 두던 것(MISSION_SOURCES)은 가져오지 않는다.
 * 앱 키를 미션 문서에 적어 두고 성적 쪽이 그 키로 공용 제출 컬렉션을 조회한다.
 *
 * 줄의 톱니 버튼이 그 앱의 어드민을 이 화면 안에서 바로 연다(선생님 지시).
 * 앱을 고치러 다른 탭으로 나갈 일이 없다.
 */

async function reloadMissions() {
  const box = $('missionList');
  try {
    state.missions = await listMissionLibrary(db);
  } catch (e) {
    console.warn('[missions]', e);
    box.innerHTML = '<p class="empty">미션을 불러오지 못했습니다.</p>';
    return;
  }
  if (!state.missions.length) { box.innerHTML = '<p class="empty">미션이 없습니다.</p>'; renderMissionRooms(); return; }

  box.innerHTML = state.missions.map(m => `
    <div class="mi-row" data-id="${esc(m.id)}">
      <span class="mi-no${m.isOpen ? '' : ' off'}">${esc(m.missionNo ? lessonTag(m.missionNo) : '미션')}</span>
      <span class="mi-main">
        <span class="mi-title">${esc(m.title || '(제목 없음)')}</span>
        <span class="mi-meta">
          <span class="mi-key">${esc(m.appKey || appKeyFromUrl(m.url) || '앱 키 없음')}</span>
          <span data-rooms="${esc(m.id)}"></span>
        </span>
      </span>
      <span class="mi-acts">
        <button type="button" class="mi-sw${m.isOpen ? ' on' : ''}" data-act="mi-open" data-id="${esc(m.id)}"
          title="${m.isOpen ? '공개 중' : '비공개'}" aria-label="공개 전환"></button>
        <button type="button" class="ib" data-act="mi-rooms" data-id="${esc(m.id)}" title="올릴 강의실" aria-label="올릴 강의실">${icon('school', 18)}</button>
        <button type="button" class="ib" data-act="mi-admin" data-id="${esc(m.id)}" title="앱 어드민 열기" aria-label="앱 어드민 열기"${m.adminUrl ? '' : ' disabled'}>${icon('settings', 18)}</button>
        <button type="button" class="ib" data-act="mi-open-app" data-id="${esc(m.id)}" title="학생 화면 보기" aria-label="학생 화면 보기"${m.url ? '' : ' disabled'}>${icon('eye', 18)}</button>
        <button type="button" class="ib" data-act="mi-edit" data-id="${esc(m.id)}" title="수정" aria-label="수정">${icon('pencil', 18)}</button>
        <button type="button" class="ib ib-danger" data-act="mi-del" data-id="${esc(m.id)}" title="삭제" aria-label="삭제">${icon('trash-2', 18)}</button>
      </span>
    </div>`).join('');

  renderMissionRooms();
}

/* 올린 강의실 이름을 줄마다 적는다. 실제 데이터라 안내문이 아니다(CLAUDE.md 화면 규칙).
   이 학년도에 없는 강의실(다른 해에 올려 둔 줄)은 개수로만 센다 — 개념 노트와 같은 규칙. */
async function renderMissionRooms() {
  if (!state.missions.length) return;
  let rows = [];
  try {
    const all = await Promise.all(state.missions.map(m => listMissionCourses(db, m.id)));
    rows = all;
  } catch (e) { console.warn('[missionRooms]', e); return; }

  const byId = new Map(state.courses.map(c => [c.id, courseShort(c)]));
  state.missions.forEach((m, i) => {
    const el = document.querySelector(`[data-rooms="${CSS.escape(m.id)}"]`);
    if (!el) return;
    const here = [], other = [];
    (rows[i] || []).forEach(r => byId.has(r.courseId) ? here.push(byId.get(r.courseId)) : other.push(r));
    const parts = [];
    if (here.length) parts.push(here.join(', '));
    if (other.length) parts.push(`다른 학년도 ${other.length}개`);
    el.textContent = parts.length ? parts.join(', ') : '올린 강의실 없음';
  });
}

/* 미션 추가와 수정은 같은 창을 쓴다. 칸이 같아서 둘로 나눌 이유가 없다. */
function missionFields(m = {}) {
  return [
    { key: 'title',    type: 'text', placeholder: '미션 제목',  value: m.title ?? '' },
    { key: 'missionNo',type: 'text', placeholder: '강 번호 (비워도 됨)', value: m.missionNo ?? '' },
    { key: 'appKey',   type: 'text', placeholder: '앱 키 (폴더 이름, 예: j_interview)', value: m.appKey ?? '' },
    { key: 'url',      type: 'text', placeholder: '학생 주소 (apps/앱이름/index.html)', value: m.url ?? '' },
    { key: 'adminUrl', type: 'text', placeholder: '어드민 주소 (apps/앱이름/admin.html)', value: m.adminUrl ?? '' },
  ];
}

const missionCheck = v => !String(v.title || '').trim() ? '미션 제목을 적어 주세요.'
                        : !String(v.url || '').trim()   ? '학생 주소를 적어 주세요.' : '';

// 앱 키를 안 적었으면 주소에서 뽑아 채운다(둘 다 비면 빈 값).
function missionData(v) {
  const url = String(v.url || '').trim();
  return {
    title:     String(v.title || '').trim(),
    missionNo: String(v.missionNo || '').trim(),
    appKey:    String(v.appKey || '').trim() || appKeyFromUrl(url),
    url,
    adminUrl:  String(v.adminUrl || '').trim(),
  };
}

async function doAddMission() {
  const v = await ask({ title: '미션 추가', fields: missionFields(), check: missionCheck });
  if (!v) return;
  try {
    await addMission(db, { ...missionData(v), isOpen: false });
    await reloadMissions();
    toast('미션을 추가했습니다.');
  } catch (e) {
    console.warn('[addMission]', e);
    toast('추가하지 못했습니다. ' + e.message, 'err');
  }
}

async function doEditMission(m) {
  const v = await ask({ title: '미션 수정', fields: missionFields(m), check: missionCheck });
  if (!v) return;
  const data = missionData(v);
  try {
    await updateMission(db, m.id, data);
    // 올려 둔 줄에도 표시용 칸을 복사해 두었으므로 같이 고친다(학생 화면이 올린 줄만 읽는다).
    await syncMissionRows(db, m.id, {
      title: data.title, missionNo: data.missionNo, appKey: data.appKey, url: data.url,
    });
    await reloadMissions();
    toast('미션을 고쳤습니다.');
  } catch (e) {
    console.warn('[editMission]', e);
    toast('고치지 못했습니다. ' + e.message, 'err');
  }
}

// 공개 스위치는 미션 하나에 하나다. 켜면 올려 둔 강의실 전부가 같이 열린다(강의와 같은 규칙).
async function toggleMissionOpen(m) {
  const next = !(m.isOpen === true);
  try {
    await updateMission(db, m.id, { isOpen: next });
    await syncMissionRows(db, m.id, { isOpen: next });
    await reloadMissions();
  } catch (e) {
    console.warn('[missionOpen]', e);
    toast('공개를 바꾸지 못했습니다. ' + e.message, 'err');
  }
}

async function pickMissionRooms(m) {
  if (state.year == null) { toast('학년도가 없습니다.', 'err'); return; }
  if (!state.courses.length) { toast(`${state.year}학년도 강의실이 없습니다.`, 'err'); return; }
  let on = new Set();
  try { on = new Set((await listMissionCourses(db, m.id)).map(r => r.courseId)); }
  catch (e) { console.warn('[missionRooms]', e); }

  const v = await ask({
    title: `${m.title} 올릴 강의실`,
    wide: true,
    fields: [{
      key: 'rooms', type: 'rooms',
      options: state.courses.map(c => ({
        value: c.id, label: courseShort(c),
        subject: c.subject ?? '', grade: c.grade, classNo: c.classNo,
      })),
      value: state.courses.filter(c => on.has(c.id)).map(c => c.id),
    }],
  });
  if (!v) return;
  try {
    const { added, removed } = await setMissionCourses(db, m, v.rooms, state.courses.map(c => c.id));
    await reloadMissions();
    toast(added || removed ? '올릴 강의실을 맞췄습니다.' : '바뀐 것이 없습니다.');
  } catch (e) {
    console.warn('[setMissionRooms]', e);
    toast('강의실을 맞추지 못했습니다. ' + e.message, 'err');
  }
}

async function doDeleteMission(m) {
  const ok = await ask({
    title: '미션 삭제',
    body: `${esc(m.title || '이 미션')}을 지웁니다. 올려 둔 강의실에서도 함께 사라집니다.`,
    danger: true,
  });
  if (!ok) return;
  try {
    await deleteMissionEverywhere(db, m.id);
    await reloadMissions();
  } catch (e) {
    console.warn('[delMission]', e);
    toast('삭제하지 못했습니다. ' + e.message, 'err');
  }
}

$('btnAddMission').addEventListener('click', doAddMission);
$('missionList').addEventListener('click', ev => {
  const b = ev.target.closest('[data-act]');
  if (!b) return;
  const m = state.missions.find(x => x.id === b.dataset.id);
  if (!m) return;
  const act = b.dataset.act;
  if (act === 'mi-open')     toggleMissionOpen(m);
  if (act === 'mi-rooms')    pickMissionRooms(m);
  if (act === 'mi-admin')    openAppAdmin(m.adminUrl, m.title);
  if (act === 'mi-open-app') window.open(resolveAppUrl(m.url), '_blank', 'noopener');
  if (act === 'mi-edit')     doEditMission(m);
  if (act === 'mi-del')      doDeleteMission(m);
});

/* ── 앱 어드민 오버레이 (2026 lms/admin.js에서 옮김) ──
 * 본문 자리를 덮고 그 앱의 admin.html을 iframe으로 띄운다. 앱이
 * <html class="has-own-back">를 스스로 달아 두면 자기 헤더에 "목록으로"가 이미
 * 있다는 뜻이라 위쪽 바를 숨긴다. 같은 origin이라 안을 읽을 수 있고, 못 읽으면
 * 그냥 바를 둔다(버튼이 둘인 편이 하나도 없는 것보다 낫다).
 */
function openAppAdmin(adminUrl, title) {
  const url = resolveAppUrl(adminUrl);
  if (!url) { toast('어드민 주소가 없습니다.', 'err'); return; }
  const frame = $('appAdminFrame');
  $('appAdminBar').hidden = false;
  frame.onload = () => {
    try {
      const html = frame.contentDocument && frame.contentDocument.documentElement;
      if (html && html.classList.contains('has-own-back')) $('appAdminBar').hidden = true;
    } catch (e) { /* 다른 origin이면 못 읽는다. 바를 그대로 둔다. */ }
  };
  frame.src = url;
  $('appAdminOverlay').hidden = false;
  $('admMain').hidden = true;
  if (title) document.title = `${title} : 관리자 모드`;
}

function closeAppAdmin() {
  $('appAdminOverlay').hidden = true;
  $('appAdminFrame').src = 'about:blank';
  $('admMain').hidden = false;
  document.title = '2027 : 관리자 모드';
  // 앱 어드민에서 채점하고 돌아오면 목록 상태가 달라졌을 수 있다.
  if (!$('missionPage').hidden) reloadMissions();
}

$('appAdminClose').addEventListener('click', closeAppAdmin);
// 앱이 자기 헤더의 "목록으로"에서 부를 수 있게 한 곳만 노출한다.
// (앱은 2026 그대로 window.parent.closeAppAdmin()을 부른다 — 그 규약을 지킨다.)
window.closeAppAdmin = closeAppAdmin;
