// 2027 LMS 학생 화면 — 제로베이스 뼈대 (2026-10-26)
// 로그인 → 강의실 고르기 → 강의실(강의 목록·복습·내 성적) → 강의 뷰어(칸 넘기기).
// 지금은 데모 데이터로 돈다(model.js). 로그인도 데모: 학번만 맞으면 입장.
// 규칙: 인라인 onclick/window 노출 없이 data-act + 이벤트 위임. 상태는 state 하나.

import * as M from './model.js';
import { icon } from './shared/icons.js';

const YEAR = 2027;
const $app = document.getElementById('app');

const state = {
  view: 'login',
  sno: '', name: '',
  courseId: null,
  lessonId: null,
  partKey: null,
};

// ── 부트 가드 ──
function boot(){
  const ok = getComputedStyle(document.documentElement).getPropertyValue('--lms-css-ok').trim() === '1';
  if (!ok){ document.getElementById('boot').textContent = '화면을 불러오지 못했습니다. 새로고침해 주세요.'; return; }
  document.documentElement.classList.add('lms-ready');
  $app.hidden = false;
  render();
}

// ── 공통 조각 ──
const partColor = k => `var(--${k})`;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function topbar(title, backAct){
  return `<div class="topbar">
    ${backAct ? `<button class="iconbtn" data-act="${backAct}" aria-label="뒤로" title="뒤로">${icon('chevron-left',20)}</button>` : ''}
    <h1>${esc(title)}</h1>
    ${state.sno ? `<span class="who">${esc(state.name)} · ${esc(state.sno)}</span>
      <button class="iconbtn" data-act="logout" aria-label="로그아웃" title="로그아웃">${icon('log-out',18)}</button>` : ''}
  </div>`;
}

// ── 화면들 ──
function viewLogin(){
  return `<div class="login">
    <h1>2027</h1>
    <p class="lead">Dive into HISTORY</p>
    <input class="field" id="f-sno" inputmode="numeric" placeholder="학번 (숫자 입력)" value="30101">
    <input class="field" id="f-name" placeholder="이름" value="홍길동">
    <input class="field" id="f-pw" type="password" placeholder="비밀번호">
    <button class="primary" data-act="login">입장하기</button>
    <p class="hint">데모 — 학번 30101·30102·30103으로 입장해 보세요.</p>
  </div>`;
}

function viewRooms(){
  const rooms = M.getCoursesOfStudent(YEAR, state.sno);
  const body = rooms.length
    ? rooms.map(c => `<div class="card" data-act="open-room" data-id="${c.id}">
        <span class="ic" style="background:var(--concept)">${icon('graduation-cap',20)}</span>
        <div class="body"><div class="t">${esc(M.roomName(c))}</div>
          <div class="s">${c.grade}학년 ${c.classNo}반</div></div>
        <span class="chev">${icon('chevron-left',18,'')}</span></div>`).join('')
    : `<div class="empty">든 강의실이 없습니다.</div>`;
  return topbar('강의실 고르기') + `<div class="sectionlabel">내 강의실</div>` + body;
}

function viewHome(){
  const c = M.getCourse(state.courseId);
  const cls = M.getCourseLessons(state.courseId).filter(cl => cl.isOpen && cl.lesson);
  const lessons = cls.map(cl => {
    const tags = (cl.lesson.order || []).map(k => `<span class="tag">${esc(M.partDef(k)?.name || k)}</span>`).join('');
    return `<div class="card" data-act="open-lesson" data-cl="${cl.id}" data-lid="${cl.lessonId}">
      <span class="ic" style="background:var(--concept)">${icon('book-open',20)}</span>
      <div class="body"><div class="t">${esc(cl.lesson.title)}</div><div class="tags">${tags}</div></div>
      <span class="chev">${icon('chevron-left',18)}</span></div>`;
  }).join('') || `<div class="empty">열린 강의가 없습니다.</div>`;

  const review = `<div class="card" data-act="open-review">
    <span class="ic" style="background:var(--review)">${icon('list-ordered',20)}</span>
    <div class="body"><div class="t">복습</div><div class="s">퀴즈로 복습하기</div></div>
    <span class="chev">${icon('chevron-left',18)}</span></div>`;

  return topbar(M.roomName(c), 'back-rooms')
    + `<div class="sectionlabel">강의</div>` + lessons
    + `<div class="sectionlabel">복습</div>` + review
    + `<div class="sectionlabel">내 성적</div>` + scoreCard(c);
}

function scoreCard(c){
  const s = M.getScore(c.id, state.sno);
  const parts = M.PART_TYPES.filter(p => p.portfolio);
  let total = 0, maxTotal = 0;
  const rows = parts.map(p => {
    const v = s?.items?.[p.key], mx = s?.max?.[p.key];
    if (typeof v === 'number'){ total += v; maxTotal += (mx || 0); }
    const val = typeof v === 'number' ? `${v}${mx ? ' / ' + mx : ''}` : '—';
    return `<div class="row"><span>${esc(p.name)}</span><b>${val}</b></div>`;
  }).join('');
  return `<div class="score"><div class="h">실시간 성적</div>${rows}
    <div class="row total"><span>최종</span><b>${maxTotal ? total + ' / ' + maxTotal : total}</b></div></div>`;
}

