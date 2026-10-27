// 2027 LMS 어드민 — 제로베이스 뼈대 (2026-10-26)
// 왼쪽 메뉴는 model.js의 ADMIN_MENUS 한 곳에서 나온다.
// 가운데 넷(개념 노트 / 미션 활동 / 오늘의 질문 / 형성평가)은 강의 안 네 칸의 관리 화면이다(2026-10-27).
// 조직 원리: 강의실은 강의(차시)와 복습을 담고, 강의 하나는 개념노트/미션/질문노트/형성평가
//           네 칸을 각각 있거나 없거나로 채운다(순서 자유).
// 지금은 데모 데이터(model.js)로 돈다. 규칙: data-act + 위임, 상태는 state 하나,
// 알약 금지, 태그/카테고리는 구분선, 액션은 아이콘 버튼, 숫자 칸은 text+inputmode.

import * as M from './model.js?v=20261027n';
import { icon } from './shared/icons.js';
import { auth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from './shared/fb.js?v=20261027n';

const YEAR = 2027;
const $side = document.getElementById('side');
const $main = document.getElementById('main');

const state = {
  page: 'rooms',
  year: YEAR,
  roomGroup: 'subject',            // 강의실 묶음 축: 'subject'(과목별) | 'class'(반별)
  fSubject: null, fClass: null,    // 강의실 관리 필터(과목 / 반)
  roomDetailId: null,              // 아래로 펼친 강의실(인라인 상세)
  roomLessonsMore: false,          // 강의 진도 30강 넘겨 더 보기
  openScore: null,                 // 상세를 펼친 학생 키(`강의실id_학번`)
  roomStudentEdit: false,          // 강의실 상세 명단 편집(체크 선택) 모드
  roomStuSel: new Set(),           // 그 모드에서 고른 학번들(일괄 제외용)
  editRoomId: null,                // 그 자리에서 고치는 중인 강의실
  studentClass: 'all',             // 학생 관리 반 필터(roomNo)
  studentDetailNo: null,           // 아래로 펼친 학생(학번)
  lessonId: null, lessonTab: 'edit',

  // 칸별 메뉴 넷 (2026-10-27)
  conceptTab: 'content',           // 개념 노트 서브 메뉴 'content' | 'design'
  conceptLessonId: null,           // 콘텐츠에서 펼친 강의
  missionTab: 'list',              // 미션 활동 탭 'list' 또는 열어 둔 앱 키
  missionOpen: [],                 // 같은 창 안에 탭으로 열어 둔 앱 키들(요구사항 67)
  questionTab: 'manage',           // 오늘의 질문 서브 메뉴 'manage' | 'answers'
  questionLessonId: null,          // 질문 관리에서 펼쳐 고치는 강의
  questionCourseId: null,          // 답변을 모아 볼 강의실
  questionClId: null,              // 그 강의실에 꽂힌 강의(질문이 있는 것만)
  formativeLessonId: null,         // 문항을 편집 중인 형성평가(강의)
};

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const val = id => (document.getElementById(id)?.value || '').trim();

/* 수업일자('M/D')가 오늘보다 지났는지 — 진도표·강의 진도의 날짜 강조에 쓴다.
   연도는 적지 않으므로 오늘과 가장 가까운 해로 해석한다(2026 LMS와 같은 방식).
   'past' | 'today' | 'future' | 'none'(빈 값/형식 오류). */
const MAX_LESSONS = 30;            // 강의 진도에 한 번에 보여 줄 강의 수(요구사항 1)
function dateStatus(mmdd){
  const mt = /^(\d{1,2})\s*\/\s*(\d{1,2})$/.exec((mmdd || '').trim());
  if (!mt) return 'none';
  const m = +mt[1], d = +mt[2];
  if (m < 1 || m > 12 || d < 1 || d > 31) return 'none';
  const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let best = null;
  [today.getFullYear()-1, today.getFullYear(), today.getFullYear()+1].forEach(yy => {
    const cand = new Date(yy, m-1, d), diff = Math.abs(cand - today);
    if (!best || diff < best.diff) best = { date:cand, diff };
  });
  if (best.date.getTime() === today.getTime()) return 'today';
  return best.date < today ? 'past' : 'future';
}

function boot(){
  const ok = getComputedStyle(document.documentElement).getPropertyValue('--lms-css-ok').trim() === '1';
  if (!ok){ document.getElementById('boot').textContent = '화면을 불러오지 못했습니다. 새로고침해 주세요.'; return; }
  document.documentElement.classList.add('lms-ready');
  if (!document.getElementById('toast')){
    const t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t);
  }
  // 로그인해야 Firestore에 쓸 수 있다(규칙 isAdmin). 로그인 전엔 로그인 화면만 보인다.
  onAuthStateChanged(auth, async user => {
    if (!user){ showLogin(); return; }
    document.getElementById('login')?.remove();
    document.getElementById('boot').textContent = '불러오는 중…';
    document.getElementById('boot').style.display = 'grid';
    try { await M.loadCore(); }
    catch(e){ console.error(e); toast('데이터를 불러오지 못했습니다.'); }
    document.getElementById('boot').style.display = 'none';
    document.getElementById('shell').hidden = false;
    render();
  });
}

// ── 어드민 로그인 화면 (Firebase Auth 이메일/비밀번호) ──
function showLogin(msg){
  document.getElementById('shell').hidden = true;
  document.getElementById('boot').style.display = 'none';
  let el = document.getElementById('login');
  if (!el){ el = document.createElement('div'); el.id = 'login'; document.body.appendChild(el); }
  el.innerHTML = `<form class="login-card" id="login-form">
    <h1>2027 관리자</h1>
    <label class="m-label">이메일</label>
    <input class="f" id="lg-email" type="email" autocomplete="username">
    <label class="m-label">비밀번호</label>
    <input class="f" id="lg-pw" type="password" autocomplete="current-password">
    <button class="btn-text" type="submit">로그인</button>
    <div class="m-err" id="lg-err">${esc(msg || '')}</div>
  </form>`;
  const form = el.querySelector('#login-form');
  el.querySelector('#lg-email').focus();
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const email = el.querySelector('#lg-email').value.trim();
    const pw = el.querySelector('#lg-pw').value;
    const err = el.querySelector('#lg-err');
    err.textContent = '';
    try { await signInWithEmailAndPassword(auth, email, pw); }   // 성공하면 onAuthStateChanged가 화면을 바꾼다
    catch(_){ err.textContent = '이메일 또는 비밀번호를 확인해 주세요.'; }
  });
}

function toast(msg){
  const t = document.getElementById('toast'); t.textContent = msg; t.style.display = 'block';
  clearTimeout(t._h); t._h = setTimeout(() => t.style.display = 'none', 1800);
}

/* 확인 창 — 브라우저 기본 confirm을 쓰지 않는다(코드 규칙).
   되돌릴 수 없는 삭제에만 쓴다. 보통 입력은 인라인 폼으로 받는다(요구사항 66).
   needText를 주면 그 글자를 그대로 쳐야 확인 버튼이 켜진다(강의실 삭제, 화면 규칙 2026-10-25). */
