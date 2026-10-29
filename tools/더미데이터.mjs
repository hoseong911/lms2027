// 2027 LMS 더미 데이터 (선생님 지시 2026-10-28: "모든 메뉴가 다 데이터가 채워졌다고 가정하고")
//
//   node tools/더미데이터.mjs fill    더미를 채운다
//   node tools/더미데이터.mjs clear   dummy: true 표시가 있는 문서(제출물, 성적, 미션 앱)를 지운다
//
// 바탕(학년도 1, 강의실 6, 명단 150, 꽂힌 강의 60, 강의 L_h01~L_h10)이 Firestore에
// 있어야 한다. 그 위에 강의 내용, 질문, 미션, 형성평가, 미션 앱, 반 요일, 제출물, AI 채점 결과,
// 성적을 채운다.
//
// 만드는 방법: model.js를 노드에서 그대로 돌린다(Firestore 부분만 흉내). 그래서 문서 모양이
// 화면이 쓰는 것과 똑같다. 쓰기는 Firebase CLI에 로그인된 계정의 토큰으로 REST를 쓴다
// (`firebase login`이 돼 있어야 한다. 규칙을 거치지 않으므로 어드민 로그인이 필요 없다).
// 다시 채우려면 clear를 먼저 한다(제출물과 성적이 겹쳐 쌓이지 않게 fill은 더미가 있으면 멈춘다).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'ho0911seong-56638';
const P = `projects/${PROJECT}/databases/(default)/documents`;
const API = 'https://firestore.googleapis.com/v1';

// ── Firebase CLI 계정 토큰 ──
async function token(){
  const ft = path.join(execSync('npm root -g').toString().trim(), 'firebase-tools');
  const auth = createRequire(import.meta.url)(path.join(ft, 'lib/auth.js'));
  const acct = auth.getGlobalDefaultAccount();
  if (!acct) throw new Error('firebase login 먼저 해 주세요.');
  return (await auth.getAccessToken(acct.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform'])).access_token;
}
const TOK = await token();
const H_ = { Authorization:`Bearer ${TOK}`, 'Content-Type':'application/json' };

// ── Firestore 값 <-> JS ──
const fromV = x => 'stringValue' in x ? x.stringValue : 'integerValue' in x ? +x.integerValue
  : 'doubleValue' in x ? x.doubleValue : 'booleanValue' in x ? x.booleanValue : 'nullValue' in x ? null
  : 'mapValue' in x ? Object.fromEntries(Object.entries(x.mapValue.fields || {}).map(([k, y]) => [k, fromV(y)]))
  : 'arrayValue' in x ? (x.arrayValue.values || []).map(fromV) : null;
const toV = v => v === null || v === undefined ? { nullValue:null }
  : typeof v === 'boolean' ? { booleanValue:v }
  : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue:String(v) } : { doubleValue:v })
  : typeof v === 'string' ? { stringValue:v }
  : Array.isArray(v) ? { arrayValue:{ values:v.map(toV) } }
  : { mapValue:{ fields:Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, toV(x)])) } };
const docRow = d => ({ ...fromV({ mapValue:{ fields:d.fields || {} } }), id:d.name.split('/').pop() });

async function listAll(coll){
  const out = []; let tok = '';
  do {
    const r = await (await fetch(`${API}/${P}/${coll}?pageSize=1000${tok ? '&pageToken=' + tok : ''}`, { headers:H_ })).json();
    (r.documents || []).forEach(d => out.push(docRow(d)));
    tok = r.nextPageToken || '';
  } while (tok);
  return out;
}
async function commit(writes){
  for (let i = 0; i < writes.length; i += 400){
    const res = await fetch(`${API}/${P}:commit`, { method:'POST', headers:H_, body:JSON.stringify({ writes:writes.slice(i, i + 400) }) });
    if (!res.ok) throw new Error(`쓰기 실패 ${res.status} ${(await res.text()).slice(0, 300)}`);
    console.log(`  ${Math.min(i + 400, writes.length)} / ${writes.length}`);
  }
}

const DUMMY_COLLS = ['course_submissions', 'course_grades', 'mission_apps'];
const cmd = process.argv[2];

if (cmd === 'clear'){
  const dels = [];
  for (const c of DUMMY_COLLS) (await listAll(c)).filter(r => r.dummy === true).forEach(r => dels.push({ delete:`${P}/${c}/${r.id}` }));
  console.log(`지울 더미 문서 ${dels.length}건`);
  await commit(dels);
  process.exit(0);
}
if (cmd !== 'fill'){ console.log('쓰는 법: node tools/더미데이터.mjs fill | clear'); process.exit(1); }