function viewLesson(){
  const l = M.getLesson(state.lessonId);
  if (!l) return topbar('강의', 'back-home') + `<div class="empty">강의를 찾지 못했습니다.</div>`;
  const order = l.order || [];
  if (!state.partKey || !order.includes(state.partKey)) state.partKey = order[0] || null;

  const tabs = order.map(k => {
    const d = M.partDef(k);
    return `<button class="lessontab ${k === state.partKey ? 'on':''}" data-act="part" data-k="${k}">
      ${icon(d.icon,16)}<span>${esc(d.name)}</span></button>`;
  }).join('');

  const idx = order.indexOf(state.partKey);
  const nav = `<div class="lessonnav">
    <button class="navbtn" data-act="part-prev" ${idx<=0?'disabled':''}>이전</button>
    <button class="navbtn" data-act="part-next" ${idx>=order.length-1?'disabled':''}>다음</button></div>`;

  return topbar(l.title, 'back-home')
    + `<div class="lessontabs">${tabs}</div>`
    + `<div class="partview">${partView(l, state.partKey)}</div>` + nav;
}

function partView(l, k){
  const d = M.partDef(k); if (!d) return '';
  const p = l.parts[k] || {};
  const head = `<div class="pt">${icon(d.icon,15)} ${esc(d.name)}</div><div class="bigt">${esc(p.title || d.name)}</div>`;
  if (k === 'concept')
    return head + `<div class="placeholder">개념 슬라이드가 여기 열립니다. (뼈대 — 슬라이드 엔진은 다음 단계)</div>`;
  if (k === 'mission')
    return head + `<div class="placeholder">미니앱이 여기 바로 열립니다${p.appKey?' ('+esc(p.appKey)+')':''}.<br>제출하면 반 전체에 실시간 공유. (뼈대 — 연결은 다음 단계)</div>`;
  if (k === 'question')
    return head + `<p style="color:#444;font-size:14px;margin:0 0 10px">${esc(p.prompt || '질문이 아직 없습니다.')}</p>`
      + `<textarea placeholder="내 답변을 적습니다"></textarea>`
      + `<div style="margin-top:10px"><button class="primary" style="width:auto;padding:10px 18px" data-act="submit-demo">제출</button></div>`;
  if (k === 'formative')
    return head + `<div class="placeholder">형성평가 퀴즈가 여기 열립니다. 성적에는 들어가지 않습니다. (뼈대)</div>`;
  return head;
}

function viewReview(){
  const c = M.getCourse(state.courseId);
  const qs = M.getCourseQuizzes(state.courseId).filter(cq => cq.isOpen && cq.quiz);
  const body = qs.length
    ? qs.map(cq => `<div class="card" data-act="noop">
        <span class="ic" style="background:var(--review)">${icon('list-ordered',20)}</span>
        <div class="body"><div class="t">${esc(cq.quiz.title)}</div>
          <div class="s">${cq.quiz.source === 'auto' ? '자동 생성' : '외부 문제'} · 성적 무관</div></div></div>`).join('')
    : `<div class="empty">열린 복습이 없습니다.</div>`;
  return topbar(`${M.roomName(c)} 복습`, 'back-home') + `<div class="sectionlabel">복습 퀴즈</div>` + body;
}

// ── 렌더 ──
function render(){
  const v = { login:viewLogin, rooms:viewRooms, home:viewHome, lesson:viewLesson, review:viewReview }[state.view];
  $app.innerHTML = v ? v() : '';
}

// ── 이벤트 위임 ──
$app.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act;
  switch (act){
    case 'login': {
      const sno = (document.getElementById('f-sno').value || '').trim();
      const rooms = M.getCoursesOfStudent(YEAR, sno);
      if (!rooms.length){ alertBox('그 학번으로 든 강의실이 없습니다. (데모: 30101)'); return; }
      state.sno = sno;
      state.name = (document.getElementById('f-name').value || '').trim() || rooms[0] && M.getStudentsByCourse(rooms[0].id).find(s=>s.studentNo===sno)?.name || '';
      state.view = 'rooms'; render(); break;
    }
    case 'logout': Object.assign(state, { view:'login', sno:'', name:'', courseId:null }); render(); break;
    case 'open-room': state.courseId = el.dataset.id; state.view = 'home'; render(); break;
    case 'back-rooms': state.view = 'rooms'; render(); break;
    case 'open-lesson': state.lessonId = el.dataset.lid; state.partKey = null; state.view = 'lesson'; render(); break;
    case 'back-home': state.view = 'home'; render(); break;
    case 'open-review': state.view = 'review'; render(); break;
    case 'part': state.partKey = el.dataset.k; render(); break;
    case 'part-prev': shiftPart(-1); break;
    case 'part-next': shiftPart(1); break;
    case 'submit-demo': alertBox('제출되었습니다. (데모)'); break;
    case 'noop': break;
  }
});

function shiftPart(dir){
  const l = M.getLesson(state.lessonId); if (!l) return;
  const order = l.order || []; const i = order.indexOf(state.partKey) + dir;
  if (i >= 0 && i < order.length){ state.partKey = order[i]; render(); }
}

// 아주 단순한 알림(브라우저 기본 대화상자 대신). 뼈대용.
function alertBox(msg){
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#1f2328;color:#fff;'
    + 'padding:11px 16px;border-radius:10px;font-size:14px;z-index:50;max-width:90%';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

boot();
