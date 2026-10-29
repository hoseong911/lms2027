// 2027 LMS 어드민: 제로베이스 뼈대 (2026-10-26)
// 왼쪽 메뉴는 model.js의 ADMIN_MENUS 한 곳에서 나온다.
// 가운데 넷(개념 노트 / 미션 활동 / 오늘의 질문 / 형성평가)은 강의 안 네 칸의 관리 화면이다(2026-10-27).
// 조직 원리: 강의실은 강의(차시)와 복습을 담고, 강의 하나는 개념 노트, 미션 활동, 오늘의 질문, 형성평가
//           네 칸을 각각 있거나 없거나로 채운다(순서 자유).
// 지금은 데모 데이터(model.js)로 돈다. 규칙: data-act + 위임, 상태는 state 하나,
// 알약 금지, 태그/카테고리는 구분선, 액션은 아이콘 버튼, 숫자 칸은 text+inputmode.

import * as M from './model.js?v=20261029a';
import { icon } from './shared/icons.js?v=20261028h';
import { auth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from './shared/fb.js?v=20261028a';

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
  progSubject: null,               // 진도 관리에서 보고 있는 과목(탭)
  studentClass: 'all',             // 학생 관리 반 필터(roomNo)
  studentDetailNo: null,           // 아래로 펼친 학생(학번)
  studentQuery: '',                // 학생 관리 학번 검색어
  lessonId: null, lessonTab: 'edit',

  // 칸별 메뉴 넷 (2026-10-27)
  conceptTab: 'content',           // 개념 노트 서브 메뉴 'content' | 'design'
  conceptLessonId: null,           // 콘텐츠에서 펼친 강의
  missionTab: 'list',              // 미션 활동 탭 'list' 또는 열어 둔 앱 키
  missionOpen: [],                 // 같은 창 안에 탭으로 열어 둔 앱 키들(요구사항 67)
  questionTab: 'manage',           // 오늘의 질문 서브 메뉴 'manage' | 'answers' | 'pick'
  questionSubject: null,           // 오늘의 질문 과목 탭(서브 메뉴 셋 공통)
  questionOpenId: null,            // 질문 관리에서 설명문을 펼친 강의
  questionEditId: null,            // 질문 관리에서 편집 중인 강의
  questionLessonId: null,          // 답변, 채점에서 고른 강의(lessons id)
  questionRoom: 'all',             // 답변, 채점에서 고른 반: 'all' 또는 강의실 id
  questionGradeTab: 'grade',       // 답변, 채점의 탭 'grade' | 'pass' | 'fail' (hoistory 채점 모달)
  questionAiBusy: false,           // AI 채점이 도는 중인가
  questionAiStatus: '',            // AI 채점 진행 문구
  formativeLessonId: null,         // 문항을 편집 중인 형성평가(강의)

  progAdding: false,               // 진도표에서 강의 추가 줄을 열었는가

  // 성적 (hoistory 성적 Check 틀 이식, 2026-10-28)
  scTab: 'input',                  // 서브 메뉴 'input' | 'setting' | 'view'
  scSubject: null,                 // 과목 탭
  scCourseId: null,                // 반 탭(강의실)
  scClId: null,                    // 성적 입력에서 고른 꽂힌 강의
  scOpenNo: null,                  // 성적 조회에서 강의별 내역을 펼친 학생(학번)
};

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const val = id => (document.getElementById(id)?.value || '').trim();

// 수업일자('M/D')의 과거/오늘/미래 판정은 model.js로 옮겼다(성적 기한 판정과 같은 함수를 쓴다).
const MAX_LESSONS = 30;            // 강의 진도에 한 번에 보여 줄 강의 수(요구사항 1)

// 넓은 화면(PC)에서는 강의실 관리, 학생 관리가 왼쪽 목록 + 오른쪽 상세 두 칸이 된다(선생님 지시 2026-10-29).
// 좁으면(패드, 폰) 목록 줄 아래로 펼친다. 폭이 바뀌어 넘나들면 다시 그린다.
const WIDE = matchMedia('(min-width:1100px)');
WIDE.addEventListener('change', () => { if (!document.getElementById('shell').hidden) render(); });

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
    try { await M.loadCore(); document.title = `${M.getText('browserTitle')} : 관리자 모드`; }
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

/* 확인 창: 브라우저 기본 confirm을 쓰지 않는다(코드 규칙).
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
function catline(items, active, act, allLabel, extra = '', cls = ''){
  const all = allLabel ? `<button class="cat ${active==null||active==='all'?'on':''}" data-act="${act}" data-v="all">${esc(allLabel)}</button>` : '';
  const rest = items.map(it => `<button class="cat ${String(active)===String(it.v)?'on':''}" data-act="${act}" data-v="${esc(it.v)}">${esc(it.label)}</button>`).join('');
  return `<div class="catline ${cls}">${all}${rest}${extra}</div>`;
}

// ── 강의실 관리 ──
// 머리줄: 제목 + 학년도 고르개(드롭다운) + 추가 버튼(팝업). 창 넓이는 admin.css에서.
// 생성(학년도, 강의실)은 전부 추가 버튼의 팝업에 모았다(요구사항 5). 필터는 과목 한 줄만
// 남기고(요구사항 4), 보이는 것은 늘 있는 과목만(요구사항 3). 목록은 과목, 학년, 반 순.
// 수정 중인 강의실 줄: 그 자리에서 입력 칸이 된다(인라인, 요구사항 66). 목록, 상세 공용.
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

  // 묶음 축 토글(과목별/반별): 필터 줄 오른쪽 끝에.
  const groupToggle = `<span class="line-end"><span class="seg seg-inline">
    <button class="seg-b ${byClass?'':'on'}" data-act="room-group" data-v="subject">과목별</button>
    <button class="seg-b ${byClass?'on':''}" data-act="room-group" data-v="class">반별</button>
  </span></span>`;

  // 필터 탭: 축에 따라 과목 또는 반. 늘 있는 것만(요구사항 3). 정렬도 축에 맞춘다.
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

  if (!list.length) return `${head}${filterLine}<div class="empty">강의실이 없습니다.</div>`;

  const keyOf = c => byClass ? M.roomNo(c) : c.subject;
  const grouped = rowOf => {
    const out = []; let last = null, first = true;
    list.forEach(c => {
      const key = keyOf(c);
      if (key !== last){ if (!first) out.push(`<div class="group-sep"></div>`); last = key; first = false; }
      out.push(rowOf(c));
    });
    return out.join('');
  };

  if (!WIDE.matches)
    return `${head}${filterLine}${grouped(c => c.id === state.editRoomId ? roomEditRow(c) : showRow(c))}`;

  // 넓은 화면: 왼쪽 목록에서 고르면 오른쪽 상세가 바뀐다. 수정, 삭제는 상세 머리에.
  if (!list.some(c => c.id === state.roomDetailId)) state.roomDetailId = list[0].id;
  const left = grouped(c => `<div class="row ${c.id===state.roomDetailId?'on':''}">
      <div class="grow rowlink" data-act="room-open" data-id="${c.id}"><div class="t">${esc(M.roomName(c))}</div></div></div>`);
  const c = M.getCourse(state.roomDetailId);
  const paneHead = c.id === state.editRoomId ? roomEditRow(c)
    : `<div class="pane-head"><h3>${esc(M.roomName(c))}</h3><div class="tools">
        <button class="ib" data-act="room-edit" data-id="${c.id}" title="수정" aria-label="수정">${icon('pencil',16)}</button>
        <button class="ib ib-danger" data-act="room-del" data-id="${c.id}" title="삭제" aria-label="삭제">${icon('trash-2',16)}</button>
      </div></div>`;
  return `${head}${filterLine}<div class="split"><div class="split-list">${left}</div>
    <div class="pane">${paneHead}<div class="two">${roomDetailCols(c)}</div></div></div>`;
}

/* 강의실 상세(요구사항 6): 줄 아래로 두 칸으로 펼쳐진다(요구사항 1).
   왼쪽: 강의 진도(강의차수, 제목, 수업일자, 최대 30강, 넘으면 더보기, 요구사항 1, 2).
   오른쪽: 학생 전원. 이름을 누르면 그 학생의 레벨, 경험치, 포트폴리오 성적이 펼쳐진다(요구사항 3). */
