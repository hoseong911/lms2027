/* ══ 활동지 한글 파일(.hwpx)을 개념 노트와 미션 활동 페이지로 바꾸기 (선생님 지시 2026-10-30, 요구사항 137) ══
 *
 * "그리고 문자 인식하는건 거기에서 적용한걸 좀 참고해봐"
 * 2026 lms(concept-note.js의 ceExtractHwpxText)가 한글 파일을 받던 길을 보고 따랐다.
 *
 * .hwpx는 zip 묶음이고, 그 안의 Contents/section0.xml, section1.xml ... 에 글이 들어 있다.
 * PDF와 달리 표 칸과 문단이 그대로 들어 있어서 어림할 것이 거의 없다.
 *   hp:tbl  표            hp:tr  표의 가로줄       hp:tc  칸
 *   hp:cellAddr colAddr  칸이 몇째 열에서 시작하는가
 *   hp:cellSpan colSpan  칸이 열 몇 개를 차지하는가(합친 칸)
 *   hp:p    문단          hp:t   글자              hp:lineBreak  한 문단 안의 강제 줄나눔
 * 그래서 라벨 칸, 좌우 비교 칸, 일부러 바꾼 줄을 자리로 재지 않고 그대로 읽는다.
 * 저절로 넘어간 줄은 파일에 아예 없다(한 문단이 한 줄로 들어 있다). PDF의 wrapGlue가 필요 없다.
 *
 * XML 해석기(DOMParser)를 쓰지 않는다. 보는 태그가 몇 개 안 되어 훑개 하나로 충분하고,
 * 그래야 노드에서도 같은 함수로 시험할 수 있다(노드에는 DOMParser가 없다).
 *
 * 줄 판정 규칙 (활동지 표의 실제 모양에 맞췄다. 틀린 곳은 편집기에서 고친다)
 *   - 빈 칸만 있는 줄은 건너뛴다.
 *   - 칸 하나(표 전체 너비): 첫 문단이 괄호 머리면 새 쪽이고, 나머지 문단은 그 쪽의 글이다.
 *       괄호 머리가 아니고 글이 짧으면(SHORT 이하) 버린다. 옆에 진짜 라벨 칸이 따로 있는,
 *       표 위에 덧붙인 제목줄이다(29강의 "유교 윤리의 보급"이 그렇다).
 *   - 칸 둘, 둘 다 짧고, 다음 줄도 칸 둘에 열 자리가 같으면: 좌우 비교다.
 *       이 줄이 왼쪽과 오른쪽 라벨, 다음 줄이 왼쪽과 오른쪽 내용이다(두 줄을 같이 먹는다).
 *   - 칸 둘, 첫 칸이 짧으면: 라벨 칸 + 내용 칸.
 *   - 그 밖: 칸들의 글을 차례로 이어 붙인다.
 *   - 표 밖 문단: 괄호 머리면 새 쪽, 아니면 글.
 *   - 내용 안에서 "1."로 시작하는 줄은 새 묶음이다(PDF 길과 같다. 활동지 표는 칸마다 1.부터 센다).
 *     라벨 칸이 있는 줄은 라벨이 이미 새 묶음을 열었으므로 그 줄의 1.은 다시 열지 않는다.
 *
 * 이 파일은 Firebase도 화면도 모른다. 노드에서는 JSZip을 넘겨 시험한다.
 */
import { lineLevel } from './slide-axis.js?v=20261030t';
import { SHORT, JUNK_RE, unwrapTitle, makeCollector, tidyPages } from './worksheet.js?v=20261030t';

// 브라우저는 CDN에서 JSZip을 불러온다. PDF.js와 같이 판 번호를 못박는다
const JSZIP_CDN = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';

const ENT = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'" };
const unent = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1))
    : (ENT[e] ?? m));
const attr = (s, name) => { const m = new RegExp(`\\b${name}="([^"]*)"`).exec(s); return m ? m[1] : ''; };

