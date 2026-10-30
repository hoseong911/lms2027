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
    title: String(p.title || '').trim() || fallback,
    rows: p.rows.map(r => ({
      label: String(r.label || '').trim(),
      lines: String(r.text || '').split('\n').map(t => t.trim()).filter(Boolean),
    })).filter(r => r.lines.length || r.label),
  })).filter(p => p.rows.length || String(p.title).trim());
}

// 축 단계 이름(쪽 맨 위 배지). 표지에는 달지 않는다
const stepName = key => (SLIDE_AXIS.find(a => a.key === key) || {}).name || '';

/* 내용 줄 하나. 단계는 줄 앞 기호가 정한다(1. 1단계, - 2단계, · 3단계. slide-axis.js의 lineLevel).
   단계가 내려갈수록 들여 쓴다(선생님 지시 2026-10-30). 기호와 글을 두 칸으로 나눠서
   줄이 넘어가도 둘째 줄이 글 시작 자리에 맞춰 내려온다(내어쓰기).
   기호 없는 줄은 바로 위 항목에 이어지는 줄이라 그 항목의 글 시작 자리에 맞춘다(after). */
function linesHTML(lines){
  let prev = 0;
  return lines.map(t => {
    const { lv, mark, body } = lineLevel(t);
    if (!lv) return `<div class="pl lv0 after${prev}"><span class="pt">${inlineText(body)}</span></div>`;
    prev = lv;
    return `<div class="pl lv${lv}"><span class="pm">${esc(mark)}</span><span class="pt">${inlineText(body)}</span></div>`;
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
       OX     : O와 X 두 칸이 서고 정답인 쪽이 눌러서 열린다
       그 밖  : 가린 답 한 칸이 눌러서 열린다
     글배치: 묻는 줄은 번호와 유형 이름표를 머리에 두고, 답은 묻는 줄 밑으로 들여 쓴다.
     번호 칸 폭을 고정해서 문항이 여럿이어도 물음의 시작 위치가 가지런하다. */
  if (s.type === 'qa')
    return `${mark}<div class="s-body s-qa">${s.items.map((it, i) => {
      const ans = String(it.a || '').trim();
      let answer = '';
      if (it.type === 'ox'){
        const on = ans.toUpperCase();
        answer = `<div class="qa-ox">${['O','X'].map(v =>
          `<button class="qa-oxb ${on === v ? 'is' : ''}" data-act="reveal">${v}</button>`).join('')}</div>`;
      } else if (ans){
        answer = `<button class="qa-a" data-act="reveal">${inlineText(ans)}</button>`;
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

  /* 개념 노트, 미션 활동의 페이지. 묶음마다 왼쪽에 라벨, 오른쪽에 내용 줄(2026 편집기의 행 모양).
     라벨이 하나라도 있는 페이지는 두 칸 격자로 세워 라벨 칸 폭을 페이지 안에서 맞춘다
     (가장 긴 라벨에 맞춰지므로 내용 시작선이 가지런하다). 라벨이 없는 페이지는 내용이 폭을 다 쓴다. */
  if (s.type === 'page'){
    const hasLabel = s.rows.some(r => r.label);
    return `${top(s.title)}<div class="s-body s-page ${hasLabel ? 'haslabel' : ''}">${s.rows.map(r =>
      `<div class="prow">${hasLabel ? `<div class="plabel">${inlineText(r.label)}</div>` : ''}
        <div class="plines">${linesHTML(r.lines)}</div></div>`).join('')}</div>`;
  }

  if (s.type === 'question')
    return `${mark}<div class="s-body s-q">
      <div class="qbig">${inlineText(s.question)}</div>
      ${s.guide ? `<div class="qguide">${inlineText(s.guide)}</div>` : ''}</div>`;

  if (s.type === 'closing')
    return `${mark}<div class="s-body s-close">${s.items.map(t =>
      `<div class="cline">${inlineText(t)}</div>`).join('')}</div>`;

  return mark;
}

/* 가린 빈칸과 전시학습확인 답을 눌러서 여는 것. 쪽을 그린 뒤 한 번 걸어 준다.
   쪽을 다시 그려도 위임이라 다시 걸 필요가 없다(컨테이너에 한 번만). */
export function wireReveal(root){
  if (!root || root.dataset.revealWired) return;
  root.dataset.revealWired = '1';
  root.addEventListener('click', e => {
    // OX는 어느 쪽을 눌러도 두 칸이 같이 열린다: 어느 쪽이 답인지 보여 주는 것이 목적이다
    const ox = e.target.closest('.qa-ox');
    if (ox){
      const on = ox.querySelector('.qa-oxb.open');
      ox.querySelectorAll('.qa-oxb').forEach(b => b.classList.toggle('open', !on));
      return;
    }
    const t = e.target.closest('.blank, .qa-a');
    if (t) t.classList.toggle('open');
  });
}
