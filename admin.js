/* 2027 LMS 어드민 — 큰 틀
 *
 * 세 가지만 담았다.
 *
 *  1. 반 관리  — 반을 1년 단위로 개설하고 없앤다. 학년 통째 개설과
 *                학년 명단 통째 업로드가 핵심이다(학번에서 반을 읽어 흩는다).
 *  2. 두 관리 축 — "반별"은 반을 먼저 고르고 그 반의 메뉴들을 보고,
 *                "메뉴별"은 메뉴를 먼저 고르고 그 메뉴의 반들을 본다.
 *                둘 다 같은 자리(반 x 메뉴)에 도착한다. 선생님이 그때
 *                편한 쪽으로 들어가면 된다.
 *  3. 강의 라이브러리 — 강의 내용은 연도와 무관하게 남는다. 반이 없어져도
 *                강의는 남아서 다음 해 반에 다시 붙여 쓴다.
 *
 * 2026 admin.js(10,382줄)와 달리 인라인 onclick과 window 노출을 쓰지 않는다.
 * 전부 data-act 속성 + 컨테이너 이벤트 위임이다. 2026에서는 window 노출을
 * 빠뜨리면 조용히 실패하는 사고가 반복돼서 CLAUDE.md에 별도 규칙까지 있었다.
 *
 * 각 메뉴의 실제 작업 화면(개념 편집, 성적 표 등)은 아직 없다. 지금은
 * 반 x 메뉴 칸까지 도착하는 길만 세워 둔 상태다.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./shared/firebase-config.js";
import { icon } from "./shared/icons.js?v=20260918";
import {
  MENUS, menuByKey, schoolYear, parseStudentNo,
  courseLabel, courseShort, listCourses, listYears,
  createCourse, createGrade, archiveCourse, unarchiveCourse, deleteCourse,
  listStudents, countStudentsByCourse, replaceRoster, replaceGradeRoster,
  listLibrary, addLibraryLesson, deleteLibraryLesson,
  countLessonsByCourse, lessonTag, lessonOrderKey
} from "./model.js?v=20261023b";

const app  = initializeApp(firebaseConfig);
// 학생 화면과 같은 이유로 롱폴링 자동 감지를 켠다(lms2027/index.js 주석 참고).
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

function hint(id, text, kind = '') {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'hint' + (kind ? ' ' + kind : '');
}

/* ── 상태 ──
 * 모듈 최상위 변수를 최소로 둔다. 2026 admin.js는 여기에 81개가 있었고
 * 탭 사이로 값이 새는 것을 눈으로 막아야 했다. */
const state = {
  year: schoolYear(),
  courses: [],          // 지금 학년도의 반 목록
  studentCount: {},     // courseId 별 학생 수
  lessonCount: {},      // courseId 별 { total, open }
  pickedCourse: null,   // 반별 관리에서 고른 반
  pickedMenu: null,     // 메뉴별 관리에서 고른 메뉴
  uploadTarget: null,   // 반별 명단 업로드가 어느 반인지
};

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
  wireLibrary();
  loadYears().then(reloadCourses);
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

  if (nav === 'byclass') renderPickClass();
  if (nav === 'bymenu')  renderPickMenu();
  if (nav === 'library') reloadLibrary();
}

/* ── 공통: 반 목록 다시 읽기 ──
 * 학생 수와 강의 수를 반마다 따로 묻지 않고 컬렉션을 한 번씩만 읽어 센다.
 * 반이 스무 개를 넘어가면 반별 조회는 읽기가 그만큼 곱해진다. */