/* section XML 하나를 덩어리 목록으로 읽는다. 차례는 문서 차례 그대로다.
     { type:'p', text }                                       표 밖 문단
     { type:'tbl', rows:[[{ col, span, paras:[문단 글] }]] }  표. 칸은 열 자리 순서
   문단 글 안의 '\n'은 hp:lineBreak(한글에서 Shift+Enter로 바꾼 줄)다.
   표 안의 표(칸 속 표)는 드물어서 바깥 칸의 문단으로 펴서 넣는다. */
export function hwpxBlocks(xml){
  const blocks = [];
  const tbls = [];          // 열려 있는 표(안쪽이 끝)
  const paras = [];         // 열려 있는 문단(표가 문단 안에 들기 때문에 쌓인다)
  let inT = 0;
  const cell = () => { const t = tbls[tbls.length - 1]; return t && t.cell; };
  const RE = /<(\/?)hp:(tbl|tr|tc|p|t|lineBreak|tab|cellAddr|cellSpan)\b([^>]*?)(\/?)>|([^<]+)|<[^>]*>/g;
  let m;
  while ((m = RE.exec(xml))){
    const [, close, tag, rest, self, text] = m;
    if (text !== undefined){ if (inT && paras.length) paras[paras.length - 1].text += unent(text); continue; }
    if (!tag) continue;
    const p = paras[paras.length - 1];
    switch (tag){
      case 't':
        if (!self) inT += close ? -1 : 1;
        break;
      case 'lineBreak': if (inT && p) p.text += '\n'; break;
      case 'tab':       if (inT && p) p.text += ' '; break;
      case 'p':
        if (!close){ paras.push({ text: '' }); break; }
        { const done = paras.pop(); if (!done) break;
          const c = cell();
          if (c) c.paras.push(done.text);
          else if (!tbls.length && done.text.trim()) blocks.push({ type:'p', text: done.text }); }
        break;
      case 'tbl':
        if (!close){ tbls.push({ rows: [], row: null, cell: null }); break; }
        { const t = tbls.pop(); if (!t) break;
          const outer = cell();
          // 칸 속 표: 그 글을 바깥 칸의 문단으로 편다
          if (outer) t.rows.forEach(r => r.forEach(c => outer.paras.push(...c.paras)));
          else blocks.push({ type:'tbl', rows: t.rows }); }
        break;
      case 'tr': { const t = tbls[tbls.length - 1]; if (!t) break;
        if (!close){ t.row = []; t.rows.push(t.row); } else t.row = null; break; }
      case 'tc': { const t = tbls[tbls.length - 1]; if (!t) break;
        if (!close){ t.cell = { col: 0, span: 1, paras: [] }; (t.row || (t.row = [], t.rows.push(t.row), t.row)).push(t.cell); }
        else t.cell = null;
        break; }
      case 'cellAddr': { const c = cell(); if (c) c.col = +attr(rest, 'colAddr') || 0; break; }
      case 'cellSpan': { const c = cell(); if (c) c.span = +attr(rest, 'colSpan') || 1; break; }
    }
  }
  // 칸은 파일 안에서 대개 열 순서지만 못박혀 있지 않으므로 다시 세운다
  blocks.forEach(b => { if (b.type === 'tbl') b.rows.forEach(r => r.sort((a, c) => a.col - c.col)); });
  return blocks;
}

// 칸 글: 문단마다 줄 하나(문단 안의 강제 줄나눔도 줄 하나). 빈 줄과 줄 앞뒤 빈칸은 걷는다
const cellLines = c => c.paras.join('\n').split('\n').map(t => t.replace(/[\s　]+/g, ' ').trim()).filter(Boolean);
const cellText = c => cellLines(c).join('\n');