function confirmDelete({ title, bodyHtml = '', needText = null, okText = '삭제' }){
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h3>${esc(title)}</h3>
      <div class="m-body">${bodyHtml}</div>
      ${needText ? `<input class="f" id="m-text" placeholder="${esc(needText)}" autocomplete="off">` : ''}
      <div class="m-err" id="m-err"></div>
      <div class="m-acts">
        <button class="btn-ghost" data-m="cancel">취소</button>
        <button class="btn-danger" data-m="ok" ${needText ? 'disabled' : ''}>${esc(okText)}</button>
      </div></div>`;
    document.body.appendChild(back);

    const ok = back.querySelector('[data-m="ok"]');
    const inp = back.querySelector('#m-text');
    const close = v => { document.removeEventListener('keydown', onKey); back.remove(); resolve(v); };
    const onKey = e => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter' && !ok.disabled) close(true);
    };
    if (inp){
      inp.addEventListener('input', () => { ok.disabled = inp.value.trim() !== needText; });
      inp.focus();
    } else ok.focus();
    back.addEventListener('click', e => {
      if (e.target === back) close(false);
      const b = e.target.closest('[data-m]'); if (!b) return;
      close(b.dataset.m === 'ok');
    });
    document.addEventListener('keydown', onKey);
  });
}

// model.js가 던지는 오류 메시지를 그대로 토스트로. 성공하면 다시 그린다.
function run(fn, okMsg){
  try { const r = fn(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); render(); return r; }
  catch (e){ toast(e.message); return null; }
}

// ── 사이드 ──
function renderSide(){
  $side.innerHTML = `<div class="brand">2027</div>` + M.ADMIN_MENUS.map(m =>
    `<div class="mi ${m.key === state.page ? 'on':''}" data-act="page" data-k="${m.key}">
      ${icon(m.icon,18)}<span>${esc(m.name)}</span></div>`).join('') +
    `<div class="mi side-logout" data-act="logout">${icon('log-out',18)}<span>로그아웃</span></div>`;
}

// ── 카테고리 줄(구분선) ──
// extra를 주면 줄 오른쪽 끝에 붙는다(학년도 줄의 "학년도 만들기" 칸).
function catline(items, active, act, allLabel, extra = ''){
  const all = allLabel ? `<button class="cat ${active==null||active==='all'?'on':''}" data-act="${act}" data-v="all">${esc(allLabel)}</button>` : '';
  const rest = items.map(it => `<button class="cat ${String(active)===String(it.v)?'on':''}" data-act="${act}" data-v="${esc(it.v)}">${esc(it.label)}</button>`).join('');
  return `<div class="catline">${all}${rest}${extra}</div>`;
}

// ── 강의실 관리 ──
// 머리줄: 제목 + 학년도 고르개(드롭다운) + 추가 버튼(팝업). 창 넓이는 admin.css에서.
// 생성(학년도·강의실)은 전부 추가 버튼의 팝업에 모았다(요구사항 5). 필터는 과목 한 줄만
// 남기고(요구사항 4), 보이는 것은 늘 있는 과목만(요구사항 3). 목록은 과목→학년→반 순.
// 수정 중인 강의실 줄 — 그 자리에서 입력 칸이 된다(인라인, 요구사항 66). 목록·상세 공용.
function roomEditRow(c){
  return `<div class="row">
    <input class="f w-md" id="e-subject" value="${esc(c.subject)}">
    <input class="f w-sm" id="e-grade" inputmode="numeric" value="${c.grade}"><span class="unit">학년</span>
    <input class="f w-sm" id="e-class" inputmode="numeric" value="${c.classNo}"><span class="unit">반</span>
    <div class="grow"></div>
    <div class="tools">
      <button class="ib ib-primary" data-act="room-save" data-id="${c.id}" title="저장" aria-label="저장">${icon('check',16)}</button>
      <button class="ib" data-act="room-cancel" title="취소" aria-label="취소">${icon('x',16)}</button>
    </div></div>`;
}

function pageRooms(){
  const years = M.getYears();
  const addBtn = `<button class="btn-add" data-act="add-open" title="추가" aria-label="추가">${icon('plus',16)}<span>추가</span></button>`;

  if (!years.length)
    return `<div class="pagehead"><h2>강의실 관리</h2>${addBtn}</div>
      <div class="empty">학년도가 없습니다.</div>`;

  const courses = M.getCourses(state.year);
  const byClass = state.roomGroup === 'class';

  const yearSel = `<select class="sel" id="year-sel" data-act="year-pick" aria-label="학년도">
    ${years.map(y => `<option value="${y.year}" ${y.year===state.year?'selected':''}>${y.year}학년도</option>`).join('')}
  </select>`;
  const head = `<div class="pagehead"><h2>강의실 관리</h2>${yearSel}${addBtn}</div>`;

  // 묶음 축 토글(과목별/반별) — 필터 줄 오른쪽 끝에.
  const groupToggle = `<span class="line-end"><span class="seg seg-inline">
    <button class="seg-b ${byClass?'':'on'}" data-act="room-group" data-v="subject">과목별</button>
    <button class="seg-b ${byClass?'on':''}" data-act="room-group" data-v="class">반별</button>
  </span></span>`;

  // 필터 탭 — 축에 따라 과목 또는 반. 늘 있는 것만(요구사항 3). 정렬도 축에 맞춘다.
  let filterLine, list = courses.slice();
  if (byClass){
    const roomNos = [...new Set(courses.map(c => M.roomNo(c)))].sort();
    if (state.fClass && !roomNos.includes(state.fClass)) state.fClass = null;
    if (state.fClass) list = list.filter(c => M.roomNo(c) === state.fClass);
    list.sort((a,b) => a.grade - b.grade || a.classNo - b.classNo || a.subject.localeCompare(b.subject,'ko'));
    filterLine = catline(roomNos.map(rn => ({ v:rn, label:rn })), state.fClass, 'set-class', '전체', groupToggle);
  } else {
    const subjects = [...new Set(courses.map(c => c.subject))].sort((a,b) => a.localeCompare(b,'ko'));
    if (state.fSubject && state.fSubject !== 'all' && !subjects.includes(state.fSubject)) state.fSubject = null;
    if (state.fSubject && state.fSubject !== 'all') list = list.filter(c => c.subject === state.fSubject);
    list.sort((a,b) => a.subject.localeCompare(b.subject,'ko') || a.grade - b.grade || a.classNo - b.classNo);
    filterLine = catline(subjects.map(s => ({ v:s, label:s })), state.fSubject, 'set-subject', '전체', groupToggle);
  }

  // 누르면 그 자리에서 아래로 펼쳐진다(인라인 아코디언). 묶음은 구분선만(요구사항 3).
  const showRow = c => {
    const open = c.id === state.roomDetailId;
    const row = `<div class="row ${open?'on':''}">
      <div class="grow rowlink" data-act="room-open" data-id="${c.id}">
        <div class="t"><span class="chev">${icon(open?'chevron-down':'chevron-right',16)}</span>${esc(M.roomName(c))}</div></div>
      <div class="tools">
        <button class="ib" data-act="room-edit" data-id="${c.id}" title="수정" aria-label="수정">${icon('pencil',16)}</button>
        <button class="ib ib-danger" data-act="room-del" data-id="${c.id}" title="삭제" aria-label="삭제">${icon('trash-2',16)}</button>
      </div></div>`;
    return open ? row + roomDetailPanel(c) : row;
  };

  let rowsHtml;
  if (!list.length){
    rowsHtml = `<div class="empty">강의실이 없습니다.</div>`;
  } else {
    const keyOf = c => byClass ? M.roomNo(c) : c.subject;
    const out = []; let last = null, first = true;
    list.forEach(c => {
      const key = keyOf(c);
      if (key !== last){ if (!first) out.push(`<div class="group-sep"></div>`); last = key; first = false; }
      out.push(c.id === state.editRoomId ? roomEditRow(c) : showRow(c));
    });
    rowsHtml = out.join('');
  }

  return `${head}${filterLine}${rowsHtml}`;
}

/* 강의실 상세(요구사항 6) — 줄 아래로 두 칸으로 펼쳐진다(요구사항 1).
   왼쪽: 강의 진도(강의차수·제목·수업일자, 최대 30강·넘으면 더보기, 요구사항 1·2).
   오른쪽: 학생 전원. 이름을 누르면 그 학생의 레벨·경험치·포트폴리오 성적이 펼쳐진다(요구사항 3). */
function roomDetailPanel(c){
  const students = M.getStudentsByCourse(c.id).slice().sort((a,b) => a.studentNo.localeCompare(b.studentNo));
  const lessons = M.getCourseLessons(c.id);          // order 순, 수업일자(date) 포함

  // ── 왼쪽: 강의 진도 ──
  const shown = state.roomLessonsMore ? lessons : lessons.slice(0, MAX_LESSONS);
  const lessonRows = lessons.length ? shown.map((cl, i) => {
    const st = dateStatus(cl.date);
    return `<div class="row compact plrow">
      <div class="plnum">${i+1}강</div>
      <div class="grow"><div class="t">${esc(cl.lesson?.title || '(삭제된 강의)')}</div></div>
      <input class="f dateinput ds-${st}" data-act="cl-date" data-id="${cl.id}" value="${esc(cl.date || '')}" inputmode="numeric" aria-label="수업일자">
      <button class="ib ib-sm ${cl.isOpen?'ib-primary':''}" data-act="cl-open" data-id="${cl.id}" title="${cl.isOpen?'공개 중 (누르면 숨김)':'숨김 (누르면 공개)'}" aria-label="공개 전환">${icon('eye',14)}</button>
    </div>`;
  }).join('') : `<div class="empty">개설된 강의가 없습니다.</div>`;
  const moreBtn = (!state.roomLessonsMore && lessons.length > MAX_LESSONS)
    ? `<button class="btn-link morebtn" data-act="room-lessons-more">더보기 (${lessons.length - MAX_LESSONS}강)</button>` : '';
  const left = `<div class="dcol">
    <div class="sectionlabel between">강의 진도<button class="btn-link" data-act="go-progress">진도 관리</button></div>
    ${lessonRows}${moreBtn}</div>`;

  // ── 오른쪽: 학생 명단 (편집을 누르면 체크 선택 모드 → 이 강의실에서 일괄 제외) ──
  const editing = state.roomStudentEdit;
  const sel = state.roomStuSel;
  const allSel = students.length > 0 && students.every(s => sel.has(s.studentNo));

  const stuRows = students.length ? students.map(s => {
    if (editing){
      const checked = sel.has(s.studentNo);
      return `<label class="row compact selrow ${checked?'on':''}">
        <input type="checkbox" data-act="stu-sel" data-no="${s.studentNo}" ${checked?'checked':''}>
        <span class="grow"><span class="t"><span class="mono">${esc(s.studentNo)}</span> &nbsp;${esc(s.name)}</span></span></label>`;
    }
    const open = state.openScore === `${c.id}_${s.studentNo}`;
    const row = `<div class="row compact rowlink" data-act="stu-score" data-no="${s.studentNo}" data-id="${c.id}">
      <div class="grow"><div class="t"><span class="chev">${icon(open?'chevron-down':'chevron-right',14)}</span><span class="mono">${esc(s.studentNo)}</span> &nbsp;${esc(s.name)}</div></div></div>`;
    return open ? row + studentCard(c.id, s.studentNo) : row;
  }).join('') : `<div class="empty">학생이 없습니다.</div>`;

  const stuHead = editing
    ? `<div class="sectionlabel between">학생 명단
         <button class="btn-link" data-act="stu-edit-done">완료</button></div>
       <div class="selbar">
         <label class="selall"><input type="checkbox" data-act="stu-sel-all" ${allSel?'checked':''}><span>전체</span></label>
         <button class="btn-chip danger" data-act="stu-exclude" data-id="${c.id}" ${sel.size?'':'disabled'}>선택 제외 (${sel.size})</button>
       </div>`
    : `<div class="sectionlabel between">학생 명단
         <span class="sec-acts">
           ${students.length ? `<button class="btn-link" data-act="stu-edit-mode">편집</button>` : ''}
           <button class="btn-link" data-act="go-students" data-id="${c.id}">학생 관리</button>
         </span></div>`;

  const right = `<div class="dcol">${stuHead}${stuRows}</div>`;

  return `<div class="detail two">${left}${right}</div>`;
}

// 한 학생 카드 — 레벨·경험치·포인트 + 포트폴리오 성적(펼침 안쪽, 요구사항 3).
function studentCard(courseId, studentNo){
  const xp = M.getXp(courseId, studentNo);
  const lvl = xp ? M.levelFromXp(xp.xp) : null;
  const sc = M.getScore(courseId, studentNo), sum = M.scoreSummary(courseId, studentNo);

  const stats = `<div class="sc-stats">
    <div class="sc-stat"><div class="sc-k">레벨</div><div class="sc-v">${lvl!=null?`Lv.${lvl}`:'–'}</div></div>
    <div class="sc-stat"><div class="sc-k">경험치</div><div class="sc-v">${xp?xp.xp:'–'}</div></div>
    <div class="sc-stat"><div class="sc-k">포인트</div><div class="sc-v">${xp?xp.point:'–'}</div></div>
  </div>`;

  let port;
  if (!sc){ port = `<div class="score-empty">성적 기록이 없습니다.</div>`; }
  else {
    const lines = M.PART_TYPES.filter(p => p.portfolio).map(p => {
      const got = sc.items?.[p.key]; if (got == null) return '';
      return `<div class="score-line"><span>${esc(p.name)}</span><span class="mono">${got} / ${sc.max?.[p.key] ?? '–'}점</span></div>`;
    }).filter(Boolean).join('');
    const tot = sum ? `<div class="score-line tot"><span>합계</span><span class="mono">${sum.got} / ${sum.max}점</span></div>` : '';
    port = (lines + tot) || `<div class="score-empty">기록된 칸이 없습니다.</div>`;
  }
  return `<div class="score-detail">${stats}<div class="sc-port"><div class="sc-k">포트폴리오 성적</div>${port}</div></div>`;
}

/* 진도 관리(요구사항 1·2) — 2026 LMS 진도표를 본떠 강의 × 강의실 표로.
   행은 강의(차수·제목), 열은 강의실, 칸은 수업일자('M/D'). 오늘·지난 날은 색으로.
   강의실 관리의 강의 진도와 같은 데이터(course_lessons)를 써서 서로 실시간으로 맞물린다. */
function pageProgress(){
  const years = M.getYears();
  const yearSel = `<select class="sel" id="year-sel" data-act="year-pick" aria-label="학년도">
    ${years.map(y => `<option value="${y.year}" ${y.year===state.year?'selected':''}>${y.year}학년도</option>`).join('')}
  </select>`;
  const head = `<div class="pagehead"><h2>진도 관리</h2>${years.length?yearSel:''}</div>`;
  if (!years.length) return `${head}<div class="empty">학년도가 없습니다.</div>`;

  const courses = M.getCourses(state.year)
    .slice().sort((a,b) => a.subject.localeCompare(b.subject,'ko') || a.grade - b.grade || a.classNo - b.classNo);
  const placed = {}, placedIds = new Set();
  courses.forEach(c => { placed[c.id] = M.getCourseLessons(c.id); placed[c.id].forEach(cl => placedIds.add(cl.lessonId)); });
  const lessons = M.getLessons().filter(l => placedIds.has(l.id));

  if (!courses.length) return `${head}<div class="empty">강의실이 없습니다.</div>`;
  if (!lessons.length) return `${head}<div class="empty">개설된 강의가 없습니다.</div>`;

  const th = courses.map(c => `<th title="${esc(M.roomName(c))}">${esc(M.roomName(c))}</th>`).join('');
  const body = lessons.map((l, li) => {
    const cells = courses.map(c => {
      const cl = placed[c.id].find(x => x.lessonId === l.id);
      if (!cl) return `<td class="na">–</td>`;
      const st = dateStatus(cl.date);
      return `<td class="ds-${st}"><input class="f dateinput" data-act="cl-date" data-id="${cl.id}" value="${esc(cl.date || '')}" inputmode="numeric" aria-label="${esc(M.roomName(c))} 수업일자"></td>`;
    }).join('');
    return `<tr><td class="lname">${li+1}강. ${esc(l.title)}</td>${cells}</tr>`;
  }).join('');

  return `${head}
    <div class="prog-wrap"><table class="prog">
      <thead><tr><th class="lname">강의</th>${th}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

/* 추가 팝업 — 학년도 생성 / 강의실 생성을 한곳에 모았다(요구사항 5).
   과목은 따로 만드는 것이 아니라 강의실을 만들면 생긴다(있는 것만 보인다, 요구사항 3).
   위 세그먼트로 무엇을 만들지 고른다. 생성 폼은 팝업 안에서만 쓴다. */
function openAddModal(initial){
  const years = M.getYears();
  const subjects = [...new Set(M.getCourses(state.year).map(c => c.subject))];
  let tab = initial || (years.length ? 'room' : 'year');

  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="추가"></div>`;
  document.body.appendChild(back);
  const modal = back.querySelector('.modal');

  const draw = () => {
    const seg = `<div class="seg">
      <button class="seg-b ${tab==='year'?'on':''}" data-seg="year">학년도 생성</button>
      <button class="seg-b ${tab==='room'?'on':''}" data-seg="room" ${years.length?'':'disabled'}>강의실 생성</button>
    </div>`;
    const body = tab === 'year'
      ? `<div class="m-form">
          <label class="m-label">학년도</label>
          <input class="f" id="a-year" inputmode="numeric" autocomplete="off">
        </div>`
      : `<div class="m-form">
          <label class="m-label">과목</label>
          ${subjects.length
            ? `<select class="sel sel-full" id="a-subject-sel">
                 ${subjects.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
                 <option value="__new__">+ 새 과목 직접 입력</option>
               </select>
               <input class="f" id="a-subject-new" autocomplete="off" hidden>`
            : `<input class="f" id="a-subject-new" autocomplete="off">`}
          <div class="m-two">
            <div><label class="m-label">학년</label><input class="f" id="a-grade" inputmode="numeric"></div>
            <div><label class="m-label">반</label><input class="f" id="a-class" inputmode="numeric"></div>
          </div>
        </div>`;
    modal.innerHTML = `<h3>추가</h3>${seg}${body}
      <div class="m-err" id="a-err"></div>
      <div class="m-acts">
        <button class="btn-ghost" data-m="cancel">닫기</button>
        <button class="btn-text" data-m="ok">만들기</button>
      </div>`;
    modal.querySelector('.m-form .f')?.focus();
  };
  draw();

  const close = () => { document.removeEventListener('keydown', onKey); back.remove(); };
  const err = m => { const e = modal.querySelector('#a-err'); if (e) e.textContent = m; };
  const submit = () => {
    if (tab === 'year'){
      const y = (modal.querySelector('#a-year')?.value || '').trim();
      if (!y){ err('학년도를 적어 주세요.'); return; }
      try { const row = M.addYear(y); state.year = row.year; state.fSubject = null; state.editRoomId = null;
        toast(`${row.year}학년도를 만들었습니다.`); close(); render(); }
      catch(e){ err(e.message); }
    } else {
      const sel = modal.querySelector('#a-subject-sel');
      const subject = (sel && sel.value !== '__new__')
        ? sel.value
        : (modal.querySelector('#a-subject-new')?.value || '').trim();
      const grade = (modal.querySelector('#a-grade')?.value || '').trim();
      const classNo = (modal.querySelector('#a-class')?.value || '').trim();
      if (!subject || !grade || !classNo){ err('과목, 학년, 반을 적어 주세요.'); return; }
      try { const c = M.addCourse({ year:state.year, subject, grade, classNo });
        state.fSubject = c.subject; toast(`${M.roomName(c)} 강의실을 만들었습니다.`); close(); render(); }
      catch(e){ err(e.message); }
    }
  };
  const onKey = e => {
    if (e.key === 'Escape'){ close(); return; }
    if (e.key === 'Enter'){ e.preventDefault(); submit(); }
  };
  back.addEventListener('click', e => {
    if (e.target === back){ close(); return; }
    const s = e.target.closest('[data-seg]');
    if (s){ if (!s.disabled){ tab = s.dataset.seg; draw(); } return; }
    const m = e.target.closest('[data-m]'); if (!m) return;
    if (m.dataset.m === 'ok') submit(); else close();
  });
  // 과목 드롭다운에서 "직접 입력"을 고르면 글자 칸을 연다.
  back.addEventListener('change', e => {
    if (e.target.id !== 'a-subject-sel') return;
    const ni = modal.querySelector('#a-subject-new');
    const on = e.target.value === '__new__';
    if (ni){ ni.hidden = !on; if (on) ni.focus(); }
  });
  document.addEventListener('keydown', onKey);
}

// ── 학생 관리 ──
// 헤더는 강의실 관리와 같은 모양(제목 + 학년도 드롭다운 + 추가 버튼), 아래 반별 한 줄.
function pageStudents(){
  const years = M.getYears();
  const addBtn = `<button class="btn-add" data-act="stu-add-open" title="추가" aria-label="추가">${icon('plus',16)}<span>추가</span></button>`;
  if (!years.length)
    return `<div class="pagehead"><h2>학생 관리</h2>${addBtn}</div><div class="empty">학년도가 없습니다.</div>`;

  const all = M.getStudentsByYear(state.year);
  const byRoom = {};
  all.forEach(s => { const r = s.studentNo.slice(0,3); (byRoom[r] ||= new Set()).add(s.studentNo); });
  const roomNos = Object.keys(byRoom).sort();
  if (state.studentClass !== 'all' && !roomNos.includes(state.studentClass)) state.studentClass = 'all';

  let snos = state.studentClass !== 'all' ? [...(byRoom[state.studentClass] || [])] : roomNos.flatMap(r => [...byRoom[r]]);
  snos = [...new Set(snos)].sort();

  const yearSel = `<select class="sel" id="year-sel" data-act="year-pick" aria-label="학년도">
    ${years.map(y => `<option value="${y.year}" ${y.year===state.year?'selected':''}>${y.year}학년도</option>`).join('')}
  </select>`;
  const head = `<div class="pagehead"><h2>학생 관리</h2>${yearSel}${addBtn}</div>`;
  const filterLine = catline(roomNos.map(r => ({ v:r, label:r })), state.studentClass, 'set-sclass', '전체');

  const list = snos.length ? snos.map(sno => {
    const name = all.find(s => s.studentNo === sno)?.name || '';
    const open = state.studentDetailNo === sno;
    const row = `<div class="row ${open?'on':''}">
      <div class="grow rowlink" data-act="stu-open" data-no="${sno}">
        <div class="t"><span class="chev">${icon(open?'chevron-down':'chevron-right',16)}</span><span class="mono">${esc(sno)}</span> &nbsp;${esc(name)}</div></div>
      <div class="tools">
        <button class="ib" data-act="stu-reset" data-no="${sno}" title="비밀번호 초기화" aria-label="비밀번호 초기화">${icon('rotate-ccw',16)}</button>
        <button class="ib ib-danger" data-act="stu-del" data-no="${sno}" title="삭제" aria-label="삭제">${icon('trash-2',16)}</button>
      </div></div>`;
    return open ? row + studentDetailPanel(sno, name) : row;
  }).join('') : `<div class="empty">학생이 없습니다.</div>`;

  return `${head}${filterLine}${list}`;
}

/* 학생 상세(요구사항 2) — 줄 아래로 두 칸. 왼쪽: 수강 과목(강의실) 체크로 켜고 끄기 + 비밀번호.
   오른쪽: 과목(강의실)별 레벨·경험치·포트폴리오 성적. 한 학번이 여러 과목에 들 수 있어서 과목별로 본다. */
function studentDetailPanel(sno, name){
  const grade = +sno.slice(0,1), classNo = +sno.slice(1,3);
  const classCourses = M.getCourses(state.year)
    .filter(c => c.grade === grade && c.classNo === classNo)
    .sort((a,b) => a.subject.localeCompare(b.subject,'ko'));
  const mine = M.getCoursesOfStudent(state.year, sno).sort((a,b) => a.subject.localeCompare(b.subject,'ko'));
  const enrolled = new Set(mine.map(c => c.id));

  const checks = classCourses.length ? classCourses.map(c => `<label class="checkline">
    <input type="checkbox" data-act="stu-enroll" data-id="${c.id}" data-no="${sno}" ${enrolled.has(c.id)?'checked':''}>
    <span>${esc(M.roomName(c))}</span></label>`).join('')
    : `<div class="empty">${grade}${String(classNo).padStart(2,'0')} 반으로 만든 강의실이 없습니다.</div>`;

  const left = `<div class="dcol">
    <div class="sectionlabel">수강 과목</div>${checks}
    <div class="sectionlabel">비밀번호</div>
    <button class="btn-link" data-act="stu-reset" data-no="${sno}">비밀번호 초기화</button></div>`;

  const scoreRows = mine.length ? mine.map(c => {
    const xp = M.getXp(c.id, sno), lvl = xp ? M.levelFromXp(xp.xp) : null, sum = M.scoreSummary(c.id, sno);
    const bits = [lvl!=null?`Lv.${lvl}`:'Lv.–', `경험치 ${xp?xp.xp:0}`,
      sum ? `포트폴리오 ${sum.got}/${sum.max}점` : '포트폴리오 기록 없음'];
    return `<div class="row compact"><div class="grow"><div class="t">${esc(M.roomName(c))}</div>
      <div class="s">${bits.join(', ')}</div></div></div>`;
  }).join('') : `<div class="empty">수강 중인 과목이 없습니다.</div>`;
  const right = `<div class="dcol">
    <div class="sectionlabel">과목별 성적</div>
    ${scoreRows}</div>`;

  return `<div class="detail two">${left}${right}</div>`;
}

/* 학생 추가 팝업(요구사항 1) — 개별 추가 / 엑셀 명단. 개별은 학년·반·번호·이름만 받는다.
   수강 과목은 추가한 뒤 학생을 눌러 수강 과목 체크로 고른다(여기선 그 반 강의실에 모두 등록). */
function openStudentModal(){
  let tab = 'one';
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="학생 추가"></div>`;
  document.body.appendChild(back);
  const modal = back.querySelector('.modal');

  const draw = () => {
    const seg = `<div class="seg">
      <button class="seg-b ${tab==='one'?'on':''}" data-seg="one">개별 추가</button>
      <button class="seg-b ${tab==='excel'?'on':''}" data-seg="excel">엑셀 명단</button>
    </div>`;
    const body = tab === 'one'
      ? `<div class="m-form">
          <div class="m-two">
            <div><label class="m-label">학년</label><input class="f" id="st-grade" inputmode="numeric"></div>
            <div><label class="m-label">반</label><input class="f" id="st-class" inputmode="numeric"></div>
            <div><label class="m-label">번호</label><input class="f" id="st-no" inputmode="numeric"></div>
          </div>
          <label class="m-label">이름</label>
          <input class="f" id="st-name" autocomplete="off">
        </div>`
      : `<div class="m-form">
          <button class="btn-ghost" data-m="upload" style="align-self:flex-start">엑셀 파일 고르기</button>
        </div>`;
    modal.innerHTML = `<h3>학생 추가</h3>${seg}${body}
      <div class="m-err" id="st-err"></div>
      <div class="m-acts">
        <button class="btn-ghost" data-m="cancel">닫기</button>
        ${tab==='one' ? `<button class="btn-text" data-m="ok">추가</button>` : ''}
      </div>`;
    modal.querySelector('.m-form .f')?.focus();
  };
  draw();

  const close = () => { document.removeEventListener('keydown', onKey); back.remove(); };
  const err = m => { const e = modal.querySelector('#st-err'); if (e) e.textContent = m; };
  const submit = () => {
    const grade = (modal.querySelector('#st-grade')?.value || '').trim();
    const classNo = (modal.querySelector('#st-class')?.value || '').trim();
    const n = (modal.querySelector('#st-no')?.value || '').trim();
    const nm = (modal.querySelector('#st-name')?.value || '').trim();
    if (!grade || !classNo || !n || !nm){ err('학년, 반, 번호, 이름을 적어 주세요.'); return; }
    const studentNo = `${grade}${String(classNo).padStart(2,'0')}${String(n).padStart(2,'0')}`;
    const { rooms, added } = M.addStudent({ year:state.year, grade, classNo, studentNo, name:nm });
    if (!rooms.length){ err('그 반으로 만든 강의실이 없습니다. 먼저 강의실을 만드세요.'); return; }
    state.studentClass = `${grade}${String(classNo).padStart(2,'0')}`;
    toast(`${nm}(${studentNo})을 ${added.length}개 강의실에 등록했습니다.`); close(); render();
  };
  const onKey = e => {
    if (e.key === 'Escape'){ close(); return; }
    if (e.key === 'Enter' && tab === 'one'){ e.preventDefault(); submit(); }
  };
  back.addEventListener('click', e => {
    if (e.target === back){ close(); return; }
    const s = e.target.closest('[data-seg]');
    if (s){ tab = s.dataset.seg; draw(); return; }
    const m = e.target.closest('[data-m]'); if (!m) return;
    if (m.dataset.m === 'ok') submit();
    else if (m.dataset.m === 'upload') toast('엑셀 올리기 — 뼈대(다음 단계).');
    else close();
  });
  document.addEventListener('keydown', onKey);
}

// ── 강의 라이브러리 ──
function pageLessons(){
  const lessons = M.getLessons();
  const listSide = lessons.map(l => `<div class="row" style="cursor:pointer" data-act="lesson-open" data-id="${l.id}">
      <div class="grow"><div class="t">${esc(l.title)}</div>
        <div class="s">${(l.order||[]).map(k => M.partDef(k)?.name).filter(Boolean).join(', ') || '빈 강의'}</div></div>
      ${l.id === state.lessonId ? `<span class="badge">편집 중</span>` : ''}</div>`).join('') || `<div class="empty">강의가 없습니다.</div>`;

  const addForm = `<div class="formrow">
    <input class="f grow" id="l-title" placeholder="새 강의 제목">
    <button class="btn-text" data-act="lesson-add">강의 만들기</button>
  </div>`;

  if (!state.lessonId)
    return `<div class="pagehead"><h2>강의 라이브러리</h2></div>${addForm}${listSide}`;

  const l = M.getLesson(state.lessonId);
  const tabs = catline([{v:'edit',label:'강의 편집'},{v:'place',label:'강의실에 꽂기'}], state.lessonTab, 'lesson-tab');
  const body = state.lessonTab === 'edit' ? lessonEditor(l) : lessonPlacer(l);

  return `<div class="pagehead">
      <button class="ib" data-act="lesson-close" title="목록" aria-label="목록">${icon('chevron-left',16)}</button>
      <h2>${esc(l.title)}</h2></div>${tabs}${body}`;
}

function lessonEditor(l){
  const order = l.order || [];
  const deck = order.length ? order.map((k,i) => {
    const d = M.partDef(k);
    return `<div class="partrow">
      <span class="dot" style="background:var(--${k})"></span>
      <div class="grow"><div class="t">${esc(d.name)}</div>
        <div class="s">${esc(l.parts[k]?.title || '')}${d.portfolio?'':' (성적 무관)'}</div></div>
      <div class="tools">
        <button class="ib" data-act="part-up" data-k="${k}" ${i===0?'disabled':''} title="위로" aria-label="위로">${icon('arrow-up',16)}</button>
        <button class="ib" data-act="part-down" data-k="${k}" ${i===order.length-1?'disabled':''} title="아래로" aria-label="아래로">${icon('arrow-down',16)}</button>
        <button class="ib" data-act="part-off" data-k="${k}" title="빼기" aria-label="빼기">${icon('x',16)}</button>
      </div></div>`;
  }).join('') : `<div class="placeholder">칸이 없습니다. 오른쪽에서 추가하세요.</div>`;

  const palette = M.PART_TYPES.map(p => {
    const has = order.includes(p.key);
    return `<div class="pchip ${has?'has':''}" data-act="part-toggle" data-k="${p.key}">
      <span class="dot" style="background:var(--${p.key})"></span>
      <span class="grow">${esc(p.name)}</span>${has ? icon('check',15) : icon('plus',15)}</div>`;
  }).join('');

  return `<div class="editor">
    <div class="deck"><div class="sectionlabel">이 강의의 칸 (순서 자유)</div>${deck}</div>
    <div class="palette"><div class="sectionlabel">칸 넣고 빼기</div>${palette}
      <div class="formrow" style="margin-top:10px;flex-direction:column;align-items:stretch">
        <button class="btn-text" data-act="lesson-import" style="display:flex;align-items:center;justify-content:center;gap:8px"
          title="활동지를 올려 개념노트를 만듭니다">${icon('upload',16)}<span>활동지 올리기</span></button>
      </div>
    </div></div>`;
}

function lessonPlacer(l){
  const placed = new Set();
  M.getCourses(state.year).forEach(c => {
    if (M.getCourseLessons(c.id).some(cl => cl.lessonId === l.id)) placed.add(c.id);
  });
  const rows = M.getCourses(state.year).map(c => `<label class="checkline">
    <input type="checkbox" data-act="place-toggle" data-id="${c.id}" ${placed.has(c.id)?'checked':''}>
    <span>${esc(M.roomName(c))}</span></label>`).join('');
  return `<div class="sectionlabel">이 강의를 올릴 강의실</div>${rows}`;
}

/* ── 개념 노트 ──
   2026 lms의 개념 체크에서 가져오는 것은 콘텐츠 올리는 기능과 디자인 조절 기능뿐이다
   (요구사항 46·47). 그래서 서브 메뉴도 콘텐츠와 디자인 둘뿐이다. */
function pageConcept(){
  const tabs = catline(M.ADMIN_SUBMENUS.concept, state.conceptTab, 'concept-tab');
  const head = `<div class="pagehead"><h2>개념 노트</h2></div>${tabs}`;

  if (state.conceptTab === 'design')
    return head + `<div class="placeholder">디자인 조절 (다음 단계)</div>`;

  const lessons = M.getLessonsWithPart('concept');
  if (!lessons.length) return head + `<div class="empty">개념 노트가 있는 강의가 없습니다.</div>`;
  const list = lessons.map(l => {
    const open = state.conceptLessonId === l.id;
    const row = `<div class="row ${open?'on':''}">
      <div class="grow rowlink" data-act="concept-open" data-id="${l.id}">
        <div class="t"><span class="chev">${icon(open?'chevron-down':'chevron-right',16)}</span>${esc(l.title)}</div></div></div>`;
    return open ? row + conceptEditor(l) : row;
  }).join('');
  return head + list;
}

/* 개념 콘텐츠 편집기 — 페이지(제목)와 내용 줄을 쌓는다(2026 contentLines 모티브).
   각 줄은 입력칸이고 포커스가 빠질 때(change) 저장한다. 순서/삭제는 버튼으로. */
function conceptEditor(l){
  const content = M.getConceptContent(l.id);
  const lines = content.length ? content.map((ln, i) => {
    const tools = `<div class="tools">
      <button class="ib ib-sm" data-act="ce-up" data-id="${l.id}" data-k="${i}" ${i===0?'disabled':''} title="위로" aria-label="위로">${icon('arrow-up',14)}</button>
      <button class="ib ib-sm" data-act="ce-down" data-id="${l.id}" data-k="${i}" ${i===content.length-1?'disabled':''} title="아래로" aria-label="아래로">${icon('arrow-down',14)}</button>
      <button class="ib ib-sm ib-danger" data-act="ce-del" data-id="${l.id}" data-k="${i}" title="삭제" aria-label="삭제">${icon('trash-2',14)}</button></div>`;
    if (ln.type === 'divider')
      return `<div class="ce-line ce-page"><span class="ce-tag">페이지</span>
        <input class="f grow" data-act="ce-edit" data-id="${l.id}" data-k="${i}" value="${esc(ln.title)}">${tools}</div>`;
    return `<div class="ce-line"><span class="ce-bullet"></span>
      <input class="f grow" data-act="ce-edit" data-id="${l.id}" data-k="${i}" value="${esc(ln.text)}">${tools}</div>`;
  }).join('') : `<div class="placeholder">내용이 없습니다.</div>`;
  const add = `<div class="ce-add">
    <button class="btn-chip" data-act="ce-add" data-id="${l.id}" data-k="divider">${icon('plus',13)}페이지</button>
    <button class="btn-chip" data-act="ce-add" data-id="${l.id}" data-k="row">${icon('plus',13)}내용 줄</button></div>`;
  return `<div class="detail"><div class="ce-wrap">${lines}${add}</div></div>`;
}

/* ── 미션 활동 ──
   별도로 만든 미니 웹앱을 잇는 허브(요구사항 62·63). 앱 어드민은 오버레이로 화면을 통째로
   덮지 않고 같은 창 안의 별도 탭으로 연다 — 미션 목록과 나란히 두고 오간다(요구사항 67). */
function pageMission(){
  const head = `<div class="pagehead"><h2>미션 활동</h2>
    <button class="btn-add" data-act="mission-add-open" title="추가" aria-label="추가">${icon('plus',16)}<span>추가</span></button></div>`;

  const openTabs = state.missionOpen.map(key => M.getMissionApp(key)).filter(Boolean);
  const tabline = `<div class="catline">
    <button class="cat ${state.missionTab==='list'?'on':''}" data-act="mission-tab" data-v="list">미션 목록</button>
    ${openTabs.map(a => `<span class="cat-wrap">
      <button class="cat ${state.missionTab===a.id?'on':''}" data-act="mission-tab" data-v="${esc(a.id)}">${esc(a.name)}</button>
      <button class="cat-x" data-act="mission-tab-close" data-v="${esc(a.id)}" title="탭 닫기" aria-label="탭 닫기">${icon('x',14)}</button>
    </span>`).join('')}</div>`;

  const openApp = state.missionTab === 'list' ? null : M.getMissionApp(state.missionTab);
  if (openApp)
    return `${head}${tabline}<iframe class="appframe" src="${esc(openApp.adminUrl)}" title="${esc(openApp.name)} 관리자 모드"></iframe>`;

  const apps = M.getMissionApps();
  const list = apps.length ? apps.map(a => `<div class="row">
    <div class="grow"><div class="t">${esc(a.name)}</div>
      <div class="s mono">${esc(a.id)}</div></div>
    <div class="tools">
      <button class="ib" data-act="mission-admin" data-v="${esc(a.id)}" title="앱 어드민" aria-label="앱 어드민">${icon('wrench',16)}</button>
      <button class="ib" data-act="mission-edit" data-v="${esc(a.id)}" title="수정" aria-label="수정">${icon('pencil',16)}</button>
      <button class="ib ib-danger" data-act="mission-del" data-v="${esc(a.id)}" title="삭제" aria-label="삭제">${icon('trash-2',16)}</button>
    </div></div>`).join('') : `<div class="empty">연결한 앱이 없습니다.</div>`;

  return `${head}${tabline}${list}`;
}

/* 미션 앱 등록/수정 팝업 — 이름, 앱 키(apps/ 폴더 이름), 학생 주소, 관리자 주소. */
function openMissionModal(app){
  const back = document.createElement('div');
  back.className = 'modal-back';
  const dis = app ? 'disabled' : '';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="미션 앱">
    <h3>${app ? '앱 수정' : '앱 추가'}</h3>
    <div class="m-form">
      <label class="m-label">이름</label><input class="f" id="ma-name" value="${esc(app?.name || '')}">
      <label class="m-label">앱 키</label><input class="f" id="ma-key" value="${esc(app?.id || '')}" ${dis}>
      <label class="m-label">학생 주소</label><input class="f" id="ma-su" value="${esc(app?.studentUrl || '')}">
      <label class="m-label">관리자 주소</label><input class="f" id="ma-au" value="${esc(app?.adminUrl || '')}">
    </div>
    <div class="m-err" id="ma-err"></div>
    <div class="m-acts">
      <button class="btn-ghost" data-m="cancel">닫기</button>
      <button class="btn-text" data-m="ok">${app ? '저장' : '추가'}</button>
    </div></div>`;
  document.body.appendChild(back);
  const modal = back.querySelector('.modal');
  const close = () => { document.removeEventListener('keydown', onKey); back.remove(); };
  const err = m => { modal.querySelector('#ma-err').textContent = m; };
  const submit = () => {
    const name = modal.querySelector('#ma-name').value, su = modal.querySelector('#ma-su').value,
          auu = modal.querySelector('#ma-au').value, key = modal.querySelector('#ma-key').value;
    try {
      if (app) M.updateMissionApp(app.id, { name, studentUrl:su, adminUrl:auu });
      else M.addMissionApp({ name, studentUrl:su, adminUrl:auu, key });
      toast(app ? '앱을 저장했습니다.' : '앱을 추가했습니다.'); close(); render();
    } catch(e){ err(e.message); }
  };
  const onKey = e => { if (e.key==='Escape') close(); if (e.key==='Enter'){ e.preventDefault(); submit(); } };
  back.addEventListener('click', e => {
    if (e.target === back){ close(); return; }
    const m = e.target.closest('[data-m]'); if (!m) return;
    if (m.dataset.m === 'ok') submit(); else close();
  });
  document.addEventListener('keydown', onKey);
}

/* ── 오늘의 질문 ──
   질문 관리는 강의에 걸린 질문(lessons.parts.question)을, 답변 채점은 강의실과 강의를 골라
   그 질문에 들어온 학생 답변을 모아 본다(AI 1차 채점은 다음 단계, 요구사항 70). */
function pageQuestion(){
  const tabs = catline(M.ADMIN_SUBMENUS.question, state.questionTab, 'question-tab');
  const head = `<div class="pagehead"><h2>오늘의 질문</h2></div>${tabs}`;

  if (state.questionTab === 'manage'){
    const lessons = M.getLessonsWithPart('question');
    if (!lessons.length) return head + `<div class="empty">질문이 걸린 강의가 없습니다.</div>`;
    const list = lessons.map(l => {
      const open = state.questionLessonId === l.id, q = l.parts.question;
      const row = `<div class="row ${open?'on':''}">
        <div class="grow rowlink" data-act="q-open" data-id="${l.id}">
          <div class="t"><span class="chev">${icon(open?'chevron-down':'chevron-right',16)}</span>${esc(l.title)}</div></div></div>`;
      const ed = `<div class="detail"><div class="m-form">
        <label class="m-label">질문</label>
        <input class="f" data-act="q-edit" data-id="${l.id}" data-k="prompt" value="${esc(q.prompt || '')}">
        <label class="m-label">안내</label>
        <input class="f" data-act="q-edit" data-id="${l.id}" data-k="guide" value="${esc(q.guide || '')}">
      </div></div>`;
      return open ? row + ed : row;
    }).join('');
    return head + list;
  }

  const courses = M.getCourses(state.year);
  if (!courses.length) return head + `<div class="empty">강의실이 없습니다.</div>`;
  if (!courses.some(c => c.id === state.questionCourseId)) state.questionCourseId = courses[0].id;

  const cls = M.getCourseLessons(state.questionCourseId).filter(cl => cl.lesson?.parts?.question);
  if (!cls.some(cl => cl.id === state.questionClId)) state.questionClId = cls[0]?.id || null;

  const pickers = `<div class="formrow">
    <select class="sel" data-act="q-course" aria-label="강의실">
      ${courses.map(c => `<option value="${c.id}" ${c.id===state.questionCourseId?'selected':''}>${esc(M.roomName(c))}</option>`).join('')}
    </select>
    <select class="sel" data-act="q-lesson" aria-label="강의" ${cls.length?'':'disabled'}>
      ${cls.length
        ? cls.map(cl => `<option value="${cl.id}" ${cl.id===state.questionClId?'selected':''}>${esc(cl.lesson.title)}</option>`).join('')
        : `<option>질문이 걸린 강의 없음</option>`}
    </select></div>`;

  if (!state.questionClId) return head + pickers + `<div class="empty">질문이 걸린 강의가 없습니다.</div>`;

  const subs = M.getQuestionSubs(state.questionClId);
  const body = subs.length ? subs.map(s => `<div class="row">
    <div class="grow"><div class="t"><span class="mono">${esc(s.studentNo)}</span> &nbsp;${esc(s.name)}</div>
      <div class="s">${esc(s.answer)}</div></div>
    <div class="tools">
      <input class="f dateinput" data-act="q-score" data-id="${s.id}" value="${s.score ?? ''}" inputmode="numeric" aria-label="점수">
      <span class="unit">/ ${s.max}</span>
      <button class="ib ib-sm ${s.shared?'ib-primary':''}" data-act="q-share" data-id="${s.id}" title="${s.shared?'공개 중 (누르면 숨김)':'숨김 (누르면 공개)'}" aria-label="공개 전환">${icon('eye',14)}</button>
    </div></div>`).join('') : `<div class="empty">제출된 답변이 없습니다.</div>`;

  return head + pickers + body;
}

/* ── 형성평가 ──
   성적에 들어가지 않는다(요구사항 70). 문제 유형은 단답, OX, 초성, 선택형 넷(2026-10-27). */
function pageFormative(){
  const lessons = M.getLessonsWithPart('formative');

  if (!state.formativeLessonId){
    const list = lessons.length ? lessons.map(l => `<div class="row rowlink" data-act="fm-open" data-id="${l.id}">
      <div class="grow"><div class="t">${esc(l.title)}</div>
        <div class="s">${esc(l.parts.formative.title || '')}</div></div>
      <div class="tools"><span class="chev">${icon('chevron-right',16)}</span></div>
    </div>`).join('') : `<div class="empty">형성평가가 있는 강의가 없습니다.</div>`;
    return `<div class="pagehead"><h2>형성평가</h2></div>${list}`;
  }

  const l = M.getLesson(state.formativeLessonId);
  const f = l?.parts?.formative;
  if (!f){ state.formativeLessonId = null; return pageFormative(); }

  const items = f.items || [];
  const deck = items.length ? items.map((it, i) => `<div class="partrow">
      <span class="plnum">${i + 1}</span>
      <div class="grow"><div class="t">${esc(it.q || '')}</div>
        <div class="s">${esc(M.formativeTypeDef(it.type)?.name || '')}</div></div>
      <div class="tools">
        <button class="ib" data-act="noop" title="수정" aria-label="수정">${icon('pencil',16)}</button>
        <button class="ib ib-danger" data-act="noop" title="삭제" aria-label="삭제">${icon('trash-2',16)}</button>
      </div></div>`).join('') : `<div class="placeholder">문항이 없습니다.</div>`;

  const palette = M.FORMATIVE_TYPES.map(t =>
    `<div class="pchip" data-act="fm-add" data-k="${t.key}"><span class="grow">${esc(t.name)}</span>${icon('plus',15)}</div>`).join('');

  return `<div class="pagehead">
      <button class="ib" data-act="fm-close" title="목록" aria-label="목록">${icon('chevron-left',16)}</button>
      <h2>${esc(l.title)}</h2></div>
    <div class="editor">
      <div class="deck"><div class="sectionlabel">문항</div>${deck}</div>
      <div class="palette"><div class="sectionlabel">문제 유형</div>${palette}</div>
    </div>`;
}

// ── 렌더 ──
function render(){
  renderSide();
  const p = { rooms:pageRooms, students:pageStudents, lessons:pageLessons, progress:pageProgress,
              concept:pageConcept, mission:pageMission, question:pageQuestion, formative:pageFormative }[state.page];
  $main.innerHTML = p ? p() : '';
}

// ── 이벤트 위임 ──
document.getElementById('shell').addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, k = el.dataset.k, id = el.dataset.id, v = el.dataset.v, no = el.dataset.no;
  switch (act){
    case 'page':
      state.page = k; state.lessonId = null; state.editRoomId = null; state.roomDetailId = null;
      state.studentDetailNo = null; state.roomStudentEdit = false; state.roomStuSel = new Set();
      state.conceptLessonId = null; state.formativeLessonId = null; state.questionLessonId = null; render(); break;
    case 'set-year': state.year = +v; state.editRoomId = null; render(); break;
    case 'set-subject': state.fSubject = v; render(); break;
    case 'set-class': state.fClass = v === 'all' ? null : v; render(); break;
    case 'room-group': state.roomGroup = v; render(); break;
    case 'set-sclass': state.studentClass = v; render(); break;

    case 'add-open': openAddModal(); break;

    // 강의실 상세(요구사항 6) — 줄 아래로 펼침/접음. 같은 줄을 다시 누르면 닫는다.
    case 'room-open':
      state.roomDetailId = state.roomDetailId === id ? null : id;
      state.openScore = null; state.editRoomId = null; state.roomLessonsMore = false;
      state.roomStudentEdit = false; state.roomStuSel = new Set(); render(); break;
    case 'room-lessons-more': state.roomLessonsMore = true; render(); break;
    case 'stu-edit-mode': state.roomStudentEdit = true; state.roomStuSel = new Set(); state.openScore = null; render(); break;
    case 'stu-edit-done': state.roomStudentEdit = false; state.roomStuSel = new Set(); render(); break;
    case 'stu-exclude': {
      const c = M.getCourse(id); if (!c) break;
      const nos = [...state.roomStuSel]; if (!nos.length) break;
      nos.forEach(sno => M.unenrollStudent(id, sno));
      state.roomStuSel = new Set();
      toast(`${nos.length}명을 ${M.roomName(c)}에서 제외했습니다.`); render(); break;
    }
    case 'cl-open': M.toggleCourseLessonOpen(id); render(); break;   // 공개 토글(진도 관리와 같이 맞물림)
    case 'stu-score': {
      const key = `${id}_${no}`;
      state.openScore = state.openScore === key ? null : key; render(); break;
    }
    case 'go-progress': state.page = 'progress'; state.roomDetailId = null; render(); break;
    case 'go-lessons': state.page = 'lessons'; state.roomDetailId = null; state.lessonId = null; render(); break;
    case 'go-students': state.page = 'students'; state.studentClass = M.roomNo(M.getCourse(id)); state.roomDetailId = null; render(); break;

    case 'room-edit': state.editRoomId = id; render(); break;
    case 'room-cancel': state.editRoomId = null; render(); break;
    case 'room-save': {
      const subject = val('e-subject'), grade = val('e-grade'), classNo = val('e-class');
      if (!subject || !grade || !classNo){ toast('과목, 학년, 반을 적어 주세요.'); return; }
      const c = run(() => M.updateCourse(id, { subject, grade, classNo }));
      if (c){ state.editRoomId = null; toast(`${M.roomName(c)} 강의실로 저장했습니다.`); render(); }
      break;
    }
    case 'room-del': {
      const c = M.getCourse(id); if (!c) return;
      const name = M.roomName(c), d = M.courseDeps(id);
      const gone = [
        d.students ? `학생 ${d.students}명` : '',
        d.lessons  ? `꽂힌 강의 ${d.lessons}개` : '',
        d.quizzes  ? `걸린 복습 ${d.quizzes}개` : '',
      ].filter(Boolean);
      confirmDelete({
        title: `${name} 강의실 삭제`,
        // 목록 끝 낱말이 무엇이냐에 따라 조사가 달라지므로 아예 조사를 쓰지 않는다
        bodyHtml: (gone.length
          ? `같이 없어지는 것 — ${gone.join(', ')}.<ul><li>강의 내용 자체는 창고에 남습니다</li></ul>`
          : `되돌릴 수 없습니다.`) + `<br>지우려면 <b>${esc(name)}</b>을 그대로 적어 주세요.`,
        needText: name,
      }).then(ok => {
        if (!ok) return;
        M.deleteCourse(id);
        if (state.editRoomId === id) state.editRoomId = null;
        if (state.roomDetailId === id) state.roomDetailId = null;
        toast(`${name} 강의실을 삭제했습니다.`); render();
      });
      break;
    }

    case 'stu-add-open': openStudentModal(); break;
    case 'stu-open':
      state.studentDetailNo = state.studentDetailNo === no ? null : no; render(); break;
    case 'stu-reset': toast('비밀번호 초기화 — 뼈대(다음 단계).'); break;
    case 'stu-del':
      M.removeStudentEverywhere(state.year, no);
      if (state.studentDetailNo === no) state.studentDetailNo = null;
      toast('삭제했습니다.'); render(); break;

    case 'lesson-add': {
      const title = val('l-title'); if (!title){ toast('강의 제목을 적어 주세요.'); return; }
      const l = M.addLesson(title); state.lessonId = l.id; state.lessonTab = 'edit'; render(); break;
    }
    case 'lesson-open': state.lessonId = id; state.lessonTab = 'edit'; render(); break;
    case 'lesson-close': state.lessonId = null; render(); break;
    case 'lesson-tab': state.lessonTab = v; render(); break;
    case 'part-toggle': M.setLessonPart(state.lessonId, k, !(M.getLesson(state.lessonId).order||[]).includes(k)); render(); break;
    case 'part-off': M.setLessonPart(state.lessonId, k, false); render(); break;
    case 'part-up': M.moveLessonPart(state.lessonId, k, -1); render(); break;
    case 'part-down': M.moveLessonPart(state.lessonId, k, 1); render(); break;
    case 'lesson-import': toast('활동지 올리기와 개념노트 변환은 다음 단계.'); break;
    case 'place-toggle': {
      // 데모: 꽂기만(해제는 다음 단계). 꽂혀 있지 않으면 꽂는다.
      const already = M.getCourseLessons(id).some(cl => cl.lessonId === state.lessonId);
      if (!already){ M.placeLesson(id, state.lessonId); toast('강의실에 꽂았습니다.'); }
      else toast('해제는 다음 단계에서 붙입니다.');
      render(); break;
    }
    // 개념 노트
    case 'concept-tab': state.conceptTab = v; state.conceptLessonId = null; render(); break;
    case 'concept-open': state.conceptLessonId = state.conceptLessonId === id ? null : id; render(); break;
    case 'ce-add': M.conceptAddLine(id, k); render(); break;
    case 'ce-up': M.conceptMoveLine(id, +k, -1); render(); break;
    case 'ce-down': M.conceptMoveLine(id, +k, 1); render(); break;
    case 'ce-del': M.conceptDelLine(id, +k); render(); break;

    // 미션 활동 — 앱 어드민을 같은 창 안의 탭으로 열고 닫는다
    case 'mission-tab': state.missionTab = v; render(); break;
    case 'mission-admin':
      if (!state.missionOpen.includes(v)) state.missionOpen.push(v);
      state.missionTab = v; render(); break;
    case 'mission-tab-close':
      state.missionOpen = state.missionOpen.filter(x => x !== v);
      if (state.missionTab === v) state.missionTab = 'list';
      render(); break;
    case 'mission-add-open': openMissionModal(); break;
    case 'mission-edit': openMissionModal(M.getMissionApp(v)); break;
    case 'mission-del': {
      const a = M.getMissionApp(v); if (!a) break;
      confirmDelete({ title:`${a.name} 삭제`, bodyHtml:`연결을 지웁니다. 되돌릴 수 없습니다.`, needText:a.name })
        .then(ok => { if (!ok) return;
          M.deleteMissionApp(v);
          state.missionOpen = state.missionOpen.filter(x => x !== v);
          if (state.missionTab === v) state.missionTab = 'list';
          toast(`${a.name}을 지웠습니다.`); render(); });
      break;
    }

    // 오늘의 질문
    case 'question-tab': state.questionTab = v; state.questionLessonId = null; render(); break;
    case 'q-open': state.questionLessonId = state.questionLessonId === id ? null : id; render(); break;
    case 'q-share': M.toggleSubShared(id); render(); break;

    // 형성평가
    case 'fm-open': state.formativeLessonId = id; render(); break;
    case 'fm-close': state.formativeLessonId = null; render(); break;
    case 'fm-add': toast(`${M.formativeTypeDef(k)?.name || ''} 문항 만들기는 다음 단계.`); break;

    case 'logout': signOut(auth); break;   // onAuthStateChanged가 로그인 화면으로 되돌린다

    case 'noop': toast('뼈대 — 다음 단계.'); break;
  }
});

/* 드롭다운(학년도 고르개)은 click이 아니라 change로 받는다. */
document.getElementById('shell').addEventListener('change', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.dataset.act === 'year-pick'){
    state.year = +el.value; state.fSubject = null; state.editRoomId = null;
    state.roomDetailId = null; state.studentDetailNo = null;
    state.roomStudentEdit = false; state.roomStuSel = new Set(); render();
  } else if (el.dataset.act === 'cl-date'){   // 수업일자 저장(진도 관리와 강의 진도가 같이 맞물림)
    M.setCourseLessonDate(el.dataset.id, el.value); render();
  } else if (el.dataset.act === 'stu-sel'){   // 명단 편집 모드에서 한 명 고르고 풀기
    if (el.checked) state.roomStuSel.add(el.dataset.no); else state.roomStuSel.delete(el.dataset.no);
    render();
  } else if (el.dataset.act === 'stu-sel-all'){
    const c = M.getCourse(state.roomDetailId);
    const nos = c ? M.getStudentsByCourse(c.id).map(s => s.studentNo) : [];
    state.roomStuSel = el.checked ? new Set(nos) : new Set();
    render();
  } else if (el.dataset.act === 'q-course'){   // 오늘의 질문 — 답변을 모아 볼 강의실
    state.questionCourseId = el.value; state.questionClId = null; render();
  } else if (el.dataset.act === 'q-lesson'){
    state.questionClId = el.value; render();
  } else if (el.dataset.act === 'ce-edit'){   // 개념 콘텐츠 줄 — 포커스 빠질 때 저장(다시 그리지 않아 커서 유지)
    M.conceptSetLine(el.dataset.id, +el.dataset.k, el.value);
  } else if (el.dataset.act === 'q-edit'){   // 질문/안내 저장
    M.setQuestion(el.dataset.id, { [el.dataset.k]: el.value });
  } else if (el.dataset.act === 'q-score'){   // 답변 점수 저장
    M.setSubScore(el.dataset.id, el.value);
  } else if (el.dataset.act === 'stu-enroll'){   // 수강 과목(강의실) 체크로 넣고 빼기
    const courseId = el.dataset.id, sno = el.dataset.no;
    if (el.checked){
      const name = M.getStudentsByYear(state.year).find(s => s.studentNo === sno)?.name || '';
      M.enrollStudent(courseId, sno, name);
    } else {
      M.unenrollStudent(courseId, sno);
    }
    render();
  }
});

/* 인라인 폼에서 엔터를 치면 그 줄의 주 버튼을 누른 것으로 본다.
   줄마다 핸들러를 달지 않도록 같은 묶음 안의 .btn-text 또는 .ib-primary를 찾는다. */
document.getElementById('shell').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
  const btn = e.target.closest('.formrow, .row, .catline')?.querySelector('.btn-text, .ib-primary');
  if (btn){ e.preventDefault(); btn.click(); }
});

boot();
