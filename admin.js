/* 2027 LMS 어드민 — 큰 틀
 *
 *  1. 학급 관리 — 학년도, 학년, 반을 선생님이 직접 만들고 고치고 지운다.
 *                학년 통째 개설과 학년 명단 통째 업로드(학번에서 반을 읽어 흩는다)도 여기.
 *  2. 두 관리 축 — "반별"은 반을 먼저 고르고 그 반의 메뉴들을 보고,
 *                "메뉴별"은 메뉴를 먼저 고르고 그 메뉴의 반들을 본다.
 *                둘 다 같은 자리(반 x 메뉴)에 도착한다.
 *  3. 강의 라이브러리 — 강의 내용은 연도와 무관하게 남는다.
 *
 * 2026 admin.js(10,382줄)와 달리 인라인 onclick과 window 노출을 쓰지 않는다.
 * 전부 data-act 속성 + 컨테이너 이벤트 위임이다.
 *
 * 화면 규칙(CLAUDE.md) — 작은 글씨 설명을 붙이지 않는다. 액션 버튼은 아이콘만
 * 두고 title과 aria-label로 이름을 단다. alert/confirm/prompt 대신 ask() 모달.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./shared/firebase-config.js";
import { icon } from "./shared/icons.js?v=20261025a";
import {
  MENUS, menuByKey, schoolYear, parseStudentNo,
  validYear, validGrade, validClass,
  listYears, createYear, renameYear, deleteYear, renameGrade, deleteGrade,
  courseLabel, courseShort, listCourses,
  createCourse, createGrade, renameCourse, archiveCourse, unarchiveCourse, deleteCourse,
  listStudents, countStudentsByCourse, replaceRoster, replaceGradeRoster,
  listLibrary, addLibraryLesson, deleteLibraryLesson,
  countLessonsByCourse, lessonTag, lessonOrderKey
} from "./model.js?v=20261025a";

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
  years: [],            // [{ year, grades: [1,2,3] }] 큰 해부터
  year: null,           // 고른 학년도
  courses: [],          // 고른 학년도의 반 전부(아카이브 포함)
  studentCount: {},     // courseId 별 학생 수
  lessonCount: {},      // courseId 별 { total, open }
  pickedCourse: null,   // 반별 관리에서 고른 반
  pickedMenu: null,     // 메뉴별 관리에서 고른 메뉴
  upload: null,         // 명단 올리기 대상 { kind: 'grade', grade } | { kind: 'class', id }
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
 *   fields: [{ key, label, type: 'number'|'text', value, placeholder }]
 *   check(values): 문제가 있으면 오류 문구를 돌려준다. 모달 안에 띄우고 닫지 않는다.
 *   info: 확인 버튼 하나만(명단 보기처럼 보기만 하는 창).
 */
let _modalDone = null;

function ask({ title, body = '', fields = [], check = null, info = false, danger = false }) {
  if (_modalDone) _modalDone(null);
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = `
    ${body ? `<div class="modal-text">${body}</div>` : ''}
    ${fields.map(f => `
      <label class="f">
        <span class="f-label">${esc(f.label)}</span>
        <input class="inp" data-key="${esc(f.key)}" type="${f.type === 'number' ? 'number' : 'text'}"
          ${f.type === 'number' ? 'inputmode="numeric"' : ''}
          value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder ?? '')}" autocomplete="off">
      </label>`).join('')}
    <div class="modal-err" id="modalErr"></div>`;
  $('modalCancel').hidden = info;
  $('modalOk').classList.toggle('ib-danger', danger);
  $('modalOk').classList.toggle('ib-primary', !danger);
  $('modal').hidden = false;
  const first = $('modalBody').querySelector('input');
  (first || $('modalOk')).focus();
  if (first) first.select();

  return new Promise(resolve => {
    _modalDone = v => { _modalDone = null; $('modal').hidden = true; resolve(v); };
    $('modalOk').onclick = () => {
      const vals = {};
      $('modalBody').querySelectorAll('input[data-key]').forEach(i => {
        vals[i.dataset.key] = i.type === 'number' ? (i.value === '' ? NaN : Number(i.value)) : i.value.trim();
      });
      const err = check ? check(vals) : '';
      if (err) { $('modalErr').textContent = err; return; }
      _modalDone(vals);
    };
  });
}

