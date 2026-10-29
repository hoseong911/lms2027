/* 형성평가 문항 함수 점검 (2026-10-29)
 *
 *   node tools/형성평가-점검.mjs
 *
 * model.js를 Firestore 없이(getDocs는 빈 것, setDoc은 메모리) 올려
 * normFormativeItem, initialsOf, formativeResult, 문항 넣고 빼고 옮기기를 따져 본다.
 * Firebase 로그인도 네트워크도 필요 없다.
 *
 * 왜 두었나: formativeResult의 공백 떼기 정규식이 \s가 s로 들어간 것을 이것이 잡았다.
 * 어드민 화면을 열어 보는 것으로는 "공백 든 답이 오답으로 셈" 같은 것을 알아채기 어렵다.
 * 형성평가 채점 규칙을 고칠 때 한 번 돌려 보면 된다. 필요 없어지면 지워도 된다.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const store = new Map();
globalThis.__fb = {
  collection: (db, name) => name,
  getDocs: async () => ({ docs:[] }),
  doc: (db, coll, id) => ({ coll, id }),
  getDoc: async () => ({ exists:() => false, data:() => ({}) }),
  setDoc: async (ref, obj) => { store.set(`${ref.coll}/${ref.id}`, obj); },
  deleteDoc: async ref => { store.delete(`${ref.coll}/${ref.id}`); },
};
const src = fs.readFileSync(path.join(ROOT, 'model.js'), 'utf8')
  .replace(/^import \{ db,.*$/m, 'const db = {}; const { collection, getDocs, doc, getDoc, setDoc, deleteDoc } = globalThis.__fb;')
  .replace(/^import \{ CLAUDE_PROXY_URL.*$/m, "const CLAUDE_PROXY_URL = '';");
const tmp = path.join(os.tmpdir(), `t-model-${Date.now()}.mjs`);
fs.writeFileSync(tmp, src);
const M = await import(pathToFileURL(tmp).href);
fs.unlinkSync(tmp);
await M.loadCore();

let fails = 0;
const ok = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w){ fails++; console.log(`X ${name}\n   받음 ${g}\n   바람 ${w}`); }
  else console.log(`O ${name}`);
};
const throws = (name, fn, msgPart) => {
  try { fn(); fails++; console.log(`X ${name} (던지지 않았다)`); }
  catch (e){
    if (msgPart && !e.message.includes(msgPart)){ fails++; console.log(`X ${name} 메시지 ${e.message}`); }
    else console.log(`O ${name} (${e.message})`);
  }
};

ok('초성', M.initialsOf('위화도 회군'), 'ㅇㅎㄷ ㅎㄱ');

ok('단답 다듬기', M.normFormativeItem({ type:'short', q:' 핵심 낱말? ', a:' 과전법 ' }),
   { type:'short', q:'핵심 낱말?', a:'과전법' });
ok('초성 다듬기', M.normFormativeItem({ type:'initial', q:'낱말', a:'균역법' }),
   { type:'initial', q:'낱말', a:'균역법', hint:'ㄱㅇㅂ' });
ok('OX 다듬기', M.normFormativeItem({ type:'ox', q:'맞나요?', a:'o' }),
   { type:'ox', q:'맞나요?', a:'O' });
ok('선택형: 빈 보기를 떨어뜨리고 정답 자리를 당긴다',
   M.normFormativeItem({ type:'choice', q:'고르세요', a:2, choices:['가','', '다','라'] }),
   { type:'choice', q:'고르세요', choices:['가','다','라'], a:1 });

throws('문제 빈 칸', () => M.normFormativeItem({ type:'short', q:'  ', a:'답' }), '문제를 입력');
throws('정답 빈 칸', () => M.normFormativeItem({ type:'short', q:'문제', a:'' }), '정답을 입력');
throws('OX 아무것도 안 고름', () => M.normFormativeItem({ type:'ox', q:'문제', a:'' }), 'O 또는 X');
throws('보기 하나', () => M.normFormativeItem({ type:'choice', q:'문제', a:0, choices:['가'] }), '두 개 이상');
throws('정답 안 고른 선택형', () => M.normFormativeItem({ type:'choice', q:'문제', a:-1, choices:['가','나'] }), '정답인 보기');
throws('빈 보기를 정답으로 고름', () => M.normFormativeItem({ type:'choice', q:'문제', a:1, choices:['가','','다'] }), '정답인 보기');
throws('유형 없음', () => M.normFormativeItem({ type:'xx', q:'문제', a:'답' }), '문제 유형');

// ── 강의에 꽂아 넣고 빼기 ──
const l = M.addLesson('시험용 강의');
throws('형성평가 꺼진 강의', () => M.addFormativeItem(l.id, { type:'short', q:'문제', a:'답' }), '먼저 켜');
M.setFormativeEnabled(l.id, true);
M.addFormativeItem(l.id, { type:'short', q:'1번', a:'가' });
M.addFormativeItem(l.id, { type:'ox', q:'2번', a:'X' });
M.addFormativeItem(l.id, { type:'choice', q:'3번', a:1, choices:['가','나','다','다시'] });
const items = () => M.getLesson(l.id).parts.formative.items;
ok('세 문항', items().map(i => i.q), ['1번','2번','3번']);
M.moveFormativeItem(l.id, 0, 1);
ok('아래로 옮김', items().map(i => i.q), ['2번','1번','3번']);
M.moveFormativeItem(l.id, 0, -1);
ok('맨 위에서 더 위로는 안 움직인다', items().map(i => i.q), ['2번','1번','3번']);
M.setFormativeItem(l.id, 1, { type:'initial', q:'1번 고침', a:'한양' });
ok('고치기', items()[1], { type:'initial', q:'1번 고침', a:'한양', hint:'ㅎㅇ' });
M.delFormativeItem(l.id, 0);
ok('지우기', items().map(i => i.q), ['1번 고침','3번']);

// ── 끄면 문항이 남아 있다가 되살아난다 ──
M.setFormativeEnabled(l.id, false);
ok('끄면 칸이 없다', !!M.getLesson(l.id).parts.formative, false);
M.setFormativeEnabled(l.id, true);
ok('다시 켜면 문항이 되살아난다', items().map(i => i.q), ['1번 고침','3번']);

// ── 채점 ──
const quiz = [
  { type:'short', q:'1', a:'과전법' },
  { type:'ox', q:'2', a:'O' },
  { type:'initial', q:'3', a:'한양', hint:'ㅎㅇ' },
  { type:'choice', q:'4', choices:['가','나','다'], a:2 },
];
ok('다 맞음', M.formativeResult({ answers:['과전법','O','한양',2] }, quiz),
   { total:4, answered:4, correct:4, wrong:0, pct:100, wrongPct:0 });
ok('공백은 떼고 견준다', M.formativeResult({ answers:[' 과 전 법 ','O','한양',2] }, quiz).correct, 4);
ok('반만 맞음', M.formativeResult({ answers:['과전법','X','한양',0] }, quiz),
   { total:4, answered:4, correct:2, wrong:2, pct:50, wrongPct:50 });
ok('안 쓴 문항은 오답', M.formativeResult({ answers:['과전법','', null, undefined] }, quiz),
   { total:4, answered:1, correct:1, wrong:3, pct:25, wrongPct:75 });
ok('선택형 0번 정답도 센다', M.formativeResult({ answers:[0] }, [{ type:'choice', q:'x', choices:['가','나'], a:0 }]).correct, 1);
ok('제출 없음', M.formativeResult(null, quiz),
   { total:4, answered:0, correct:0, wrong:4, pct:0, wrongPct:100 });
ok('문항 없는 형성평가', M.formativeResult({ answers:[] }, []),
   { total:0, answered:0, correct:0, wrong:0, pct:0, wrongPct:0 });

console.log(fails ? `\n실패 ${fails}건` : '\n모두 통과');
process.exit(fails ? 1 : 0);
