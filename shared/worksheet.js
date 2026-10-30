/* ══ 활동지 파일을 개념 노트와 미션 활동 페이지로 바꾸기 (공통 규칙) ══════════
 *
 * "활동지를 pdf로 올려서 편집하는데 pdf를 md로 바꿔서 인식하는건지?
 *  토큰이 안드는 방향으로 변환해서 내용 인식해줄 것." (선생님 지시 2026-10-30)
 *
 * AI를 거치지 않는다. 브라우저 안에서 파일을 열어 글자와 표를 꺼낸다.
 * 사용료가 나가지 않고 파일이 어디로도 나가지 않는다.
 *
 * ── 파일 두 가지 (선생님 지시 2026-10-30, 요구사항 137) ──
 *   .hwpx  한글 파일 그대로. **이쪽이 낫다.** 안에 표 칸과 문단이 그대로 들어 있어서
 *          라벨 칸, 좌우 비교 칸, 줄바꿈을 자리로 어림하지 않고 그대로 읽는다.
 *          2026 lms가 쓰던 길을 가져왔다(선생님 지시: "문자 인식하는건 거기에서 적용한걸 참고해봐").
 *   .pdf   한글이 없을 때를 위한 대비. 글자 자리를 재서 줄과 칸을 어림한다(worksheet-pdf.js).
 *          스캔한 PDF(종이를 사진으로 찍은 것)는 안에 글자가 없어 안 된다.
 * **선생님께는 .hwpx를 먼저 권한다.** 한글에서 "다른 이름으로 저장"하면 바로 나온다.
 *
 * ── 활동지 모양을 읽는 규칙 (두 길이 같이 쓴다) ──
 *   - 쪽 제목: 괄호로 감싼 줄. "[ 개념 노트 #1 : 성리학적 질서의 확산 ]", "< 사료 : ... >".
 *             선생님 활동지는 묶음 머리를 큰 글씨가 아니라 이 괄호로 알린다(2026-10-30 확인).
 *   - 넣지 않는 것: 첫 제목 위의 줄(활동지 머리: 학교 이름, 학번 칸, 학습 단원, 학습 주제),
 *             제목에 "질문"이나 "생각 Check"가 든 쪽(오늘의 질문 메뉴에 따로 있다),
 *             제목에 "학습 목표"가 든 쪽(축의 학습 목표 단계에 따로 적는다),
 *             내용이 하나도 없는 쪽.
 *   - **묶음 하나가 페이지 하나다**(요구사항 139). 활동지 한 쪽에 라벨이 여럿이면 라벨마다
 *             페이지를 따로 만든다(제목은 그 쪽 제목을 그대로 되쓴다). 사료 쪽은 쪼개지 않는다.
 *   - 미션: 제목에 "미션"이 든 쪽부터는 미션 활동 쪽으로 간다.
 *   - 제목의 단계 이름 머리("개념 노트 #1 : ")는 뗀다(slide-axis.js의 stripStepPrefix).
 *             "사료 : "는 떼지 않는다. 그 머리로 사료 쪽인 줄 알기 때문이다(SOURCE_RE).
 */
import { stripStepPrefix, SOURCE_RE, rowFilled } from './slide-axis.js?v=20261030w';

export const SHORT = 10;   // 라벨로 볼 수 있는 가장 긴 글자 수

/* 묶음 머리를 감싼 괄호. 괄호는 떼고 안쪽 글만 제목으로 쓴다.
   머리가 아니면 null을 돌려준다. */
const WRAP_RE = /^[\[【〔<〈]\s*([^\]】〕>〉]+?)\s*[\]】〕>〉]$/;
export const unwrapTitle = t => {
  const m = WRAP_RE.exec(String(t ?? '').trim());
  return m ? m[1].trim() : null;
};

// 축의 다른 단계에 따로 있는 쪽이라 페이지로 넣지 않는다
export const SKIP_TITLE_RE = /질문|생각\s*Check|학습\s*목표/i;

/* 군더더기: 쪽 번호("1/2", "- 3 -", 숫자만), 그리고 화살표나 기호만 있는 글.
   기호만 있는 것은 활동지에서 그림으로 쓴 것이라(붕당이 갈라지는 ⇙ ⇘ 같은 것) 글로 옮길 것이 없다.
   PDF는 그런 줄을, 한글 파일은 그런 칸을 버린다. */
export const JUNK_RE = /^(?:\d+\s*\/\s*\d+|-\s*\d+\s*-|\d+|[\s⇙⇘⇐⇒⇑⇓→←↑↓↔⇨⇦▶◀▲▼◆◇■□●○※*]+)$/;

/* 쪽을 모으는 일꾼. 두 길(hwpx, pdf)이 같은 모양을 만들도록 여기 한 곳에 둔다.
   돌려주는 것은 slide-axis.js의 fromPages가 받는 페이지 배열이다:
   [{ title, rows:[{ label, text } 또는 { kind:'compare', left, right }] }] */
