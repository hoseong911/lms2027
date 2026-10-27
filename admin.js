// 2027 LMS 어드민 — 제로베이스 뼈대 (2026-10-26)
// 왼쪽 메뉴 5개(강의실 관리 / 학생 관리 / 강의 라이브러리 / 복습 / 채점·공유).
// 조직 원리: 강의실은 강의(차시)와 복습을 담고, 강의 하나는 개념노트/미션/질문노트/형성평가
//           네 칸을 각각 있거나 없거나로 채운다(순서 자유).
// 지금은 데모 데이터(model.js)로 돈다. 규칙: data-act + 위임, 상태는 state 하나,
// 알약 금지, 태그/카테고리는 구분선, 액션은 아이콘 버튼, 숫자 칸은 text+inputmode.

import * as M from './model.js';
import { icon } from './shared/icons.js';

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
  editRoomId: null,                // 그 자리에서 고치는 중인 강의실
  studentClass: 'all',             // 학생 관리 반 필터(roomNo)
  lessonId: null, lessonTab: 'edit',
  gradingType: 'question',
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
  document.getElementById('shell').hidden = false;
  if (!document.getElementById('toast')){
    const t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t);
  }
  render();
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
      ${icon(m.icon,18)}<span>${esc(m.name)}</span></div>`).join('');
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
      <div class="empty">학년도가 없습니다. 오른쪽 위 추가에서 학년도를 먼저 만드세요.</div>`;

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
    rowsHtml = `<div class="empty">강의실이 없습니다. 오른쪽 위 추가에서 만드세요.</div>`;
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

  // ── 오른쪽: 학생 명단 ──
  const stuRows = students.length ? students.map(s => {
    const open = state.openScore === `${c.id}_${s.studentNo}`;
    const row = `<div class="row compact rowlink" data-act="stu-score" data-no="${s.studentNo}" data-id="${c.id}">
      <div class="grow"><div class="t"><span class="chev">${icon(open?'chevron-down':'chevron-right',14)}</span><span class="mono">${esc(s.studentNo)}</span> &nbsp;${esc(s.name)}</div></div></div>`;
    return open ? row + studentCard(c.id, s.studentNo) : row;
  }).join('') : `<div class="empty">학생이 없습니다.</div>`;
  const right = `<div class="dcol">
    <div class="sectionlabel between">학생 명단<button class="btn-link" data-act="go-students" data-id="${c.id}">학생 관리</button></div>
    ${stuRows}</div>`;

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
    <div class="prog-hint">칸에 수업일자를 'M/D'로 적습니다. 강의실 관리의 강의 진도와 같이 맞물립니다.</div>
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
          <div class="m-hint">${state.year}학년도에 만듭니다.</div>
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
function pageStudents(){
  const all = M.getStudentsByYear(state.year);
  // 학번 앞 세 자리(roomNo)로 묶기
  const byRoom = {};
  all.forEach(s => { const r = s.studentNo.slice(0,3); (byRoom[r] ||= new Set()).add(s.studentNo); });
  const roomNos = Object.keys(byRoom).sort();
  const cats = roomNos.map(r => ({ v:r, label:`${r} (${byRoom[r].size})` }));

  let snos = roomNos.flatMap(r => [...byRoom[r]]);
  if (state.studentClass !== 'all') snos = [...(byRoom[state.studentClass] || [])];
  snos = [...new Set(snos)].sort();

  const addForm = `<div class="formrow">
    <input class="f w-sm" id="s-grade" inputmode="numeric" placeholder="학년"><span class="unit">학년</span>
    <input class="f w-sm" id="s-class" inputmode="numeric" placeholder="반"><span class="unit">반</span>
    <input class="f w-sm" id="s-no" inputmode="numeric" placeholder="번호"><span class="unit">번</span>
    <input class="f grow" id="s-name" placeholder="이름">
    <button class="btn-text" data-act="stu-add">학생 추가</button>
  </div>
  <div class="formrow">
    <div class="grow"><div class="t">엑셀 명단 올리기</div></div>
    <button class="ib ib-primary" data-act="stu-upload" title="업로드" aria-label="업로드">${icon('upload',16)}</button>
  </div>`;

  const list = snos.length ? snos.map(sno => {
    const recs = all.filter(s => s.studentNo === sno);
    const name = recs[0]?.name || '';
    const badges = recs.map(r => `<span class="badge">${esc(M.roomName(M.getCourse(r.courseId)))}</span>`).join(' ');
    return `<div class="row">
      <div class="grow"><div class="t"><span class="mono">${esc(sno)}</span> &nbsp;${esc(name)}</div>
        <div class="s">${badges}</div></div>
      <div class="tools">
        <button class="ib" data-act="stu-edit" data-no="${sno}" title="수정" aria-label="수정">${icon('pencil',16)}</button>
        <button class="ib" data-act="stu-reset" data-no="${sno}" title="비밀번호 초기화" aria-label="비밀번호 초기화">${icon('rotate-ccw',16)}</button>
        <button class="ib ib-danger" data-act="stu-del" data-no="${sno}" title="삭제" aria-label="삭제">${icon('trash-2',16)}</button>
      </div></div>`;
  }).join('') : `<div class="empty">학생이 없습니다.</div>`;

  return `<div class="pagehead"><h2>학생 관리</h2></div>
    ${catline(M.getYears().map(y => ({ v:y.year, label:`${y.year}` })), state.year, 'set-year')}
    ${catline(cats, state.studentClass, 'set-sclass', '전체')}
    ${addForm}${list}`;
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

// ── 복습 ──
function pageReview(){
  const list = M.getQuizzes().map(q => `<div class="row">
    <div class="grow"><div class="t">${esc(q.title)}</div>
      <div class="s">${q.source === 'auto' ? '자동 생성' : '외부 문제'} (성적 무관)</div></div>
    <div class="tools"><button class="ib" data-act="noop" title="수정" aria-label="수정">${icon('pencil',16)}</button></div>
  </div>`).join('');
  return `<div class="pagehead"><h2>복습</h2></div>
    <div class="formrow"><input class="f grow" placeholder="새 복습 퀴즈 제목"><button class="btn-text" data-act="noop">만들기</button></div>
    ${list}`;
}

// ── 채점, 공유 ──
function pageGrading(){
  const types = M.PART_TYPES.filter(p => p.submits).map(p => ({ v:p.key, label:p.name }));
  const line = catline(types, state.gradingType, 'set-gtype');
  return `<div class="pagehead"><h2>채점, 공유</h2></div>${line}
    <div class="placeholder">${esc(M.partDef(state.gradingType)?.name || '')} 제출물이 강의실/강의별로 여기 모입니다.<br>
      AI 1차 채점, 잘한 것 공유, 아카이브. (뼈대 — 다음 단계)</div>`;
}

// ── 렌더 ──
function render(){
  renderSide();
  const p = { rooms:pageRooms, students:pageStudents, lessons:pageLessons, progress:pageProgress, review:pageReview, grading:pageGrading }[state.page];
  $main.innerHTML = p ? p() : '';
}

// ── 이벤트 위임 ──
document.getElementById('shell').addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, k = el.dataset.k, id = el.dataset.id, v = el.dataset.v, no = el.dataset.no;
  switch (act){
    case 'page': state.page = k; state.lessonId = null; state.editRoomId = null; state.roomDetailId = null; render(); break;
    case 'set-year': state.year = +v; state.editRoomId = null; render(); break;
    case 'set-subject': state.fSubject = v; render(); break;
    case 'set-class': state.fClass = v === 'all' ? null : v; render(); break;
    case 'room-group': state.roomGroup = v; render(); break;
    case 'set-sclass': state.studentClass = v; render(); break;
    case 'set-gtype': state.gradingType = v; render(); break;

    case 'add-open': openAddModal(); break;

    // 강의실 상세(요구사항 6) — 줄 아래로 펼침/접음. 같은 줄을 다시 누르면 닫는다.
    case 'room-open':
      state.roomDetailId = state.roomDetailId === id ? null : id;
      state.openScore = null; state.editRoomId = null; state.roomLessonsMore = false; render(); break;
    case 'room-lessons-more': state.roomLessonsMore = true; render(); break;
    case 'cl-open': M.toggleCourseLessonOpen(id); render(); break;   // 공개 토글(진도 관리와 같이 맞물림)
    case 'stu-score': {
      const key = `${id}_${no}`;
      state.openScore = state.openScore === key ? null : key; render(); break;
    }
    case 'go-progress': state.page = 'progress'; state.roomDetailId = null; render(); break;
    case 'go-lessons': state.page = 'lessons'; state.roomDetailId = null; state.lessonId = null; render(); break;
    case 'go-students': state.page = 'students'; state.studentClass = M.roomNo(M.getCourse(id)); state.roomDetailId = null; render(); break;
    case 'go-grading': state.page = 'grading'; state.roomDetailId = null; render(); break;

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

    case 'stu-add': {
      const grade = val('s-grade'), classNo = val('s-class'), n = val('s-no'), name = val('s-name');
      if (!grade || !classNo || !n || !name){ toast('학년, 반, 번호, 이름을 적어 주세요.'); return; }
      const studentNo = `${grade}${String(classNo).padStart(2,'0')}${String(n).padStart(2,'0')}`;
      const { rooms, added } = M.addStudent({ year:state.year, grade, classNo, studentNo, name });
      if (!rooms.length){ toast('그 반으로 만든 강의실이 없습니다. 먼저 강의실을 만드세요.'); return; }
      toast(`${name}(${studentNo})을 ${added.length}개 강의실에 등록했습니다.`); render(); break;
    }
    case 'stu-upload': toast('엑셀 올리기 — 뼈대(다음 단계).'); break;
    case 'stu-edit': case 'stu-reset': toast('뼈대 — 다음 단계에서 붙입니다.'); break;
    case 'stu-del': M.removeStudentEverywhere(state.year, no); toast('삭제했습니다.'); render(); break;

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
    case 'noop': toast('뼈대 — 다음 단계.'); break;
  }
});

/* 드롭다운(학년도 고르개)은 click이 아니라 change로 받는다. */
document.getElementById('shell').addEventListener('change', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.dataset.act === 'year-pick'){
    state.year = +el.value; state.fSubject = null; state.editRoomId = null; state.roomDetailId = null; render();
  } else if (el.dataset.act === 'cl-date'){   // 수업일자 저장(진도 관리와 강의 진도가 같이 맞물림)
    M.setCourseLessonDate(el.dataset.id, el.value); render();
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
