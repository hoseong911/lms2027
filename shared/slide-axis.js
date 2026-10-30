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
 *   'concept'   parts.concept.content 를 그대로 쓴다(개념 노트 줄 편집기가 이미 있다)
 *   'mission'   parts.mission 의 제목을 머리글로 쓰고, 활동 안내 줄은 덱이 들고 있다
 *   'question'  parts.question 의 질문과 설명문을 그대로 쓴다
 * 같은 내용을 두 군데 적지 않게 하려고 이렇게 갈랐다. 미션 활동 메뉴에서 제목을 고치면
 * 슬라이드 제목도 같이 바뀐다.
 *
 * edit 는 어드민 편집기가 그 단계를 어떤 칸으로 그릴지다(admin.js의 deckStepEditor).
 *   cover 표지 메타 / qa 문답 / lines 줄 목록 / media 사진과 영상 / concept 개념 줄 / question 읽기만
 */
export const SLIDE_AXIS = [
  { key:'cover',     name:'표지',         edit:'cover',    from:null },
  { key:'review',    name:'전시학습확인',  edit:'qa',       from:null },
  { key:'objective', name:'학습 목표',     edit:'lines',    from:null },
  { key:'hook',      name:'동기 유발',     edit:'media',    from:null },
  { key:'concept',   name:'개념 노트',     edit:'concept',  from:'concept' },
  { key:'mission',   name:'미션 활동',     edit:'lines',    from:'mission' },
  { key:'question',  name:'오늘의 질문',   edit:'question', from:'question' },
  { key:'closing',   name:'맺음말',        edit:'lines',    from:null },
];
export const AXIS_ORDER = SLIDE_AXIS.map(s => s.key);
export function axisStep(key){ return SLIDE_AXIS.find(s => s.key === key) || null; }

/* 전시학습확인 문항의 유형 셋 (선생님 지시 2026-10-30: "단답형 OX 초성형 3개 유형").
   말씀하신 순서 그대로다. 키는 형성평가(model.js의 FORMATIVE_TYPES)와 같게 맞췄다:
   같은 것을 두 이름으로 부르지 않으려는 것이다. 다만 형성평가는 ox를 "진위형"이라 부르고
   여기서는 선생님이 말씀하신 "OX"로 적는다(두 이름을 하나로 맞출지는 선생님께 물어볼 자리).

   유형이 슬라이드에서 가르는 것은 "학생이 어떻게 답하는가"다.
     short   단답형  답을 말이나 글로
     ox      OX      O인지 X인지
     initial 초성형  초성을 보고 낱말을
   초성은 선생님이 문제 글에 직접 적는다(형성평가와 같은 규칙. 자동으로 만들지 않는다). */
export const REVIEW_TYPES = [
  { key:'short',   name:'단답형' },
  { key:'ox',      name:'OX' },
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
    mission:   { items:[] },            // ['안내 한 줄', ...]
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
  return lesson.deck;
}
