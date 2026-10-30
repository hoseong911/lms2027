/* ══ 강의 슬라이드의 축 (선생님 지시 2026-10-30, 요구사항 125) ══════════════
 *
 * "표지 - 전시학습확인(퀴즈 등) - 학습 목표 - 동기 유발 내용(사진, 영상류) -
 *  개념 노트(강의 내용) - 미션 활동 - 오늘의 질문 - 맺음말 이 순서야"
 *
 * 수업 한 차시의 흐름이라 순서와 단계가 고정이다. 선생님이 더하고 빼고 섞는 것이 아니다.
 * (hoistory 2026은 섹션을 자유롭게 짜는 틀이었다. 2027은 선생님이 쓰는 수업 흐름 하나로 못박았다.)
 * 단계마다 내용이 없으면 그 단계는 슬라이드에서 그냥 빠진다. 끄고 켜는 스위치를 따로 두지 않는다.
 *
 * ── 이 파일이 model.js 밖에 따로 있는 까닭 ──
 * model.js는 맨 위에서 Firebase를 불러온다. 축과 덱의 모양만 알면 되는 쪽(슬라이드 엔진,
 * 활동지 변환 도구, 혼자 도는 미리보기 문서)이 Firebase까지 끌어오지 않게 갈라 두었다.
 * model.js가 이 파일을 불러 그대로 다시 내보내므로 어드민과 학생 화면은 M.SLIDE_AXIS로 쓴다.
 *
 * 내용이 어디서 오는가(from)
 *   null        그 단계가 덱(lesson.deck)에 직접 들고 있다
 *   'concept'   parts.concept.content 를 그대로 쓴다(아래 toPages의 페이지 모양)
 *   'mission'   페이지는 덱(deck.mission.content)이 들고 있고, 페이지 제목을 비우면
 *               parts.mission 의 제목(미션 활동 메뉴의 이름)을 쓴다
 *   'question'  parts.question 의 질문과 설명문을 그대로 쓴다
 * 같은 내용을 두 군데 적지 않게 하려고 이렇게 갈랐다. 미션 활동 메뉴에서 제목을 고치면
 * 슬라이드 제목도 같이 바뀐다.
 *
 * edit 는 어드민 편집기가 그 단계를 어떤 칸으로 그릴지다(admin.js의 deckStepEditor).
 *   cover 표지 메타 / qa 문답 / lines 줄 목록 / media 사진과 영상 / pages 페이지 / question 읽기만
 * 개념 노트와 미션 활동은 둘 다 pages다(2026 편집기가 둘을 같은 틀로 고쳤다).
 */
export const SLIDE_AXIS = [
  { key:'cover',     name:'표지',         edit:'cover',    from:null },
  { key:'review',    name:'전시학습확인',  edit:'qa',       from:null },
  { key:'objective', name:'학습 목표',     edit:'lines',    from:null },
  { key:'hook',      name:'동기 유발',     edit:'media',    from:null },
  { key:'concept',   name:'개념 노트',     edit:'pages',    from:'concept' },
  { key:'mission',   name:'미션 활동',     edit:'pages',    from:'mission' },
  { key:'question',  name:'오늘의 질문',   edit:'question', from:'question' },
  { key:'closing',   name:'맺음말',        edit:'lines',    from:null },
];
export const AXIS_ORDER = SLIDE_AXIS.map(s => s.key);
export function axisStep(key){ return SLIDE_AXIS.find(s => s.key === key) || null; }

/* 전시학습확인 문항의 유형 셋 (선생님 지시 2026-10-30: "단답형 OX 초성형 3개 유형").
   말씀하신 순서 그대로다. 키도 이름도 형성평가(model.js의 FORMATIVE_TYPES)와 같다:
   ox를 전시학습확인에서만 "OX"로 부르던 것을 선생님 지시로 진위형으로 맞췄다
   (2026-10-30: "전시 학습 확인에서 ox를 진위형으로 바꿔주고"). 같은 것을 두 이름으로 부르지 않는다.

   유형이 슬라이드에서 가르는 것은 "학생이 어떻게 답하는가"다.
     short   단답형  답을 말이나 글로
     ox      진위형  O인지 X인지 (답 칸은 O와 X 라디오 그대로다. 이름만 진위형이다)
     initial 초성형  초성을 보고 낱말을
   초성은 선생님이 문제 글에 직접 적는다(형성평가와 같은 규칙. 자동으로 만들지 않는다). */
export const REVIEW_TYPES = [
  { key:'short',   name:'단답형' },
  { key:'ox',      name:'진위형' },
  { key:'initial', name:'초성형' },
];
export function reviewTypeDef(key){ return REVIEW_TYPES.find(t => t.key === key) || REVIEW_TYPES[0]; }

