/* 활동지 한 장을 강의 슬라이드 축에 맞춰 넣어 보는 임시 도구 (선생님 지시 2026-10-30)
 *
 *   "내가 올려주는 활동지 파일로 임시로 만들어봐"
 *   원본: 바탕화면 "29. 살아 남은 자들, 다시 갈라지다.pdf" (2쪽, 2026 3학년 역사 활동지)
 *
 * 쓰는 법
 *   node tools/활동지-29강.mjs put    Firestore에 강의 L_a29를 넣는다
 *   node tools/활동지-29강.mjs drop   그 강의를 지운다
 *   node tools/활동지-29강.mjs html   tools/29강-슬라이드.html 미리보기 문서를 굽는다 (Firebase 없이 돌아간다)
 *
 * 강의실에 꽂지 않는다. 축 편집기와 미리보기로 보는 임시 자료라 학생 화면에는 뜨지 않는다.
 * 지울 때는 drop 하나로 끝난다(강의 문서 하나뿐이라 딸린 것이 없다).
 *
 * ── 활동지에 없어서 임시로 채운 것 ──
 * 활동지는 학습 목표, 개념 노트, 미션, 생각 Check까지만 있다. 축의 나머지 세 단계
 * (전시학습확인, 동기 유발, 맺음말)는 활동지에 없는 것이라 선생님이 고치실 자리로
 * 임시 글을 넣었다. 동기 유발은 사진과 영상 주소를 지어낼 수 없어 비워 두었다
 * (빈 단계는 슬라이드에서 그냥 빠진다).
 *
 * ── 활동지 글을 그대로 옮긴 것 ──
 * 화살표(→)와 가운뎃점은 레포 규칙상 내가 쓰는 글에서는 안 쓰지만, 여기 들어간 글은
 * 선생님이 활동지에 적은 수업 내용 그 자체다. 고치면 활동지와 슬라이드가 어긋나므로
 * 원문을 손대지 않았다.
 *
 * ── 빈칸 ──
 * 활동지가 빈칸 채우기 꼴이라 핵심 낱말에 슬라이드 빈칸 문법 {낱말}을 걸어 두었다.
 * 수업 중에 눌러서 연다(slide-deck.js의 wireReveal).
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'ho0911seong-56638';
const P = `projects/${PROJECT}/databases/(default)/documents`;
const API = 'https://firestore.googleapis.com/v1';
const COLL = 'hoclass_lessons';
const LESSON_ID = 'L_a29';

// ── 활동지에서 옮긴 강의 하나 ────────────────────────────────────────────────
const 개념 = [
  ['개념 노트 #1 : 성리학적 질서의 확산', [
    '**서원** 1. 설립 : 16C 이후 {사림}이 향촌에 설립',
    '2. 기능 : 훌륭한 유학자(선현)에게 제사, 성리학 연구하며 지방 양반 자제 교육, 서원 중심으로 결속하여 공론을 모아 중앙 정치에 영향을 끼침',
    '3. 최초 : {주세붕}이 백운동 서원 건립 → 명종 대 ‘{소수서원}’이라는 사액 서원이 됨',
    '4. 영향 : 향촌 사회에 성리학적 질서 보급, 사림의 정치적 기반 강화',
  ]],
  ['사료 : 이황의 사액 서원 건의', [
    '풍기 군수 이황이 말하기를 … 뜻을 구하는 선비들은 세상에서 시끄럽게 다투는 것을 싫어하여, 한적한 들판이나 고요한 물가로 나아가 선왕의 도를 익히므로 기꺼이 서원에 나아갑니다.',
    '… 국학이나 향교는 성곽 안에 있어 학령에 구애되고 과거에 유혹되니, 그 효과를 어찌 서원과 같다 하겠습니까.',
    '… 바라건대 감사와 군수가 서원에 물품만 지원하게 하고, 가혹한 법령으로 구속하지는 못하게 해 주소서. … 서원 교육이 크게 일어난다면 선비의 풍속이 변혁되고 습속이 날로 아름다워질 것입니다.',
    '『퇴계집』',
  ]],
  ['개념 노트 #1 : 향약', [
    '**향약** 1. 의미 : 향촌의 {자치 규약} → 공동체적 생활 풍속에 유교 윤리를 덧붙여서 만듦',
    '2. 보급 : 중종 대 {조광조}가 중국의 향약 소개하면서 보급 시작',
    '→ 이황, 이이 등이 우리 실정에 맞는 향약(예안 향약, 해주 향약 등) 만들어 시행',
    '3. 영향 : 사림의 영향력 강화, 성리학적 사회 질서 확산',
  ]],
  ['개념 노트 #1 : 유교 윤리의 보급', [
    '**1. 서적 편찬**',
    '『{삼강행실도}』: 유교 기본 윤리인 삼강오륜 보급을 위해 편찬',
    '『{소학}』: 유학의 도덕과 예법을 배우는 기본서, 유학 교육의 입문서',
    '『{주자가례}』: 가정에서 지켜야 할 예법 정리한 책',
    '**2. 생활 양식** : 유교 예법에 따라 혼인과 장례를 치르고 조상의 제사를 지냄, 가묘나 사당을 설립하기도 함',
  ]],
  ['개념 노트 #2 : 붕당의 형성', [
    '**붕당 형성** 1. 사림 집권 : 사화 이후 국정 운영 중심이 왕권에서 {신권}으로 옮겨짐 → 사림이 중앙 정치 주도권 확보',
    '2. 붕당 형성 : {외척}의 정치 참여 문제, {이조 전랑}의 임명 문제를 둘러싸고 내부 갈등 심화',
    '→ 사림이 {동인}과 {서인}으로 나뉨',
  ]],
  ['개념 노트 #2 : 동인과 서인', [
    '**동인** 주로 {이황}과 조식, 서경덕 학문 계승 / 영남 지역 사림 중심 / 이후 {북인}과 남인으로 분화',
    '**서인** 주로 {이이}와 성혼의 학문 계승 / 경기, 충청 지역 사림 중심 / 이후 {노론}과 소론으로 분화',
  ]],
  ['사료 : 동인과 서인의 분당', [
    '이조 전랑 자리를 두고 김효원과 심의겸이 서로 맞섰다. 심의겸은 김효원이 예전에 외척 윤원형의 집에 드나든 자라 하여 그가 전랑이 되는 것을 막았다.',
    '뒤에 김효원이 전랑이 되자, 이번에는 심의겸의 동생 심충겸이 그 자리에 추천되었다. 김효원이 말하기를 "이조의 벼슬자리가 어찌 외척 집안의 물건이냐?" 하며 반대하였다.',
    '이때부터 당론이 나뉘었다. 김효원을 지지하는 이들은 그가 한양 동쪽에 살아 {동인}(東人)이라 불렸고, 심의겸을 지지하는 이들은 그가 한양 서쪽에 살아 {서인}(西人)이라 불렸다.',
    '『당의통략』',
  ]],
];

export const LESSON = {
  id: LESSON_ID,
  title: '살아 남은 자들, 다시 갈라지다',
  createdAt: Date.now(),
  order: ['concept', 'mission', 'question'],
  parts: {
    concept: {
      title: '개념 노트',
      // 'divider' 줄이 슬라이드 쪽을 나눈다(slide-deck.js의 buildSlides)
      content: 개념.flatMap(([쪽, 줄]) => [
        { type:'divider', title:쪽 },
        ...줄.map(text => ({ type:'row', text })),
      ]),
    },
    mission: { title: '미션 Check : 사화에서 살아남기' },
    question: {
      title: '오늘의 질문',
      question: '사림은 왜 정권을 장악한 뒤에 다시 둘로 나뉘게 되었을까?',
      guide: '사림은 수 차례 화를 입었지만, 지방의 서원 등을 중심으로 다시 힘을 모아 결국 선조 대에는 '
        + '권력을 장악하게 되었습니다. 하지만 그들은 결국 붕당을 형성하면서 다시 나누어지게 되었는데요. '
        + '같은 길을 걷던 자들이 왜 둘로 다시 나누어지게 되었을까요? 여러분들의 생각을 이유와 함께 자유롭게 작성해 보세요.',
    },
  },
  deck: {
    cover: { unit: 'Ⅳ-2. 사림의 성장과 문화의 발달', pages: 'p.117~119' },

    // 활동지에 없는 단계: 지난 차시(사화)를 묻는 임시 문항이다. 선생님이 고치실 자리
    review: { items: [
      { q: '조선에서 사림과 훈구가 충돌해 사림이 큰 화를 입은 네 차례의 사건을 무엇이라 하는가?', a: '사화' },
      { q: '조광조의 개혁이 꺾이고 사림이 쫓겨난 중종 대의 사화는?', a: '기묘사화' },
      { q: '사화를 겪은 사림이 힘을 다시 모은 곳은 향촌의 무엇인가?', a: '서원과 향약' },
    ]},

    // 활동지에 없는 단계. 사진과 영상 주소는 지어낼 수 없어 비워 둔다(빈 단계는 슬라이드에서 빠진다)
    objective: { items: [
      '서원과 향약이 보급되면서 조선에 성리학적 질서가 확산되었음을 설명할 수 있다.',
      '사림이 붕당을 형성하는 배경과 과정에 대해 말할 수 있다.',
    ]},
    hook: { items: [] },

    mission: { items: [
      '1. LMS 시스템 속 미션 Check 중 ‘사화에서 살아남기’를 선택합니다. 선생님이 알려주는 방 코드를 입력하여 게임에 입장합니다.',
      '2. 게임을 시작하기 전, 나의 선비 캐릭터를 설정합니다. 나의 호(號)를 짓고, 스승(‘이황, 조식’ 또는 ‘이이, 성혼’)과 기반(‘중앙 관직형’ 또는 ‘향촌 서원형’)을 고릅니다.',
      '3. 1498년부터 1575년까지, 여섯 장면을 차례로 헤쳐 나갑니다. 상황을 읽고 제한 시간 안에 선택합니다. 선택에 따라 관직(官)과 명예(名)가 오르내리고, 살아남거나 화를 입습니다.',
      '4. 마지막 장면까지 마치면 결말이 나오고, 나의 77년이 정리됩니다. 마지막으로 ‘소감 남기기’에 오늘 알게 된 것과 생각한 것을 적습니다.',
    ]},

    // 활동지에 없는 단계. 선생님이 고치실 자리
    closing: { items: [
      '사림은 살아남아 권력을 잡았지만, 그 안에서 다시 갈라졌습니다.',
      '다음 시간에는 갈라진 붕당이 어떻게 맞서 갔는지를 봅니다.',
    ]},
  },
};

// ── Firestore (Firebase CLI 계정 토큰으로 REST. 더미데이터.mjs와 같은 길) ──
async function token(){
  const ft = path.join(execSync('npm root -g').toString().trim(), 'firebase-tools');
  const auth = createRequire(import.meta.url)(path.join(ft, 'lib/auth.js'));
  const acct = auth.getGlobalDefaultAccount();
  if (!acct) throw new Error('firebase login 먼저 해 주세요.');
  return (await auth.getAccessToken(acct.tokens.refresh_token,
    ['https://www.googleapis.com/auth/cloud-platform'])).access_token;
}
const toV = v => v === null || v === undefined ? { nullValue:null }
  : typeof v === 'boolean' ? { booleanValue:v }
  : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue:String(v) } : { doubleValue:v })
  : typeof v === 'string' ? { stringValue:v }
  : Array.isArray(v) ? { arrayValue:{ values:v.map(toV) } }
  : { mapValue:{ fields:Object.fromEntries(Object.entries(v)
      .filter(([, x]) => x !== undefined).map(([k, x]) => [k, toV(x)])) } };

async function put(){
  const H = { Authorization:`Bearer ${await token()}`, 'Content-Type':'application/json' };
  const fields = Object.fromEntries(Object.entries(LESSON).map(([k, v]) => [k, toV(v)]));
  const res = await fetch(`${API}/${P}:commit`, { method:'POST', headers:H, body:JSON.stringify({
    writes: [{ update: { name:`${P}/${COLL}/${LESSON_ID}`, fields } }],
  })});
  if (!res.ok) throw new Error(`쓰기 실패 ${res.status} ${(await res.text()).slice(0, 300)}`);
  console.log(`넣었다: ${COLL}/${LESSON_ID} "${LESSON.title}"`);
  console.log('강의실에 꽂지는 않았다. 어드민 개념 노트 - 콘텐츠에서 보인다.');
}
async function drop(){
  const H = { Authorization:`Bearer ${await token()}`, 'Content-Type':'application/json' };
  const res = await fetch(`${API}/${P}:commit`, { method:'POST', headers:H, body:JSON.stringify({
    writes: [{ delete: `${P}/${COLL}/${LESSON_ID}` }],
  })});
  if (!res.ok) throw new Error(`지우기 실패 ${res.status} ${(await res.text()).slice(0, 300)}`);
  console.log(`지웠다: ${COLL}/${LESSON_ID}`);
}

/* 혼자 도는 미리보기 문서를 굽는다. slide-deck.js와 slide-deck.css를 그대로 끼워 넣어
   Firebase 없이 열린다. 쪽을 한 장씩 넘기지 않고 한 화면에 세로로 늘어놓아서,
   축 여덟 단계가 어떤 순서로 나오는지를 한눈에 본다. */