$('modalCancel').addEventListener('click', () => _modalDone && _modalDone(null));
$('modal').addEventListener('click', e => { if (e.target.id === 'modal' && _modalDone) _modalDone(null); });
document.addEventListener('keydown', e => {
  if ($('modal').hidden) return;
  if (e.key === 'Escape') { e.preventDefault(); _modalDone && _modalDone(null); }
  // 버튼에 초점이 있을 때는 그 버튼이 Enter를 받게 둔다(취소 위에서 Enter가 확인이 되지 않게).
  if (e.key === 'Enter' && !e.isComposing && e.target.tagName === 'INPUT') { e.preventDefault(); $('modalOk').click(); }
});

// 되돌릴 수 없는 삭제는 이름을 그대로 적게 한다.
function askDelete(name, what) {
  return ask({
    title: `${name} 삭제`,
    body: `${esc(what)} 함께 지워지고 되돌릴 수 없습니다.`,
    fields: [{ key: 'name', label: '확인을 위해 이름 입력', type: 'text', placeholder: name }],
    check: v => v.name === name ? '' : `"${name}"을 그대로 입력해 주세요.`,
    danger: true,
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
    $('gradeList').innerHTML = '<p class="empty">불러오지 못했습니다. 새로고침해 주세요.</p>';
    return;
  }
  const has = y => state.years.some(v => v.year === y);
  if (!has(state.year)) {
    const cur = schoolYear();
    state.year = has(cur) ? cur : (state.years[0]?.year ?? null);
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
    $('gradeList').innerHTML = '<p class="empty">불러오지 못했습니다. 새로고침해 주세요.</p>';
    return;
  }
  if (state.pickedCourse && !activeCourses().some(c => c.id === state.pickedCourse)) state.pickedCourse = null;
  renderClasses();
  renderPickClass();
  renderPickMenu();
}

/* ══════ 학급 관리 ══════ */

function wireClasses() {
  $('yearBar').addEventListener('click', onClassesClick);
  $('yearTools').addEventListener('click', onClassesClick);
  $('gradeList').addEventListener('click', onClassesClick);
  $('fileRoster').addEventListener('change', onRosterFile);
}

function renderClasses() {
  const yearObj = state.years.find(y => y.year === state.year);

  $('yearBar').innerHTML = state.years.map(y => `
    <button type="button" class="pick${y.year === state.year ? ' on' : ''}" data-act="pick-year" data-year="${y.year}">
      ${y.year}학년도
    </button>`).join('') + ib('add-year', 'plus', '학년도 추가', '', 'ib-round');

  $('yearTools').innerHTML = yearObj
    ? ib('edit-year', 'pencil', `${yearObj.year}학년도 수정`) + ib('del-year', 'trash-2', `${yearObj.year}학년도 삭제`, '', 'ib-danger')
    : '';

  if (!yearObj) {
    $('gradeList').innerHTML = '<p class="empty">학년도가 없습니다.</p>';
    return;
  }

  $('gradeList').innerHTML = yearObj.grades.map(g => {
    const rows = state.courses.filter(c => c.grade === g);
    const students = rows.reduce((s, c) => s + (state.studentCount[c.id] || 0), 0);
    const ga = `data-grade="${g}"`;
    return `
      <div class="card">
        <div class="card-head">
          <h2 class="card-title">${g}학년<span class="card-meta">${rows.length}개 반, 학생 ${students}명</span></h2>
          <span class="acts">
            ${ib('add-class', 'plus', `${g}학년에 반 추가`, ga)}
            ${ib('upload-grade', 'upload', `${g}학년 명단 올리기`, ga)}
            ${ib('edit-grade', 'pencil', `${g}학년 수정`, ga)}
            ${ib('del-grade', 'trash-2', `${g}학년 삭제`, ga, 'ib-danger')}
          </span>
        </div>
        <div class="card-body">
          ${rows.length ? rows.map(classRow).join('') : '<p class="empty">반이 없습니다.</p>'}
        </div>
      </div>`;
  }).join('') + `
    <button type="button" class="add-block" data-act="add-grade" title="학년 추가" aria-label="학년 추가">${icon('plus', 20)}</button>`;
}

function classRow(c) {
  const arch = c.status === 'archived';
  const n  = state.studentCount[c.id] || 0;
  const lc = state.lessonCount[c.id] || { total: 0, open: 0 };
  const name = courseShort(c);
  const ca = `data-id="${esc(c.id)}"`;
  return `
    <div class="cls-row${arch ? ' arch' : ''}">
      <span class="cls-name">${c.classNo}반</span>
      ${arch ? '<span class="badge">아카이브</span>' : ''}
      <span class="cls-meta">학생 ${n}명, 강의 ${lc.total}개 중 ${lc.open}개 공개</span>
      <span class="acts">
        ${ib('roster', 'users', `${name} 명단`, ca)}
        ${ib('upload-class', 'upload', `${name} 명단 올리기`, ca)}
        ${arch ? ib('unarchive', 'archive-restore', `${name} 아카이브 해제`, ca)
               : ib('archive', 'archive', `${name} 아카이브`, ca)}
        ${ib('edit-class', 'pencil', `${name} 수정`, ca)}
        ${ib('del-class', 'trash-2', `${name} 삭제`, ca, 'ib-danger')}
      </span>
    </div>`;
}

async function onClassesClick(ev) {
  const btn = ev.target.closest('[data-act]');
  if (!btn) return;
  const act   = btn.dataset.act;
  const grade = btn.dataset.grade != null ? +btn.dataset.grade : null;
  const c     = btn.dataset.id ? state.courses.find(x => x.id === btn.dataset.id) : null;
  const year  = state.year;
  const yearObj = state.years.find(y => y.year === year);

  try {
    switch (act) {
      case 'pick-year':
        state.year = +btn.dataset.year;
        state.pickedCourse = null;
        await reloadCourses();
        return;

      case 'add-year': {
        const top = state.years[0]?.year ?? schoolYear();
        const v = await ask({
          title: '학년도 추가',
          fields: [{ key: 'year', label: '학년도', type: 'number', value: state.years.length ? top + 1 : schoolYear() }],
          check: v => !validYear(v.year) ? '학년도를 확인해 주세요.'
            : state.years.some(y => y.year === v.year) ? `${v.year}학년도가 이미 있습니다.` : '',
        });
        if (!v) return;
        await createYear(db, v.year);
        state.year = v.year;
        toast(`${v.year}학년도를 만들었습니다.`);
        break;
      }

      case 'edit-year': {
        const v = await ask({
          title: `${year}학년도 수정`,
          fields: [{ key: 'year', label: '학년도', type: 'number', value: year }],
          check: v => !validYear(v.year) ? '학년도를 확인해 주세요.'
            : (v.year !== year && state.years.some(y => y.year === v.year)) ? `${v.year}학년도가 이미 있습니다.` : '',
        });
        if (!v || v.year === year) return;
        await renameYear(db, year, v.year);
        state.year = v.year;
        toast(`${v.year}학년도로 바꿨습니다.`);
        break;
      }

      case 'del-year': {
        const n = state.courses.reduce((s, x) => s + (state.studentCount[x.id] || 0), 0);
        if (!await askDelete(`${year}학년도`, `반 ${state.courses.length}개와 명단 ${n}명, 강의 연결, 학생 비밀번호가`)) return;
        await deleteYear(db, year);
        state.year = null;
        toast(`${year}학년도를 삭제했습니다.`);
        break;
      }

      case 'add-grade': {
        const grades = yearObj?.grades || [];
        const next = grades.length ? Math.max(...grades) + 1 : 1;
        const prevCount = grades.length ? state.courses.filter(x => x.grade === Math.max(...grades)).length : 0;
        const v = await ask({
          title: `${year}학년도 학년 추가`,
          fields: [
            { key: 'grade', label: '학년', type: 'number', value: next },
            { key: 'count', label: '반 수', type: 'number', value: prevCount || 6 },
          ],
          check: v => !validGrade(v.grade) ? '학년을 확인해 주세요.'
            : grades.includes(v.grade) ? `${v.grade}학년이 이미 있습니다.`
            : !(Number.isInteger(v.count) && v.count >= 0 && v.count <= 30) ? '반 수를 확인해 주세요.' : '',
        });
        if (!v) return;
        const { made } = await createGrade(db, { year, grade: v.grade, count: v.count });
        toast(`${v.grade}학년을 만들었습니다${made.length ? ` (반 ${made.length}개)` : ''}.`);
        break;
      }

      case 'edit-grade': {
        const v = await ask({
          title: `${grade}학년 수정`,
          fields: [{ key: 'grade', label: '학년', type: 'number', value: grade }],
          check: v => !validGrade(v.grade) ? '학년을 확인해 주세요.'
            : (v.grade !== grade && yearObj.grades.includes(v.grade)) ? `${v.grade}학년이 이미 있습니다.` : '',
        });
        if (!v || v.grade === grade) return;
        await renameGrade(db, year, grade, v.grade);
        toast(`${v.grade}학년으로 바꿨습니다.`);
        break;
      }

      case 'del-grade': {
        const rows = state.courses.filter(x => x.grade === grade);
        const n = rows.reduce((s, x) => s + (state.studentCount[x.id] || 0), 0);
        if (!await askDelete(`${grade}학년`, `반 ${rows.length}개와 명단 ${n}명, 강의 연결, 학생 비밀번호가`)) return;
        await deleteGrade(db, year, grade);
        toast(`${grade}학년을 삭제했습니다.`);
        break;
      }

      case 'add-class': {
        const taken = state.courses.filter(x => x.grade === grade).map(x => x.classNo);
        const v = await ask({
          title: `${grade}학년 반 추가`,
          fields: [{ key: 'classNo', label: '반', type: 'number', value: taken.length ? Math.max(...taken) + 1 : 1 }],
          check: v => !validClass(v.classNo) ? '반을 확인해 주세요.'
            : taken.includes(v.classNo) ? `${grade}학년 ${v.classNo}반이 이미 있습니다.` : '',
        });
        if (!v) return;
        await createCourse(db, { year, grade, classNo: v.classNo });
        toast(`${grade}학년 ${v.classNo}반을 만들었습니다.`);
        break;
      }

      case 'edit-class': {
        const taken = state.courses.filter(x => x.grade === c.grade && x.id !== c.id).map(x => x.classNo);
        const v = await ask({
          title: `${courseShort(c)} 수정`,
          fields: [{ key: 'classNo', label: '반', type: 'number', value: c.classNo }],
          check: v => !validClass(v.classNo) ? '반을 확인해 주세요.'
            : taken.includes(v.classNo) ? `${c.grade}학년 ${v.classNo}반이 이미 있습니다.` : '',
        });
        if (!v || v.classNo === c.classNo) return;
        await renameCourse(db, c.id, v.classNo);
        toast(`${c.grade}학년 ${v.classNo}반으로 바꿨습니다.`);
        break;
      }

      case 'del-class': {
        const n = state.studentCount[c.id] || 0;
        if (!await askDelete(courseShort(c), `명단 ${n}명과 강의 연결, 학생 비밀번호가`)) return;
        await deleteCourse(db, c.id);
        toast(`${courseShort(c)}을 삭제했습니다.`);
        break;
      }

      case 'archive':
        await archiveCourse(db, c.id);
        toast(`${courseShort(c)}을 아카이브했습니다.`);
        break;

      case 'unarchive':
        await unarchiveCourse(db, c.id);
        toast(`${courseShort(c)} 아카이브를 해제했습니다.`);
        break;

      case 'roster': {
        const rows = await listStudents(db, c.id);
        await ask({
          title: `${courseShort(c)} 명단 ${rows.length}명`,
          body: rows.length
            ? `<div class="roster">${rows.map(r =>
                `<div class="roster-row"><span class="roster-no">${esc(r.studentNo)}</span><span>${esc(r.name)}</span></div>`).join('')}</div>`
            : '<p class="empty">명단이 비어 있습니다.</p>',
          info: true,
        });
        return;
      }

      case 'upload-grade':
        state.upload = { kind: 'grade', grade };
        $('fileRoster').click();
        return;

      case 'upload-class':
        state.upload = { kind: 'class', id: c.id };
        $('fileRoster').click();
        return;

      default:
        return;
    }
    await reloadAll();
  } catch (e) {
    console.warn('[classes]', act, e);
    toast('처리하지 못했습니다. ' + e.message, 'err');
  }
}

/* 엑셀 한 장을 읽어 { studentNo, name } 줄로. A열 학번, B열 이름, 1행은 머리글로 보고 건너뛴다. */
function readRoster(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = e => {
      try {
        const wb  = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
        resolve(raw.slice(1)
          .filter(r => r[0] !== '' && r[1] !== '')
          .map(r => ({ studentNo: String(r[0]).trim(), name: String(r[1]).trim() }))
          .filter(s => parseStudentNo(s.studentNo) && s.name));
      } catch (err) { reject(err); }
    };
    reader.readAsArrayBuffer(file);
  });
}