/* 덱(lesson.deck): 축 단계마다 칸 하나. 덱이 직접 들고 있는 것만 여기 있다.
   개념 노트와 오늘의 질문은 parts 쪽에 있으므로 덱에 칸을 두지 않는다. */
export function blankDeck(){
  return {
    cover:     { unit:'', pages:'' },   // 단원, 교과서 쪽수
    review:    { items:[] },            // [{ q, a }]
    objective: { items:[] },            // ['목표 한 줄', ...]
    hook:      { items:[] },            // [{ kind:'image'|'video', url, caption }]
    mission:   { content:[] },          // 개념 노트와 같은 페이지 모양(아래 toPages)
    closing:   { items:[] },            // ['맺음말 한 줄', ...]
  };
}

/* 모양을 맞춰 준다: 옛 문서에 deck이 없거나 칸이 빠져 있어도 화면이 깨지지 않게.
   받은 강의 객체를 그 자리에서 고치고 덱을 돌려준다(저장은 부르는 쪽이 한다). */
export function normalizeDeck(lesson){
  if (!lesson) return null;
  const base = blankDeck();
  if (!lesson.deck || typeof lesson.deck !== 'object') lesson.deck = base;
  else Object.keys(base).forEach(k => {
    if (!lesson.deck[k] || typeof lesson.deck[k] !== 'object') lesson.deck[k] = base[k];
    else if (Array.isArray(base[k].items) && !Array.isArray(lesson.deck[k].items)) lesson.deck[k].items = [];
  });
  /* 전시학습확인에 유형이 생기기 전(2026-10-30 낮)에 적어 둔 문항은 유형 칸이 없다.
     그런 문항은 단답형으로 본다: 그때 적을 수 있던 것이 묻는 줄과 답 줄뿐이었다. */
  lesson.deck.review.items.forEach(it => {
    if (it && typeof it === 'object' && !REVIEW_TYPES.some(t => t.key === it.type)) it.type = 'short';
  });
  /* 미션 활동이 페이지 모양이 되기 전(2026-10-30 낮)에는 안내 줄 목록(items)이었다.
     그 줄들을 제목 없는 페이지 하나, 라벨 없는 묶음 하나로 옮긴다
     (페이지 제목이 비면 슬라이드에는 미션 이름이 선다). */
  const ms = lesson.deck.mission;
  if (!Array.isArray(ms.content)){
    const old = (Array.isArray(ms.items) ? ms.items : []).map(t => String(t ?? '').trim()).filter(Boolean);
    ms.content = old.length ? [{ type:'divider', title:'' }, { type:'row', label:'', text:old.join('\n') }] : [];
  }
  delete ms.items;
  return lesson.deck;
}

/* ══ 개념 노트와 미션 활동의 페이지 (선생님 지시 2026-10-30) ═══════════════════
 *
 * "2026에 사용한 lms 콘텐츠 편집기를 참고하여 개념노트 페이지와 미션 활동 페이지 만들어줄것"
 *
 * 2026 편집기(개념 Check, 미션 Check)의 틀을 보고 따랐다: 페이지마다 제목이 있고,
 * 페이지 안은 "라벨 + 내용" 묶음 여러 개다. 내용은 한 줄이 한 항목이다.
 * 2026은 개념과 미션을 같은 편집기로 고쳤다. 2027도 둘이 같은 모양, 같은 편집기다.
 *
 * 저장 모양은 예전 개념 노트 줄 배열을 그대로 잇는다(옛 강의를 옮기지 않아도 되게):
 *   { type:'divider', title }        페이지 제목. 여기서 새 페이지
 *   { type:'row', label, text }      묶음 하나. text는 여러 줄(줄바꿈으로 나눈다)
 * 개념 노트는 parts.concept.content, 미션 활동은 deck.mission.content 에 든다.
 *
 * 예전 줄(label 칸이 아예 없는 row)은 한 줄이 row 하나였다. 그런 줄이 이어지면
 * 페이지로 펼 때 한 묶음으로 합친다(보이는 모양은 같고 편집기에서 칸이 줄줄이 서지 않게).
 * 새로 만든 묶음은 label 칸을 늘 들고 있어서(빈 글자라도) 합쳐지지 않는다.
 */
export function toPages(content){
  const pages = [];
  let cur = null, lastLegacy = false;
  (Array.isArray(content) ? content : []).forEach(ln => {
    if (!ln || typeof ln !== 'object') return;
    if (ln.type === 'divider'){
      cur = { title: String(ln.title ?? ''), rows: [] }; pages.push(cur); lastLegacy = false; return;
    }
    if (!cur){ cur = { title: '', rows: [] }; pages.push(cur); }
    const legacy = !('label' in ln);
    const text = String(ln.text ?? '');
    if (legacy && lastLegacy) cur.rows[cur.rows.length - 1].text += '\n' + text;
    else cur.rows.push({ label: String(ln.label ?? ''), text });
    lastLegacy = legacy;
  });
  return pages;
}
export function fromPages(pages){
  const out = [];
  (pages || []).forEach(p => {
    out.push({ type:'divider', title: String(p.title ?? '') });
    (p.rows || []).forEach(r => out.push({ type:'row', label: String(r.label ?? ''), text: String(r.text ?? '') }));
  });
  return out;
}

