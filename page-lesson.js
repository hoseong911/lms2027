/* ════════════════════════════════════════════════════════
   교재 쪽(page) 강의 화면: 시안

   활동지 PDF를 쪽 그림으로 구워 두고, 빈칸만 그 위에 겹쳐 올린다.
   빈칸의 자리(%)와 정답은 학생용/교사용 PDF 한 쌍을 대조해서 뽑은 것이다.
   (뽑는 쪽은 도구가 따로 한다. 여기는 뽑아 놓은 lesson.json만 읽는다)

   모드 셋
     수업  : 빈칸을 눌러 하나씩 연다. 수업 중 투사용
     채우기: 정답 칩을 섞어 놓고 빈칸에 넣는다. 학생 활동용
     정답  : 전부 열어 둔다. 교사용 책과 같은 상태

   코드 규칙(CLAUDE.md): 인라인 onclick과 window 노출을 쓰지 않는다.
   data-act + 이벤트 위임, 모듈 최상위 상태는 state 하나.
   ════════════════════════════════════════════════════════ */

import { icon } from './shared/icons.js';

const DATA_URL = 'demo/lesson.json';

const state = {
  lesson: null,   // { title, lessonNo, pages:[{ image, w, h, blanks:[{id,left,top,width,height,answer}] }] }
  i: 0,           // 보고 있는 쪽
  mode: 'blank',  // blank | fill | answer
  chips: [],      // 쪽마다 [{ id, text }] (섞어 둔 정답 칩)
  placed: [],     // 쪽마다 { 빈칸id: 칩id }
  opened: [],     // 쪽마다 Set(빈칸id): 수업 모드에서 연 빈칸
  graded: [],     // 쪽마다 boolean
  picked: null,   // 지금 고른 칩 id
};

const $ = id => document.getElementById(id);
const el = {
  no: $('pl-no'), name: $('pl-name'), modes: $('pl-modes'), count: $('pl-count'),
  grade: $('pl-grade'), reset: $('pl-reset'), stage: $('pl-stage'),
  page: $('pl-page'), img: $('pl-img'), blanks: $('pl-blanks'), tray: $('pl-tray'),
};

/* 공백만 지우고 견준다. 정답 조각을 이어 붙일 때 생기는 공백 차이를 흡수한다 */
const norm = s => String(s || '').replace(/\s+/g, '');
const page = () => state.lesson.pages[state.i];

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ── 들머리 ── */
init();

async function init() {
  el.reset.innerHTML = icon('rotate-ccw', 18);
  el.grade.innerHTML = icon('check', 17) + '채점';
  document.querySelector('[data-act="prev"]').innerHTML = icon('chevron-left', 20);
  document.querySelector('[data-act="next"]').innerHTML = icon('chevron-right', 20);

  const res = await fetch(DATA_URL);
  if (!res.ok) { el.name.textContent = '강의를 불러오지 못했습니다'; return; }
  state.lesson = await res.json();

  state.lesson.pages.forEach((p, i) => {
    state.chips[i] = shuffle(p.blanks.map((b, k) => ({ id: `c${k}`, text: b.answer })));
    state.placed[i] = {};
    state.opened[i] = new Set();
    state.graded[i] = false;
  });

  el.name.textContent = state.lesson.title || '';
  el.no.textContent = state.lesson.lessonNo != null ? state.lesson.lessonNo : '';
  el.no.hidden = state.lesson.lessonNo == null;

  bind();
  render();
}

function bind() {
  document.addEventListener('click', onClick);
  window.addEventListener('resize', fitPage);
  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
  });
  el.img.addEventListener('load', fitPage);

  /* 칩 끌어서 넣기 */
  el.tray.addEventListener('dragstart', e => {
    const chip = e.target.closest('.pl-chip');
    if (!chip) return;
    state.picked = chip.dataset.id;
    paintChips();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', chip.dataset.id);
  });
  el.blanks.addEventListener('dragover', e => {
    if (state.mode !== 'fill' || !state.picked) return;
    const b = e.target.closest('.pl-blank');
    if (!b) return;
    e.preventDefault();
    el.blanks.querySelectorAll('.aim').forEach(x => x.classList.remove('aim'));
    b.classList.add('aim');
  });
  el.blanks.addEventListener('dragleave', e => {
    const b = e.target.closest('.pl-blank');
    if (b) b.classList.remove('aim');
  });
  el.blanks.addEventListener('drop', e => {
    const b = e.target.closest('.pl-blank');
    if (!b) return;
    e.preventDefault();
    b.classList.remove('aim');
    put(b.dataset.id);
  });
}

function onClick(e) {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  if (act === 'mode')  setMode(t.dataset.mode);
  if (act === 'prev')  go(-1);
  if (act === 'next')  go(1);
  if (act === 'grade') { state.graded[state.i] = true; paintBlanks(); paintCount(); }
  if (act === 'reset') resetPage();
  if (act === 'chip')  { state.picked = state.picked === t.dataset.id ? null : t.dataset.id; paintChips(); }
  if (act === 'blank') onBlank(t.dataset.id);
}

function onBlank(id) {
  if (state.mode === 'blank') {
    const set = state.opened[state.i];
    if (set.has(id)) set.delete(id); else set.add(id);
    paintBlanks(); paintCount();
    return;
  }
  if (state.mode === 'fill') put(id);
}

/* 고른 칩을 빈칸에 넣는다. 고른 칩이 없고 이미 찬 빈칸이면 도로 뺀다 */
function put(blankId) {
  const placed = state.placed[state.i];
  if (!state.picked) {
    if (placed[blankId]) { delete placed[blankId]; state.graded[state.i] = false; paint(); }
    return;
  }
  /* 그 칩이 다른 빈칸에 들어가 있으면 거기서 뺀다 */
  for (const k of Object.keys(placed)) if (placed[k] === state.picked) delete placed[k];
  placed[blankId] = state.picked;
  state.picked = null;
  state.graded[state.i] = false;
  paint();
}

