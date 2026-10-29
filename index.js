// 2027 LMS 학생 화면: 제로베이스 뼈대 (2026-10-26, 큰 틀 2026-10-27)
// 로그인 → 강의실 고르기 → 강의실(두 배치) → 칸 보기.
//
// 선생님 지시 2026-10-27 (요구사항 84~87):
//  - 강의실 고르기에 반 번호를 띄우지 않는다. 학생은 자기 반밖에 없으므로 "사회", "역사"로 끝낸다
//  - 강의실 안은 배치 둘: 강의별(1강, 2강 고르기)과 메뉴별(개념노트만, 미션만 모아 보기).
//    둘은 같은 내용으로 들어가는 두 길이다. 둘 다 필요하다
//  - 학생은 폰과 패드로 들어온다. 화면은 모바일과 PC가 같은 것을 쓴다
//  - 개념노트(강의 슬라이드)만 예외로 새 탭 전체화면으로 연다
//
// 지금은 데모 데이터로 돈다(model.js). 로그인도 데모: 학번만 맞으면 입장.
// 규칙: 인라인 onclick/window 노출 없이 data-act + 이벤트 위임. 상태는 state 하나.

import * as M from './model.js?v=20261029c';
import { icon } from './shared/icons.js?v=20261028h';

const YEAR = 2027;
const $app = document.getElementById('app');

const state = {
  view: 'login',          // login | rooms | home | lesson | menu | part
  sno: '', name: '',
  courseId: null,
  layout: 'byLesson',     // 강의실 안의 배치 (byLesson | byMenu)
  lessonId: null,         // 강의별로 들어왔을 때 보는 강의
  partKey: null,          // 보고 있는 칸
  menuKey: null,          // 메뉴별로 들어왔을 때 고른 메뉴

  // 로그인 화면 (선생님 지시 2026-10-28)
  loginStep: 'check',     // 'check'(학번, 이름, 비밀번호) | 'setup'(첫 접속: 비밀번호 만들기)
  loginErr: '',           // 지금 보일 빨간 오류 문구(없으면 '')
  loginBusy: false,       // Firestore 확인 중: 중복 제출 막기
  pending: null,          // setup으로 넘어갈 때 쥐고 있는 { sno, name, courseId }
  formSno: '', formName: '',  // 오류로 다시 그릴 때도 학번, 이름은 남겨 둔다(비밀번호만 새로 친다)
};

// ── 부트 가드 ──
// Firestore를 먼저 읽고 화면을 연다. 이게 없으면 메모리가 빈 채로 로그인을 판정해
// 맞는 학번을 넣어도 "그 학번으로 든 강의실이 없다"가 된다.
async function boot(){
  const ok = getComputedStyle(document.documentElement).getPropertyValue('--lms-css-ok').trim() === '1';
  if (!ok){ document.getElementById('boot').textContent = '화면을 불러오지 못했습니다. 새로고침해 주세요.'; return; }
  try {
    await M.loadCore();
  } catch (e) {
    console.error('loadCore', e);
    document.getElementById('boot').textContent = '자료를 불러오지 못했습니다. 새로고침해 주세요.';
    return;
  }
  document.title = M.getText('browserTitle');
  document.documentElement.classList.add('lms-ready');
  $app.hidden = false;
  render();
}

// ── 공통 조각 ──
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// 학생에게 보이는 강의실 이름은 과목만(요구사항 84). 어드민은 "사회 301"을 그대로 쓴다.
const roomLabel = c => c?.subject || '';

function topbar(title, backAct){
  return `<div class="topbar">
    ${backAct ? `<button class="iconbtn" data-act="${backAct}" aria-label="뒤로" title="뒤로">${icon('chevron-left',20)}</button>` : ''}
    <h1>${esc(title)}</h1>
    ${state.sno ? `<span class="who">${esc(state.name)} ${esc(state.sno)}</span>
      <button class="iconbtn" data-act="logout" aria-label="로그아웃" title="로그아웃">${icon('log-out',18)}</button>` : ''}
  </div>`;
}