/* ── 내용 줄의 단계 (선생님 지시 2026-10-30) ──
 * "내용 수준 단계는 총 3단계로 1. , -, · 임. 활동지에서 수준이 떨어질 수록 들여쓰기를 해야 함."
 *
 *   1단계  1. 2. 3.   (숫자와 마침표)
 *   2단계  -
 *   3단계  ·          (가운뎃점. 한글 자판의 ㆍ, 일본식 ・, 동그라미 • 도 같이 받는다)
 *   0      기호 없는 줄. 바로 위 항목에 이어지는 줄로 본다
 *
 * 기호는 선생님이 활동지에 쓴 글자 그대로라 줄 글자에 남겨 둔다. 단계를 따로 적어 두지 않는다.
 * 그래서 이 함수가 슬라이드(들여쓰기), 편집기(칸 안 들여쓰기), 활동지 변환(라벨 가리기)의
 * 공통 기준이다. 여기만 고치면 셋이 같이 바뀐다.
 *
 * "1.5배", "-5도"처럼 기호가 내용인 줄을 잘못 읽지 않게 숫자가 바로 붙으면 기호로 보지 않는다.
 * (글머리 기호를 가려내는 정규식이라 가운뎃점 글자 자체가 자료다. 화면 규칙의 예외 자리)
 */
const LEVEL_RES = [
  [1, /^(\d{1,2}\.)(?!\d)\s*/],
  [2, /^([-–])(?!\s*\d)\s*/],
  [3, /^([·ㆍ・•∙])\s*/],
];
export function lineLevel(line){
  const s = String(line ?? '').replace(/^[\s　]+/, '');
  for (const [lv, re] of LEVEL_RES){
    const m = s.match(re);
    if (m && s.length > m[0].length) return { lv, mark: m[1], body: s.slice(m[0].length) };
  }
  return { lv: 0, mark: '', body: s };
}

/* 편집기 글 칸에서 단계가 보이게 줄 앞에 빈칸을 넣고(indentText), 저장할 때 걷는다(stripIndent).
   저장되는 글에는 들여쓰기 빈칸이 없다. 단계는 기호가 정하므로 빈칸은 보기용일 뿐이다.
   기호 없는 줄은 바로 위 항목의 글 시작 자리에 맞춘다(기호 폭만큼 더 민다). */
const IND = 4;
export function indentText(text){
  let prev = 0, prevMark = 0;
  return String(text ?? '').split('\n').map(raw => {
    const t = raw.replace(/^[\s　]+/, '');
    if (!t) return '';
    const { lv, mark } = lineLevel(t);
    if (lv){ prev = (lv - 1) * IND; prevMark = mark.length + 1; return ' '.repeat(prev) + t; }
    return ' '.repeat(prev + prevMark) + t;
  }).join('\n');
}
export function stripIndent(text){
  return String(text ?? '').split('\n').map(t => t.replace(/^[\s　]+/, '').replace(/\s+$/, ''))
    .join('\n').replace(/^\n+|\n+$/g, '');
}

/* ── 페이지 제목의 단계 이름 머리 (선생님 지시 2026-10-30) ──
 * "개념 노트 #1 : 성리학적 질서의 확산이면 성리학적 질서의 확산 이렇게만"
 * 배지가 이미 단계 이름을 말하므로 제목에 같은 말을 또 두지 않는다. 떼는 것은 단계 이름 꼴의
 * 머리뿐이다(개념 노트, 개념 Check, 미션 활동, 미션 Check, 뒤에 #번호가 붙어도).
 * "사료 : ..."의 사료는 단계 이름이 아니라 쪽의 종류라 여기서 떼지 않는다(slide-deck.js가 사료 쪽으로 그린다).
 * 활동지 변환(worksheet-pdf.js)이 가져올 때 떼고, 슬라이드(slide-deck.js)도 그릴 때 한 번 더 뗀다
 * (손으로 적은 제목이나 예전에 가져온 제목에 머리가 남아 있어도 쪽에는 서지 않게). */
export const STEP_PREFIX_RE = /^(?:개념\s*노트|개념\s*Check|미션\s*활동|미션\s*Check)\s*(?:#\s*\d+)?\s*:\s*/i;
export const stripStepPrefix = t => String(t ?? '').trim().replace(STEP_PREFIX_RE, '').trim();
