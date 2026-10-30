/* ════════════════════════════════════════════════════════════════════════
   강의 슬라이드 엔진: 덱(강의 하나) → 쪽 배열 → 쪽 HTML.

   축은 model.js의 SLIDE_AXIS 하나에서 온다(선생님 지시 2026-10-30, 요구사항 125).
     표지, 전시학습확인, 학습 목표, 동기 유발, 개념 노트, 미션 활동, 오늘의 질문, 맺음말

   학생 슬라이드(slide.html)와 어드민 미리보기가 이 파일 하나를 같이 불러써서 두 쪽이
   언제나 같게 보인다. 모양(색, 크기)은 slide-deck.css 한 곳에 있다.

   hoistory 2026의 slide-render.js를 그대로 들고 오지 않았다(선생님 지시 2026-10-30:
   "이식은 보고 따라하라는 뜻"). 거기서 가져온 생각은 셋이다:
     하나, 쪽 만들기와 쪽 그리기를 한 파일에 두어 두 화면이 어긋나지 않게 한다.
     둘,   빈칸 문법 {정답} 과 굵게 문법 **굵게** 를 본문에 둔다.
     셋,   유튜브 주소에서 영상 id와 시작 시각을 읽어 끼운다.
   2026의 글꼴 슬라이더, 장평, 디자인 설정 50여 칸은 가져오지 않았다. 아직 시킨 것이 아니다.
   ════════════════════════════════════════════════════════════════════════ */
// Firebase를 끌어오지 않는 축 파일만 쓴다: 혼자 도는 미리보기 문서도 이 엔진을 그대로 쓴다
import { SLIDE_AXIS, normalizeDeck, reviewTypeDef, toPages, lineLevel } from './shared/slide-axis.js?v=20261030j';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));

/* 본문 한 줄을 HTML로. 두 가지 문법만 둔다(2026에서 가져온 것).
     {정답}   빈칸. 수업 중에는 가려 두었다가 눌러서 연다
     **굵게** 강조
   가린 빈칸의 정답은 data-answer에 넣는다: 눌러서 열 때 그 글자를 꺼내 쓴다.

   빈칸을 먼저 떼어 두는 자리표는 NUL(눈에 안 보이는 0번 글자)로 둔다. 글 안에 우연히
   나올 수 없는 글자라야 "1 더하기 1 은" 같은 본문을 빈칸으로 잘못 읽지 않는다.
   소스에 NUL을 그대로 적으면 파일이 바이너리로 보여서 String.fromCharCode로 만든다. */
const NUL = String.fromCharCode(0);
const NUL_RE = new RegExp(NUL + '(\\d+)' + NUL, 'g');
export function inlineText(str){
  const blanks = [];
  let s = String(str ?? '').replace(/\{([^}]+)\}/g, (_, inner) => {
    blanks.push(inner);
    return NUL + (blanks.length - 1) + NUL;
  });
  s = esc(s).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  return s.replace(NUL_RE, (_, i) =>
    `<span class="blank" data-answer="${esc(blanks[+i])}">${esc(blanks[+i])}</span>`);
}

/* 유튜브 주소에서 영상 id와 시작 시각(초)을 읽는다. watch?v=, youtu.be/, embed/, shorts/ 넷 다 받는다.
   시작 시각은 t=90, t=90s, t=1m30s, t=1h2m3s 모양을 초로 바꾼다. */