/* ── 로그인 (선생님 지시 2026-10-28) ──
   순서: 제목 → 부제목 → 안내문구 → 학번 → 이름 → 비밀번호 → 입장하기 → (틀렸을 때) 빨간 문구
         → 오픈카톡 / 홈 화면에 추가.
   화면 문구는 전부 M.getText(key)로 읽는다(하드코딩 금지: CLAUDE.md). */
function viewLogin(){
  if (state.loginStep === 'setup') return viewLoginSetup();
  const guide = M.getText('loginGuide');
  return `<div class="login">
    <h1>${esc(M.getText('loginTitle'))}</h1>
    <p class="lead">${esc(M.getText('loginSubtitle'))}</p>
    ${guide ? `<p class="guide">${esc(guide)}</p>` : ''}
    <input class="field" id="f-sno" inputmode="numeric" value="${esc(state.formSno)}">
    <input class="field" id="f-name" value="${esc(state.formName)}">
    <input class="field" id="f-pw" type="password">
    <button class="primary" data-act="login" ${state.loginBusy ? 'disabled' : ''}>${esc(M.getText('loginBtn'))}</button>
    ${state.loginErr ? `<p class="err">${esc(state.loginErr)}</p>` : ''}
    ${loginExtras()}
  </div>`;
}

// 처음 접속(비밀번호 문서가 없음): 학번, 이름은 이미 맞혀 둔 채 비밀번호만 새로 만든다.
function viewLoginSetup(){
  return `<div class="login">
    <h1>${esc(M.getText('loginTitle'))}</h1>
    <p class="lead">${esc(M.getText('loginSubtitle'))}</p>
    <p class="guide">${esc(M.getText('setupGuide'))}</p>
    <div class="fieldlabel">새 비밀번호</div>
    <input class="field" id="f-pw1" type="password">
    <div class="fieldlabel">비밀번호 확인</div>
    <input class="field" id="f-pw2" type="password">
    <button class="primary" data-act="setup-pw" ${state.loginBusy ? 'disabled' : ''}>${esc(M.getText('setupBtn'))}</button>
    ${state.loginErr ? `<p class="err">${esc(state.loginErr)}</p>` : ''}
  </div>`;
}

// 입장하기 아래: 오픈카톡 / 홈 화면에 추가 (선생님 지시 2026-10-28). 링크는 일반 설정에서.
function loginExtras(){
  return `<div class="login-extra">
    <button class="extrabtn" data-act="go-kakao">${icon('message-circle',20)}<span>${esc(M.getText('kakaoCaption'))}</span></button>
    <button class="extrabtn" data-act="go-install">${icon('home',20)}<span>${esc(M.getText('installCaption'))}</span></button>
  </div>`;
}
function openExternal(url){
  if (!url){ alertBox('링크가 아직 설정되지 않았습니다.'); return; }
  window.open(url, '_blank', 'noopener');
}

// ── 강의실 고르기 ── 과목만 보인다(요구사항 84)
function viewRooms(){
  const rooms = M.getCoursesOfStudent(YEAR, state.sno);
  const body = rooms.length
    ? `<div class="grid">${rooms.map(c => `<div class="card room" data-act="open-room" data-id="${c.id}">
        <span class="ic" style="background:var(--concept)">${icon('graduation-cap',22)}</span>
        <div class="body"><div class="t">${esc(roomLabel(c))}</div></div>
        <span class="chev">${icon('chevron-right',18)}</span></div>`).join('')}</div>`
    : `<div class="empty">든 강의실이 없습니다.</div>`;
  return topbar('강의실 고르기') + body;
}

// ── 강의실 안 ── 배치 둘(강의별 / 메뉴별)
function viewHome(){
  const c = M.getCourse(state.courseId);
  const tabs = `<div class="layouttabs">${M.STUDENT_VIEWS.map(v =>
    `<button class="layouttab ${v.key === state.layout ? 'on':''}" data-act="layout" data-v="${v.key}">${esc(v.name)}</button>`).join('')}</div>`;
  const pane = { byLesson:paneByLesson, byMenu:paneByMenu, extras:paneExtras }[state.layout] || paneByLesson;
  return topbar(roomLabel(c), 'back-rooms') + tabs + pane();
}

