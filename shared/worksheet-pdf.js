/* ══ 활동지 PDF를 개념 노트와 미션 활동 페이지로 바꾸기 (선생님 지시 2026-10-30) ══════
 *
 * "활동지를 pdf로 올려서 편집하는데 pdf를 md로 바꿔서 인식하는건지?
 *  토큰이 안드는 방향으로 변환해서 내용 인식해줄 것."
 *
 * 그래서 AI(Claude)를 거치지 않는다. 브라우저 안에서 PDF.js(파이어폭스가 PDF를 띄울 때
 * 쓰는 무료 도구)로 PDF 안에 든 글자만 꺼내고, 줄을 나누고 단계를 가리는 것은 아래 규칙이
 * 한다. 사용료가 나가지 않고 파일이 어디로도 나가지 않는다.
 *
 * 한계 둘
 *   하나, 글자만 꺼내므로 표 칸, 상자, 음영, 그림은 사라진다.
 *   둘,   스캔한 PDF(종이를 사진으로 찍은 것)는 안에 글자가 없어 꺼낼 것이 없다.
 *         한글에서 바로 PDF로 저장한 활동지는 된다.
 *
 * 나누는 규칙 (활동지 모양에 맞춘 어림이다. 틀린 곳은 편집기에서 고친다)
 *   - 페이지 제목: 본문보다 글자가 뚜렷하게 큰 줄(본문 크기의 1.15배 이상). 거기서 새 페이지다.
 *   - 라벨: 같은 줄 맨 왼쪽에 짧은 낱말이 있고 멀리 떨어져 "1." 줄이 이어지면(표의 왼쪽 칸),
 *           또는 짧은 줄 하나가 홀로 서고 바로 밑에 "1." 줄이 오면 그 낱말이 라벨이다.
 *   - 단계: 줄 앞 기호가 "1."이면 1단계, "-"이면 2단계, "·"이면 3단계(slide-axis.js의 lineLevel).
 *           단계는 줄 글자에 기호가 그대로 남아 있어서 따로 적어 두지 않는다.
 *   - 미션: 제목에 "미션"이 든 페이지부터는 미션 활동 쪽으로 간다.
 *   - 제목의 단계 이름 머리("개념 노트 #1 : ")는 떼고 가져온다(slide-axis.js의 stripStepPrefix).
 *   - 넣지 않는 것: 첫 페이지 제목 위의 줄(활동지 머리: 강의 제목, 반 번호 이름 칸),
 *           제목에 "질문"이나 "생각 Check"가 든 페이지(오늘의 질문 메뉴에 따로 있다),
 *           제목에 "학습 목표"가 든 페이지(축의 학습 목표 단계에 따로 적는다),
 *           내용 줄이 하나도 없는 페이지(큰 글씨 제목만 덩그러니 선 것).
 *
 * 이 파일은 Firebase도 화면도 모른다. 노드에서도 같은 함수로 시험한다(pdfjs를 넘겨준다).
 */
import { lineLevel, stripStepPrefix } from './slide-axis.js?v=20261030r';