async function html(){
  const { buildSlides, renderSlide } = await import('../slide-deck.js');
  const { SLIDE_AXIS } = await import('../shared/slide-axis.js');
  const slides = buildSlides(structuredClone(LESSON), 29);
  const theme = fs.readFileSync(path.join(ROOT, 'shared/theme.css'), 'utf8');
  const deckCss = fs.readFileSync(path.join(ROOT, 'slide-deck.css'), 'utf8')
    .replace(/@import[^;]+;/, '');   // 테마는 위에 직접 끼우므로 import는 뺀다
  const stepName = k => (SLIDE_AXIS.find(a => a.key === k) || {}).name || '';

  const cards = slides.map((s, i) => `
  <section class="slot">
    <div class="slotbar"><span class="slotno">${i + 1}</span>
      <span class="slotstep">${stepName(s.step)}</span></div>
    <div class="deckframe"><div class="deckpage">${renderSlide(s)}</div></div>
  </section>`).join('');

  const axisList = SLIDE_AXIS.map((ax, i) => {
    const n = slides.filter(s => s.step === ax.key).length;
    return `<li class="${n ? '' : 'none'}"><b>${i + 1}</b> ${ax.name}
      <span>${n ? n + '쪽' : '비었음'}</span></li>`;
  }).join('');

  const out = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>29강 슬라이드 미리보기</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<style>
${theme}
${deckCss}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font);
  -webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:0 auto;padding:26px 18px 80px}