// 배치 3: 콘텐츠. 뽑기, 게임 같은 흥미 요소가 들어올 자리다(선생님 지시 2026-10-27). 아직 비었다.
function paneExtras(){
  return `<div class="empty">아직 없습니다.</div>`;
}

// 배치 1: 강의 고르기. 1강, 2강을 고르면 그 강의의 칸이 차례로 이어진다.
function paneByLesson(){
  const cls = M.getCourseLessons(state.courseId).filter(cl => cl.isOpen && cl.lesson);
  if (!cls.length) return `<div class="empty">열린 강의가 없습니다.</div>`;
  return `<div class="grid">${cls.map((cl, i) => {
    const tags = (cl.lesson.order || []).map(k =>
      `<span class="tag" style="--c:var(--${k})">${esc(M.partDef(k)?.name || k)}</span>`).join('');
    return `<div class="card" data-act="open-lesson" data-lid="${cl.lessonId}">
      <span class="no">${i + 1}강</span>
      <div class="body"><div class="t">${esc(cl.lesson.title)}</div><div class="tags">${tags}</div></div>
      <span class="chev">${icon('chevron-right',18)}</span></div>`;
  }).join('')}</div>`;
}

// 배치 2: 메뉴별. 개념노트만, 미션만 모아 본다. 복습과 성적도 여기 선다.
function paneByMenu(){
  const counts = {};
  M.PART_TYPES.forEach(p => counts[p.key] = M.getPartItems(state.courseId, p.key).length);
  const n = {
    review: M.getCourseQuizzes(state.courseId).filter(cq => cq.isOpen && cq.quiz).length,
  };
  return `<div class="grid menus">${M.STUDENT_MENUS.map(m => {
    const sub = m.kind === 'part'   ? `${counts[m.key]}개`
              : m.kind === 'review' ? `${n.review}개`
              : '';
    return `<div class="card menu" data-act="open-menu" data-k="${m.key}">
      <span class="ic" style="background:var(--${m.key === 'score' ? 'navy-600' : m.key})">${icon(m.icon,22)}</span>
      <div class="body"><div class="t">${esc(m.name)}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>
      <span class="chev">${icon('chevron-right',18)}</span></div>`;
  }).join('')}</div>`;
}

// ── 메뉴 하나를 고른 화면 ──
function viewMenu(){
  const c = M.getCourse(state.courseId);
  const m = M.STUDENT_MENUS.find(x => x.key === state.menuKey);
  if (!m) return topbar(roomLabel(c), 'back-home') + `<div class="empty">메뉴를 찾지 못했습니다.</div>`;
  const head = topbar(m.name, 'back-home');

  if (m.kind === 'score')  return head + scoreCard(c);
  if (m.kind === 'review') return head + reviewList();

  // 칸 모아 보기: 강의마다 그 칸 하나씩
  const items = M.getPartItems(state.courseId, m.key);
  if (!items.length) return head + `<div class="empty">아직 없습니다.</div>`;
  return head + `<div class="grid">${items.map(it => `
    <div class="card" data-act="open-part" data-lid="${it.lesson.id}" data-k="${m.key}">
      <span class="no">${it.no}강</span>
      <div class="body"><div class="t">${esc(it.part.title || m.name)}</div>
        <div class="s">${esc(it.lesson.title)}</div></div>
      <span class="chev">${icon('chevron-right',18)}</span></div>`).join('')}</div>`;
}

function reviewList(){
  const qs = M.getCourseQuizzes(state.courseId).filter(cq => cq.isOpen && cq.quiz);
  if (!qs.length) return `<div class="empty">열린 복습이 없습니다.</div>`;
  return `<div class="grid">${qs.map(cq => `<div class="card" data-act="noop">
    <span class="ic" style="background:var(--review)">${icon('list-ordered',22)}</span>
    <div class="body"><div class="t">${esc(cq.quiz.title)}</div>
      <div class="s">${cq.quiz.source === 'auto' ? '자동 생성' : '외부 문제'} (성적 무관)</div></div></div>`).join('')}</div>`;
}