// 브라우저는 CDN에서 PDF.js를 불러온다. 판 번호를 못박아 둔다(바뀌면 꺼내는 결과가 달라질 수 있다)
const PDFJS_VER = '4.10.38';
const PDFJS_CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VER}`;

/* PDF 파일(ArrayBuffer)에서 줄을 꺼낸다.
   돌려주는 줄 하나 = { text, size, segs:[{ text, x }] }.
   segs는 같은 높이에 있지만 멀리 떨어진 조각들이다(표의 왼쪽 칸과 오른쪽 칸 같은 것).
   size는 그 줄에서 가장 많이 쓰인 글자 크기다(페이지 제목을 가릴 때 쓴다).

   한글 PDF는 글꼴 안의 글자 번호를 유니코드로 바꾸는 표(CMap)가 있어야 제대로 나온다.
   그 표를 CDN에서 같이 받게 cMapUrl을 준다. */
export async function pdfLines(data, pdfjs, opts = {}){
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(data),
    cMapUrl: opts.cMapUrl ?? `${PDFJS_CDN}/cmaps/`, cMapPacked: true,
    standardFontDataUrl: opts.fontUrl ?? `${PDFJS_CDN}/standard_fonts/`,
    isEvalSupported: false,
  }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++){
    const page = await doc.getPage(p);
    const { items } = await page.getTextContent();
    const lines = pageLines(items);
    /* 오른쪽 끝까지 꽉 찬 줄인가(full). 꽉 찬 줄 다음의 기호 없는 줄은 활동지에서 칸이 모자라 저절로
       넘어간 줄이라 한 줄로 다시 잇는다(linesToParts). 꽉 차지 않았는데 다음 줄로 간 것은 한글에서
       일부러 줄을 바꾼 것이라 그대로 둔다(선생님 말씀 2026-10-30: "보기 좋으라고 일부러 줄바꿈을 한거").
       기준은 그 쪽에서 가장 오른쪽까지 간 줄의 끝이다. 글자 두 칸 안쪽이면 꽉 찬 것으로 본다. */
    const maxRight = Math.max(...lines.map(l => l.right));
    lines.forEach(l => { l.full = l.right >= maxRight - l.size * 2; });
    out.push(...lines);
  }
  return out;
}

/* 한 쪽의 글자 조각을 줄로 묶는다.
   PDF 안의 글자는 줄 단위가 아니라 조각 단위로 흩어져 있다. 조각마다 x, y 자리와 크기가 있으니
   y가 거의 같은 조각끼리 한 줄로 모으고 x 순서로 늘어놓는다.
   조각 사이가 글자 한 칸보다 넓게 벌어지면 다른 칸(segs)으로 본다. 낱말 사이 빈칸은 글자 4분의 1 칸
   남짓이고, 표의 칸 사이(라벨 칸 "붕당 형성"과 내용 칸 "1. 사림 집권")는 칸 안쪽 여백 둘이 더해져
   그보다 넓다. 처음에는 두 칸으로 잡았는데, 라벨이 칸을 거의 채우면 틈이 두 칸이 안 돼 라벨이
   내용에 붙었다(2026-10-30). 칸으로 갈려도 글은 빈칸으로 다시 이어 붙이므로 너무 잘게 갈려도
   글이 망가지지는 않는다(갈린 칸은 라벨을 가릴 때만 쓴다). */
function pageLines(items){
  /* 빈칸만 든 조각은 버린다. 한글에서 만든 PDF는 표의 칸과 칸 사이를 빈칸 조각 하나로 메우는데,
     그 조각을 살려 두면 왼쪽 칸(라벨)과 오른쪽 칸(내용)이 한 덩어리로 붙어 버린다.
     낱말 사이의 빈칸은 아래에서 조각 사이 간격을 보고 다시 넣는다. */
  const parts = items
    .filter(it => it.str && it.str.trim() !== '')
    .map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5],
      w: it.width, size: Math.round(Math.hypot(it.transform[2], it.transform[3]) * 10) / 10 }))
    .filter(it => it.size > 0);
  // 위에서 아래로(PDF는 y가 아래에서 위로 커진다), 같은 줄 안에서는 왼쪽에서 오른쪽으로
  parts.sort((a, b) => b.y - a.y || a.x - b.x);

  const rows = [];
  parts.forEach(it => {
    const row = rows.find(r => Math.abs(r.y - it.y) <= Math.max(2, it.size * 0.35));
    if (row) row.items.push(it); else rows.push({ y: it.y, items: [it] });
  });
  rows.sort((a, b) => b.y - a.y);

  return rows.map(r => {
    r.items.sort((a, b) => a.x - b.x);
    const segs = [];
    let cur = null, end = 0;
    r.items.forEach(it => {
      const gap = it.x - end;
      if (!cur || gap > it.size){ cur = { text: '', x: it.x }; segs.push(cur); }
      else if (gap > it.size * 0.2 && !/\s$/.test(cur.text) && !/^\s/.test(it.str)) cur.text += ' ';
      cur.text += it.str;
      end = it.x + it.w;
    });
    segs.forEach(s => { s.text = s.text.replace(/\s+/g, ' ').trim(); });
    const kept = segs.filter(s => s.text);
    // 줄 크기: 글자 수로 무게를 단 최빈값. 큰 글씨 한두 자(번호 동그라미 같은 것)에 끌려가지 않게
    const tally = {};
    r.items.forEach(it => { tally[it.size] = (tally[it.size] || 0) + it.str.length; });
    const size = +Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
    return { text: kept.map(s => s.text).join(' '), size, segs: kept, right: end };
  }).filter(l => l.text);
}

/* 쪽 번호, 머리말 같은 군더더기 줄: "1/2", "- 3 -", 숫자만 있는 줄 */
const JUNK_RE = /^(?:\d+\s*\/\s*\d+|-\s*\d+\s*-|\d+)$/;
const SHORT = 10;   // 라벨로 볼 수 있는 가장 긴 글자 수

/* 꺼낸 줄을 페이지로 나눈다. 돌려주는 것은 { concept, mission } 두 덩어리이고
   둘 다 slide-axis.js의 fromPages가 받는 페이지 배열이다: [{ title, rows:[{ label, text }] }]. */
export function linesToParts(lines){
  const clean = lines.filter(l => !JUNK_RE.test(l.text.trim()));
  if (!clean.length) return { concept: [], mission: [] };

  // 본문 크기: 글자 수로 무게를 단 최빈값. 제목은 이보다 뚜렷하게 크다
  const tally = {};
  clean.forEach(l => { tally[l.size] = (tally[l.size] || 0) + l.text.length; });
  const body = +Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
  const isTitle = l => l.size >= body * 1.15 && l.text.length <= 60;

  const concept = [], mission = [];
  // 페이지 제목이 하나라도 있으면 첫 제목 위의 줄은 활동지 머리라 넣지 않는다(skip으로 시작)
  let target = concept, page = null, row = null, skip = clean.some(isTitle);
  const newPage = title => {
    if (/미션/.test(title)) target = mission;
    // 오늘의 질문(생각 Check)과 학습 목표는 축의 다른 단계에 따로 있으므로 페이지로 넣지 않는다
    skip = /질문|생각\s*Check|학습\s*목표/i.test(title);
    // "개념 노트 #1 : 성리학적 질서의 확산"은 "성리학적 질서의 확산"만 가져온다(선생님 지시 2026-10-30)
    page = { title: stripStepPrefix(title), rows: [] }; row = null;
    if (!skip) target.push(page);
  };
  const ensurePage = () => { if (!page) newPage(''); };
  let prevFull = false;   // 바로 앞에 넣은 줄이 오른쪽 끝까지 꽉 찼는가(pdfLines의 full)
  const newRow = label => { ensurePage(); row = { label, text: '' }; page.rows.push(row); prevFull = false; };
  const addLine = (t, full) => {
    ensurePage();
    if (!row) newRow('');
    // 꽉 찬 줄 다음의 기호 없는 줄은 저절로 넘어간 줄이라 앞 줄에 잇는다(줄바꿈 대신 빈칸 하나)
    const wrap = prevFull && row.text && !lineLevel(t).lv;
    row.text += row.text ? (wrap ? ' ' : '\n') + t : t;
    prevFull = !!full;
  };

  clean.forEach((l, i) => {
    if (isTitle(l)){ newPage(l.text); return; }
    if (skip) return;
    const next = clean[i + 1];
    const [first, ...rest] = l.segs;
    const restText = rest.map(s => s.text).join(' ');

    // 표의 왼쪽 칸: 짧은 낱말 + 멀리 떨어진 "1." 줄
    if (rest.length && first.text.length <= SHORT && !lineLevel(first.text).lv
        && lineLevel(restText).lv === 1){
      newRow(first.text); addLine(restText, l.full); return;
    }
    // 홀로 선 짧은 줄 밑에 "1." 줄이 오면 그 줄이 라벨이다
    if (l.text.length <= SHORT && !lineLevel(l.text).lv && next && !isTitle(next)
        && lineLevel(next.text).lv === 1){
      newRow(l.text); return;
    }
    addLine(l.text, l.full);
  });

  // 내용 줄이 없는 페이지(제목만 덩그러니 선 것)는 뺀다
  const tidy = pages => pages.filter(p => p.rows.some(r => r.text.trim()));
  return { concept: tidy(concept), mission: tidy(mission) };
}

// 브라우저에서 PDF.js를 한 번만 불러 둔다
let pdfjsP = null;
function loadPdfjs(){
  if (!pdfjsP) pdfjsP = import(`${PDFJS_CDN}/build/pdf.min.mjs`).then(lib => {
    lib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/build/pdf.worker.min.mjs`;
    return lib;
  });
  return pdfjsP;
}

// 어드민이 부르는 길: 고른 파일 하나를 받아 { concept, mission } 페이지 배열을 돌려준다
export async function worksheetFromPdf(file){
  const lib = await loadPdfjs();
  const lines = await pdfLines(await file.arrayBuffer(), lib);
  if (!lines.length) throw new Error('PDF 안에서 글자를 찾지 못했습니다. 스캔한 PDF는 글자를 꺼낼 수 없습니다.');
  return linesToParts(lines);
}