export function makeCollector(){
  const concept = [], mission = [];
  let target = concept, page = null, row = null;
  let skip = true;          // 첫 제목을 만나기 전까지는 활동지 머리라 넣지 않는다
  let parentTitle = '';     // 사료 쪽이 끝나고 표로 돌아올 때 다시 쓸 제목
  let inSource = false;

  /* 같은 제목으로 다음 페이지를 연다(묶음 하나가 페이지 하나라는 원칙. 아래 newRow).
     newPage와 달리 제목을 다시 읽지 않는다: 미션인지, 넣지 않을 쪽인지, 사료 쪽인지는
     이미 가려 둔 그대로 이어 간다. */
  const contPage = () => { page = { title: page.title, rows: [] }; if (!skip) target.push(page); };

  const api = {
    get pages(){ return { concept, mission }; },
    get row(){ return row; },        // 지금 채우는 묶음(PDF 길이 줄을 이을 때 앞 글을 본다)
    get inSource(){ return inSource; },
    get parentTitle(){ return parentTitle; },
    get skipping(){ return skip; },

    /* 제목이 없는 활동지(괄호 머리를 하나도 안 쓴 것)는 처음부터 다 담는다.
       두 길 다 줄을 다 읽어 본 뒤 이것을 불러 준다. */
    noTitles(){ skip = false; },

    newPage(title){
      if (/미션/.test(title)) target = mission;
      skip = SKIP_TITLE_RE.test(title);
      // "사료 : "는 떼지 않는다. 그 머리로 사료 쪽인 줄 안다(SOURCE_RE)
      page = { title: stripStepPrefix(title), rows: [] };
      row = null;
      inSource = SOURCE_RE.test(page.title);
      if (!inSource && !skip) parentTitle = page.title;
      if (!skip) target.push(page);
    },
    ensurePage(){ if (!page) api.newPage(''); },

    /* 원칙: 묶음 하나가 페이지 하나다 (선생님 지시 2026-10-30, 요구사항 139).
       "한 페이지에서 행라벨이 2개 이상 들어오는 경우가 있어. 원칙은 1행라벨 당 1페이지가
        원칙인데 지금 그 원칙이 없어서 이렇게 된거 같거든? 원칙을 저렇게 세우자."
       활동지 한 쪽(괄호 제목 하나)에 라벨이 여럿 있으면 전에는 한 페이지에 다 들어왔다.
       이제는 묶음이 새로 열릴 때마다 **같은 제목으로 다음 페이지를 연다**(contPage).
       그래서 슬라이드도 묶음마다 한 쪽이 된다(2026 lms의 enforceOnePerSlide가 하던 일이다).
       내용이 적어 한 쪽에 같이 두고 싶으면 편집기에서 합친다(어드민의 "위 페이지와 합치기").

       사료 쪽(inSource)은 쪼개지 않는다. 사료는 한 덩어리 글이라 줄마다 쪽이 되면 안 된다. */
    newRow(){
      api.ensurePage();
      if (!inSource && page.rows.some(rowHasText)) contPage();
      row = { label:'', text:'' }; page.rows.push(row); return row;
    },
    // 라벨은 여러 조각으로 쪼개져 올 수 있다("유교" "윤리의" "보급"). 그 묶음의 라벨에 이어 붙인다
    addLabel(t){
      if (!row || row.kind === 'compare') api.newRow();
      row.label = row.label ? `${row.label} ${t}` : t;
    },
    addText(t, glue = '\n'){
      if (skip || !String(t).trim()) return;
      api.ensurePage();
      if (!row || row.kind === 'compare') api.newRow();
      row.text += row.text ? glue + t : t;
    },
    // 좌우 비교 묶음(2026 lms의 compare를 본떴다). 왼쪽과 오른쪽이 각각 라벨과 내용을 들고 있다
    addCompare(left, right){
      if (skip) return;
      api.ensurePage();
      if (!inSource && page.rows.some(rowHasText)) contPage();   // 비교표도 묶음 하나라 제 쪽을 갖는다
      row = { kind:'compare', label:'', text:'',
        left:  { label: String(left.label  || '').trim(), text: String(left.text  || '').trim() },
        right: { label: String(right.label || '').trim(), text: String(right.text || '').trim() } };
      page.rows.push(row);
      row = null;   // 비교 묶음 뒤의 줄은 새 묶음으로 간다
    },
    // 지금 묶음을 닫는다(다음 글은 새 묶음으로)
    endRow(){ row = null; },
  };
  return api;
}

/* 내용이 든 묶음인가. 빈 묶음만 있는 쪽은 쪽을 만들지 않는다.
   보통 묶음은 라벨만 있고 내용이 없으면 없는 것으로 친다(라벨만 덩그러니 선 쪽을 만들지 않게).
   비교 묶음은 네 칸 중 하나라도 있으면 있는 것이다(slide-axis.js의 rowFilled). */
export const rowHasText = r => !!r && (r.kind === 'compare' ? rowFilled(r) : !!String(r.text || '').trim());

export const tidyPages = pages => pages.filter(p => p.rows.some(rowHasText));

/* 어드민이 부르는 하나뿐인 길. 확장자를 보고 한글 파일과 PDF를 갈라 보낸다.
   읽는 쪽은 그때 불러온다(한글 파일만 올릴 때 PDF.js까지 받아 오지 않게). */
export async function worksheetFromFile(file){
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.hwpx')){
    const { worksheetFromHwpx } = await import('./worksheet-hwpx.js?v=20261030w');
    return worksheetFromHwpx(file);
  }
  if (name.endsWith('.pdf')){
    const { worksheetFromPdf } = await import('./worksheet-pdf.js?v=20261030w');
    return worksheetFromPdf(file);
  }
  throw new Error('한글 파일(.hwpx)이나 PDF만 올릴 수 있습니다.');
}