/* 성적(요구사항 4의 성적 창구): model.js studentGrade로 그 자리에서 계산한다.
   선생님이 성적 입력에서 체크하고 그 반에 [반영하기]를 누른 강의만 들어온다.
   영역마다 급간 표로 환산한 점수와 달성률을 같이 보여 준다. */
function scoreCard(c){
  const sc = M.studentGrade(c.id, state.sno);
  if (!sc.has)
    return `<div class="score"><div class="h">실시간 성적</div>
      <div class="row"><span>아직 반영된 강의가 없습니다.</span></div></div>`;
  const rows = M.GRADE_AREAS.map(a => {
    const it = sc.areas[a.key];
    const v = it.total ? `${it.score}점 <small>${it.pct}%</small>` : '미실시';
    return `<div class="row"><span>${esc(a.name)}</span><b>${v}</b></div>`;
  }).join('');
  return `<div class="score"><div class="h">실시간 성적</div>${rows}
    <div class="row total"><span>최종</span><b>${sc.total} / ${sc.maxScore}</b></div></div>`;
}

// ── 강의 하나를 고른 화면(배치 1): 칸을 탭으로 넘긴다 ──
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

// ── 칸 하나만 보는 화면(배치 2에서 들어옴) ──
function viewPart(){
  const l = M.getLesson(state.lessonId);
  const d = M.partDef(state.partKey);
  if (!l || !d) return topbar('', 'back-menu') + `<div class="empty">찾지 못했습니다.</div>`;
  return topbar(l.title, 'back-menu') + `<div class="partview">${partView(l, state.partKey)}</div>`;
}

/* 칸 하나의 알맹이.
   개념노트만 여기서 안 펼친다: 강의 슬라이드는 늘 새 탭 전체화면이다(요구사항 87). */
function partView(l, k){
  const d = M.partDef(k); if (!d) return '';
  const p = l.parts?.[k] || {};
  const head = `<div class="pt">${icon(d.icon,15)} ${esc(d.name)}</div>
    <div class="bigt">${esc(p.title || d.name)}</div>`;

  if (k === 'concept')
    return head + `<button class="primary wide" data-act="open-slide" data-lid="${l.id}">
        ${icon('monitor',18)}<span>슬라이드 열기</span></button>`;

  if (k === 'mission')
    return head + `<div class="placeholder">미니앱이 여기 바로 열립니다${p.appKey?' ('+esc(p.appKey)+')':''}.<br>
      제출하면 반 전체에 실시간 공유. (뼈대: 연결은 다음 단계)</div>`;

  if (k === 'question')
    return head + `<p class="prompt">${esc(p.prompt || '질문이 아직 없습니다.')}</p>`
      + `<textarea placeholder="내 답변을 적습니다"></textarea>`
      + `<button class="primary wide" data-act="submit-demo">제출</button>`;

  if (k === 'formative')
    return head + `<div class="placeholder">형성평가 퀴즈가 여기 열립니다. 성적에는 들어가지 않습니다. (뼈대)</div>`;

  return head;
}

// ── 렌더 ──
function render(){
  const v = { login:viewLogin, rooms:viewRooms, home:viewHome,
              lesson:viewLesson, menu:viewMenu, part:viewPart }[state.view];
  $app.innerHTML = v ? v() : '';
  window.scrollTo(0, 0);
}