export function youTube(url){
  const u = String(url ?? '');
  const m = u.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  if (!m) return null;
  let start = 0;
  const t = u.match(/[?&#](?:t|start)=([0-9hms]+)/i);
  if (t){
    const raw = t[1].toLowerCase();
    if (/^\d+s?$/.test(raw)) start = parseInt(raw, 10) || 0;
    else {
      const h = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
      if (h) start = (+(h[1] || 0)) * 3600 + (+(h[2] || 0)) * 60 + (+(h[3] || 0));
    }
  }
  return { id: m[1], start };
}

/* ── 덱을 쪽 배열로 편다 ──────────────────────────────────────────────────
   쪽 하나 = { type, step, 그 종류가 쓰는 칸들 }. step은 축 단계 key라 쪽마다
   어느 단계에서 나온 쪽인지 알 수 있다(위쪽 단계 이름표와 어드민 미리보기가 쓴다).

   내용이 빈 단계는 쪽을 만들지 않는다. 그래서 동기 유발을 안 쓰는 차시는 그 단계가
   슬라이드에서 그냥 빠진다. 끄는 스위치를 따로 두지 않는 까닭이다.

   no는 강 번호(그 강의실에서 몇 번째로 꽂혔는가)다. 강의 본체에는 차수가 없고
   강의실마다 다를 수 있어서 부르는 쪽이 넘겨 준다(index.js의 카드가 아는 값이다). */
export function buildSlides(lesson, no){
  if (!lesson) return [];
  const deck = normalizeDeck(lesson) || {};
  const out = [];
  const push = (step, slide) => out.push(Object.assign({ step }, slide));
  const lines = key => (deck[key]?.items || []).map(t => String(t ?? '').trim()).filter(Boolean);

  SLIDE_AXIS.forEach(ax => {
    if (ax.key === 'cover'){
      push('cover', { type:'cover', no, title:lesson.title || '',
        unit:deck.cover?.unit || '', pages:deck.cover?.pages || '' });

    } else if (ax.key === 'review'){
      const qa = (deck.review?.items || []).filter(it => String(it?.q || '').trim());
      if (qa.length) push('review', { type:'qa', items:qa });

    } else if (ax.key === 'objective'){
      const items = lines('objective');
      if (items.length) push('objective', { type:'numbered', items });

    } else if (ax.key === 'hook'){
      // 사진과 영상은 한 쪽에 하나다: 교실 화면에 띄우는 것이라 크게 봐야 한다
      (deck.hook?.items || []).forEach(it => {
        if (String(it?.url || '').trim())
          push('hook', { type:'media', kind:it.kind === 'video' ? 'video' : 'image',
            url:it.url, caption:it.caption || '' });
      });

    } else if (ax.key === 'concept'){
      // 개념 노트는 parts.concept.content를 쓴다. 페이지 하나가 쪽 하나다
      pageSlides(lesson.parts?.concept?.content, '').forEach(s => push('concept', s));

    } else if (ax.key === 'mission'){
      /* 미션 활동 페이지는 덱이 들고 있다. 페이지 제목을 비우면 미션 이름(parts.mission의 제목)이
         선다: 같은 이름을 두 군데 적지 않게. 페이지가 하나도 없어도 미션 이름이 있으면 쪽 하나가 선다
         (페이지 모양이 되기 전에도 그랬다). 이 기준은 model.js의 deckStepFilled와 같아야 한다. */
      const name = String(lesson.parts?.mission?.title || '').trim();
      const pages = pageSlides(deck.mission?.content, name);
      if (!pages.length && name) pages.push({ type:'page', title:name, rows:[] });
      pages.forEach(s => push('mission', s));

    } else if (ax.key === 'question'){
      const q = String(lesson.parts?.question?.question || '').trim();
      if (q) push('question', { type:'question', question:q,
        guide:String(lesson.parts?.question?.guide || '').trim() });

    } else if (ax.key === 'closing'){
      const items = lines('closing');
      if (items.length) push('closing', { type:'closing', items });
    }
  });
  return out;
}

/* 개념 노트와 미션 활동의 페이지를 쪽으로 편다(페이지 모양은 shared/slide-axis.js의 toPages).
   빈 줄은 떨어뜨리고, 줄도 제목도 없는 페이지는 쪽을 만들지 않는다.
   제목은 있는데 줄이 없는 페이지는 선다(제목만 세운 쪽을 일부러 두는 경우가 있다).
   fallback은 페이지 제목이 비었을 때 대신 쓸 제목이다(미션 이름). */
function pageSlides(content, fallback){
  return toPages(content).map(p => ({
    type: 'page',
    title: pageTitle(p.title) || pageTitle(fallback),
    rows: p.rows.map(r => ({
      label: String(r.label || '').trim(),
      lines: String(r.text || '').split('\n').map(t => t.trim()).filter(Boolean),
    })).filter(r => r.lines.length || r.label),
  })).filter(p => p.rows.length || String(p.title).trim());
}

/* 쪽 제목에서 단계 이름 머리를 뗀다(선생님 지시 2026-10-30:
   "개념 노트 #1 : 성리학의 확산 이라고 적혀 있으면 배지는 개념 노트 그 옆에는 성리학의 확산만 있어야해").
   배지가 이미 단계 이름을 말하므로 제목에 같은 말이 또 서지 않게 한다.
   떼는 것은 단계 이름 꼴의 머리뿐이다: 개념 노트, 개념 Check, 미션 활동, 미션 Check(뒤에 #번호가 붙어도).
   "사료 : 이황의 사액 서원 건의"의 "사료"처럼 단계 이름이 아닌 머리는 내용이라 남긴다.
   저장된 제목은 그대로 두고 쪽에 그릴 때만 뗀다(활동지에 적힌 글을 고치지 않는다). */
const STEP_PREFIX_RE = /^(?:개념\s*노트|개념\s*Check|미션\s*활동|미션\s*Check)\s*(?:#\s*\d+)?\s*:\s*/i;
const pageTitle = t => String(t ?? '').trim().replace(STEP_PREFIX_RE, '').trim();

// 축 단계 이름(쪽 맨 위 배지). 표지에는 달지 않는다
const stepName = key => (SLIDE_AXIS.find(a => a.key === key) || {}).name || '';

/* 항목 글 "설립 : 16C 이후 ..." 를 소제목(설립)과 내용으로 가른다(선생님 지시 2026-10-30:
   "1. 설립 : ~ 이렇게 되어 있으면 굵은 글씨로 설립 하고 그 내용 사이에 여백을 만들어줘.
    줄바꿈이 되는 경우에는 내어쓰기 해야 해.")
   쌍점은 지우고 그 자리를 여백으로 둔다(2026 슬라이드도 소제목 뒤 쌍점을 지웠다).
   내용 칸이 따로 서서 줄이 넘어가면 내용 시작 자리에 맞춰 내려온다(내어쓰기).
   잘못 가르지 않게 셋을 본다: 쌍점 뒤에 빈칸이 있고, 앞부분이 15자 이하이고,
   앞부분 안에서 빈칸 문법 {}의 괄호가 맞아야 한다("3:1" 같은 비율이나 긴 문장 속 쌍점은 그대로 둔다). */
const TERM_RE = /^(.{1,15}?)\s*:\s+(.+)$/;
function itemHTML(body){
  const m = body.match(TERM_RE);
  if (m && (m[1].match(/\{/g) || []).length === (m[1].match(/\}/g) || []).length)
    return `<span class="pt"><span class="pk">${inlineText(m[1].trim())}</span><span class="pv">${inlineText(m[2])}</span></span>`;
  return `<span class="pt"><span class="pv">${inlineText(body)}</span></span>`;
}

/* 내용 줄 하나. 단계는 줄 앞 기호가 정한다(1. 1단계, - 2단계, · 3단계. slide-axis.js의 lineLevel).
   단계가 내려갈수록 들여 쓴다(선생님 지시 2026-10-30). 기호와 글을 두 칸으로 나눠서
   줄이 넘어가도 둘째 줄이 글 시작 자리에 맞춰 내려온다(내어쓰기).
   기호 없는 줄은 바로 위 항목에 이어지는 줄이라 그 항목의 글 시작 자리에 맞춘다(after). */
function linesHTML(lines){
  let prev = 0;
  return lines.map(t => {
    const { lv, mark, body } = lineLevel(t);
    if (!lv) return `<div class="pl lv0 after${prev}">${itemHTML(body)}</div>`;
    prev = lv;
    return `<div class="pl lv${lv}"><span class="pm">${esc(mark)}</span>${itemHTML(body)}</div>`;
  }).join('');
}

/* ── 쪽 하나를 HTML로 ────────────────────────────────────────────────────
   돌려주는 것은 #page 안에 들어갈 속이다. 바깥 16:9 틀과 색은 slide-deck.css가 잡는다. */
export function renderSlide(s){
  if (!s) return '';
  /* 쪽 맨 위 배지(선생님 지시 2026-10-30: "2026 사용한 슬라이드에서는 최상단부에 배지가 있었음.
     그 배지로 전시학습 확인, 학습 목표, 개념노트 이런걸 설명했었음. 그거 살릴 것.")
     2026의 배지(개념 Check, 미션 Check)처럼 쪽이 축의 어느 단계인지 알린다. 글자는 축 단계 이름이다.
     2027 화면 규칙에 맞춰 알약 모양과 테두리 없이 연한 레드 바탕만 깐다(배지 규칙).
     페이지 제목이 있는 쪽(개념 노트, 미션 활동)은 배지 옆에 제목이 같은 줄로 선다. */
  const top = title => s.type === 'cover' ? ''
    : `<div class="s-top"><span class="s-badge">${esc(stepName(s.step))}</span>${
        title ? `<h2 class="s-head">${inlineText(title)}</h2>` : ''}</div>`;
  const mark = top('');

  if (s.type === 'cover'){
    const no = s.no != null && String(s.no).trim() !== '' ? `${esc(s.no)}강` : '';
    const meta = [s.unit, s.pages && `교과서 ${s.pages}`].filter(Boolean).map(esc);
    return `<div class="s-cover">
      ${no ? `<div class="s-no">${no}</div>` : ''}
      <h1 class="s-title">${esc(s.title)}</h1>
      ${meta.length ? `<div class="s-meta">${meta.join('<span class="s-dot"></span>')}</div>` : ''}
    </div>`;
  }

  /* 전시학습확인: 문항 유형 셋(단답형, OX, 초성형. 선생님 지시 2026-10-30).
     유형이 가르는 것은 "학생이 어떻게 답하는가"라서 답 칸의 모양만 다르다.
       OX     : O와 X 두 칸이 처음부터 서 있고(답하는 꼴이라서), 정답인 쪽이 나중에 켜진다
       그 밖  : 답 칸이 처음에는 아예 보이지 않다가 나중에 나타난다
     답은 슬라이드 애니메이션처럼 나온다(선생님 지시 2026-10-30: "답이 늦게 나오게 해줘. 답은 내가
     화살표 버튼으로 조작하거나 페이지 업다운으로 조작할때 나오게"). 답 하나가 한 단계(data-step)이고
     넘기기를 누를 때마다 위에서부터 하나씩 나온다. 다루는 것은 아래 stepForward, stepBack.
     글배치: 묻는 줄은 번호와 유형 이름표를 머리에 두고, 답은 묻는 줄 밑으로 들여 쓴다.
     번호 칸 폭을 고정해서 문항이 여럿이어도 물음의 시작 위치가 가지런하다. */
  if (s.type === 'qa')
    return `${mark}<div class="s-body s-qa">${s.items.map((it, i) => {
      const ans = String(it.a || '').trim();
      let answer = '';
      if (it.type === 'ox'){
        const on = ans.toUpperCase();
        answer = `<div class="qa-ox" ${on === 'O' || on === 'X' ? 'data-step' : ''}>${['O','X'].map(v =>
          `<span class="qa-oxb ${on === v ? 'is' : ''}">${v}</span>`).join('')}</div>`;
      } else if (ans){
        answer = `<div class="qa-a" data-step>${inlineText(ans)}</div>`;
      }
      return `<div class="qa">
        <div class="qa-q"><span class="qa-n">${i + 1}</span>
          <span class="qa-t">${esc(reviewTypeDef(it.type).name)}</span>
          <span class="qa-txt">${inlineText(it.q)}</span></div>
        ${answer}</div>`;
    }).join('')}</div>`;

  if (s.type === 'numbered')
    return `${mark}<div class="s-body s-num">${s.items.map((t, i) => `
      <div class="nitem"><span class="nn">${i + 1}</span><span class="nt">${inlineText(t)}</span></div>`
    ).join('')}</div>`;

  if (s.type === 'media'){
    const yt = s.kind === 'video' ? youTube(s.url) : null;
    const frame = yt
      ? `<iframe src="https://www.youtube-nocookie.com/embed/${esc(yt.id)}?rel=0${yt.start ? '&start=' + yt.start : ''}"
           title="영상" allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
           allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`
      : `<img src="${esc(s.url)}" alt="${esc(s.caption || '')}" loading="lazy">`;
    return `${mark}<div class="s-body s-media">
      <div class="mframe ${s.kind === 'video' ? 'vid' : 'img'}">${frame}</div>
      ${s.caption ? `<div class="mcap">${inlineText(s.caption)}</div>` : ''}</div>`;
  }

  /* 개념 노트, 미션 활동의 페이지. 묶음마다 라벨이 위에, 내용 줄이 그 아래에 선다
     (선생님 지시 2026-10-30: "행라벨은 상단 왼쪽 정렬로 위치해주고 그 아래 빨간색 구분선을 넣어줘.
      구분선 길이는 행라벨 글씨까지만"). 라벨이 없는 묶음은 내용 줄만 선다. */
  if (s.type === 'page')
    return `${top(s.title)}<div class="s-body s-page">${s.rows.map(r =>
      `<div class="prow">${r.label ? `<div class="plabel">${inlineText(r.label)}</div>` : ''}
        <div class="plines">${linesHTML(r.lines)}</div></div>`).join('')}</div>`;

  if (s.type === 'question')
    return `${mark}<div class="s-body s-q">
      <div class="qbig">${inlineText(s.question)}</div>
      ${s.guide ? `<div class="qguide">${inlineText(s.guide)}</div>` : ''}</div>`;

  if (s.type === 'closing')
    return `${mark}<div class="s-body s-close">${s.items.map(t =>
      `<div class="cline">${inlineText(t)}</div>`).join('')}</div>`;

  return mark;
}

/* 가린 빈칸을 눌러서 여는 것. 쪽을 그린 뒤 한 번 걸어 준다.
   (전시학습확인 답은 누르는 것이 아니라 넘기기로 나온다. 아래 stepForward)
   쪽을 다시 그려도 위임이라 다시 걸 필요가 없다(컨테이너에 한 번만). */
export function wireReveal(root){
  if (!root || root.dataset.revealWired) return;
  root.dataset.revealWired = '1';
  root.addEventListener('click', e => {
    const t = e.target.closest('.blank');
    if (t) t.classList.toggle('open');
  });
}

/* ── 쪽 안의 단계(슬라이드 애니메이션) ──
   전시학습확인의 답처럼 나중에 나올 것에 data-step을 달아 둔다. 넘기기(오른쪽 화살표, PageDown,
   다음 단추)를 누르면 쪽을 넘기기 전에 아직 안 나온 것을 위에서부터 하나 꺼낸다(stepForward).
   되돌리기(왼쪽 화살표, PageUp, 이전 단추)는 마지막에 꺼낸 것부터 하나씩 도로 넣는다(stepBack).
   둘 다 할 일이 없으면 false를 돌려주고, 그때 부르는 쪽이 쪽을 넘긴다.
   뒤로 넘겨 이 쪽에 다시 들어오면 다 나온 모양으로 선다(showAllSteps). 발표 프로그램과 같은 순서다. */
export function stepForward(root){
  const el = root?.querySelector('[data-step]:not(.shown)');
  if (!el) return false;
  el.classList.remove('instant'); el.classList.add('shown');
  return true;
}
export function stepBack(root){
  const shown = root?.querySelectorAll('[data-step].shown') || [];
  if (!shown.length) return false;
  const el = shown[shown.length - 1];
  el.classList.remove('instant'); el.classList.remove('shown');
  return true;
}
export function stepsLeft(root){ return !!root?.querySelector('[data-step]:not(.shown)'); }
// 움직임 없이 한꺼번에(instant): 뒤로 들어왔을 때 답이 하나씩 날아드는 것을 다시 보이지 않게
export function showAllSteps(root){
  root?.querySelectorAll('[data-step]').forEach(el => el.classList.add('shown', 'instant'));
}