function roomDetailPanel(c){
  return `<div class="detail two">${roomDetailCols(c)}</div>`;
}
// 상세의 두 칸(강의 진도, 학생 명단). 좁은 화면의 펼침과 넓은 화면의 오른쪽 상세가 같이 쓴다.
function roomDetailCols(c){
  const students = M.getStudentsByCourse(c.id).slice().sort((a,b) => a.studentNo.localeCompare(b.studentNo));
  const lessons = M.getCourseLessons(c.id);          // order 순, 수업일자(date) 포함

  // ── 왼쪽: 강의 진도 ──
  const shown = state.roomLessonsMore ? lessons : lessons.slice(0, MAX_LESSONS);
  const lessonRows = lessons.length ? shown.map((cl, i) => {
    const st = M.dateStatus(cl.date);
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
    <div class="sectionlabel between">강의 진도<button class="btn-link" data-act="go-progress" data-id="${c.id}">진도 관리</button></div>
    ${lessonRows}${moreBtn}</div>`;

  // ── 오른쪽: 학생 명단 (편집을 누르면 체크 선택 모드로 이 강의실에서 일괄 제외) ──
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

  return left + right;
}

// 한 학생 카드: 레벨, 경험치, 포인트 + 포트폴리오 성적(펼침 안쪽, 요구사항 3).
function studentCard(courseId, studentNo){
  const xp = M.getXp(courseId, studentNo);
  const lvl = xp ? M.levelFromXp(xp.xp) : null;
  const sc = M.studentGrade(courseId, studentNo);

  const stats = `<div class="sc-stats">
    <div class="sc-stat"><div class="sc-k">레벨</div><div class="sc-v">${lvl!=null?`Lv.${lvl}`:'없음'}</div></div>
    <div class="sc-stat"><div class="sc-k">경험치</div><div class="sc-v">${xp?xp.xp:0}</div></div>
    <div class="sc-stat"><div class="sc-k">포인트</div><div class="sc-v">${xp?xp.point:0}</div></div>
  </div>`;

  let port;
  if (!sc.has){ port = `<div class="score-empty">반영된 강의가 없습니다.</div>`; }
  else {
    const lines = M.GRADE_AREAS.map(a => {
      const it = sc.areas[a.key];
      const detail = it.total ? `${it.score}점 <span class="gsub">${it.achieved}/${it.total} ${it.pct}%</span>` : '미실시';
      return `<div class="score-line"><span>${esc(a.name)}</span><span class="mono">${detail}</span></div>`;
    }).join('');
    const tot = `<div class="score-line tot"><span>총점</span><span class="mono">${sc.total} / ${sc.maxScore}점</span></div>`;
    port = lines + tot;
  }
  return `<div class="score-detail">${stats}<div class="sc-port"><div class="sc-k">포트폴리오 성적</div>${port}</div></div>`;
}

/* ── 진도 관리 (hoistory/lms "설정 - SCHEDULE 반별 수업 스케줄" 틀 이식) ─────
   선생님 지시 2026-10-28: "hoistory/lms의 진도 관리 메뉴를 차용해서 가지고 와 줘."
   hoistory 틀을 그대로 옮긴 것:
     - 머리줄 두 줄: 위는 반, 아래는 그 반의 수업 요일(자유 입력, courses.schedule)
     - 왼쪽 두 열: 강의 번호와 주제. 주제는 그 자리에서 고치면 강의 제목이 바뀐다
     - 가운데: 반마다 수업일자('M/D'). 오늘과 지난 날은 색으로 구분한다
     - 오른쪽 관리 열: 그 줄(강의)을 그 과목 강의실 전부에서 뺀다
     - 툴바의 [강의 추가]: 한 줄을 더하면 **그 과목 강의실 전부에 같이 꽂힌다**
   hoistory에서 안 가져온 것:
     [번호 자동 채우기]와 [주제 새로고침]은 hoistory가 번호와 주제를 손으로 적어
     따로 맞춰 줘야 했기 때문에 있던 단추다. 2027은 번호가 꽂힌 순서에서 저절로 나오고
     주제가 강의 제목 그 자체라 맞출 것이 없다.
   과목 탭은 어제 지시(요구사항 96)대로 그대로 둔다. */
/* 강의실들에 깔린 강의를 모은다: 어느 반에든 꽂혀 있으면 한 줄이 선다.
   세우는 차례는 꽂힌 순서(order)가 가장 앞인 것 기준이다(반마다 순서가 어긋나도 한 줄로 선다).
   진도 관리와 질문 관리가 같이 쓴다. */
function placedLessons(rooms){
  const placed = {};                     // 강의실id -> 꽂힌 강의 배열
  const firstOrder = new Map();          // 강의id -> 가장 앞선 order
  rooms.forEach(c => {
    placed[c.id] = M.getCourseLessons(c.id);
    placed[c.id].forEach(cl => {
      const cur = firstOrder.get(cl.lessonId);
      if (cur == null || cl.order < cur) firstOrder.set(cl.lessonId, cl.order);
    });
  });
  const lessons = M.getLessons()
    .filter(l => firstOrder.has(l.id))
    .sort((a,b) => firstOrder.get(a.id) - firstOrder.get(b.id));
  return { placed, lessons };
}

function pageProgress(){
  const years = M.getYears();
  const yearSel = `<select class="sel" id="year-sel" data-act="year-pick" aria-label="학년도">
    ${years.map(y => `<option value="${y.year}" ${y.year===state.year?'selected':''}>${y.year}학년도</option>`).join('')}
  </select>`;
  const head = `<div class="pagehead"><h2>진도 관리</h2>${years.length?yearSel:''}</div>`;
  if (!years.length) return `${head}<div class="empty">학년도가 없습니다.</div>`;

  const all = M.getCourses(state.year);
  if (!all.length) return `${head}<div class="empty">강의실이 없습니다.</div>`;

  // 과목 탭에서 그 과목의 반 탭으로 좁힌다. 둘 다 있는 것만(요구사항 3).
  const subjects = [...new Set(all.map(c => c.subject))].sort((a,b) => a.localeCompare(b,'ko'));
  if (!subjects.includes(state.progSubject)) state.progSubject = subjects[0];
  // hoistory의 [+ 강의 추가]는 과목 탭 줄 오른쪽 끝에 둔다(선생님 지시 2026-10-29).
  // 누르면 줄 아래에 제목 입력 줄이 열린다(요구사항 66 인라인).
  const addBtn = `<span class="line-end"><button class="btn-chip" data-act="prog-add-open">${icon('plus',13)}강의 추가</button></span>`;
  const tabs = catline(subjects.map(s => ({ v:s, label:s })), state.progSubject, 'prog-subject', '', addBtn);

  const rooms = all.filter(c => c.subject === state.progSubject)
    .slice().sort((a,b) => a.grade - b.grade || a.classNo - b.classNo);

  const { placed, lessons } = placedLessons(rooms);
  const addRow = state.progAdding ? `<div class="row">
    <input class="f grow" id="prog-new-title" autocomplete="off" aria-label="강의 제목">
    <span class="unit">${esc(state.progSubject)} 강의실 ${rooms.length}개에 같이 꽂습니다</span>
    <div class="tools">
      <button class="ib ib-primary" data-act="prog-add-save" title="추가" aria-label="추가">${icon('check',16)}</button>
      <button class="ib" data-act="prog-add-cancel" title="취소" aria-label="취소">${icon('x',16)}</button>
    </div></div>` : '';

  if (!lessons.length)
    return `${head}${tabs}${addRow}${addRow ? '' : `<div class="empty">개설된 강의가 없습니다.</div>`}`;

  // 머리줄 두 줄: 반 번호 / 그 반의 수업 요일
  const thead = `<tr>
      <th class="pl-num" rowspan="2">강의</th>
      <th class="lname" rowspan="2">주제</th>
      ${rooms.map(c => `<th title="${esc(M.roomName(c))}">${esc(M.roomNo(c))}</th>`).join('')}
      <th class="pl-manage" rowspan="2">관리</th>
    </tr>
    <tr>
      ${rooms.map(c => `<th class="pl-sch"><input class="f dateinput" data-act="prog-sch" data-id="${c.id}"
          value="${esc(c.schedule || '')}" aria-label="${esc(M.roomName(c))} 수업 요일"></th>`).join('')}
    </tr>`;

  const body = lessons.map((l, li) => {
    const cells = rooms.map(c => {
      const cl = placed[c.id].find(x => x.lessonId === l.id);
      if (!cl) return `<td class="na"><button class="pl-plus" data-act="prog-place" data-id="${c.id}" data-lid="${l.id}"
        title="${esc(M.roomName(c))}에 이 강의를 꽂습니다" aria-label="꽂기">${icon('plus',12)}</button></td>`;
      const st = M.dateStatus(cl.date);
      return `<td class="ds-${st}"><input class="f dateinput" data-act="cl-date" data-id="${cl.id}"
        value="${esc(cl.date || '')}" inputmode="numeric" aria-label="${esc(M.roomName(c))} 수업일자"></td>`;
    }).join('');
    return `<tr>
      <td class="pl-num">${li + 1}강</td>
      <td class="lname"><input class="f" data-act="prog-topic" data-lid="${l.id}" value="${esc(l.title)}" aria-label="주제"></td>
      ${cells}
      <td class="pl-manage"><button class="ib ib-sm ib-danger" data-act="prog-del" data-lid="${l.id}"
        title="이 줄을 과목 전체에서 빼기" aria-label="빼기">${icon('trash-2',14)}</button></td>
    </tr>`;
  }).join('');

  return `${head}${tabs}${addRow}
    <div class="prog-wrap"><table class="prog pltable">
      <thead>${thead}</thead><tbody>${body}</tbody>
    </table></div>`;
}

/* ── 성적 (hoistory/lms "성적 Check" 틀 이식) ───────────────────────────────
   선생님 지시 2026-10-28: 미션 활동, 오늘의 질문, 성적 전부 hoistory 기본 틀로.
   hoistory와 같이 서브 메뉴 셋으로 나눈다.
     성적 입력 : 강의를 고르고 불러오면 반 학생 표가 뜬다. 영역마다 달성 칸과 기한 칸을
                 체크한다. 미션 활동과 오늘의 질문은 제출물에서 자동으로 끌어오고(자동 감지),
                 교사가 누른 칸은 손으로 정한 것으로 표시돼 다시 끌어와도 덮이지 않는다.
                 이름을 누르면 결석(전부 미달성 고정). 끝에 피드백 칸과 템플릿 고르개.
                 영역 셋은 그 강의에 칸이 없어도 늘 선다: 제목 옆 스위치로 켜고 끈다
                 (선생님 지시 2026-10-28). 머리줄의 달성, 기한 체크표시는 그 열 전체를 켠다
     성적 설정 : 과목별로 성적에 반영할 강의 목록 + 포트폴리오 점수 급간 표 + 피드백 템플릿
     성적 조회 : 반별로 학생의 영역 점수, 달성률, 총점. 이름을 누르면 강의별 내역
   계산은 model.js의 studentGrade 한 곳에서 한다(머리 주석 참고). */
function pageScores(){
  const years = M.getYears();
  const yearSel = `<select class="sel" id="year-sel" data-act="year-pick" aria-label="학년도">
    ${years.map(y => `<option value="${y.year}" ${y.year===state.year?'selected':''}>${y.year}학년도</option>`).join('')}
  </select>`;
  // 세 줄이던 고르개를 한 줄로 모았다(선생님 지시 2026-10-29).
  // 과목은 머리줄의 학년도 옆 드롭다운, 반은 카테고리 줄, 입력/설정/조회는 그 줄 오른쪽 끝 토글.
  const subSeg = `<span class="line-end"><span class="seg seg-inline">
    ${M.ADMIN_SUBMENUS.scores.map(t => `<button class="seg-b ${state.scTab===t.v?'on':''}" data-act="sc-tab" data-v="${t.v}">${esc(t.label)}</button>`).join('')}
  </span></span>`;
  if (!years.length) return `<div class="pagehead"><h2>성적</h2></div><div class="empty">학년도가 없습니다.</div>`;

  const all = M.getCourses(state.year);
  if (!all.length) return `<div class="pagehead"><h2>성적</h2>${yearSel}</div><div class="empty">강의실이 없습니다.</div>`;

  // 과목은 세 화면 공통이다(선생님 지시 2026-10-28: 성적 설정도 과목별로 뜨게).
  const subjects = [...new Set(all.map(c => c.subject))].sort((a,b) => a.localeCompare(b,'ko'));
  if (!subjects.includes(state.scSubject)) state.scSubject = subjects[0];
  const subjectSel = `<select class="sel" data-act="sc-subject-pick" aria-label="과목">
    ${subjects.map(s => `<option value="${esc(s)}" ${s===state.scSubject?'selected':''}>${esc(s)}</option>`).join('')}
  </select>`;
  const head = `<div class="pagehead"><h2>성적</h2>${yearSel}${subjectSel}</div>`;

  const rooms = all.filter(c => c.subject === state.scSubject)
    .slice().sort((a,b) => a.grade - b.grade || a.classNo - b.classNo);

  // 성적 설정은 반을 고르지 않는다: 반영 강의와 급간 표는 과목 단위다. 줄에는 토글만 남는다.
  if (state.scTab === 'setting') return head + catline([], null, 'sc-room', '', subSeg) + scoreSettingPanel(rooms);

  if (!rooms.some(c => c.id === state.scCourseId)) state.scCourseId = rooms[0]?.id || null;
  const roomTabs = catline(rooms.map(c => ({ v:c.id, label:M.roomNo(c) })), state.scCourseId, 'sc-room', '', subSeg);

  const c = M.getCourse(state.scCourseId);
  if (!c) return `${head}${roomTabs}<div class="empty">강의실이 없습니다.</div>`;

  return head + roomTabs + (state.scTab === 'input' ? scoreInputPanel(c) : scoreViewPanel(c));
}

/* 성적 입력: 강의 고르개 줄(hoistory의 grade-config-card) + 통계 칩 + 학생 표.
   선생님 지시 2026-10-28로 셋을 고쳤다.
     1) 배수(1배, 2배) 고르개를 걷어내고 고르개 줄을 한 줄로 모았다
     2) 영역 셋(개념 노트, 미션 활동, 오늘의 질문)은 그 강의에 칸이 없어도 늘 선다.
        제목 옆 스위치로 켜고 끈다(끈 영역은 미실시, 적어 둔 내용은 되살려 둔다)
     3) 머리줄의 달성, 기한 옆 체크표시를 누르면 그 열이 모두 체크된다 */
function scoreInputPanel(c){
  const cls = M.getCourseLessons(c.id);
  if (!cls.length) return `<div class="empty">꽂힌 강의가 없습니다.</div>`;
  if (!cls.some(cl => cl.id === state.scClId)) state.scClId = cls[0].id;
  const cl = cls.find(x => x.id === state.scClId);

  const lessonSel = `<select class="sel sel-lesson" data-act="sc-lesson" aria-label="강의">
    ${cls.map((x, i) => `<option value="${x.id}" ${x.id===state.scClId?'selected':''}>${i+1}강. ${esc(x.lesson?.title || '(삭제된 강의)')}</option>`).join('')}
  </select>`;

  const students = M.getStudentsByCourse(c.id).slice().sort((a,b) => a.studentNo.localeCompare(b.studentNo));
  const nos = students.map(s => s.studentNo);
  const stats = M.gradeStats(cl.id, nos);
  const statChips = M.GRADE_AREAS.map(a => {
    const st = stats[a.key];
    return `<span class="gchip"><b>${esc(a.name)}</b>${st ? `${st.done} / ${st.all}` : '미실시'}</span>`;
  }).join('');

  const dateNote = cl.date
    ? `<span class="unit">수업일자 ${esc(cl.date)}</span>`
    : `<span class="unit">수업일자가 없어 기한을 따지지 않습니다</span>`;

  const pubBtn = `<button class="btn-chip ${cl.gradePublished?'on':''}" data-act="sc-publish" data-id="${cl.id}">
    ${icon(cl.gradePublished ? 'eye' : 'eye-off', 13)}${cl.gradePublished ? '반영 중' : '반영하기'}</button>`;
  const autoBtn = `<button class="btn-chip" data-act="sc-auto" data-id="${cl.id}">${icon('download',13)}자동 끌어오기</button>`;
  const inGrade = M.isGradeLesson(cl.lessonId);

  // 한 줄로 모았다(선생님 지시 2026-10-28). 반영 강의가 아닐 때만 오류 줄이 한 줄 더 선다.
  const bar = `<div class="gradebar">
    <div class="gradebar-line">${lessonSel}${dateNote}<div class="grow"></div>${autoBtn}${pubBtn}</div>
    ${inGrade ? '' : `<div class="m-err">이 강의는 성적 설정의 반영 강의 목록에 없어 최종 성적에 들어가지 않습니다.</div>`}
  </div>`;

  if (!students.length) return bar + `<div class="empty">학생이 없습니다.</div>`;

  // 영역 셋은 늘 다 선다. on이 꺼진 영역은 칸이 비고 체크를 못 한다(미실시).
  const areas = M.GRADE_AREAS.map(a => ({ ...a, on: !!M.partWeight(cl.lessonId, a.key) }));
  const recs = new Map(students.map(s => [s.studentNo, M.gradeRec(cl.id, s.studentNo)]));
  const auto = M.autoDetect(cl.id);
  const templates = M.getFeedbackTemplates();

  // 제목 옆 스위치로 그 강의의 칸을 켜고 끈다(그 강의를 꽂은 모든 강의실에 같이 걸린다).
  const head1 = areas.map(a => `<th colspan="2" class="ga-${a.key} ${a.on?'':'ga-off'}">
      <span class="gahead">${esc(a.name)}
        <button class="sw sw-sm ${a.on?'on':''}" role="switch" aria-checked="${a.on}"
          data-act="sc-part-enable" data-lid="${cl.lessonId}" data-k="${a.key}"
          title="${esc(a.name)} ${a.on?'비활성화':'활성화'}" aria-label="${esc(a.name)} 활성화, 비활성화"><i></i></button>
      </span></th>`).join('');

  // 둘째 줄: 달성, 기한 옆 체크표시. 누르면 그 열의 모든 학생이 한 번에 체크된다.
  const colHead = (a, field, label) => {
    const on = a.on && students.every(st => {
      const g = recs.get(st.studentNo);
      return g.absent || (g[a.key]?.[field] || 0) >= 1;
    });
    return `<th class="ga-${a.key} ${a.on?'':'ga-off'}">
      <label class="colall">${label}<input type="checkbox" class="gcb" data-act="sc-col-all"
        data-id="${cl.id}" data-k="${a.key}" data-f="${field}" ${on?'checked':''} ${a.on?'':'disabled'}></label></th>`;
  };
  const head2 = areas.map(a => colHead(a, 'achievedN', '달성') + colHead(a, 'onTimeN', '기한')).join('');

  const body = students.map(s => {
    const g = recs.get(s.studentNo);
    const live = areas.filter(a => a.on);
    const rowAll = live.length > 0 &&
      live.every(a => (g[a.key]?.achievedN||0) >= 1 && (g[a.key]?.onTimeN||0) >= 1);
    const cells = areas.map(a => ['achievedN', 'onTimeN'].map(field =>
      `<td class="ga-${a.key} ${a.on?'':'ga-off'}">${a.on ? `<input type="checkbox" class="gcb" data-act="sc-cell" data-id="${cl.id}"
         data-no="${s.studentNo}" data-k="${a.key}" data-f="${field}" data-i="0"
         ${(g[a.key]?.[field]||0) >= 1 ? 'checked' : ''} ${g.absent ? 'disabled' : ''}>` : ''}</td>`).join('')).join('');
    const note = M.GRADE_AREAS.map(a => {
      const v = auto[s.studentNo]?.[a.key]; if (!v) return '';
      const manual = g.manual?.[a.key];
      return `<span class="gnote ${manual?'muted':''}" title="${manual?'손으로 정한 칸이라 자동 감지가 덮지 않습니다':'자동 감지 결과'}">${esc(v.note)}</span>`;
    }).filter(Boolean).join('');
    // 피드백 칸 옆 고르개: 템플릿을 고르면 그 글이 칸에 들어간다(선생님 지시 2026-10-28).
    // 글자 없이 화살표만 있는 드롭다운 단추다(선생님 지시 2026-10-29). 템플릿이 없으면 눌리지 않는다.
    const fbPick = `<select class="sel sel-sm fbpick" data-act="sc-fb-pick"
        data-id="${cl.id}" data-no="${s.studentNo}" aria-label="피드백 템플릿" ${templates.length?'':'disabled'}
        title="${templates.length?'피드백 템플릿':'성적 설정에서 피드백 템플릿을 적으면 고를 수 있습니다.'}">
        <option value=""></option>
        ${templates.map((t, i) => `<option value="${i}">${esc(t)}</option>`).join('')}</select>`;
    return `<tr class="${g.absent?'absent':''}">
      <td class="lname">
        <input type="checkbox" class="gcb" data-act="sc-row-all" data-id="${cl.id}" data-no="${s.studentNo}"
          ${rowAll?'checked':''} ${g.absent?'disabled':''} title="이 학생의 달성과 기한을 한 번에">
        <span class="mono">${esc(s.studentNo)}</span>
        <button class="gname" data-act="sc-absent" data-id="${cl.id}" data-no="${s.studentNo}"
          title="누르면 결석으로 표시하고 해제합니다">${esc(s.name)}</button>
        ${g.absent ? `<span class="gnote">결석</span>` : ''}
      </td>
      ${cells}
      <td class="gauto">${note}</td>
      <td class="gfb"><div class="fbcell"><input class="f" data-act="sc-feedback" data-id="${cl.id}" data-no="${s.studentNo}"
        value="${esc(g.feedback || '')}" aria-label="피드백">${fbPick}</div></td>
    </tr>`;
  }).join('');

  return bar + `<div class="gstats">${statChips}</div>
    <div class="prog-wrap"><table class="prog gradetable">
      <thead>
        <tr><th class="lname" rowspan="2">학생</th>${head1}<th rowspan="2">자동 감지</th><th class="gfb" rowspan="2">피드백</th></tr>
        <tr>${head2}</tr>
      </thead><tbody>${body}</tbody></table></div>`;
}

/* 성적 설정: 과목별 반영 강의 목록 + 포트폴리오 점수 급간 표 + 피드백 템플릿.
   급간 표와 템플릿은 과목을 가리지 않고 하나다(hoistory grade_settings/config 그대로).
   반영 강의 목록만 과목 탭에 따라 달라진다(선생님 지시 2026-10-28). */
function scoreSettingPanel(rooms){
  const { lessons } = placedLessons(rooms);
  const picked = new Set(M.getGradeLessons());
  const list = lessons.length ? lessons.map((l, i) => {
    const on = picked.has(l.id);
    const parts = M.GRADE_AREAS.filter(a => M.partWeight(l.id, a.key)).map(a => a.name).join(', ');
    return `<label class="row compact selrow ${on?'on':''}">
      <input type="checkbox" data-act="sc-pick-lesson" data-lid="${l.id}" ${on?'checked':''}>
      <span class="grow"><span class="t">${i + 1}강 ${esc(l.title)}</span>
        ${parts ? `<span class="s">${esc(parts)}</span>` : `<span class="s">성적에 드는 칸이 없습니다.</span>`}</span></label>`;
  }).join('') : `<div class="empty">깔린 강의가 없습니다.</div>`;

  const bands = M.getBands();
  const rows = bands.map((b, i) => {
    const next = i === 0 ? 100 : bands[i-1].min;
    const label = i === 0 ? `${b.min}% 이상` : `${b.min} ~ ${next}%`;
    const box = k => `<td class="num"><input class="f dateinput" data-band="${i}" data-k="${k}"
      value="${+b[k] || 0}" inputmode="numeric" aria-label="${label} ${esc(M.GRADE_AREAS.find(a=>a.key===k).name)} 점수"></td>`;
    return `<tr><td class="lname">${label}</td>${M.GRADE_AREAS.map(a => box(a.key)).join('')}</tr>`;
  }).join('');
  const top = bands[0] || {};
  const full = M.GRADE_AREAS.reduce((n, a) => n + (+top[a.key] || 0), 0);

  // 피드백 템플릿: 한 줄에 하나. 성적 입력의 피드백 칸 옆 고르개가 이 목록을 쓴다.
  const tmpl = `<div class="sectionlabel between">피드백 템플릿
      <button class="btn-link" data-act="sc-fb-save">저장</button></div>
    <textarea class="f fbtmpl" id="sc-fb-tmpl" rows="6" aria-label="피드백 템플릿">${esc(M.getFeedbackTemplates().join('\n'))}</textarea>`;

  return `<div class="sectionlabel">성적에 반영할 강의</div>${list}
    <div class="sectionlabel between">포트폴리오 점수 급간
      <button class="btn-link" data-act="sc-config-save">저장</button></div>
    <div class="prog-wrap"><table class="prog bandtable">
      <thead><tr><th class="lname">달성률</th>${M.GRADE_AREAS.map(a => `<th class="num">${esc(a.name)}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td class="lname">만점</td><td class="num" colspan="${M.GRADE_AREAS.length}">${full}점</td></tr></tfoot>
    </table></div>` + tmpl;
}

/* 성적 조회: 반별로 학생의 영역 점수와 총점. 이름을 누르면 강의별 내역이 펼쳐진다. */
function scoreViewPanel(c){
  const students = M.getStudentsByCourse(c.id).slice().sort((a,b) => a.studentNo.localeCompare(b.studentNo));
  if (!students.length) return `<div class="empty">학생이 없습니다.</div>`;
  const picked = M.getGradeLessons();
  if (!picked.length)
    return `<div class="empty">성적 설정에서 반영할 강의를 먼저 고르시길 바랍니다.</div>`;

  const th = M.GRADE_AREAS.map(a => `<th class="num">${esc(a.name)}</th>`).join('');
  const body = students.map(s => {
    const g = M.studentGrade(c.id, s.studentNo);
    const open = state.scOpenNo === s.studentNo;
    const cells = M.GRADE_AREAS.map(a => {
      const it = g.areas[a.key];
      return `<td class="num">${it.total ? `${it.score}<span class="gsub">${it.achieved}/${it.total} ${it.pct}%</span>` : '<span class="gsub">미실시</span>'}</td>`;
    }).join('');
    const row = `<tr class="scrow ${open?'on':''}" data-act="sc-open" data-no="${s.studentNo}">
      <td class="lname"><span class="chev">${icon(open?'chevron-down':'chevron-right',14)}</span>
        <span class="mono">${esc(s.studentNo)}</span> &nbsp;${esc(s.name)}</td>
      ${cells}<td class="num tot">${g.total}<span class="gsub">/ ${g.maxScore}</span></td></tr>`;
    return open ? row + scoreRowDetail(g, M.GRADE_AREAS.length + 2) : row;
  }).join('');

  return `<div class="sectionlabel">${esc(M.roomName(c))} 포트폴리오 성적</div>
    <div class="prog-wrap"><table class="prog scoretable">
      <thead><tr><th class="lname">학생</th>${th}<th class="num">총점</th></tr></thead>
      <tbody>${body}</tbody></table></div>`;
}

// 강의별 내역: 어디서 깎였는지 그대로 보인다(hoistory 2026-09-03과 같은 뜻).
function scoreRowDetail(g, span){
  const body = g.rows.length ? g.rows.map(r => {
    const bits = M.GRADE_AREAS.map(a => {
      const v = r.areas[a.key]; if (!v) return '';
      const mark = (n, w) => n >= w ? 'O' : (n > 0 ? '△' : 'X');
      return `<span class="gnote">${esc(a.name)} ${mark(v.achievedN, v.weight)} ${mark(v.onTimeN, v.weight)}</span>`;
    }).filter(Boolean).join('');
    return `<div class="row compact">
      <div class="plnum">${r.no}강</div>
      <div class="grow"><div class="t">${esc(r.title)}</div>${r.feedback ? `<div class="s">${esc(r.feedback)}</div>` : ''}</div>
      ${r.absent ? `<span class="gnote">결석</span>` : ''}${bits}</div>`;
  }).join('') : `<div class="empty">반영된 강의가 없습니다.</div>`;
  return `<tr class="sc-lines"><td colspan="${span}"><div class="detail">${body}</div></td></tr>`;
}

/* 추가 팝업: 학년도 생성 / 강의실 생성을 한곳에 모았다(요구사항 5).
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
  // 학번 검색: 반 줄 오른쪽 끝 칸에 치는 대로 바로 거른다(선생님 지시 2026-10-29). 고른 반 안에서 거른다.
  const q = state.studentQuery.replace(/\D/g, '');
  if (q) snos = snos.filter(sno => sno.includes(q));

  const yearSel = `<select class="sel" id="year-sel" data-act="year-pick" aria-label="학년도">
    ${years.map(y => `<option value="${y.year}" ${y.year===state.year?'selected':''}>${y.year}학년도</option>`).join('')}
  </select>`;
  const head = `<div class="pagehead"><h2>학생 관리</h2>${yearSel}${addBtn}</div>`;
  const search = `<span class="line-end"><label class="searchbox">${icon('search',15)}
    <input class="f" id="stu-search" data-act="stu-search" inputmode="numeric" autocomplete="off"
      value="${esc(state.studentQuery)}" aria-label="학번 검색"></label></span>`;
  const filterLine = catline(roomNos.map(r => ({ v:r, label:r })), state.studentClass, 'set-sclass', '전체', search);

  if (!snos.length) return `${head}${filterLine}<div class="empty">학생이 없습니다.</div>`;
  const nameOf = sno => all.find(s => s.studentNo === sno)?.name || '';
  const stuTools = sno => `<div class="tools">
        <button class="ib" data-act="stu-reset" data-no="${sno}" title="비밀번호 초기화" aria-label="비밀번호 초기화">${icon('rotate-ccw',16)}</button>
        <button class="ib ib-danger" data-act="stu-del" data-no="${sno}" title="삭제" aria-label="삭제">${icon('trash-2',16)}</button>
      </div>`;

  if (!WIDE.matches){
    const list = snos.map(sno => {
      const open = state.studentDetailNo === sno;
      const row = `<div class="row ${open?'on':''}">
        <div class="grow rowlink" data-act="stu-open" data-no="${sno}">
          <div class="t"><span class="chev">${icon(open?'chevron-down':'chevron-right',16)}</span><span class="mono">${esc(sno)}</span> &nbsp;${esc(nameOf(sno))}</div></div>
        ${stuTools(sno)}</div>`;
      return open ? row + `<div class="detail two">${studentDetailCols(sno)}</div>` : row;
    }).join('');
    return `${head}${filterLine}${list}`;
  }

  // 넓은 화면: 왼쪽 학생 목록, 오른쪽 상세(선생님 지시 2026-10-29, 시안 A).
  if (!snos.includes(state.studentDetailNo)) state.studentDetailNo = snos[0];
  const sel = state.studentDetailNo;
  const left = snos.map(sno => `<div class="row ${sno===sel?'on':''}">
      <div class="grow rowlink" data-act="stu-open" data-no="${sno}"><div class="t"><span class="mono">${esc(sno)}</span> &nbsp;${esc(nameOf(sno))}</div></div></div>`).join('');
  return `${head}${filterLine}<div class="split"><div class="split-list">${left}</div>
    <div class="pane"><div class="pane-head"><h3><span class="mono">${esc(sel)}</span> ${esc(nameOf(sel))}</h3>${stuTools(sel)}</div>
      <div class="two">${studentDetailCols(sel)}</div></div></div>`;
}

/* 학생 상세(요구사항 2): 줄 아래로 두 칸. 왼쪽: 수강 과목(강의실) 체크로 켜고 끄기 + 비밀번호.
   오른쪽: 과목(강의실)별 레벨, 경험치, 포트폴리오 성적. 한 학번이 여러 과목에 들 수 있어서 과목별로 본다. */
function studentDetailCols(sno){
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
    const xp = M.getXp(c.id, sno), lvl = xp ? M.levelFromXp(xp.xp) : null, sc = M.studentGrade(c.id, sno);
    const bits = [lvl!=null?`Lv.${lvl}`:'레벨 없음', `경험치 ${xp?xp.xp:0}`,
      sc.has ? `포트폴리오 ${sc.total}/${sc.maxScore}점` : '포트폴리오 기록 없음'];
    return `<div class="row compact"><div class="grow"><div class="t">${esc(M.roomName(c))}</div>
      <div class="s">${bits.join(', ')}</div></div></div>`;
  }).join('') : `<div class="empty">수강 중인 과목이 없습니다.</div>`;
  const right = `<div class="dcol">
    <div class="sectionlabel">과목별 성적</div>
    ${scoreRows}</div>`;

  return left + right;
}

/* 학생 추가 팝업(요구사항 1): 개별 추가 / 엑셀 명단. 개별은 학년, 반, 번호, 이름만 받는다.
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
    if (!rooms.length){ err('그 반으로 만든 강의실이 없습니다. 먼저 강의실을 만들어 주세요.'); return; }
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
    else if (m.dataset.m === 'upload') toast('엑셀 올리기는 다음 단계에서 만듭니다.');
    else close();
  });
  document.addEventListener('keydown', onKey);
}

// ── 강의 라이브러리 (개념 노트의 서브 메뉴, 선생님 지시 2026-10-28) ──
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
    return `${addForm}${listSide}`;

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
  }).join('') : `<div class="placeholder">칸이 없습니다. 오른쪽에서 추가해 주세요.</div>`;

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
          title="활동지를 올려 개념 노트를 만듭니다">${icon('upload',16)}<span>활동지 올리기</span></button>
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
   (요구사항 46, 47). 그래서 서브 메뉴도 콘텐츠와 디자인 둘뿐이다. */
function pageConcept(){
  const tabs = catline(M.ADMIN_SUBMENUS.concept, state.conceptTab, 'concept-tab');
  const head = `<div class="pagehead"><h2>개념 노트</h2></div>${tabs}`;

  if (state.conceptTab === 'library')
    return head + pageLessons();

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

/* 개념 콘텐츠 편집기: 페이지(제목)와 내용 줄을 쌓는다(2026 contentLines 모티브).
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

/* ── 미션 활동 (hoistory/lms "미션 Check" 카드 틀 이식) ─────────────────────
   선생님 지시 2026-10-28: 미션 활동도 hoistory 기본 틀로.
   hoistory 카드가 들고 있던 것을 그대로 옮겼다: 제목, 웹앱 주소, 어드민 주소, 아이콘,
   연결할 강의, 팝업으로 열기, 그리고 아카이브 세 칸(수업 주제, 활동 의도, 아카이브 내용).
   아카이브 칸은 접어 두고 아이콘 단추로 펼친다(hoistory의 아카이브 아코디언과 같다).
   앱 어드민은 오버레이로 화면을 덮지 않고 같은 창 안의 탭으로 연다(요구사항 67). */
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
  const list = apps.length ? apps.map(a => {
    const lesson = a.lessonId ? M.getLesson(a.lessonId) : null;
    const arch = a.archive || {};
    const bits = [lesson ? `연결 강의 ${lesson.title}` : '연결한 강의 없음',
                  a.modal ? '팝업으로 열기' : ''].filter(Boolean).join(', ');
    return `<div class="row">
      <div class="grow"><div class="t">${esc(a.name)}</div>
        <div class="s mono">${esc(a.id)}</div>
        <div class="s">${esc(bits)}</div>
        ${arch.topic ? `<div class="s">아카이브 ${esc(arch.topic)}</div>` : ''}</div>
      <div class="tools">
        <button class="ib" data-act="mission-admin" data-v="${esc(a.id)}" title="앱 어드민" aria-label="앱 어드민">${icon('wrench',16)}</button>
        <button class="ib" data-act="mission-edit" data-v="${esc(a.id)}" title="수정" aria-label="수정">${icon('pencil',16)}</button>
        <button class="ib ib-danger" data-act="mission-del" data-v="${esc(a.id)}" title="삭제" aria-label="삭제">${icon('trash-2',16)}</button>
      </div></div>`;
  }).join('') : `<div class="empty">연결한 앱이 없습니다.</div>`;

  return `${head}${tabline}<div class="sectionlabel">현재 연결된 미션</div>${list}`;
}

/* 미션 앱 등록, 수정 팝업. hoistory 카드 추가 폼의 칸을 그대로 옮겼다. */
function openMissionModal(app){
  const back = document.createElement('div');
  back.className = 'modal-back';
  const dis = app ? 'disabled' : '';
  const lessons = M.getLessons();
  const arch = app?.archive || {};
  let archOpen = !!(arch.topic || arch.intent || arch.content);

  back.innerHTML = `<div class="modal modal-wide" role="dialog" aria-modal="true" aria-label="미션 앱">
    <h3>${app ? '앱 수정' : '앱 추가'}</h3>
    <div class="m-form">
      <label class="m-label">제목</label><input class="f" id="ma-name" value="${esc(app?.name || '')}">
      <label class="m-label">앱 키</label><input class="f" id="ma-key" value="${esc(app?.id || '')}" ${dis}>
      <label class="m-label">웹앱 주소</label><input class="f" id="ma-su" value="${esc(app?.studentUrl || '')}">
      <label class="m-label">어드민 주소</label><input class="f" id="ma-au" value="${esc(app?.adminUrl || '')}">
      <label class="m-label">연결할 강의</label>
      <select class="sel sel-full" id="ma-lesson">
        <option value="">연결 없음</option>
        ${lessons.map(l => `<option value="${l.id}" ${l.id===app?.lessonId?'selected':''}>${esc(l.title)}</option>`).join('')}
      </select>
      <label class="m-check"><input type="checkbox" id="ma-modal" ${app?.modal?'checked':''}><span>팝업으로 열기</span></label>
      <button class="btn-chip" id="ma-arch-btn">${icon('archive',13)}아카이브 정보</button>
      <div class="m-form" id="ma-arch" ${archOpen?'':'hidden'}>
        <label class="m-label">수업 주제</label><input class="f" id="ma-topic" value="${esc(arch.topic || '')}">
        <label class="m-label">활동 의도</label><textarea class="f ta" id="ma-intent">${esc(arch.intent || '')}</textarea>
        <label class="m-label">아카이브 내용</label><textarea class="f ta" id="ma-content">${esc(arch.content || '')}</textarea>
      </div>
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
  const g = id => modal.querySelector(id);
  const submit = () => {
    const payload = {
      name: g('#ma-name').value, studentUrl: g('#ma-su').value, adminUrl: g('#ma-au').value,
      lessonId: g('#ma-lesson').value, modal: g('#ma-modal').checked,
      archive: { topic:g('#ma-topic').value.trim(), intent:g('#ma-intent').value.trim(), content:g('#ma-content').value.trim() },
    };
    try {
      if (app) M.updateMissionApp(app.id, payload);
      else M.addMissionApp({ ...payload, key:g('#ma-key').value });
      toast(app ? '앱을 저장했습니다.' : '앱을 추가했습니다.'); close(); render();
    } catch(e){ err(e.message); }
  };
  g('#ma-arch-btn').addEventListener('click', () => {
    archOpen = !archOpen; g('#ma-arch').hidden = !archOpen;
  });
  const onKey = e => { if (e.key==='Escape') close(); };
  back.addEventListener('click', e => {
    if (e.target === back){ close(); return; }
    const m = e.target.closest('[data-m]'); if (!m) return;
    if (m.dataset.m === 'ok') submit(); else close();
  });
  document.addEventListener('keydown', onKey);
}

/* ── 오늘의 질문 (hoistory/lms "생각 Check" 틀 이식) ─────────────────────────
   서브 메뉴 셋. 셋 다 과목 탭 아래에서 움직인다(선생님 지시 2026-10-28).
     질문 관리 : 깔린 강의마다 카드 하나. 주제와 질문 두 줄, 누르면 설명문이 펼쳐진다.
                 편집 버튼을 눌러야 고칠 수 있고, 토글로 오늘의 질문 칸을 통째로 끈다
     답변       : 강의를 드롭다운으로 고르고 전체, 1~n반 중 하나를 누르면 그 답변 목록이 뜬다.
                 채점이 메인이고 통과, 미흡은 인원수를 붙인 탭이다. 세 탭 모두 답변 줄을
                 그대로 보여 준다(선생님 지시 2026-10-28: 명단만 뜨면 안 된다).
                 hoistory 채점 모달(thGradeBackdrop)을 옮긴 것.
                 이탈 탭은 학생 화면에 이탈 감시가 없어 뺐다
     PICK      : 같은 고르개로 공유로 켜 둔 답변만 모아 본다(수업 중 띄우는 자리, 요구사항 73) */
function pageQuestion(){
  const tabs = catline(M.ADMIN_SUBMENUS.question, state.questionTab, 'question-tab');
  const head = `<div class="pagehead"><h2>오늘의 질문</h2></div>${tabs}`;

  const all = M.getCourses(state.year);
  if (!all.length) return head + `<div class="empty">강의실이 없습니다.</div>`;
  const subjects = [...new Set(all.map(c => c.subject))].sort((a,b) => a.localeCompare(b,'ko'));
  if (!subjects.includes(state.questionSubject)) state.questionSubject = subjects[0];
  const subTabs = catline(subjects.map(s => ({ v:s, label:s })), state.questionSubject, 'q-subject');
  const rooms = all.filter(c => c.subject === state.questionSubject)
    .slice().sort((a,b) => a.grade - b.grade || a.classNo - b.classNo);
  const { placed, lessons } = placedLessons(rooms);

  if (state.questionTab === 'manage') return head + subTabs + questionManage(lessons);
  return head + subTabs + questionAnswers(rooms, placed, lessons);
}

// 질문 관리: 강의별 카드
function questionManage(lessons){
  if (!lessons.length) return `<div class="empty">깔린 강의가 없습니다.</div>`;
  const cards = lessons.map((l, i) => {
    const q = l.parts?.question, on = !!q;
    const editing = on && state.questionEditId === l.id;
    const open = on && state.questionOpenId === l.id;
    const sw = `<button class="sw ${on?'on':''}" role="switch" aria-checked="${on}" data-act="q-enable" data-id="${l.id}"
      title="${on?'오늘의 질문 끄기':'오늘의 질문 켜기'}" aria-label="오늘의 질문 켜고 끄기"><i></i></button>`;
    const tools = `<div class="tools">
      ${on && !editing ? `<button class="ib ib-sm" data-act="q-edit-open" data-id="${l.id}" title="편집" aria-label="편집">${icon('pencil',14)}</button>` : ''}
      ${sw}</div>`;
    if (editing) return `<div class="qcard on">
      <div class="qcard-top"><div class="grow"><div class="t">${i + 1}강 ${esc(l.title)}</div></div>
        <div class="tools">
          <button class="ib ib-sm ib-primary" data-act="q-edit-save" data-id="${l.id}" title="저장" aria-label="저장">${icon('check',14)}</button>
          <button class="ib ib-sm" data-act="q-edit-cancel" title="취소" aria-label="취소">${icon('x',14)}</button>
        </div></div>
      <textarea class="f" id="q-ed-prompt" rows="2" aria-label="질문">${esc(q.prompt || '')}</textarea>
      <textarea class="f" id="q-ed-guide" rows="4" aria-label="설명문">${esc(q.guide || '')}</textarea>
    </div>`;
    return `<div class="qcard ${on?'':'off'} ${open?'open':''}">
      <div class="qcard-top">
        <div class="grow ${on?'rowlink':''}" ${on ? `data-act="q-open" data-id="${l.id}"` : ''}>
          <div class="t">${i + 1}강 ${esc(l.title)}</div>
          ${on && q.prompt ? `<div class="q">${esc(q.prompt)}</div>` : ''}
        </div>${tools}</div>
      ${open && q.guide ? `<div class="qcard-guide">${esc(q.guide)}</div>` : ''}
    </div>`;
  }).join('');
  return `<div class="qcards">${cards}</div>`;
}

/* 답변과 PICK의 고르개: 강의 드롭다운(오늘의 질문이 켜진 강의만) + 전체, 반 버튼.
   고른 반(또는 전체)의 꽂힌 강의들을 targets로 돌려준다. */
function questionAnswers(rooms, placed, lessons){
  const qLessons = lessons.map((l, i) => ({ l, no:i + 1 })).filter(x => x.l.parts?.question);
  if (!qLessons.length) return `<div class="empty">오늘의 질문이 켜진 강의가 없습니다.</div>`;
  if (!qLessons.some(x => x.l.id === state.questionLessonId)) state.questionLessonId = qLessons[0].l.id;
  const lesson = M.getLesson(state.questionLessonId);

  // 이 강의가 꽂힌 반만 버튼이 된다
  const withCl = rooms.map(c => ({ c, cl:placed[c.id].find(x => x.lessonId === lesson.id) })).filter(x => x.cl);
  if (state.questionRoom !== 'all' && !withCl.some(x => x.c.id === state.questionRoom)) state.questionRoom = 'all';
  const targets = state.questionRoom === 'all' ? withCl : withCl.filter(x => x.c.id === state.questionRoom);

  const one = targets.length === 1 && state.questionRoom !== 'all' ? targets[0].cl : null;
  const openBtn = one ? `<button class="btn-chip ${one.isOpen?'on':''}" data-act="cl-open" data-id="${one.id}">
      ${icon(one.isOpen?'eye':'eye-off',13)}${one.isOpen?'공개 중':'숨김'}</button>` : '';
  // 첫 줄: 강의 드롭다운 옆에 반 태그(선생님 지시 2026-10-28). 공개 토글은 줄 끝.
  const pickers = `<div class="qbar">
    <select class="sel sel-lesson" data-act="q-lesson" aria-label="강의">
      ${qLessons.map(x => `<option value="${x.l.id}" ${x.l.id===lesson.id?'selected':''}>${x.no}강 ${esc(x.l.title)}</option>`).join('')}
    </select>
    ${catline(withCl.map(x => ({ v:x.c.id, label:`${x.c.classNo}반` })), state.questionRoom, 'q-room', '전체',
      openBtn ? `<span class="line-end">${openBtn}</span>` : '')}</div>`;

  const q = lesson.parts.question;
  // 질문과 안내문 묶음. 아래 탭 줄과 붙어 보이지 않게 .qinfo로 간격을 둔다(선생님 지시 2026-10-28).
  const info = q.prompt ? `<div class="qinfo"><div class="row"><div class="grow"><div class="t">${esc(q.prompt)}</div>
    ${q.guide ? `<div class="s">${esc(q.guide)}</div>` : ''}</div></div></div>` : '';

  const subs = targets.flatMap(x => M.getQuestionSubs(x.cl.id));
  const byNo = (a, b) => String(a.studentNo).localeCompare(String(b.studentNo), undefined, { numeric:true });

  if (state.questionTab === 'pick'){
    const picked = subs.filter(s => s.shared).sort(byNo);
    const body = picked.length ? picked.map(s => `<div class="row">
      <div class="grow"><div class="t"><span class="mono">${esc(s.studentNo)}</span> &nbsp;${esc(s.name)}</div>
        <div class="s">${esc(s.answer)}</div></div>
      <div class="tools">
        <button class="ib ib-sm ib-primary" data-act="q-share" data-id="${s.id}" title="공개 내리기" aria-label="공개 내리기">${icon('eye',14)}</button>
      </div></div>`).join('') : `<div class="empty">공유로 켜 둔 답변이 없습니다.</div>`;
    return pickers + info + `<div class="sectionlabel">PICK (${picked.length})</div>` + body;
  }

  return pickers + info + questionGrade(targets, subs, one);
}

/* 채점 본문: hoistory 채점 모달(thUpdateGradeSummary, thRenderGradeBody)을 옮긴 것.
   판정은 언제나 M.questionVerdict 하나로 한다. 성적의 자동 끌어오기도 같은 함수를 쓰므로
   여기서 누른 통과/미흡과 AI 채점 결과가 성적에 그대로 이어진다.
   미흡 인원에는 미제출이 들어간다(hoistory와 같다).
   세 탭(채점, 통과, 미흡)이 모두 같은 답변 줄(answerRow)을 쓴다: 통과와 미흡에서 명단만
   보이던 것을 선생님 지시로 고쳤다(2026-10-28). 미제출 학생만 답변 없이 이름 줄로 선다. */
function answerRow(s, v){
  const res = s.graded
    ? `<span class="gnote ${v.achieved ? '' : 'bad'}">${esc(s.aiVerdict || '')} / ${s.aiPt ?? 0}pt</span>`
    : `<span class="gnote muted">미채점</span>`;
  return `<div class="row">
    <div class="grow"><div class="t"><span class="mono">${esc(s.studentNo)}</span> &nbsp;${esc(s.name)}${res}
        <span class="gsub">${v.length}자</span></div>
      <div class="s">${esc(s.answer)}</div></div>
    <div class="tools">
      <button class="btn-chip ${v.achieved?'on':''}" data-act="q-verdict" data-id="${s.id}" data-v="pass">통과</button>
      <button class="btn-chip ${v.achieved?'':'on'}" data-act="q-verdict" data-id="${s.id}" data-v="fail">미흡</button>
      <button class="ib ib-sm ${s.shared?'ib-primary':''}" data-act="q-share" data-id="${s.id}" title="${s.shared?'공개 중 (누르면 숨김)':'숨김 (누르면 공개)'}" aria-label="공개 전환">${icon('eye',14)}</button>
    </div></div>`;
}
// 미제출 학생 줄: 답변이 없어 통과, 미흡 버튼도 달지 않는다.
function absentRow(st){
  return `<div class="row">
    <div class="grow"><div class="t"><span class="mono">${esc(st.studentNo)}</span> &nbsp;${esc(st.name)}
      <span class="gnote muted">미제출</span></div></div></div>`;
}
function questionGrade(targets, subs, one){
  const byNo = (a, b) => String(a.studentNo).localeCompare(String(b.studentNo), undefined, { numeric:true });
  const absent = targets.flatMap(({ c, cl }) => {
    const done = new Set(M.getQuestionSubs(cl.id).map(s => s.studentNo));
    return M.getStudentsByCourse(c.id).filter(st => !done.has(st.studentNo));
  }).sort(byNo);
  const judged = subs.map(s => ({ s, v:M.questionVerdict(s) })).sort((a,b) => byNo(a.s, b.s));
  const failing = judged.filter(x => !x.v.achieved);
  const passing = judged.filter(x => x.v.achieved);

  // 셋째 줄: 채점, 통과, 미흡 탭과 AI 채점, 재채점 버튼을 한 줄에(선생님 지시 2026-10-28).
  const ungraded = subs.filter(s => !s.graded).length, graded = subs.length - ungraded;
  const busy = state.questionAiBusy;
  const actions = `<span class="line-end">
      ${state.questionAiStatus ? `<span class="gnote">${esc(state.questionAiStatus)}</span>` : ''}
      <button class="btn-chip" data-act="q-ai-run" ${ungraded && !busy ? '' : 'disabled'}>${icon('sparkles',13)}AI 채점${ungraded ? ` (미채점 ${ungraded})` : ''}</button>
      ${graded ? `<button class="btn-chip" data-act="q-ai-regrade" ${busy ? 'disabled' : ''}>${icon('rotate-ccw',13)}재채점 (${graded}명)</button>` : ''}
      ${one ? `<button class="btn-chip" data-act="q-go-scores" data-id="${one.id}">${icon('trophy',13)}성적 입력으로</button>` : ''}
    </span>`;
  const gtabs = catline([
    { v:'grade', label:'채점' },
    { v:'pass',  label:`통과 (${passing.length})` },
    { v:'fail',  label:`미흡 (${absent.length + failing.length})` },
  ], state.questionGradeTab, 'q-gtab', null, actions, 'gtabs');

  let body;
  if (state.questionGradeTab === 'pass'){
    body = passing.length
      ? passing.map(({ s, v }) => answerRow(s, v)).join('')
      : `<div class="empty">통과한 학생이 없습니다.</div>`;
  } else if (state.questionGradeTab === 'fail'){
    // 미흡 사유별로 묶는다(hoistory: 미제출, 50자 미만, AI 분석 미흡).
    const groups = [
      ['미제출', absent.map(st => absentRow(st))],
      ['50자 미만', failing.filter(x => x.v.verdict === '미흡(50자 미만)').map(({ s, v }) => answerRow(s, v))],
      ['AI 채점 미흡', failing.filter(x => x.v.verdict === '조금 미흡').map(({ s, v }) => answerRow(s, v))],
      ['선생님 미흡', failing.filter(x => x.v.verdict === '미흡(교사)').map(({ s, v }) => answerRow(s, v))],
    ].filter(g => g[1].length);
    body = groups.length
      ? groups.map(([label, rows]) => `<div class="sectionlabel">${label} (${rows.length})</div>${rows.join('')}`).join('')
      : `<div class="empty">미흡 학생이 없습니다.</div>`;
  } else {
    body = judged.length
      ? judged.map(({ s, v }) => answerRow(s, v)).join('')
      : `<div class="empty">제출된 답변이 없습니다.</div>`;
  }
  return gtabs + body;
}

// 지금 고른 강의와 반(또는 전체)의 꽂힌 강의 id들. AI 채점이 이 단위로 돈다.
function questionTargetClIds(){
  const rooms = M.getCourses(state.year).filter(c => c.subject === state.questionSubject
    && (state.questionRoom === 'all' || c.id === state.questionRoom));
  return rooms.map(c => M.getCourseLessons(c.id).find(cl => cl.lessonId === state.questionLessonId)?.id).filter(Boolean);
}

// AI 채점과 재채점: 반마다 차례로 돈다. 끝나면 다시 그린다. 진행 문구는 버튼 줄 옆에 뜬다.
async function runQuestionAI(regrade){
  const clIds = questionTargetClIds(); if (!clIds.length || state.questionAiBusy) return;
  if (regrade){
    const n = clIds.reduce((t, id) => t + M.getQuestionSubs(id).filter(s => s.graded).length, 0);
    const ok = await confirmDelete({ title:'재채점',
      bodyHtml:`${n}명의 채점과 손으로 정한 통과, 미흡을 지우고 다시 채점합니다.`, okText:'재채점' });
    if (!ok) return;
  }
  state.questionAiBusy = true; render();
  const onStatus = msg => { state.questionAiStatus = msg; render(); };
  let n = 0;
  try {
    for (const id of clIds) n += await (regrade ? M.regradeQuestionsAI : M.gradeQuestionsAI)(id, onStatus);
    toast(`${n}명을 채점했습니다.`);
  } catch(e){ toast(e.message || '채점하지 못했습니다.'); }
  state.questionAiBusy = false; state.questionAiStatus = ''; render();
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

/* ── 일반 설정 (선생님 지시 2026-10-28) ──
   화면 문구를 코드에 박지 않고 여기서 직접 심고 바꾼다(model.js의 TEXT_FIELDS 규칙 참고).
   비워 두면 기본값이 그대로 쓰인다. 칸마다 따로 저장하지 않고 저장 버튼 하나로 한 번에 쓴다. */
function pageGeneral(){
  const groups = M.TEXT_FIELDS.map(g => `
    <div class="sectionlabel">${esc(g.group)}</div>
    ${g.items.map(f => `<div class="row">
      <div class="grow"><div class="t">${esc(f.label)}</div></div>
      <input class="f w-lg" data-text-key="${f.key}" value="${esc(M.getText(f.key))}">
    </div>`).join('')}`).join('');
  return `<div class="pagehead"><h2>일반 설정</h2>
      <button class="btn-add" data-act="general-save" title="저장" aria-label="저장">${icon('check',16)}<span>저장</span></button></div>
    ${groups}`;
}

// ── 렌더 ──
function render(){
  renderSide();
  const p = { rooms:pageRooms, students:pageStudents, progress:pageProgress,
              concept:pageConcept, mission:pageMission, question:pageQuestion, formative:pageFormative,
              scores:pageScores, general:pageGeneral }[state.page];
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
      state.conceptLessonId = null; state.formativeLessonId = null; render(); break;
    case 'set-year': state.year = +v; state.editRoomId = null; render(); break;
    case 'set-subject': state.fSubject = v; render(); break;
    case 'set-class': state.fClass = v === 'all' ? null : v; render(); break;
    case 'room-group': state.roomGroup = v; render(); break;
    case 'prog-subject': state.progSubject = v; render(); break;
    case 'set-sclass': state.studentClass = v; render(); break;

    case 'add-open': openAddModal(); break;

    // 강의실 상세(요구사항 6): 줄 아래로 펼침/접음. 같은 줄을 다시 누르면 닫는다.
    case 'room-open':
      // 넓은 화면에서는 고르기만 한다(오른쪽 상세가 늘 하나 떠 있다).
      state.roomDetailId = (!WIDE.matches && state.roomDetailId === id) ? null : id;
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
    // 강의실 상세에서 건너올 때는 그 강의실의 과목 탭이 열려 있게 한다.
    case 'go-progress':
      state.page = 'progress'; state.progSubject = M.getCourse(id)?.subject ?? null;
      state.roomDetailId = null; render(); break;
    case 'go-lessons':
      state.page = 'concept'; state.conceptTab = 'library'; state.roomDetailId = null; state.lessonId = null; render(); break;
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
        d.subs     ? `제출물과 성적 ${d.subs}건` : '',
      ].filter(Boolean);
      confirmDelete({
        title: `${name} 강의실 삭제`,
        // 목록 끝 낱말이 무엇이냐에 따라 조사가 달라지므로 아예 조사를 쓰지 않는다
        bodyHtml: (gone.length
          ? `같이 없어지는 것: ${gone.join(', ')}.<ul><li>강의 내용 자체는 창고에 남습니다</li></ul>`
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
      state.studentDetailNo = (!WIDE.matches && state.studentDetailNo === no) ? null : no; render(); break;
    case 'stu-reset': toast('비밀번호 초기화는 다음 단계에서 만듭니다.'); break;
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
    case 'lesson-import': toast('활동지 올리기와 개념 노트 변환은 다음 단계에서 만듭니다.'); break;
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

    // 미션 활동: 앱 어드민을 같은 창 안의 탭으로 열고 닫는다
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
    case 'question-tab': state.questionTab = v; render(); break;
    case 'q-subject':
      state.questionSubject = v; state.questionLessonId = null; state.questionRoom = 'all';
      state.questionOpenId = null; state.questionEditId = null; render(); break;
    case 'q-room': state.questionRoom = v; render(); break;
    case 'q-gtab': state.questionGradeTab = v; render(); break;
    case 'q-open': state.questionOpenId = state.questionOpenId === id ? null : id; render(); break;
    case 'q-enable': {   // 오늘의 질문 켜고 끄기(끄면 그 강의에서 그 칸이 빠진다)
      const on = !M.getLesson(id)?.parts?.question;
      M.setQuestionEnabled(id, on);
      if (!on && state.questionEditId === id) state.questionEditId = null;
      render(); break;
    }
    case 'q-edit-open': state.questionEditId = id; render(); break;
    case 'q-edit-cancel': state.questionEditId = null; render(); break;
    case 'q-edit-save':
      run(() => { M.setQuestion(id, { prompt:val('q-ed-prompt'), guide:val('q-ed-guide') }); state.questionEditId = null; }, '저장했습니다.');
      break;
    case 'q-ai-run': runQuestionAI(false); break;
    case 'q-ai-regrade': runQuestionAI(true); break;
    case 'q-go-scores': {   // hoistory "성적 체크로": 같은 강의실, 같은 강의의 성적 입력으로
      const cl = M.getCourseLessons(state.questionRoom).find(x => x.id === id);
      Object.assign(state, { page:'scores', scTab:'input', scSubject:state.questionSubject,
                             scCourseId:state.questionRoom, scClId:cl?.id ?? null });
      render(); break;
    }
    case 'q-share': M.toggleSubShared(id); render(); break;
    // 통과/미흡을 손으로 못박는다(같은 것을 다시 누르면 자동 판정으로 되돌아간다)
    case 'q-verdict': M.setSubVerdict(id, v); render(); break;

    // 형성평가
    case 'fm-open': state.formativeLessonId = id; render(); break;
    case 'fm-close': state.formativeLessonId = null; render(); break;
    case 'fm-add': toast(`${M.formativeTypeDef(k)?.name || ''} 문항 만들기는 다음 단계.`); break;

    // 성적
    case 'sc-tab': state.scTab = v; state.scOpenNo = null; render(); break;
    case 'sc-room': state.scCourseId = v; state.scClId = null; state.scOpenNo = null; render(); break;
    case 'sc-open': state.scOpenNo = state.scOpenNo === no ? null : no; render(); break;
    // 이름을 누르면 결석(전부 미달성 고정). hoistory와 같다.
    case 'sc-absent': run(() => M.toggleGradeAbsent(id, no)); break;
    // 제출물에서 달성과 기한을 끌어온다. 손으로 정한 칸과 결석 학생은 건드리지 않는다.
    case 'sc-auto': {
      const r = run(() => M.applyAutoDetect(id));
      if (r) toast(r.touched ? `${r.touched}명을 끌어왔습니다.` : '새로 끌어올 것이 없습니다.');
      break;
    }
    case 'sc-publish': {
      const cl = M.toggleGradePublished(id);
      toast(cl?.gradePublished ? '이 반에 성적을 반영했습니다.' : '성적 반영을 내렸습니다.');
      render(); break;
    }
    // 영역 머리줄의 스위치: 그 강의의 그 칸을 켜고 끈다(그 강의를 꽂은 모든 강의실 공통).
    case 'sc-part-enable': {
      const lid = el.dataset.lid;
      const on = !M.getLesson(lid)?.parts?.[k];
      M.setPartEnabled(lid, k, on);
      toast(`${M.partDef(k)?.name || ''}을 ${on ? '활성화' : '비활성화'}했습니다.`);
      render(); break;
    }
    // 피드백 템플릿 저장(한 줄에 하나). 급간 표와 같은 settings/grade 문서에 들어간다.
    case 'sc-fb-save': {
      M.setFeedbackTemplates(document.getElementById('sc-fb-tmpl')?.value ?? '');
      M.saveGradeConfig()
        .then(() => { toast('저장했습니다.'); render(); })
        .catch(() => toast('저장하지 못했습니다. 다시 시도해 주세요.'));
      break;
    }
    // 급간 표와 반영 강의 목록을 한 번에 쓴다(일반 설정의 저장 버튼과 같은 방식).
    case 'sc-config-save': {
      const bands = M.getBands().map((b, i) => {
        const out = { min:b.min };
        M.GRADE_AREAS.forEach(a => {
          out[a.key] = document.querySelector(`[data-band="${i}"][data-k="${a.key}"]`)?.value ?? b[a.key];
        });
        return out;
      });
      M.saveGradeConfig(bands)
        .then(() => { toast('저장했습니다.'); render(); })
        .catch(() => toast('저장하지 못했습니다. 다시 시도해 주세요.'));
      break;
    }

    // 진도 관리 (hoistory 진도 계획 틀)
    case 'prog-add-open': state.progAdding = true; render();
      document.getElementById('prog-new-title')?.focus(); break;
    case 'prog-add-cancel': state.progAdding = false; render(); break;
    case 'prog-add-save': {
      const t = val('prog-new-title');
      const r = run(() => M.addLessonToSubject(state.year, state.progSubject, t));
      if (r){ state.progAdding = false; toast(`${state.progSubject} 강의실 ${r.rooms}개에 꽂았습니다.`); render(); }
      break;
    }
    case 'prog-place': {   // 그 반에만 빠져 있던 강의를 꽂는다
      M.placeLesson(id, el.dataset.lid); render(); break;
    }
    case 'prog-del': {
      const l = M.getLesson(el.dataset.lid); if (!l) break;
      confirmDelete({
        title: `${l.title} 빼기`,
        bodyHtml: `${esc(state.progSubject)} 강의실 전부에서 이 줄을 뺍니다. 그 강의의 성적 기록과 제출물도 같이 없어집니다.`
          + `<ul><li>강의 내용 자체는 창고에 남습니다</li></ul>`,
        okText: '빼기',
      }).then(ok => { if (!ok) return;
        const n = M.removeLessonFromSubject(state.year, state.progSubject, l.id);
        toast(`강의실 ${n}개에서 뺐습니다.`); render(); });
      break;
    }

    // 일반 설정: 칸마다 따로 안 쓰고 저장 버튼을 누를 때 전부 한 번에 쓴다.
    case 'general-save': {
      const patch = {};
      document.querySelectorAll('[data-text-key]').forEach(inp => { patch[inp.dataset.textKey] = inp.value; });
      M.setTexts(patch)
        .then(() => toast('저장했습니다.'))
        .catch(() => toast('저장하지 못했습니다. 다시 시도해 주세요.'));
      break;
    }

    case 'logout': signOut(auth); break;   // onAuthStateChanged가 로그인 화면으로 되돌린다

    case 'noop': toast('다음 단계에서 만듭니다.'); break;
  }
});

/* 드롭다운(학년도 고르개)은 click이 아니라 change로 받는다. */
document.getElementById('shell').addEventListener('change', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.dataset.act === 'year-pick'){
    state.year = +el.value; state.fSubject = null; state.editRoomId = null;
    state.roomDetailId = null; state.studentDetailNo = null;
    state.scCourseId = null; state.scOpenNo = null;
    state.roomStudentEdit = false; state.roomStuSel = new Set(); render();
  } else if (el.dataset.act === 'cl-date'){   // 수업일자 저장(진도 관리와 강의 진도가 같이 맞물림)
    M.setCourseLessonDate(el.dataset.id, el.value); render();
  } else if (el.dataset.act === 'prog-sch'){   // 반별 수업 요일(진도표 머리줄)
    M.setCourseSchedule(el.dataset.id, el.value);
  } else if (el.dataset.act === 'prog-topic'){   // 진도표의 주제 = 강의 제목
    run(() => M.setLessonTitle(el.dataset.lid, el.value));
  } else if (el.dataset.act === 'sc-subject-pick'){   // 성적: 머리줄의 과목 드롭다운
    state.scSubject = el.value; state.scCourseId = null; state.scClId = null; state.scOpenNo = null; render();
  } else if (el.dataset.act === 'sc-lesson'){   // 성적 입력: 채점할 강의
    state.scClId = el.value; render();
  } else if (el.dataset.act === 'sc-cell'){   // 달성, 기한 칸 하나
    const n = el.checked ? (+el.dataset.i + 1) : (+el.dataset.i);
    run(() => M.setGradeCell(el.dataset.id, el.dataset.no, el.dataset.k, el.dataset.f, n));
  } else if (el.dataset.act === 'sc-row-all'){   // 이름 앞 체크: 그 학생의 실시 중인 칸 전부
    run(() => M.setGradeRowAll(el.dataset.id, el.dataset.no, el.checked));
  } else if (el.dataset.act === 'sc-col-all'){   // 머리줄 체크: 그 열의 모든 학생을 한 번에
    const nos = M.getStudentsByCourse(state.scCourseId).map(s => s.studentNo);
    run(() => M.setGradeColAll(el.dataset.id, nos, el.dataset.k, el.dataset.f, el.checked));
  } else if (el.dataset.act === 'sc-fb-pick'){   // 피드백 템플릿을 고르면 그 글이 칸에 들어간다
    const t = M.getFeedbackTemplates()[+el.value];
    if (t == null){ el.value = ''; return; }
    M.setGradeFeedback(el.dataset.id, el.dataset.no, t);
    render();
  } else if (el.dataset.act === 'sc-feedback'){
    M.setGradeFeedback(el.dataset.id, el.dataset.no, el.value);
  } else if (el.dataset.act === 'sc-pick-lesson'){   // 성적에 반영할 강의 목록
    M.toggleGradeLesson(el.dataset.lid, el.checked);
    M.saveGradeConfig().catch(() => toast('저장하지 못했습니다. 다시 시도해 주세요.'));
    render();
  } else if (el.dataset.act === 'stu-sel'){   // 명단 편집 모드에서 한 명 고르고 풀기
    if (el.checked) state.roomStuSel.add(el.dataset.no); else state.roomStuSel.delete(el.dataset.no);
    render();
  } else if (el.dataset.act === 'stu-sel-all'){
    const c = M.getCourse(state.roomDetailId);
    const nos = c ? M.getStudentsByCourse(c.id).map(s => s.studentNo) : [];
    state.roomStuSel = el.checked ? new Set(nos) : new Set();
    render();
  } else if (el.dataset.act === 'q-lesson'){   // 오늘의 질문: 답변을 모아 볼 강의
    state.questionLessonId = el.value; render();
  } else if (el.dataset.act === 'ce-edit'){   // 개념 콘텐츠 줄: 포커스 빠질 때 저장(다시 그리지 않아 커서 유지)
    M.conceptSetLine(el.dataset.id, +el.dataset.k, el.value);
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

/* 학번 검색: 치는 대로 목록을 다시 그린다. 다시 그리면 칸이 새로 생기므로 커서를 되살린다. */
document.getElementById('shell').addEventListener('input', e => {
  if (e.target.dataset.act !== 'stu-search') return;
  state.studentQuery = e.target.value;
  const pos = e.target.selectionStart;
  render();
  const box = document.getElementById('stu-search');
  if (box){ box.focus(); box.setSelectionRange(pos, pos); }
});

/* 인라인 폼에서 엔터를 치면 그 줄의 주 버튼을 누른 것으로 본다.
   줄마다 핸들러를 달지 않도록 같은 묶음 안의 .btn-text 또는 .ib-primary를 찾는다. */
document.getElementById('shell').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
  const btn = e.target.closest('.formrow, .row, .catline')?.querySelector('.btn-text, .ib-primary');
  if (btn){ e.preventDefault(); btn.click(); }
});

boot();