/* 덩어리 목록을 { concept, mission } 페이지 배열로 바꾼다(worksheet.js의 makeCollector가 모은다). */
export function blocksToParts(blocks){
  const col = makeCollector();
  const anyTitle = blocks.some(b => b.type === 'p'
    ? unwrapTitle(b.text) !== null
    : b.rows.some(r => r.some(c => unwrapTitle(cellLines(c)[0]) !== null)));
  if (!anyTitle) col.noTitles();

  const page = title => col.newPage(title);

  /* 내용 줄을 넣는다. "1."로 시작하는 줄은 새 묶음이다.
     사료 쪽이 끝나고 다시 1. 줄이 오면 표로 돌아온 것이라 본문 쪽을 같은 제목으로 다시 연다. */
  const addLines = (lines, { fresh = false } = {}) => {
    lines.forEach((t, i) => {
      const { lv, mark } = lineLevel(t);
      if (lv === 1 && mark === '1.' && !(fresh && i === 0)){
        if (col.inSource) page(col.parentTitle);
        col.newRow();
      }
      col.addText(t);
    });
  };

  // 칸 하나짜리 줄, 표 밖 문단: 첫 줄이 괄호 머리면 새 쪽
  const addLoose = (lines, { dropShort = false } = {}) => {
    if (!lines.length) return;
    const t = unwrapTitle(lines[0]);
    if (t !== null){ page(t); addLines(lines.slice(1)); return; }
    if (dropShort && lines.length === 1 && lines[0].length <= SHORT) return;
    if (col.skipping) return;
    addLines(lines);
  };

  blocks.forEach(b => {
    if (b.type === 'p'){ addLoose(cellLines({ paras: [b.text] })); return; }
    // 빈 칸과 기호만 든 칸(⇙ ⇘)은 없는 것으로 친다. 남은 칸 수로 줄 모양을 가린다
    const rows = b.rows.map(r => r.filter(c => { const t = cellText(c); return t && !JUNK_RE.test(t); }));
    for (let i = 0; i < rows.length; i++){
      const r = rows[i];
      if (!r.length) continue;
      if (r.length === 1){ col.endRow(); addLoose(cellLines(r[0]), { dropShort: true }); col.endRow(); continue; }
      if (col.skipping) continue;
      const short = c => { const t = cellText(c); return !t.includes('\n') && t.length <= SHORT; };
      const next = rows[i + 1];
      if (r.length === 2 && short(r[0]) && short(r[1])
          && next && next.length === 2 && next[0].col === r[0].col && next[1].col === r[1].col){
        if (col.inSource) page(col.parentTitle);
        col.addCompare({ label: cellText(r[0]), text: cellText(next[0]) },
                       { label: cellText(r[1]), text: cellText(next[1]) });
        i++;
        continue;
      }
      if (r.length === 2 && short(r[0])){
        if (col.inSource) page(col.parentTitle);
        col.newRow();
        col.addLabel(cellText(r[0]));
        addLines(cellLines(r[1]), { fresh: true });
        col.endRow();
        continue;
      }
      addLines(r.flatMap(cellLines));
    }
  });

  const { concept, mission } = col.pages;
  return { concept: tidyPages(concept), mission: tidyPages(mission) };
}

/* zip 안의 section XML을 차례대로 읽는다. JSZip은 부르는 쪽이 넘긴다(노드 시험용). */
export async function hwpxSections(data, JSZip){
  const zip = await JSZip.loadAsync(data);
  const names = Object.keys(zip.files)
    .filter(n => /^Contents\/section\d+\.xml$/i.test(n))
    .sort((a, b) => +a.match(/(\d+)\.xml$/i)[1] - +b.match(/(\d+)\.xml$/i)[1]);
  return Promise.all(names.map(n => zip.file(n).async('string')));
}

let jszipP = null;
const loadJSZip = () => (jszipP ||= import(JSZIP_CDN).then(m => m.default || m));

// 어드민이 부르는 길(worksheet.js의 worksheetFromFile을 거친다)
export async function worksheetFromHwpx(file){
  const JSZip = await loadJSZip();
  let xmls;
  try { xmls = await hwpxSections(await file.arrayBuffer(), JSZip); }
  catch { throw new Error('한글 파일을 열지 못했습니다. 한글에서 .hwpx로 다시 저장해 주시길 바랍니다.'); }
  if (!xmls.length) throw new Error('한글 파일 안에서 글을 찾지 못했습니다.');
  return blocksToParts(xmls.flatMap(hwpxBlocks));
}