/* 명단 올리기 — 학년 카드에서 누르면 학번에서 반을 읽어 반별로 흩어 넣고(없는 반은 개설),
   반 줄에서 누르면 그 반 학번만 넣는다. 어느 쪽이든 지우는 범위는 해당 반뿐이다
   (2026에서는 전교생 명단을 통째로 지웠다). 몇 명으로 바뀌는지 먼저 보여 주고 확인받는다. */
async function onRosterFile(ev) {
  const file = ev.target.files[0];
  const target = state.upload;
  ev.target.value = '';
  state.upload = null;
  if (!file || !target) return;

  try {
    const rows = await readRoster(file);
    if (!rows.length) { toast('읽을 수 있는 줄이 없습니다.', 'err'); return; }

    if (target.kind === 'grade') {
      const g = target.grade;
      const per = {};
      rows.forEach(r => { const p = parseStudentNo(r.studentNo); if (p.grade === g) per[p.classNo] = (per[p.classNo] || 0) + 1; });
      const nos = Object.keys(per).map(Number).sort((a, b) => a - b);
      if (!nos.length) { toast(`${g}학년 학번이 없습니다.`, 'err'); return; }
      const ok = await ask({
        title: `${state.year}학년도 ${g}학년 명단 교체`,
        body: `<div class="roster">${nos.map(n =>
          `<div class="roster-row"><span class="roster-no">${n}반</span><span>${per[n]}명</span></div>`).join('')}</div>`,
      });
      if (!ok) return;
      const { classes, foreign } = await replaceGradeRoster(db, { year: state.year, grade: g, rows });
      toast(`${classes.map(c => `${c.classNo}반 ${c.count}명`).join(', ')}을 올렸습니다.` +
        (foreign.length ? ` 다른 학년 학번 ${foreign.length}줄은 넣지 않았습니다.` : ''));
    } else {
      const c = state.courses.find(x => x.id === target.id);
      if (!c) return;
      const mine = rows.filter(s => { const p = parseStudentNo(s.studentNo); return p.grade === c.grade && p.classNo === c.classNo; });
      if (!mine.length) { toast(`${courseShort(c)} 학번이 없습니다.`, 'err'); return; }
      const ok = await ask({ title: `${courseShort(c)} 명단 교체`, body: `${mine.length}명` });
      if (!ok) return;
      await replaceRoster(db, c.id, mine);
      const skipped = rows.length - mine.length;
      toast(`${courseShort(c)} ${mine.length}명을 올렸습니다.` + (skipped ? ` 다른 반 학번 ${skipped}줄은 넣지 않았습니다.` : ''));
    }
    await reloadAll();
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
    toast(`${lessonTag(lessonNo)}을 추가했습니다.`);
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
    body: `${esc(btn.dataset.name || '이 강의')}을 라이브러리에서 지웁니다. 이미 반에 붙인 연결은 남습니다.`,
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
