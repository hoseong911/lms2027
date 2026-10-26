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
  fSubject: null, fRoom: null,      // 강의실 관리 필터
  studentClass: 'all',             // 학생 관리 반 필터(roomNo)
  lessonId: null, lessonTab: 'edit',
  gradingType: 'question',
};

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const val = id => (document.getElementById(id)?.value || '').trim();

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

// ── 사이드 ──
function renderSide(){
  $side.innerHTML = `<div class="brand">2027</div>` + M.ADMIN_MENUS.map(m =>
    `<div class="mi ${m.key === state.page ? 'on':''}" data-act="page" data-k="${m.key}">
      ${icon(m.icon,18)}<span>${esc(m.name)}</span></div>`).join('');
}

// ── 카테고리 줄(구분선) ──
function catline(items, active, act, allLabel){
  const all = allLabel ? `<button class="cat ${active==null||active==='all'?'on':''}" data-act="${act}" data-v="all">${esc(allLabel)}</button>` : '';
  const rest = items.map(it => `<button class="cat ${String(active)===String(it.v)?'on':''}" data-act="${act}" data-v="${esc(it.v)}">${esc(it.label)}</button>`).join('');
  return `<div class="catline">${all}${rest}</div>`;
}

// ── 강의실 관리 ──
function pageRooms(){
  const courses = M.getCourses(state.year);
  const subjects = [...new Set(courses.map(c => c.subject))];
  const rooms = [...new Set(courses.map(c => M.roomNo(c)))].sort();
  let list = courses;
  if (state.fSubject && state.fSubject !== 'all') list = list.filter(c => c.subject === state.fSubject);
  if (state.fRoom && state.fRoom !== 'all') list = list.filter(c => M.roomNo(c) === state.fRoom);

  const yearLine = catline(M.getYears().map(y => ({ v:y.year, label:`${y.year}` })), state.year, 'set-year');
  const subjLine = catline(subjects.map(s => ({ v:s, label:s })), state.fSubject, 'set-subject', '전체');
  const roomLine = catline(rooms.map(r => ({ v:r, label:r })), state.fRoom, 'set-room', '전체');

  const rowsHtml = list.length ? list.map(c => `<div class="row">
      <div class="grow"><div class="t">${esc(M.roomName(c))}</div>
        <div class="s">${M.getStudentsByCourse(c.id).length}명</div></div>
      <div class="tools">
        <button class="ib" data-act="room-edit" data-id="${c.id}" title="수정" aria-label="수정">${icon('pencil',16)}</button>
        <button class="ib" data-act="room-del" data-id="${c.id}" title="삭제" aria-label="삭제">${icon('trash-2',16)}</button>
      </div></div>`).join('') : `<div class="empty">강의실이 없습니다.</div>`;

  const addForm = `<div class="formrow">
    <input class="f w-md" id="r-subject" placeholder="과목 (예: 사회)">
    <input class="f w-sm" id="r-grade" inputmode="numeric" placeholder="학년"><span class="unit">학년</span>
    <input class="f w-sm" id="r-class" inputmode="numeric" placeholder="반"><span class="unit">반</span>
    <button class="btn-text" data-act="room-add">강의실 만들기</button>
  </div>`;

  return `<div class="pagehead"><h2>강의실 관리</h2></div>
    ${yearLine}${subjLine}${roomLine}${addForm}${rowsHtml}`;
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
        <button class="ib" data-act="stu-del" data-no="${sno}" title="삭제" aria-label="삭제">${icon('trash-2',16)}</button>
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
        <div class="s">${esc(l.parts[k]?.title || '')}${d.portfolio?'':' · 성적 무관'}</div></div>
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
      <div class="s" style="font-size:12px;color:var(--sub);margin-top:6px">형성평가·복습은 성적에 안 들어감</div>
      <div class="formrow" style="margin-top:10px;flex-direction:column;align-items:stretch">
        <button class="ib ib-primary" data-act="lesson-import" style="width:100%" title="활동지 업로드">${icon('upload',16)}<span style="margin-left:8px;font-size:13px">활동지 업로드 → 개념노트</span></button>
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
      <div class="s">${q.source === 'auto' ? '자동 생성' : '외부 문제'} · 성적 무관</div></div>
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
  const p = { rooms:pageRooms, students:pageStudents, lessons:pageLessons, review:pageReview, grading:pageGrading }[state.page];
  $main.innerHTML = p ? p() : '';
}

// ── 이벤트 위임 ──
document.getElementById('shell').addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, k = el.dataset.k, id = el.dataset.id, v = el.dataset.v, no = el.dataset.no;
  switch (act){
    case 'page': state.page = k; state.lessonId = null; render(); break;
    case 'set-year': state.year = +v; render(); break;
    case 'set-subject': state.fSubject = v; render(); break;
    case 'set-room': state.fRoom = v; render(); break;
    case 'set-sclass': state.studentClass = v; render(); break;
    case 'set-gtype': state.gradingType = v; render(); break;

    case 'room-add': {
      const subject = val('r-subject'), grade = val('r-grade'), classNo = val('r-class');
      if (!subject || !grade || !classNo){ toast('과목, 학년, 반을 적어 주세요.'); return; }
      const c = M.addCourse({ year:state.year, subject, grade, classNo });
      toast(`${M.roomName(c)} 강의실을 만들었습니다.`); render(); break;
    }
    case 'room-edit': case 'room-del': toast('뼈대 — 다음 단계에서 붙입니다.'); break;

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
    case 'lesson-import': toast('활동지 업로드 → 개념노트 변환은 다음 단계.'); break;
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

boot();
