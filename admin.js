/* 2027 LMS 어드민 — 큰 틀
 *
 *  1. 강의실 관리 — 학년도를 고르고, 그 해의 강의실(과목 + 학년 + 반)을 만들고 고치고 지운다.
 *                강의실은 학년 아래로 묶지 않고 한 줄로 늘어놓은 뒤 위의 태그(과목과 학년 한 줄,
 *                반 한 줄)로 골라 본다. 태그는 여러 개를 함께 켤 수 있다.
 *     학생 관리 — 명단을 엑셀 한 장으로 한꺼번에 만든다. 강의실마다 따로 올리지 않는다.
 *  2. 두 관리 축 — "반별"은 반을 먼저 고르고 그 반의 메뉴들을 보고,
 *                "메뉴별"은 메뉴를 먼저 고르고 그 메뉴의 반들을 본다.
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
import { icon } from "./shared/icons.js?v=20261025a";
import {
  MENUS, menuByKey, schoolYear, roomNo,
  validYear, validGrade, validClass, validSubject,
  listYears, createYear, renameYear, deleteYear,
  courseLabel, courseShort, listCourses,
  createCourses, updateCourse, archiveCourse, unarchiveCourse, deleteCourse,
  countStudentsByCourse, listYearStudents, addStudent, updateStudent, deleteStudent, rosterRowFromSheet, groupRosterRows, replaceRosterRows,
  listLibrary, addLibraryLesson, deleteLibraryLesson,
  countLessonsByCourse, lessonTag, lessonOrderKey
} from "./model.js?v=20261025j";

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
  filter: { subject: new Set(), grade: new Set(), classNo: new Set() },
  pickedCourse: null,   // 반별 관리에서 고른 반
  pickedMenu: null,     // 메뉴별 관리에서 고른 메뉴
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
  return vals;
}

function ask({ title, body = '', fields = [], check = null, info = false, danger = false }) {
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
  $('modal').hidden = false;
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
  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.nav === nav));
  document.querySelectorAll('.panel-page').forEach(el =>
    el.hidden = el.dataset.page !== nav);
  if (window.innerWidth <= 860 && $('admSidebar').classList.contains('open')) toggleSidebar();

  if (nav === 'students') renderStudents();
  if (nav === 'byclass') renderPickClass();
  if (nav === 'bymenu')  renderPickMenu();
  if (nav === 'library') reloadLibrary();
}

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
    const [courses, sc, lc] = await Promise.all([
      state.year != null ? listCourses(db, { year: state.year, includeArchived: true }) : [],
      countStudentsByCourse(db),
      countLessonsByCourse(db),
    ]);
    state.courses = courses;
    state.studentCount = sc;
    state.lessonCount = lc;
  } catch (e) {
    console.warn('[reloadCourses]', e);
    $('classList').innerHTML = '<p class="empty">불러오지 못했습니다. 새로고침해 주세요.</p>';
    return;
  }
  if (state.pickedCourse && !activeCourses().some(c => c.id === state.pickedCourse)) state.pickedCourse = null;
  renderClasses();
  renderPickClass();
  renderPickMenu();
}

/* ══════ 강의실 관리 ══════ (2026-10-25 "학급 관리"에서 이름을 바꿈)
 * 학년도 칩 줄, 그 아래 태그 두 줄(과목과 학년, 반), 그 아래 강의실 목록 한 줄. 명단은 학생 관리에서.
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

const TAGS = [
  { key: 'subject', label: v => v,          values: () => [...new Set(state.courses.map(c => c.subject || ''))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko')) },
  { key: 'grade',   label: v => `${v}학년`, values: () => [...new Set(state.courses.map(c => c.grade))].sort((a, b) => a - b) },
  { key: 'classNo', label: v => `${v}반`,   values: () => [...new Set(state.courses.map(c => c.classNo))].sort((a, b) => a - b) },
];

function passesFilter(c) {
  return TAGS.every(t => {
    const on = state.filter[t.key];
    return !on.size || on.has(t.key === 'subject' ? (c.subject || '') : c[t.key]);
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
  // 태그 두 줄 — 과목과 학년이 한 줄, 반이 한 줄(반은 몇 개로 늘어날지 몰라서 따로, 선생님 지시 2026-10-25).
  const tagBtns = t => t.values().map(v => `
        <button type="button" class="tag${state.filter[t.key].has(v) ? ' on' : ''}" data-tag="${t.key}" data-val="${esc(v)}">${esc(t.label(v))}</button>`).join('');
  const [tSubject, tGrade, tClass] = TAGS;
  $('tagBar').innerHTML = state.courses.length ? `
    <div class="tag-row">${tagBtns(tSubject)}<span class="tag-gap"></span>${tagBtns(tGrade)}</div>
    <div class="tag-row">${tagBtns(tClass)}</div>` : '';

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
  const val = key === 'subject' ? b.dataset.val : +b.dataset.val;
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
}

async function renderStudents() {
  $('stuYearBar').innerHTML = state.years.map(y => `
    <button type="button" class="pick${y === state.year ? ' on' : ''}" data-year="${y}">${y}학년도</button>`).join('');
  $('stuTools').innerHTML = state.year != null
    ? ib('add-student', 'plus', '학생 추가', '', 'ib-primary') + ib('upload-all', 'upload', '명단 올리기')
    : '';

  const box = $('stuList');
  if (state.year == null) { box.innerHTML = '<p class="empty">학년도가 없습니다.</p>'; return; }
  box.innerHTML = '<p class="empty">불러오는 중입니다.</p>';
  let rows;
  try { rows = await listYearStudents(db, state.year); }
  catch (e) {
    console.warn('[students]', e);
    box.innerHTML = '<p class="empty">불러오지 못했습니다. 새로고침해 주세요.</p>';
    return;
  }
  box.innerHTML = rows.length ? rows.map(s => `
    <div class="stu-row">
      <span class="stu-no">${esc(s.studentNo)}</span>
      <span class="stu-name">${esc(s.name)}</span>
      <span class="stu-courses">${s.courses.map(c => `<span class="stu-course">${esc(courseShort(c))}</span>`).join('')}</span>
      <span class="acts">
        ${ib('edit-student', 'pencil', `${s.studentNo} ${s.name} 수정`, `data-no="${esc(s.studentNo)}" data-name="${esc(s.name)}"`)}
        ${ib('del-student', 'trash-2', `${s.studentNo} ${s.name} 삭제`, `data-no="${esc(s.studentNo)}" data-name="${esc(s.name)}"`, 'ib-danger')}
      </span>
    </div>`).join('') : '<p class="empty">학생이 없습니다.</p>';
}

/* 학생 줄의 수정과 삭제. 학생은 학번으로 그 학년도 강의실 전부에 묶여 있어서 한꺼번에 고치고 지운다. */
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
    if (btn.dataset.act === 'del-student') {
      if (!await askDelete(name, `${no} ${name}이 이 학년도 강의실 전부에서 빠지고 비밀번호도`)) return;
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
      ${MENUS.map(m => `
        <button type="button" class="cell" disabled>
          <span class="cell-top">
            <span class="cell-ic">${icon(m.icon, 20)}</span>
            <span class="cell-name">${esc(m.label)}</span>
          </span>
          <span class="cell-state">준비 중</span>
        </button>`).join('')}
    </div>`;
}

/* ══════ 축 2: 메뉴별 관리 ══════ */

function renderPickMenu() {
  $('pickMenuBar').innerHTML = MENUS.map(m => `
    <button type="button" class="pick${state.pickedMenu === m.key ? ' on' : ''}" data-mkey="${esc(m.key)}">
      <span class="pick-ic">${icon(m.icon, 16)}</span>${esc(m.label)}
    </button>`).join('');
  renderByMenuBody();
}

$('pickMenuBar').addEventListener('click', ev => {
  const b = ev.target.closest('[data-mkey]');
  if (!b) return;
  state.pickedMenu = b.dataset.mkey;
  renderPickMenu();
});

/* 메뉴 하나를 고르면 그 메뉴를 쓰는 반들을 보여 준다. */
function renderByMenuBody() {
  const box = $('byMenuBody');
  if (!state.pickedMenu) { box.innerHTML = ''; return; }
  const m = menuByKey(state.pickedMenu);
  const active = activeCourses();
  if (!active.length) { box.innerHTML = '<p class="empty">반이 없습니다.</p>'; return; }
  box.innerHTML = `
    <div class="ctx">
      <span>${esc(m.label)}</span>
      <span class="ctx-sub">${state.year}학년도 ${active.length}개 반</span>
    </div>
    <div class="cell-grid">
      ${active.map(c => {
        const n = state.studentCount[c.id] || 0;
        return `
        <button type="button" class="cell" disabled>
          <span class="cell-top">
            <span class="cell-ic">${icon(m.icon, 20)}</span>
            <span class="cell-name">${esc(courseShort(c))}</span>
          </span>
          <span class="cell-sub">학생 ${n}명</span>
          <span class="cell-state">준비 중</span>
        </button>`;
      }).join('')}
    </div>`;
}

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
    body: `${esc(btn.dataset.name || '이 강의')} 강의를 라이브러리에서 지웁니다. 이미 반에 붙인 연결은 남습니다.`,
    danger: true,
  });
  if (!ok) return;
  try {
    await deleteLibraryLesson(db, btn.dataset.id);
    await reloadLibrary();
  } catch (e) {
    console.warn('[delLesson]', e);
    toast('삭제하지 못했습니다. ' + e.message, 'err');
  }
}