// ── 지금 데이터 읽기 ──
const COLLS = ['school_years', 'courses', 'course_students', 'course_lessons', 'lessons', ...DUMMY_COLLS];
const cur = {};
for (const c of COLLS) cur[c] = await listAll(c);
if (DUMMY_COLLS.some(c => cur[c].some(r => r.dummy))){ console.log('더미가 이미 있습니다. clear를 먼저 해 주세요.'); process.exit(1); }
if (!cur.lessons.some(l => l.id === 'L_h01')){ console.log('바탕 더미(강의 L_h01 등)가 없습니다.'); process.exit(1); }
const settings = Object.fromEntries((await listAll('settings')).map(r => [r.id, r]));

// ── model.js를 Firestore 없이 돌린다 ──
const writes = new Map();   // '컬렉션/id' -> 객체(참조째 들고 있어 나중 변경까지 실린다)
globalThis.__fb = {
  collection: (db, name) => name,
  getDocs: async name => ({ docs:(cur[name] || []).map(r => ({ id:r.id, data:() => ({ ...r }) })) }),
  doc: (db, coll, id) => ({ coll, id }),
  getDoc: async ref => ({ exists:() => ref.coll === 'settings' && !!settings[ref.id], data:() => settings[ref.id] }),
  setDoc: async (ref, obj) => { writes.set(`${ref.coll}/${ref.id}`, obj); },
  deleteDoc: async () => { throw new Error('더미 생성은 지우지 않는다'); },
};
const src = fs.readFileSync(path.join(ROOT, 'model.js'), 'utf8')
  .replace(/^import \{ db,.*$/m, 'const db = {}; const { collection, getDocs, doc, getDoc, setDoc, deleteDoc } = globalThis.__fb;')
  .replace(/^import \{ CLAUDE_PROXY_URL.*$/m, "const CLAUDE_PROXY_URL = '';");
const tmp = path.join(os.tmpdir(), `lms2027-model-${Date.now()}.mjs`);
fs.writeFileSync(tmp, src);
const M = await import(pathToFileURL(tmp).href);
fs.unlinkSync(tmp);
await M.loadCore();

// 결정적 난수(다시 돌려도 같은 결과)
let seed = 20270305;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = a => a[Math.floor(rnd() * a.length)];

/* ── 강의 내용 ── */
const H = [
  ['조선의 건국', ['고려 말의 개혁', ['권문세족과 신진 사대부', '위화도 회군과 이성계의 집권', '과전법 실시']], ['조선의 건국과 한양 천도', ['1392년 조선 건국', '한양 천도와 도성 건설', '정도전의 민본 사상']]],
  ['통치 체제의 정비', ['중앙 정치 기구', ['의정부와 6조', '3사의 언론 기능', '승정원과 의금부']], ['지방 행정과 관리 등용', ['8도와 수령', '향리의 지위 약화', '과거 제도']]],
  ['사림의 성장과 사화', ['훈구와 사림', ['사림의 등장', '성종 대 사림 등용', '훈구 세력과의 갈등']], ['네 차례의 사화', ['무오사화와 갑자사화', '기묘사화와 조광조', '을사사화']]],
  ['붕당 정치의 전개', ['붕당의 형성', ['이조 전랑 자리 다툼', '동인과 서인', '남인과 북인']], ['붕당 정치의 변질', ['예송 논쟁', '환국', '일당 전제화']]],
  ['임진왜란', ['전쟁의 발발', ['일본의 침략과 초기 패배', '선조의 피란', '명의 지원']], ['수군과 의병', ['이순신과 한산도 대첩', '곽재우와 의병', '정유재란과 노량 해전']]],
  ['병자호란', ['광해군의 중립 외교', ['후금의 성장', '명과 후금 사이의 외교', '인조반정']], ['두 차례의 호란', ['정묘호란', '병자호란과 삼전도', '북벌론']]],
  ['영조와 정조의 탕평 정치', ['영조의 탕평책', ['탕평비 건립', '균역법', '서원 정리']], ['정조의 개혁', ['규장각', '장용영', '수원 화성']]],
  ['세도 정치와 농민 봉기', ['세도 정치', ['외척 가문의 권력 독점', '삼정의 문란', '매관매직']], ['농민의 저항', ['홍경래의 난', '임술 농민 봉기', '삼정이정청']]],
  ['실학의 발달', ['농업 중심 개혁론', ['유형원', '이익', '정약용의 여전론']], ['상공업 중심 개혁론', ['유수원', '홍대용', '박지원과 박제가']]],
  ['흥선 대원군의 개혁', ['왕권 강화 정책', ['비변사 축소', '경복궁 중건', '서원 철폐']], ['통상 수교 거부', ['병인양요', '신미양요', '척화비 건립']]],
];
const Q = {
  h01:['정도전이 새 나라의 이름을 "조선"으로 정한 까닭은 무엇이었을까요?', '단군 조선과 기자 조선을 잇는다는 뜻을 떠올려 보고, 새 왕조가 무엇을 내세우고 싶었는지 내 생각을 적어 보세요.'],
  h02:['3사가 왕과 신하를 비판할 수 있게 한 제도는 오늘날 무엇과 비슷할까요?', '사간원, 사헌부, 홍문관이 한 일을 떠올리고 지금의 언론이나 감사 기관과 견주어 적어 보세요.'],
  h04:['붕당 정치는 나라에 도움이 되었을까요, 해가 되었을까요?', '붕당 초기의 견제와 후기의 일당 전제를 함께 보고 한쪽 입장을 골라 근거를 들어 주세요.'],
  h06:['내가 인조였다면 청과 싸우는 것과 화친하는 것 중 무엇을 골랐을까요?', '척화파와 주화파의 주장을 떠올리고 그때 백성의 삶까지 생각해 보세요.'],
  h08:['세도 정치 시기에 농민들이 들고일어난 가장 큰 까닭은 무엇일까요?', '삼정의 문란이 백성의 삶을 어떻게 바꾸었는지 적어 보세요.'],
  h10:['흥선 대원군의 통상 수교 거부 정책은 옳은 선택이었을까요?', '병인양요와 신미양요 뒤의 상황과 이웃 나라들의 개항을 함께 생각해 보세요.'],
};
// 답변 재료: 질문마다 긴 답 넷. 끝에 덧붙일 말로 조금씩 다르게 만든다.
const A = {
  h01:['조선이라는 이름은 단군 조선을 잇는다는 뜻이 있어서 우리 민족의 오랜 역사를 이어받은 나라라는 것을 보여 주려 했다고 생각합니다. 고려를 무너뜨리고 세운 나라라서 정당성이 필요했을 것입니다.',
       '정도전은 명에게 인정받으면서도 우리 역사를 잇는 이름이 필요했다고 생각합니다. 기자 조선은 유교 문화를, 단군 조선은 민족의 뿌리를 뜻하니 두 가지를 다 담을 수 있었습니다.',
       '새 왕조는 백성에게 우리가 오래된 나라의 정통을 잇는다고 말하고 싶었던 것 같습니다. 그래서 고려라는 이름 대신 더 오래된 조선을 골라 새롭지만 낯설지 않게 했다고 봅니다.',
       '저는 이름을 바꾼 것이 고려와 완전히 다른 나라라는 것을 보여 주기 위해서였다고 생각합니다. 유교 국가를 세우려 한 정도전에게 기자 조선의 이미지는 아주 중요했을 것입니다.'],
  h02:['3사는 지금의 언론과 비슷하다고 생각합니다. 기자들이 대통령이나 정치인을 비판하는 것처럼 3사는 왕에게도 잘못을 말할 수 있어서 권력이 한쪽으로 쏠리지 않게 했습니다.',
       '사헌부는 관리의 비리를 살폈으니 지금의 감사원이나 검찰과 비슷합니다. 왕도 비판을 들어야 했다는 점에서 조선이 생각보다 균형을 중요하게 여긴 나라였다고 느꼈습니다.',
       '저는 3사가 국회의 국정 감사와 닮았다고 생각합니다. 정부가 일을 잘하는지 따져 묻는 역할이기 때문입니다. 비판할 수 있는 기관이 있어야 나라가 오래 갈 수 있습니다.',
       '홍문관은 왕에게 공부를 가르치고 조언했으니 지금의 자문 기관과 비슷합니다. 3사 덕분에 왕이 마음대로 하지 못했고 이것이 조선이 500년 넘게 이어진 까닭 중 하나라고 봅니다.'],
  h04:['붕당 정치는 처음에는 도움이 되었다고 생각합니다. 서로 다른 의견을 내며 견제했기 때문에 한쪽이 마음대로 할 수 없었습니다. 하지만 환국 이후로는 상대를 없애려는 싸움이 되어 해가 되었습니다.',
       '저는 해가 되었다고 생각합니다. 예송 논쟁처럼 백성의 삶과 상관없는 일로 오래 다투었고, 그동안 백성을 위한 정치는 뒤로 밀렸기 때문입니다.',
       '붕당은 지금의 정당과 비슷해서 도움이 되었다고 봅니다. 여러 의견이 부딪쳐야 더 나은 결정을 내릴 수 있습니다. 다만 일당 전제가 되면서 그 장점이 사라진 것이 아쉽습니다.',
       '처음 뜻은 좋았지만 결과적으로는 해가 컸다고 생각합니다. 이조 전랑 자리 같은 권력 다툼에서 시작했고 나중에는 사화처럼 사람이 많이 죽었기 때문입니다.'],
  h06:['저는 화친을 골랐을 것 같습니다. 청은 이미 강해서 싸우면 백성이 큰 피해를 입었을 것입니다. 최명길의 말처럼 나라와 백성을 먼저 지키는 것이 왕의 일이라고 생각합니다.',
       '저는 싸우는 것을 골랐을 것입니다. 명에게 받은 은혜를 저버리면 나라의 명분이 무너진다고 보았던 김상헌의 생각도 그때 사람들에게는 아주 중요했을 것입니다.',
       '삼전도에서 인조가 머리를 숙인 것은 슬프지만 백성을 살린 선택이었다고 봅니다. 저도 화친을 골랐을 것입니다. 명분보다 사람의 목숨이 먼저라고 생각합니다.',
       '처음부터 광해군처럼 중립 외교를 했다면 이런 선택을 하지 않아도 되었을 것입니다. 그래도 고른다면 화친입니다. 준비 없이 싸우면 더 크게 지기 때문입니다.'],
};
const LONG_TAIL = ['', ' 그래서 저는 이렇게 생각합니다.', ' 수업을 듣고 생각이 더 분명해졌습니다.', ' 친구들의 생각도 궁금합니다.'];
const SHORT = ['잘 모르겠습니다.', '도움이 되었다고 생각합니다.', '백성을 위해서입니다.', '권력을 나누기 위해서'];

const MISSION = {   // 강의별 { 앱 키, 가중치 }
  h03:{ appKey:'j_interview', title:'사림 인물 인터뷰', weight:1 },
  h05:{ appKey:'j_wartimeline', title:'임진왜란 전쟁 타임라인', weight:2 },
  h07:{ appKey:'j_brain', title:'영조와 정조의 뇌구조', weight:1 },
};
const APPS = [
  { key:'j_interview', name:'조선 인물 인터뷰', base:'https://hoseong911.github.io/hoistory/apps/j_interview/', icon:'mic' },
  { key:'j_wartimeline', name:'전쟁 타임라인', base:'https://hoseong911.github.io/hoistory/apps/j_wartimeline/', icon:'swords' },
  { key:'j_brain', name:'임금의 뇌구조', base:'https://hoseong911.github.io/hoistory/apps/j_brain/', icon:'brain' },
];
const FORM = ['h02','h04','h06','h09'];

/* ── 강의 채우기 ── */
const lessonKey = id => id.replace('L_', '');            // L_h01 은 h01
function fillLesson(id, [title, ...pages]){
  const l = M.getLesson(id); if (!l) throw new Error('없는 강의 ' + id);
  const k = lessonKey(id);
  M.setLessonPart(id, 'concept', true);
  l.parts.concept.title = title;
  l.parts.concept.content = pages.flatMap(([pt, items]) => [{ type:'divider', title:pt }, ...items.map(t => ({ type:'row', text:t }))]);
  if (MISSION[k]){ M.setLessonPart(id, 'mission', true); Object.assign(l.parts.mission, { title:MISSION[k].title, appKey:MISSION[k].appKey, weight:MISSION[k].weight }); }
  if (Q[k]){ M.setQuestionEnabled(id, true); M.setQuestion(id, { prompt:Q[k][0], guide:Q[k][1] }); }
  if (FORM.includes(k)){
    M.setLessonPart(id, 'formative', true);
    const it = pages.flatMap(p => p[1]);
    l.parts.formative.title = `${title} 확인 문제`;
    l.parts.formative.items = [
      { type:'short',   q:`"${it[0]}"와 관련된 핵심 낱말을 쓰세요.`, a:it[0].split(' ')[0] },
      { type:'ox',      q:`${it[1]}은(는) ${title} 단원에서 배운 내용이다.`, a:'O' },
      { type:'initial', q:`초성을 보고 낱말을 쓰세요.`, a:it[3].split(' ')[0], hint:'' },
      { type:'choice',  q:`다음 중 ${pages[1][0]}에 해당하는 것은?`, choices:[pages[1][1][0], '갑오개혁', '위화도 회군', '금융 실명제'], a:0 },
    ];
  }
  M.setLessonTitle(id, title);   // 마지막에 한 번 저장(칸 전부 같이 저장된다)
}
H.forEach((d, i) => fillLesson(`L_h${String(i+1).padStart(2,'0')}`, d));
// 초성 문제의 힌트는 답의 초성
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
M.getLessons().forEach(l => (l.parts.formative?.items || []).forEach(it => {
  if (it.type === 'initial') it.hint = [...it.a].map(c => { const n = c.charCodeAt(0) - 0xAC00; return n >= 0 && n < 11172 ? CHO[Math.floor(n / 588)] : c; }).join('');
}));

/* ── 미션 앱 ── */
APPS.forEach(a => {
  const lessonId = 'L_' + Object.entries(MISSION).find(([, m]) => m.appKey === a.key)[0];
  M.addMissionApp({ key:a.key, name:a.name, studentUrl:a.base + 'index.html', adminUrl:a.base + 'admin.html', icon:a.icon, lessonId,
    modal:false, archive:{ topic:M.getLesson(lessonId).title, intent:`${a.name} 활동으로 배운 내용을 직접 써 보며 정리한다.`, content:'' } });
});

/* ── 강의실 요일 ── */
M.getCourses(2027).forEach(c => M.setCourseSchedule(c.id, c.subject === '역사' ? '금' : '수'));

/* ── 제출물: 공개된 1~6강 ── */
const due = cl => M.resolveMmdd(cl.date).getTime();
const HOUR = 3600e3;
M.getCourses(2027).forEach(c => {
  const stu = M.getStudentsByCourse(c.id);
  M.getCourseLessons(c.id).filter(cl => cl.isOpen).forEach(cl => {
    const k = lessonKey(cl.lessonId), parts = cl.lesson.parts;
    stu.forEach(s => {
      if (parts.question){
        const r = rnd();
        if (r < 0.08) return;                                   // 미제출
        const answer = r < 0.16 ? pick(SHORT) : pick(A[k]) + pick(LONG_TAIL);
        const late = rnd() < 0.12;
        const row = M.saveSubmission({ clId:cl.id, part:'question', studentNo:s.studentNo, answer });
        row.at = due(cl) + (late ? 30 + rnd() * 48 : 10 + rnd() * 8) * HOUR;
        if (rnd() < 0.1) row.shared = true;
      }
      if (parts.mission && rnd() > 0.08){
        const late = rnd() < 0.1;
        const row = M.saveSubmission({ clId:cl.id, part:'mission', studentNo:s.studentNo, answer:`${parts.mission.title} 제출`, score:null });
        row.at = due(cl) + (late ? 30 + rnd() * 48 : 10 + rnd() * 8) * HOUR;
        row.status = rnd() < 0.9 ? 'pass' : 'fail';
      }
    });
  });
});

/* ── 형성평가 제출물 (2026-10-29: 어드민 성취도 관리가 정답률, 오답률을 센다) ──
   난수를 따로 쓴다(rndF): 위의 rnd 차례에 끼어들면 이미 돌려 둔 질문, 미션 더미가 다 바뀐다.
   문항마다 답을 적는다. 맞히는 비율을 학생마다 다르게(0.45~0.95) 두어 명단에 잘하는 학생과
   못하는 학생이 섞이게 한다. model.js formativeResult가 items[].a와 견주므로 틀린 답은 답과 다르면 된다. */
let seedF = 20271009;
const rndF = () => (seedF = (seedF * 1103515245 + 12345) % 2147483648) / 2147483648;
M.getCourses(2027).forEach(c => {
  const stu = M.getStudentsByCourse(c.id);
  M.getCourseLessons(c.id).filter(cl => cl.isOpen && cl.lesson.parts.formative).forEach(cl => {
    const items = cl.lesson.parts.formative.items || [];
    stu.forEach(s => {
      if (rndF() < 0.1) return;                                 // 안 푼 학생
      const skill = 0.45 + rndF() * 0.5;
      const answers = items.map(it => {
        if (rndF() < skill) return it.a;
        if (it.type === 'choice') return (it.a + 1 + Math.floor(rndF() * 3)) % 4;
        if (it.type === 'ox') return it.a === 'O' ? 'X' : 'O';
        return '잘 모르겠습니다';
      });
      const row = M.saveSubmission({ clId:cl.id, part:'formative', studentNo:s.studentNo, answers });
      row.at = due(cl) + (10 + rndF() * 8) * HOUR;
    });
  });
});

/* ── AI 채점 결과: 1, 2강은 전부, 4강은 앞의 세 반만, 6강은 아직(버튼을 눌러 볼 수 있게) ──
   점수 환산은 model.js gradeQuestionsAI와 같다. */
const graded = (k, c) => ['h01','h02'].includes(k) || (k === 'h04' && c.classNo <= 3);
M.getCourses(2027).forEach(c => M.getCourseLessons(c.id).filter(cl => cl.isOpen && cl.lesson.parts.question).forEach(cl => {
  if (!graded(lessonKey(cl.lessonId), c)) return;
  const subs = M.getQuestionSubs(cl.id);
  subs.forEach(s => {
    const v = M.questionVerdict({ ...s, verdict:null });
    if (v.length < 50) Object.assign(s, { graded:true, aiPt:0, aiScore:null, aiVerdict:'미흡(50자 미만)' });
    else {
      const q = rnd() < 0.08 ? Math.floor(20 + rnd() * 19) : Math.floor(62 + rnd() * 36);
      if (q < 40) Object.assign(s, { graded:true, aiPt:5, aiScore:q, aiVerdict:'조금 미흡' });
      else Object.assign(s, { graded:true, aiScore:q, aiPt:Math.max(10, Math.min(30, Math.round(10 + (q - 40) / 54 * 20))),
                              aiVerdict:v.onTime ? '통과' : '미흡(지연 제출)' });
    }
  });
  // 선생님이 손으로 뒤집은 것 한두 건
  const weak = subs.find(s => s.aiVerdict === '조금 미흡'); if (weak) weak.verdict = 'pass';
  const ok = subs.filter(s => s.aiVerdict === '통과'); if (ok.length && rnd() < 0.5) pick(ok).verdict = 'fail';
}));

/* ── 성적: 1~5강은 반영까지, 6강은 끌어오기만 ── */
const FEED = ['답변 근거가 분명해서 좋았습니다.', '활동지 정리를 조금 더 꼼꼼히 해 봅시다.', '수업 참여가 훌륭했습니다.', '다음 시간에는 기한을 지켜 주세요.'];
M.getCourses(2027).forEach(c => {
  const stu = M.getStudentsByCourse(c.id);
  M.getCourseLessons(c.id).filter(cl => cl.isOpen).forEach(cl => {
    const absent = rnd() < 0.5 ? pick(stu).studentNo : null;
    if (absent) M.toggleGradeAbsent(cl.id, absent);
    M.applyAutoDetect(cl.id);
    stu.forEach(s => {
      if (s.studentNo === absent) return;
      M.setGradeCell(cl.id, s.studentNo, 'concept', 'achievedN', rnd() < 0.9 ? 1 : 0);
      M.setGradeCell(cl.id, s.studentNo, 'concept', 'onTimeN', rnd() < 0.85 ? 1 : 0);
      if (rnd() < 0.12) M.setGradeFeedback(cl.id, s.studentNo, pick(FEED));
    });
    if (cl.order <= 5 && !cl.gradePublished) M.toggleGradePublished(cl.id);
  });
});
M.getLessons().filter(l => /0[1-6]$/.test(l.id)).forEach(l => M.toggleGradeLesson(l.id, true));
M.setFeedbackTemplates(FEED);   // 성적 입력의 피드백 템플릿 고르개가 비지 않게
await M.saveGradeConfig(M.DEFAULT_BANDS);

// ── 새로 만든 문서에만 더미 표시를 달고 쓴다 ──
for (const [key, obj] of writes) if (DUMMY_COLLS.includes(key.split('/')[0])) obj.dummy = true;
const cnt = {};
const out = [...writes].map(([key, obj]) => {
  const c = key.split('/')[0]; cnt[c] = (cnt[c] || 0) + 1;
  const { id, ...rest } = JSON.parse(JSON.stringify(obj));
  return { update:{ name:`${P}/${key}`, fields:toV({ ...rest, id }).mapValue.fields } };
});
console.log(cnt);
await commit(out);
console.log('채웠습니다.');