h1{font-size:var(--fs-title);margin:0 0 4px;letter-spacing:-.3px}
.sub{font-size:var(--fs-body);color:var(--sub);margin:0 0 22px}
.axis{list-style:none;margin:0 0 30px;padding:0;display:grid;gap:0;
  border-top:1px solid var(--line-strong);border-bottom:1px solid var(--line-strong)}
.axis li{display:flex;align-items:center;gap:10px;min-height:var(--h-row);
  font-size:var(--fs-body);font-weight:700;border-top:1px solid var(--line)}
.axis li:first-child{border-top:0}
.axis li b{display:grid;place-items:center;width:22px;height:22px;background:var(--navy);
  color:#fff;font-size:var(--fs-meta)}
.axis li span{margin-left:auto;font-weight:500;color:var(--sub);font-size:var(--fs-meta)}
.axis li.none{color:var(--sub);font-weight:500}
.axis li.none b{background:var(--line-strong)}
.slot{margin-bottom:26px}
.slotbar{display:flex;align-items:center;gap:9px;margin-bottom:7px}
.slotno{display:grid;place-items:center;width:22px;height:22px;background:var(--navy);color:#fff;
  font-size:var(--fs-meta);font-weight:700}
.slotstep{font-size:var(--fs-meta);font-weight:700;color:var(--red);letter-spacing:.06em}
.slot .deckframe{width:100%;border:1px solid var(--line)}
</style></head><body>
<div class="wrap">
  <h1>29강. ${LESSON.title}</h1>
  <p class="sub">${LESSON.deck.cover.unit} (교과서 ${LESSON.deck.cover.pages}), 쪽 ${slides.length}장</p>
  <ul class="axis">${axisList}</ul>
  ${cards}
</div>
<script>
// 가린 빈칸과 전시학습확인 답을 눌러서 연다(slide-deck.js의 wireReveal과 같은 동작)
document.addEventListener('click', e => {
  const t = e.target.closest('.blank, .qa-a');
  if (t) t.classList.toggle('open');
});
</script>
</body></html>`;
  const dest = path.join(ROOT, 'tools/29강-슬라이드.html');
  fs.writeFileSync(dest, out, 'utf8');
  console.log(`구웠다: ${path.relative(ROOT, dest)}  (쪽 ${slides.length}장)`);
  slides.forEach((s, i) => console.log(`  ${i + 1}. [${stepName(s.step)}] ${s.title || s.type}`));
}

/* 이 파일은 LESSON을 내보내기도 한다(다른 도구가 활동지 자료만 꺼내 쓸 수 있게).
   그럴 때 명령 안내문이 끼어들지 않도록, 이 파일을 직접 돌렸을 때만 명령을 받는다. */
const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct){
  const cmd = process.argv[2];
  if (cmd === 'put') await put();
  else if (cmd === 'drop') await drop();
  else if (cmd === 'html') await html();
  else console.log('쓰는 법: node tools/활동지-29강.mjs put | drop | html');
}