// ── 이벤트 위임 ──
$app.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  switch (el.dataset.act){
    case 'login': {
      if (state.loginBusy) return;
      const sno = (document.getElementById('f-sno').value || '').trim();
      const name = (document.getElementById('f-name').value || '').trim();
      const pw = (document.getElementById('f-pw').value || '').trim();
      state.formSno = sno; state.formName = name;   // 오류로 다시 그려도 학번, 이름은 남긴다
      const rooms = M.getCoursesOfStudent(YEAR, sno);
      if (!rooms.length){ state.loginErr = M.getText('errNoRoom'); render(); return; }
      if (!M.matchesRosterName(YEAR, sno, name)){ state.loginErr = M.getText('errNameMismatch'); render(); return; }
      state.loginBusy = true; state.loginErr = ''; render();
      (async () => {
        try {
          const rec = await M.getAuthRecord(YEAR, sno);
          if (!rec){   // 첫 접속: 비밀번호를 아직 안 만들었다
            state.loginBusy = false; state.pending = { sno, name, courseId: rooms[0].id };
            state.loginStep = 'setup'; render(); return;
          }
          if (!pw){ state.loginBusy = false; state.loginErr = M.getText('errPwEmpty'); render(); return; }
          const ok = await M.verifyPassword(YEAR, sno, pw);
          state.loginBusy = false;
          if (!ok){ state.loginErr = M.getText('errPwWrong'); render(); return; }
          state.sno = sno; state.name = name; state.formSno = ''; state.formName = '';
          state.view = 'rooms'; render();
        } catch (e) {
          console.error('login', e);
          state.loginBusy = false; state.loginErr = M.getText('errNetwork'); render();
        }
      })();
      break;
    }
    case 'setup-pw': {
      if (state.loginBusy) return;
      const pw1 = (document.getElementById('f-pw1').value || '').trim();
      const pw2 = (document.getElementById('f-pw2').value || '').trim();
      if (pw1.length < 4){ state.loginErr = M.getText('errPwShort'); render(); return; }
      if (pw1 !== pw2){ state.loginErr = M.getText('errPwMismatch'); render(); return; }
      state.loginBusy = true; state.loginErr = ''; render();
      (async () => {
        try {
          await M.createPassword(YEAR, state.pending.sno, pw1, state.pending.courseId);
          state.sno = state.pending.sno; state.name = state.pending.name;
          state.pending = null; state.loginStep = 'check'; state.loginBusy = false;
          state.formSno = ''; state.formName = '';
          state.view = 'rooms'; render();
        } catch (e) {
          console.error('setup-pw', e);
          state.loginBusy = false; state.loginErr = M.getText('errNetwork'); render();
        }
      })();
      break;
    }
    case 'go-kakao': openExternal(M.getText('kakaoUrl')); break;
    case 'go-install': openExternal(M.getText('installUrl')); break;

    case 'logout':
      Object.assign(state, { view:'login', sno:'', name:'', courseId:null, layout:'byLesson',
        loginStep:'check', loginErr:'', loginBusy:false, pending:null, formSno:'', formName:'' });
      render(); break;

    case 'open-room': state.courseId = el.dataset.id; state.view = 'home'; render(); break;
    case 'back-rooms': state.view = 'rooms'; render(); break;
    case 'back-home': state.view = 'home'; render(); break;
    case 'back-menu': state.view = 'menu'; render(); break;
    case 'layout': state.layout = el.dataset.v; render(); break;

    case 'open-lesson': state.lessonId = el.dataset.lid; state.partKey = null; state.view = 'lesson'; render(); break;
    case 'open-menu': state.menuKey = el.dataset.k; state.view = 'menu'; render(); break;
    case 'open-part':
      state.lessonId = el.dataset.lid; state.partKey = el.dataset.k; state.view = 'part'; render(); break;

    case 'part': state.partKey = el.dataset.k; render(); break;
    case 'part-prev': shiftPart(-1); break;
    case 'part-next': shiftPart(1); break;

    // 강의 슬라이드는 늘 새 탭 전체화면(요구사항 87). 교실 화면에 투사하는 것이 주 용도다.
    case 'open-slide':
      window.open(`slide.html?lesson=${encodeURIComponent(el.dataset.lid)}`, '_blank', 'noopener');
      break;

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
  let t = document.getElementById('snack');
  if (!t){ t = document.createElement('div'); t.id = 'snack'; document.body.appendChild(t); }
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(t._h); t._h = setTimeout(() => t.style.display = 'none', 1800);
}

boot();