async function reloadCourses() {
  const showArch = $('chkArchived').checked;
  try {
    const [courses, sc, lc] = await Promise.all([
      listCourses(db, { year: state.year, includeArchived: showArch }),
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
  renderClassList();
  renderPickClass();
  renderPickMenu();
}

async function loadYears() {
  let years = [];
  try { years = await listYears(db); } catch (e) { console.warn('[loadYears]', e); }
  const cur = schoolYear();
  // 올해와 내년은 반이 아직 없어도 고를 수 있어야 한다(개설하려면 먼저 골라야 하므로).
  const all = [...new Set([...years, cur, cur + 1])].sort((a, b) => b - a);
  if (!all.includes(state.year)) state.year = cur;
  $('selYear').innerHTML = all.map(y =>
    `<option value="${y}"${y === state.year ? ' selected' : ''}>${y}학년도</option>`).join('');
}

/* ══════ 반 관리 ══════ */

function wireClasses() {
  $('selYear').addEventListener('change', e => {
    state.year = +e.target.value;
    state.pickedCourse = null;
    reloadCourses();
  });
  $('chkArchived').addEventListener('change', reloadCourses);
  $('btnCreateGrade').addEventListener('click', doCreateGrade);
  $('btnAddOne').addEventListener('click', doAddOne);
  $('fileRoster').addEventListener('change', doUploadGradeRoster);
  $('fileClassRoster').addEventListener('change', doUploadClassRoster);

  // 반 목록의 버튼은 이벤트 위임으로 받는다(인라인 onclick과 window 노출을 쓰지 않는다).
  $('classList').addEventListener('click', onClassListClick);
}

async function doCreateGrade() {
  const grade = +$('inpGradeAll').value;
  const count = +$('inpClassCount').value;
  if (!(grade >= 1 && grade <= 6) || !(count >= 1 && count <= 20)) {
    hint('hintCreateGrade', '학년과 반 수를 확인해 주세요.', 'err');
    return;
  }
  $('btnCreateGrade').disabled = true;
  hint('hintCreateGrade', '개설하고 있습니다.');
  try {
    const { made, skipped } = await createGrade(db, { year: state.year, grade, count });
    const parts = [];
    if (made.length)    parts.push(`${made.length}개 반을 개설했습니다`);
    if (skipped.length) parts.push(`이미 있던 ${skipped.length}개 반은 그대로 두었습니다`);
    hint('hintCreateGrade', parts.join('. ') + '.', 'ok');
    await reloadCourses();
  } catch (e) {
    console.warn('[createGrade]', e);
    hint('hintCreateGrade', '개설하지 못했습니다. ' + e.message, 'err');
  } finally {
    $('btnCreateGrade').disabled = false;
  }
}

async function doAddOne() {
  const grade = prompt('학년을 입력해 주세요.');
  if (grade === null) return;
  const classNo = prompt('반을 입력해 주세요.');
  if (classNo === null) return;
  const g = +grade, c = +classNo;
  if (!(g >= 1 && g <= 6) || !(c >= 1 && c <= 20)) { alert('학년과 반을 확인해 주세요.'); return; }
  try {
    const r = await createCourse(db, { year: state.year, grade: g, classNo: c });
    if (!r.created) alert('이미 있는 반입니다.');
    await reloadCourses();
  } catch (e) {
    console.warn('[addOne]', e);
    alert('개설하지 못했습니다. ' + e.message);
  }
}

/* 학년 명단 통째 업로드 — 학번에서 반을 읽어 반별로 나눠 넣는다.
   2026에서는 전교생 명단을 한 덩어리로 통째 교체했는데, 지금은 올린
   학년의 반들만 바뀐다. 다른 학년 명단은 건드리지 않는다. */
function doUploadGradeRoster(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  const grade = +$('inpGradeUp').value;
  if (!(grade >= 1 && grade <= 6)) {
    hint('hintUpload', '학년을 확인해 주세요.', 'err');
    ev.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const rows = raw.slice(1)  // 1행은 머리글로 보고 건너뛴다
        .filter(r => r[0] !== '' && r[1] !== '')
        .map(r => ({ studentNo: String(r[0]).trim(), name: String(r[1]).trim() }))
        .filter(s => parseStudentNo(s.studentNo) && s.name);

      if (!rows.length) { hint('hintUpload', '읽을 수 있는 줄이 없습니다.', 'err'); return; }

      // 어느 반이 몇 명으로 바뀌는지 먼저 보여 주고 확인받는다(명단 교체는 되돌릴 수 없다).
      const preview = {};
      rows.forEach(r => {
        const p = parseStudentNo(r.studentNo);
        if (p.grade === grade) preview[p.classNo] = (preview[p.classNo] || 0) + 1;
      });
      const classNos = Object.keys(preview).map(Number).sort((a, b) => a - b);
      if (!classNos.length) {
        hint('hintUpload', `${grade}학년 학번이 없습니다. 학년을 확인해 주세요.`, 'err');
        return;
      }
      const summary = classNos.map(n => `${n}반 ${preview[n]}명`).join(', ');
      if (!confirm(`${state.year}학년도 ${grade}학년\n${summary}\n\n해당 반의 기존 명단을 교체합니다. 진행하시겠습니까?`)) return;

      hint('hintUpload', '올리고 있습니다.');
      const { classes, foreign } = await replaceGradeRoster(db, { year: state.year, grade, rows });
      const done = classes.map(c => `${c.classNo}반 ${c.count}명`).join(', ');
      const extra = foreign.length ? ` 다른 학년 학번 ${foreign.length}줄은 넣지 않았습니다.` : '';
      hint('hintUpload', `${done}.${extra}`, 'ok');
      await reloadCourses();
    } catch (err) {
      console.warn('[uploadRoster]', err);
      hint('hintUpload', '올리지 못했습니다. ' + err.message, 'err');
    } finally {
      ev.target.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}

/* 반별 명단 업로드 — 2026의 일괄 업로드와 같은 흐름이다. 다른 점은 지우는
   범위가 그 반뿐이라는 것(2026에서는 전교생 명단을 통째로 지웠다).
   학번에서 읽은 학년과 반이 그 반과 다른 줄은 넣지 않고 몇 줄인지만 알려 준다. */
function doUploadClassRoster(ev) {
  const file = ev.target.files[0];
  const cid  = state.uploadTarget;
  ev.target.value = '';
  if (!file || !cid) return;
  const c = state.courses.find(x => x.id === cid);
  if (!c) return;

  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const wb  = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const all = raw.slice(1)  // 1행은 머리글로 보고 건너뛴다
        .filter(r => r[0] !== '' && r[1] !== '')
        .map(r => ({ studentNo: String(r[0]).trim(), name: String(r[1]).trim() }))
        .filter(s => parseStudentNo(s.studentNo) && s.name);

      const mine = all.filter(s => {
        const p = parseStudentNo(s.studentNo);
        return p.grade === c.grade && p.classNo === c.classNo;
      });
      if (!mine.length) {
        hint('hintClassUpload', `${courseShort(c)} 학번이 없습니다. 파일을 확인해 주세요.`, 'err');
        return;
      }
      if (!confirm(`${courseShort(c)} ${mine.length}명\n\n기존 명단을 교체합니다. 진행하시겠습니까?`)) {
        hint('hintClassUpload', '');
        return;
      }
      hint('hintClassUpload', '올리고 있습니다.');
      await replaceRoster(db, cid, mine);
      const skipped = all.length - mine.length;
      hint('hintClassUpload',
        `${courseShort(c)} ${mine.length}명을 올렸습니다.` +
        (skipped ? ` 다른 반 학번 ${skipped}줄은 넣지 않았습니다.` : ''), 'ok');
      await reloadCourses();
    } catch (err) {
      console.warn('[uploadClassRoster]', err);
      hint('hintClassUpload', '올리지 못했습니다. ' + err.message, 'err');
    } finally {
      state.uploadTarget = null;
    }
  };
  reader.readAsArrayBuffer(file);
}

function renderClassList() {
  const box = $('classList');
  if (!state.courses.length) {
    box.innerHTML = `<p class="empty">${state.year}학년도에 개설된 반이 없습니다. 위에서 학년을 통째로 개설해 보세요.</p>`;
    return;
  }
  box.innerHTML = state.courses.map(c => {
    const arch = c.status === 'archived';
    const n  = state.studentCount[c.id] || 0;
    const lc = state.lessonCount[c.id] || { total: 0, open: 0 };
    return `
      <div class="cls-row${arch ? ' arch' : ''}">
        <span class="cls-name">${esc(courseShort(c))}</span>
        ${arch ? '<span class="badge">아카이브</span>' : ''}
        <span class="cls-meta">학생 ${n}명, 강의 ${lc.total}개 중 ${lc.open}개 공개</span>
        <span class="cls-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-act="roster" data-id="${esc(c.id)}">명단</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="upload" data-id="${esc(c.id)}">명단 올리기</button>
          ${arch
            ? `<button type="button" class="btn btn-ghost btn-sm" data-act="unarchive" data-id="${esc(c.id)}">되돌리기</button>`
            : `<button type="button" class="btn btn-ghost btn-sm" data-act="archive" data-id="${esc(c.id)}">아카이브</button>`}
          <button type="button" class="btn btn-danger btn-sm" data-act="delete" data-id="${esc(c.id)}">삭제</button>
        </span>
      </div>`;
  }).join('');
}

async function onClassListClick(ev) {
  const btn = ev.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const c  = state.courses.find(x => x.id === id);
  if (!c) return;

  try {
    if (btn.dataset.act === 'roster') {
      const rows = await listStudents(db, id);
      alert(rows.length
        ? `${courseShort(c)} 명단 ${rows.length}명\n\n` +
          rows.map(r => `${r.studentNo} ${r.name}`).join('\n')
        : `${courseShort(c)} 명단이 비어 있습니다.`);
      return;
    }
    if (btn.dataset.act === 'upload') {
      // 어느 반에 올리는지 담아 두고 숨겨 둔 파일 칸을 연다.
      state.uploadTarget = id;
      hint('hintClassUpload', `${courseShort(c)} 명단을 고르세요.`);
      $('fileClassRoster').click();
      return;
    }
    if (btn.dataset.act === 'archive') {
      if (!confirm(`${courseShort(c)}을 아카이브하시겠습니까?\n기록은 남고 학생은 더 들어올 수 없습니다.`)) return;
      await archiveCourse(db, id);
    }
    if (btn.dataset.act === 'unarchive') {
      await unarchiveCourse(db, id);
    }
    if (btn.dataset.act === 'delete') {
      // 되돌릴 수 없는 작업이라 반 이름을 직접 적게 한다.
      const n = state.studentCount[id] || 0;
      const want = courseShort(c);
      const typed = prompt(
        `${want}을 삭제하면 명단 ${n}명과 강의 연결까지 함께 지워집니다.\n` +
        `되돌릴 수 없습니다. 삭제하려면 "${want}"을 그대로 입력해 주세요.`);
      if (typed === null) return;
      if (typed.trim() !== want) { alert('입력이 달라 삭제하지 않았습니다.'); return; }
      await deleteCourse(db, id);
    }
    await reloadCourses();
  } catch (e) {
    console.warn('[classAction]', e);
    alert('처리하지 못했습니다. ' + e.message);
  }
}

/* ══════ 축 1: 반별 관리 ══════ */

function renderPickClass() {
  const bar = $('pickClassBar');
  const active = state.courses.filter(c => c.status !== 'archived');
  if (!active.length) {
    bar.innerHTML = '';
    $('byClassBody').innerHTML =
      `<p class="empty">${state.year}학년도에 개설된 반이 없습니다. 반 관리에서 먼저 개설해 주세요.</p>`;
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
  if (!state.pickedCourse) { box.innerHTML = '<p class="empty">위에서 반을 골라 주세요.</p>'; return; }
  const c = state.courses.find(x => x.id === state.pickedCourse);
  if (!c) { box.innerHTML = '<p class="empty">반을 찾을 수 없습니다.</p>'; return; }

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
          <span class="cell-sub">${esc(courseShort(c))}</span>
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

/* 메뉴 하나를 고르면 그 메뉴를 쓰는 반들을 보여 준다. 반별 보기와 칸 모양이
   같은 것은 들어가는 방향만 다르고 도착하는 자리가 같기 때문이다. */
function renderByMenuBody() {
  const box = $('byMenuBody');
  if (!state.pickedMenu) { box.innerHTML = '<p class="empty">위에서 메뉴를 골라 주세요.</p>'; return; }
  const m = menuByKey(state.pickedMenu);
  const active = state.courses.filter(c => c.status !== 'archived');
  if (!active.length) {
    box.innerHTML = `<p class="empty">${state.year}학년도에 개설된 반이 없습니다. 반 관리에서 먼저 개설해 주세요.</p>`;
    return;
  }
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
            <button type="button" class="btn btn-danger btn-sm" data-act="del" data-id="${esc(r.id)}">삭제</button>
          </div>`).join('')
      : '<p class="empty">아직 강의가 없습니다.</p>';
  } catch (e) {
    console.warn('[reloadLibrary]', e);
    box.innerHTML = '<p class="empty">불러오지 못했습니다. 새로고침해 주세요.</p>';
  }
}

async function doAddLesson() {
  const lessonNo = $('inpLessonNo').value.trim();
  const title    = $('inpLessonTitle').value.trim();
  if (!lessonNo || !title) { hint('hintLesson', '강 번호와 제목을 입력해 주세요.', 'err'); return; }
  $('btnAddLesson').disabled = true;
  try {
    // order는 2026과 같은 규칙으로 강 번호에서 뽑는다(OT 같은 비숫자는 맨 아래).
    await addLibraryLesson(db, { lessonNo, title, order: lessonOrderKey(lessonNo) });
    $('inpLessonNo').value = '';
    $('inpLessonTitle').value = '';
    hint('hintLesson', '추가했습니다.', 'ok');
    await reloadLibrary();
  } catch (e) {
    console.warn('[addLesson]', e);
    hint('hintLesson', '추가하지 못했습니다. ' + e.message, 'err');
  } finally {
    $('btnAddLesson').disabled = false;
  }
}

async function onLibraryClick(ev) {
  const btn = ev.target.closest('[data-act="del"]');
  if (!btn) return;
  if (!confirm('이 강의를 라이브러리에서 삭제하시겠습니까?\n이미 반에 붙여 쓰고 있으면 그 연결은 남습니다.')) return;
  try {
    await deleteLibraryLesson(db, btn.dataset.id);
    await reloadLibrary();
  } catch (e) {
    console.warn('[delLesson]', e);
    alert('삭제하지 못했습니다. ' + e.message);
  }
}