function setMode(m) {
  if (state.mode === m) return;
  state.mode = m;
  state.picked = null;
  document.body.dataset.mode = m;
  el.modes.querySelectorAll('.pick').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  paint();
  fitPage();
}

function go(d) {
  const n = state.i + d;
  if (n < 0 || n >= state.lesson.pages.length) return;
  state.i = n;
  state.picked = null;
  render();
}

function resetPage() {
  state.placed[state.i] = {};
  state.opened[state.i] = new Set();
  state.graded[state.i] = false;
  state.picked = null;
  paint();
}

/* ── 그리기 ── */

function render() {
  const p = page();
  el.img.src = p.image;

  el.blanks.innerHTML = p.blanks.map(b =>
    `<button class="pl-blank" type="button" data-act="blank" data-id="${b.id}"
      style="left:${b.left}%;top:${b.top}%;width:${b.width}%;height:${b.height}%"><span class="pl-bt"></span></button>`
  ).join('');

  document.querySelector('[data-act="prev"]').disabled = state.i === 0;
  document.querySelector('[data-act="next"]').disabled = state.i === state.lesson.pages.length - 1;

  paint();
  fitPage();
}

function paint() { paintBlanks(); paintChips(); paintCount(); }

function paintBlanks() {
  const p = page();
  const placed = state.placed[state.i];
  const opened = state.opened[state.i];
  const graded = state.graded[state.i];

  p.blanks.forEach(b => {
    const node = el.blanks.querySelector(`[data-id="${b.id}"]`);
    if (!node) return;
    node.className = 'pl-blank';
    if (state.mode === 'answer') { node.firstChild.textContent = b.answer; return; }
    if (state.mode === 'blank') {
      node.firstChild.textContent = b.answer;
      if (opened.has(b.id)) node.classList.add('open');
      return;
    }
    /* 채우기 */
    const chip = state.chips[state.i].find(c => c.id === placed[b.id]);
    node.firstChild.textContent = chip ? chip.text : '';
    if (chip) {
      node.classList.add('full');
      if (graded) node.classList.add(norm(chip.text) === norm(b.answer) ? 'right' : 'wrong');
    }
  });
  fitText();
}

function paintChips() {
  const p = page();
  if (!p.blanks.length) { el.tray.innerHTML = '<span class="pl-tray-empty">빈칸 없음</span>'; return; }
  const used = new Set(Object.values(state.placed[state.i]));
  el.tray.innerHTML = state.chips[state.i].map(c =>
    `<button class="pl-chip${used.has(c.id) ? ' used' : ''}${state.picked === c.id ? ' picked' : ''}"
      type="button" draggable="true" data-act="chip" data-id="${c.id}">${c.text}</button>`
  ).join('');
}

function paintCount() {
  const p = page();
  const total = p.blanks.length;
  let n = 0;
  if (state.mode === 'blank')  n = state.opened[state.i].size;
  if (state.mode === 'fill')   n = Object.keys(state.placed[state.i]).length;
  if (state.mode === 'answer') n = total;
  el.count.innerHTML = `<b>${n}</b> / ${total}`;
  el.count.classList.toggle('done', total > 0 && n === total);
  el.grade.disabled = state.mode !== 'fill' || n === 0;
}

/* 쪽 그림을 화면에 꽉 차게 맞춘다. 빈칸이 %라서 틀만 맞추면 따라온다.
   CSS aspect-ratio와 max-width를 같이 쓰면 브라우저마다 반올림이 달라
   빈칸이 반 픽셀씩 밀린다. 그래서 px로 직접 정한다. */
function fitPage() {
  if (!state.lesson) return;
  const p = page();
  const cs = getComputedStyle(el.stage);
  const availW = el.stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = el.stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  if (availW <= 0 || availH <= 0) return;
  const ratio = p.w / p.h;
  let w = availH * ratio, h = availH;
  if (w > availW) { w = availW; h = w / ratio; }
  el.page.style.width = Math.floor(w) + 'px';
  el.page.style.height = Math.floor(h) + 'px';
  fitText();
}

/* 빈칸 글자 크기는 빈칸 높이에서 뽑고, 칸을 넘치면 줄인다.
   넘침은 속 span의 natural width로 잰다. 버튼에 overflow:hidden이 걸려 있어
   scrollWidth로는 넘친 줄을 모르고 글자가 양옆으로 잘려 나간다. */
const MIN_SHRINK = 0.5;   // 이보다 더 줄이지는 않는다 (틀린 칩이 작은 칸에 들어간 경우)

function fitText() {
  const h = el.page.clientHeight;
  if (!h) return;
  page().blanks.forEach(b => {
    const node = el.blanks.querySelector(`[data-id="${b.id}"]`);
    if (!node) return;
    const span = node.firstChild;
    /* 원본 PDF의 글자 크기(쪽 높이 대비 %). 없으면 상자 높이에서 어림잡는다 */
    const base = b.font ? (b.font / 100) * h : (b.height / 100) * h * 0.62;
    node.style.fontSize = base.toFixed(2) + 'px';
    if (!span.textContent) return;
    const room = node.clientWidth - 4;            // 좌우 padding 2px씩
    if (room <= 0) return;
    const over = span.offsetWidth / room;
    if (over > 1.01) node.style.fontSize = (base * Math.max(1 / over, MIN_SHRINK)).toFixed(2) + 'px';
  });
}
