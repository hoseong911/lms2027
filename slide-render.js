/* ════════════════════════════════════════════════════════
   슬라이드 렌더링 엔진 — lesson.html(학생용)과 admin.html(미리보기)이
   똑같이 이 파일을 불러써서, 슬라이드 HTML 생성 로직이 항상 일치하도록 한다.
   ════════════════════════════════════════════════════════ */
(function (global) {
  console.log('[SlideRender] v20261026a loaded');

  // 스페이스를 2칸 이상 연달아 쓰면 브라우저가 하나로 줄여버리므로, 짝수 번째
  // 스페이스를 &nbsp;로 바꿔 타이핑한 칸 수 그대로 보이게 한다(홀수 번째는 일반
  // 스페이스로 남겨둬서 줄바꿈 지점은 그대로 유지된다).
  function preserveSpaces(str) {
    return String(str).replace(/ {2,}/g, run =>
      Array.from(run, (_, i) => (i % 2 === 0 ? ' ' : '&nbsp;')).join('')
    );
  }

  // 유튜브 주소에 붙은 시작 시간(t / start)을 초로 바꾼다. "90", "90s", "1m30s", "1h2m3s" 모두 처리.
  // admin.js의 ceParseYouTubeStart와 같은 규칙 — 저장된 videoStart가 없는 예전 슬라이드도
  // 원본 url에서 바로 읽어 쓸 수 있게 여기에도 둔다.
  function youTubeStartSec(url) {
    if (!url) return 0;
    const m = String(url).match(/[?&#](?:t|start)=([0-9hms]+)/i);
    if (!m) return 0;
    const raw = m[1].toLowerCase();
    if (/^\d+s?$/.test(raw)) return parseInt(raw, 10) || 0;
    const hms = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!hms) return 0;
    return (+(hms[1] || 0)) * 3600 + (+(hms[2] || 0)) * 60 + (+(hms[3] || 0));
  }

  // 빈칸({})이나 괄호 축소 없이 **굵게** 문법만 적용. 생각 Check 질문처럼 빈칸 문법이
  // 필요 없는 일반 텍스트에 쓴다.
  function boldOnly(str) {
    return String(str).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  }

  // 강 번호 표기 규칙: 순수 숫자면 "N강", 문자(OT/안내 등)가 섞이면 "강" 없이 그대로 둔다.
  function isNumericNum(n) { return /^\d+$/.test(String(n == null ? '' : n).trim()); }
  function lessonNumTag(num) { return isNumericNum(num) ? `${num}강` : `${num}`; }

  function parseText(str) {
    // 빈칸을 임시 플레이스홀더로 보호
    const blanks = [];
    let s = preserveSpaces(str).replace(/\{([^}]+)\}/g, (_, inner) => {
      blanks.push(inner);
      return `\x00${blanks.length - 1}\x00`;
    });
    // **굵게** 문법
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    // 괄호 안에 빈칸(\x00)이 없는 경우에만 80% 크기 적용.
    // 단 (가)(나)(다)처럼 한 글자짜리 글머리 기호는 축소하지 않고 본문 크기로 둔다.
    s = s.replace(/\(([^()\x00]*)\)/g, (m, inner) =>
      /^[가-힣]$/.test(inner) ? m : `<span class="paren-note">(${inner})</span>`);
    // 플레이스홀더를 빈칸 span으로 복원. data-answer에 정답 원문을 담아 타이핑 모드 채점에 쓴다.
    s = s.replace(/\x00(\d+)\x00/g, (_, i) => {
      const ans = blanks[+i];
      const attr = ans.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<span class="blank" data-answer="${attr}">${ans}</span>`;
    });
    // 소프트 줄바꿈: U+2028 -> <br> (편집기 Shift+Enter). U+200B(편집기 표시)는 제거.
    s = s.replace(new RegExp(String.fromCharCode(0x200B), 'g'), '')
         .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '<br>');
    return s;
  }

  /* 줄 맨 앞의 글머리 기호(가운뎃점 · ㆍ ・ • / 대시·하이픈 - – — ―)를 따로 떼어내
     "기호 + 본문" 가로 배치로 감싼다. 본문 칸이 flex:1 박스가 되므로 줄이 넘어가도
     둘째 줄부터 기호 뒤(본문 시작 위치)에 맞춰 내어쓰기된다.
     가운뎃점류는 뒤 공백이 없어도(·내용) 인정하고, 하이픈/대시는 뒤에 공백이 있을 때만
     글머리 기호로 본다("-5도"처럼 기호가 내용의 일부인 경우를 건드리지 않기 위해). */
  const BULLET_RE = /^([·•∙‧ㆍ・]\s*|[-–—―]\s+)/;

  /* 여러 줄 텍스트를 줄 단위로 렌더한다. 글머리 기호로 시작하는 줄은 내어쓰기 블록으로,
     그 외 줄은 fmt()로 그대로 렌더하고 사이에 <br>을 넣는다. 내어쓰기 블록은 그 자체가
     한 줄을 차지하므로(display:flex) 앞뒤에 <br>을 덧붙이지 않는다 — 넣으면 빈 줄이 하나
     더 생긴다. fmt는 한 줄을 HTML로 바꾸는 함수(본문은 parseText, 생각 Check는 굵게만). */
  function linesWithBullets(text, fmt) {
    const lines = String(text == null ? '' : text)
      .replace(new RegExp(String.fromCharCode(0x200B), 'g'), '')
      .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\n')
      .split('\n');
    let html = '', lastBullet = false;
    lines.forEach((line, i) => {
      const m = line.match(BULLET_RE);
      if (m) {
        const mark = m[1].trim();
        html += `<span class="bullet-line"><span class="bullet-mark">${mark}</span><span class="bullet-body">${fmt(line.slice(m[0].length))}</span></span>`;
        lastBullet = true;
      } else {
        if (i > 0 && !lastBullet) html += '<br>';
        html += fmt(line);
        lastBullet = false;
      }
    });
    return html;
  }
  // 본문(빈칸·굵게 문법 적용) 한 덩어리를 글머리 기호 내어쓰기까지 반영해 렌더.
  function parseTextB(str) { return linesWithBullets(str, parseText); }

  /* \n 또는 <br>/</br> 위치에서 줄바꿈 + 내어쓰기. <br>은 어드민 편집기의 textarea가
     항목(items) 구분자로 실제 개행(\n)을 쓰기 때문에, 한 항목 "안에서" 줄을 나누고 싶을
     때(예: ①에 딸린 a./b./c. 하위 줄, 또는 그 본문 중간에 Shift+Enter로 넣는 줄바꿈) 개행
     대신 쓰는 표시다.

     " : "로 시작하는 줄(예: "b.유입 : ...")은 소제목(item-sublead)+본문(sub-body)을 가로
     flex(sub-line)로 묶는다. 그 다음에 이어지는, " : "가 없는 줄들(Shift+Enter로 추가한
     줄바꿈)은 새 sub-line을 만들지 않고 직전 소제목의 sub-body 안에 <br>로 합쳐 넣는다 —
     sub-body가 본문 시작 위치에서 시작하는 flex:1 박스이므로, 안에서 줄이 나뉘어도(수동
     줄바꿈이든 자동 줄바꿈이든) 항상 본문 시작 위치에 맞춰 내어쓰기된다. */
  function renderWithBreaks(text, abcIndent) {
    const lines = text
      .replace(new RegExp(String.fromCharCode(0x200B), 'g'), '')
      .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\n')
      .replace(/<\/?br\s*\/?>/gi, '\n').split('\n');
    /* a./b./c. 들여쓰기는 항목이 "맨 처음부터" 마커로 시작할 때만 준다. 앞에 소제목
       (item-lead)이 붙는 항목은 이미 소제목 폭만큼 오른쪽으로 밀려 있어서, 거기에 또
       들여쓰면 층이 어긋나 보인다. 호출자가 abcIndent를 넘기지 않으면 넘겨받은 덩어리의
       첫 줄로 판단한다(사료·흐름도처럼 소제목 없이 통째로 오는 텍스트). */
    const allowAbc = abcIndent === undefined ? /^[a-z]\.\s/.test(lines[0] || '') : !!abcIndent;
    const out = [];
    let subLead = null, subBodyLines = null, subAbc = false;
    let lastBullet = false;

    function flushSub() {
      if (subLead === null) return;
      const body = linesWithBullets(subBodyLines.join('\n'), parseText);
      // 맨 처음부터 a./b./c.로 시작한 덩어리일 때만 한 칸 들여쓴다(.abc-line).
      out.push(`<span class="sub-line${subAbc ? ' abc-line' : ''}"><span class="item-sublead">${parseText(subLead)}</span><span class="sub-body">${body}</span></span>`);
      subLead = null;
      subBodyLines = null;
      subAbc = false;
      lastBullet = false;
    }

    lines.forEach(line => {
      if (/^[a-z]\.\s/.test(line)) {
        // a./b./c. 마커: 콜론 유무와 무관하게 무조건 새 하위항목. "a." 만 sublead, 나머지 전체가 본문.
        flushSub();
        subLead = line.slice(0, 2);
        subBodyLines = [line.slice(3)];
        subAbc = allowAbc;
      } else {
        const colonIdx = line.indexOf(' : ');
        if (colonIdx > -1) {
          flushSub();
          subLead = line.slice(0, colonIdx);
          subBodyLines = [line.slice(colonIdx + 3)];
        } else if (subBodyLines) {
          subBodyLines.push(line);
        } else {
          // 글머리 기호(·, -)로 시작하면 내어쓰기 블록으로. 그 블록은 스스로 한 줄을
          // 차지하므로 앞뒤에 <br>을 덧대지 않는다.
          const b = linesWithBullets(line, parseText);
          if (BULLET_RE.test(line)) { out.push(b); lastBullet = true; }
          else {
            out.push(out.length === 0 || lastBullet ? b : `<br><span class="line-cont">${b}</span>`);
            lastBullet = false;
          }
        }
      }
    });
    flushSub();

    return out.join('');
  }

  /* item 문자열이 "소제목 : <br>..." 형태 — 즉 Tab으로 소제목을 구분한 직후 곧바로
     Shift+Enter를 눌러 본문이 빈 줄로 시작하는 형태인지 판별한다. rowHTML이 이 값을
     보고 <p>를 가로 배치(기존, 내어쓰기 있음) 대신 세로 배치(내어쓰기 없음)로 바꾼다. */
  function isStackedItem(str) {
    const colonIdx = str.indexOf(' : ');
    if (colonIdx > -1 && /^<br\s*\/?>/i.test(str.slice(colonIdx + 3))) return true;
    const brIdx = str.indexOf('<br>');
    return brIdx > -1 && /^[a-z]\.\s/.test(str.slice(brIdx + 4));
  }

  /* " : " 기준으로 소제목(item-lead)과 본문(item-text) 분리. 콜론은 제거.
     isStackedItem이 true인 경우, 본문 맨 앞의 빈 줄(<br>)은 렌더링에 쓰지 않고
     제거한다 — 줄바꿈 자체는 rowHTML이 <p>를 세로 배치로 바꿔서 대신 표현하므로,
     여기 남겨두면 위쪽에 빈 줄이 하나 더 끼어드는 이중 간격이 생긴다. */
  function parseItemText(str) {
    // 원문자(①~㉿) 및 괄호숫자 (1) (2) 등 앞 번호 제거
    str = str.replace(/^[①-⑳㉑-㊿]\s*/, '').replace(/^\(\d+\)\s*/, '');

    // Case 1: 아이템 자체가 a./b./c. 마커로 시작 → item-lead 없이 전체를 renderWithBreaks에 넘김
    if (/^[a-z]\.\s/.test(str)) {
      return `<span class="item-text">${renderWithBreaks(str, true)}</span>`;
    }

    // Case 2: "제목<br>a./b./c. 하위항목" 형태 — ① 뗀 후 첫 줄이 제목, <br> 이후 a.b.c. 시작
    // e.g. "건국 과정<br>a. {이성계} : ...<br>b. ...<br>c. ..."
    const firstBr = str.indexOf('<br>');
    if (firstBr > -1 && /^[a-z]\.\s/.test(str.slice(firstBr + 4))) {
      const heading = str.slice(0, firstBr);
      const subs    = str.slice(firstBr + 4);
      return `<span class="item-lead">${parseText(heading)}</span><span class="item-text">${renderWithBreaks(subs, false)}</span>`;
    }

    // Case 2b: "소제목 a. ..." 형태 — 소제목 앞에 ' : ' 없는 경우
    const subItemMatch = str.match(/^(.+?)\s([a-z]\.\s)/);
    if (subItemMatch && !subItemMatch[1].includes(' : ')) {
      const leadRaw = subItemMatch[1];
      const rest = str.slice(leadRaw.length + 1);
      return `<span class="item-lead">${parseText(leadRaw)}</span><span class="item-text">${renderWithBreaks(rest, false)}</span>`;
    }

    // Case 3: "소제목 : 본문" 형태 (기존 콜론 구분)
    const colonIdx = str.indexOf(' : ');
    if (colonIdx > -1) {
      const leadRaw = str.slice(0, colonIdx);
      let   rest     = str.slice(colonIdx + 3);
      if (isStackedItem(str)) rest = rest.replace(/^<br\s*\/?>/i, '');
      return `<span class="item-lead">${parseText(leadRaw)}</span><span class="item-text">${renderWithBreaks(rest, false)}</span>`;
    }

    return `<span class="item-text">${renderWithBreaks(str)}</span>`;
  }

  /* 표지 제목의 **핵심어**를 강조(오렌지)로. 빈칸/괄호 축소는 표지에선 쓰지 않는다. */
  function coverParse(str) {
    return preserveSpaces(str).replace(/\*\*([^*\n]+)\*\*/g, '<em>$1</em>');
  }
  function coverHTML(lesson) {
    // 제목은 \n 기준으로 줄을 나눠 각 줄이 좌·우에서 번갈아 밀려들어오는 스플릿 진입을 쓴다.
    const lines = String(lesson.title || '').split('\n');
    const titleLines = lines.map(l => `<span class="cline">${coverParse(l)}</span>`).join('');
    // 단원명·교과서 페이지 메타. 둘 다 있을 때만 사이에 '|' 바를 넣고, 하나만 있으면 그것만,
    // 둘 다 비어 있으면 메타 줄(바 포함) 자체를 렌더하지 않는다.
    const unit = String(lesson.unit || '').trim();
    const page = String(lesson.page || '').trim();
    const metaInner = (unit && page)
      ? `${preserveSpaces(unit)} &nbsp;|&nbsp; ${preserveSpaces(page)}`
      : preserveSpaces(unit || page);
    const metaHTML = metaInner ? `<div class="cover-meta">${metaInner}</div>` : '';
    return `
      <div class="cover-script">Dive into<br>History</div>
      <div class="intro-sweep"></div>
      <div class="cover-num">${lessonNumTag(lesson.num)}</div>
      <div class="cover-fg">
        <div class="cover-tagline">생각하고 활동하고 질문하는 역사 수업</div>
        <h1 class="cover-title">${titleLines}</h1>
        ${metaHTML}
      </div>
    `;
  }

  /* 번호가 매겨진 목록 형태의 슬라이드(학습 목표, 초성 퀴즈가 이 구성을 공유한다).
     둘 다 Dive into History 묶음이라 배지는 "Dive into History", 제목만 다르게 표시한다.
     startNum: 초성 퀴즈가 여러 페이지로 나뉠 때 번호가 이어지도록(6번 문제부터 시작 등). */
  function numberedListHTML(items, badgeLabel, headerTitle, startNum) {
    const base = startNum || 1;
    return `
      <div class="intro-sweep"></div>
      <div class="slide-header">
        <span class="check-badge">${badgeLabel}</span>
        <h2 class="slide-title">${preserveSpaces(headerTitle)}</h2>
      </div>
      <div class="obj-list">
        ${items.map((o, i) => `
          <div class="obj-item">
            <span class="obj-num">${base + i}</span>
            <p class="obj-text">${parseText(o)}</p>
          </div>
        `).join('')}
      </div>
    `;
  }
  /* 번호 목록 슬라이드(학습 목표, 초성 퀴즈). 배지와 제목은 섹션이 들고 있는 값을 쓴다 —
     2026에는 'Dive into History', '학습 목표', '지난 수업 시간에는?'이 코드에 박혀 있어서
     역사 수업 말고는 쓸 수가 없었다(선생님 지시 2026-10-26, 범용화). */
  function listHTML(slide) {
    return numberedListHTML(slide.items || [], slide.badge || '', slide.title || '', (slide.numOffset || 0) + 1);
  }

  /* 초성 퀴즈 문항이 많으면 한 화면(약 8줄)을 넘기 전에 다음 페이지로 넘긴다.
     글자수로 줄바꿈 줄 수를 어림잡는 방식은 실제 폭·폰트와 안 맞아 문항 하나가 이미
     8줄로 잡혀 "한 줄짜리 문항도 페이지 하나를 통째로 차지"하는 문제가 있었다. 대신
     실제 프로덕션과 똑같은 DOM(.slide-objectives .obj-item .obj-text)을 화면 밖에
     그대로 만들어 각 문항을 진짜로 렌더해보고 줄바꿈 줄 수를 측정한다 — 폭·폰트가
     나중에 바뀌어도 이 숫자가 항상 실제와 일치한다. */
  let _chosungMeasureP = null;
  function ensureChosungMeasureP() {
    if (_chosungMeasureP) return _chosungMeasureP;
    const wrap = document.createElement('div');
    wrap.className = 'slide slide-objectives';
    wrap.style.cssText = 'position:fixed;left:-9999px;top:0;width:1920px;height:1080px;visibility:hidden;pointer-events:none;';
    const list = document.createElement('div');
    list.className = 'obj-list';
    const item = document.createElement('div');
    item.className = 'obj-item';
    const num = document.createElement('span');
    num.className = 'obj-num';
    num.textContent = '1';
    const p = document.createElement('p');
    p.className = 'obj-text';
    item.appendChild(num);
    item.appendChild(p);
    list.appendChild(item);
    wrap.appendChild(list);
    document.body.appendChild(wrap);
    _chosungMeasureP = p;
    return p;
  }
  function measureChosungLines(text, scale) {
    // document가 없는 극히 예외적인 상황(테스트 등) 대비 안전장치 — 글자수로 대략 추정.
    if (typeof document === 'undefined') {
      const len = String(text || '').replace(/[{}]/g, '').length;
      return Math.max(1, Math.ceil(len / 28));
    }
    const p = ensureChosungMeasureP();
    /* 섹션 글자 배율이 걸려 있으면 그 크기로 재야 쪽 나눔이 실제 화면과 같다.
       배율만 걸고 기본 크기로 재면 한 장에 들어갈 항목 수가 어긋난다. */
    const base = _lastFonts && _lastFonts.obj != null ? _lastFonts.obj : null;
    p.style.fontSize = (scale && scale !== 100 && base) ? Math.round(base * scale / 100) + 'px' : '';
    p.innerHTML = parseText(text || '');
    const lineHeight = parseFloat(getComputedStyle(p).lineHeight) || 74;
    const h = p.getBoundingClientRect().height;
    return Math.max(1, Math.round(h / lineHeight));
  }
  /* 번호 목록 섹션을 한 화면(약 8줄)씩 끊어 여러 장으로 만든다.
     2026에는 초성 퀴즈 전용이었는데(buildChosungSlides), 학습 목표도 같은 모양이라
     번호 목록 섹션 하나로 합쳤다. 항목이 적으면 그대로 한 장이다. */
  function buildListSlides(sec) {
    const MAX_LINES = 8;
    const pages = [];
    let cur = [], curLines = 0;
    (sec.items || []).forEach(it => {
      const ln = measureChosungLines(it, sec.fontScale);
      if (cur.length && curLines + ln > MAX_LINES) { pages.push(cur); cur = []; curLines = 0; }
      cur.push(it);
      curLines += ln;
    });
    if (cur.length) pages.push(cur);
    let offset = 0;
    return pages.map(group => {
      const s = { type: 'list', items: group, numOffset: offset,
        sectionId: sec.id, badge: sec.badge || '', title: sec.title || '' };
      if (sec.fontScale != null && sec.fontScale !== 100) s.fontScale = sec.fontScale;
      offset += group.length;
      return s;
    });
  }

  // 좌측 라벨 6자 줄바꿈: 6자(공백 포함) 이내로 자르되 6자 안 마지막 공백에서 끊고,
  // 공백이 없으면 6자에서 강제로 끊는다.
  function wrapLabelLine(text) {
    let arr = [...String(text)];
    if (arr.length <= 6) return [String(text)];
    const out = [];
    while (arr.length > 6) {
      let br = -1;
      for (let k = Math.min(6, arr.length - 1); k >= 1; k--) { if (arr[k] === ' ') { br = k; break; } }
      const cut = br > 0 ? br : 6;
      out.push(arr.slice(0, cut).join('').trim());
      arr = arr.slice(br > 0 ? cut + 1 : cut);
      while (arr[0] === ' ') arr = arr.slice(1);
    }
    if (arr.length) out.push(arr.join('').trim());
    return out;
  }

  /* 좁은 좌측 라벨을 여러 줄로 세우는 규칙. 행 나열의 좌측 라벨과 연표(세로)의 라벨이
     화면에서 같은 자리(선 왼쪽의 좁은 칸)를 맡으므로 규칙도 함께 쓴다.
       · 엔터(또는 <br>)로 나뉜 줄은 그대로 각 줄
       · 줄 맨 앞의 '>' → 그 줄만 한 수준 작게
       · 줄 끝의 (연도) 같은 괄호 → 아랫줄에 작게 분리
       · 공백 포함 6자를 넘으면 6자 안쪽 마지막 빈칸에서 끊는다(빈칸이 없으면 6자에서)
     narrow가 거짓이면(라벨 상단 배치) 6자 줄바꿈은 하지 않는다 — 칸이 화면 폭을 다
     쓰므로 줄을 나눌 이유가 없다. 끝 괄호는 상단 배치에서도 떼어 작게 하지만, CSS가
     낮춘 줄을 같은 줄에 이어 붙이므로 "홍경래의 난 (1811)"처럼 옆에 작게 붙는다.
     돌려주는 것은 [{ t, sub }] 목록이다. */
  function labelLines(raw, narrow) {
    const lines = [];
    String(raw).replace(/<\/?br\s*\/?>/gi, '\n').split('\n').forEach(rawLine => {
      let t = rawLine.trim();
      if (!t) return;
      let sub = false;
      if (t[0] === '>') { sub = true; t = t.slice(1).trim(); }
      const m = t.match(/^(.*\S)\s*(\([^()]*\))$/);
      if (m && m[1]) { lines.push({ t: m[1].trim(), sub }); lines.push({ t: m[2], sub: true, paren: true }); }
      else if (t) lines.push({ t, sub });
    });
    if (!narrow) return lines;
    const out = [];
    lines.forEach(o => {
      // 괄호는 쪼개지 않는다. (1592. 4.)가 6자에서 끊겨 "(1592." / "4.)"로 갈라지면
      // 연도로 읽히지 않는다. 대신 길면 글자를 더 줄여 한 줄에 앉힌다.
      if (o.paren) { out.push({ t: o.t, sub: true, scale: parenScale(o.t) }); return; }
      wrapLabelLine(o.t).forEach(t => out.push({ t, sub: o.sub }));
    });
    return out;
  }

  /* 괄호 줄의 글자 크기. 기본은 CSS의 0.68em이고, 그 크기로 라벨 칸에 들어가는 길이를
     14자쯤으로 보아 그보다 길면 길이에 반비례해 더 줄인다(0.42em이 바닥).
     돌려주는 값이 null이면 CSS 기본값(0.68em)을 그대로 쓴다. */
  const PAREN_FIT = 14;
  function parenScale(t) {
    const n = [...String(t)].length;
    return n <= PAREN_FIT ? null : Math.max(0.42, +(0.68 * PAREN_FIT / n).toFixed(3));
  }
  const labelLineHTML = (o, cls) =>
    `<span class="${cls}${o.sub ? ' sub' : ''}"${o.scale ? ` style="font-size:${o.scale}em"` : ''}>${preserveSpaces(o.t)}</span>`;

  /* 원문자(①②③…)로 시작하면서 ' : '도 'a.'도 없는 줄이 "소제목"인지 "번호 매긴 문장"인지
     가른다. 소제목은 짧고 문장부호가 없다("왕권 강화 기반", "세부 채점 기준"). 문장은 쉼표·
     마침표를 달고 있거나, 소제목이라기엔 길다.
       - 마침표는 뒤에 숫자가 오면 안 센다. "3.1 운동" "6.25 전쟁"은 문장이 아니라 제목이다.
       - 가운뎃점(·)도 안 센다. "정치·경제"처럼 제목에서 흔히 쓴다.
       - 길이는 **강조**와 {빈칸} 표시를 걷어낸 알맹이로 잰다. 지금 쓰는 소제목 중 가장 긴
         "도요토미 히데요시"가 9자라 16자면 넉넉하다. */
  const SENTENCE_PUNCT_RE = /[,!?;…]|\.(?!\d)/;
  const TITLE_MAX_LEN = 16;
  function looksLikeSentence(bare) {
    const plain = bare.replace(/\*\*/g, '').replace(/[{}]/g, '').trim();
    return SENTENCE_PUNCT_RE.test(plain) || plain.length > TITLE_MAX_LEN;
  }

  function rowHTML(row, labelPos, bottomQuote) {
    const rawItems = row.items || [];
    const CIRCLE_RE = /^[①-⑳㉑-㊿]\s*/;

    // 1. rawItems를 줄 단위로 납작하게 펴기 (<br>도 줄바꿈으로 처리)
    //    단, "→"로 시작하는 줄은 화살표에서 줄을 바꾸지 않고 바로 앞 줄에 이어 붙인다.
    // U+2028(Shift+Enter로 같은 항목 안에 이어붙인 줄바꿈) 뒤에 곧바로(또는 예전 편집기
    // 버그로 남은 U+200B 잔재 몇 개를 사이에 두고) a./b./c. 하위 항목 마커가 오면, 원래
    // 별도 하위 항목으로 갈라졌어야 하는데 그냥 이어붙여져 저장된 데이터다(a.는 굵게
    // 나오는데 b.는 일반 텍스트로 보이던 문제 — 실제로 U+2028 뒤에 U+200B가 여러 개 낀
    // 채로 저장된 사례가 있었음). 그 경우만 줄바꿈으로 되살려 재분류하고, 그 외
    // U+2028(문장 중간 줄바꿈)은 그대로 둬서 기존 동작에 영향 없게 한다.
    const SOFT_SUBITEM_RE = new RegExp(String.fromCharCode(0x2028) + String.fromCharCode(0x200B) + '*(?=[a-z]\\.\\s)', 'g');
    const lines = [];
    rawItems.forEach(item => {
      item.replace(SOFT_SUBITEM_RE, '\n').replace(/<\/?br\s*\/?>/gi, '\n').split('\n').forEach(line => {
        const t = line.trim();
        if (!t) return;
        if (/^→/.test(t) && lines.length) lines[lines.length - 1] += ' ' + t;
        else lines.push(t);
      });
    });

    // 2. 각 줄 분류
    function classifyLine(line) {
      if (CIRCLE_RE.test(line)) {
        const bare = line.replace(CIRCLE_RE, '');
        const ci = bare.indexOf(' : ');
        const m  = bare.match(/^(.+?)\s([a-z]\.\s)/);
        // a.가 :보다 먼저 나오면 → 제목+인라인소제목
        if (m && (ci === -1 || ci > m[1].length)) {
          return { type: 'title-sub', title: m[1], firstSub: bare.slice(m[1].length + 1) };
        }
        // 콜론 구분 → 제목+내용
        if (ci > -1) return { type: 'title-colon', title: bare.slice(0, ci), content: bare.slice(ci + 3) };
        // 구분자가 없다. 원문자를 소제목에 붙인 건지("① 왕권 강화 기반"), 문장에 번호를
        // 매긴 건지("① 당 자체를 없앤 것이 아니라, …")를 가려야 한다. 전자는 굵은 소제목
        // (item-lead)으로, 후자는 콜론 뒤 내용과 같은 본문 서체(item-text)로 내보낸다.
        if (looksLikeSentence(bare)) return { type: 'text', content: bare };
        // 제목만
        return { type: 'title-alone', title: bare };
      }
      if (/^[a-z]\.\s/.test(line)) {
        return { type: 'sub', marker: line.slice(0, 2), body: line.slice(3) };
      }
      return { type: 'text', content: line };
    }

    const classified = lines.map(classifyLine);

    // 3. 그루핑: title-sub + 이어지는 sub, 연속 sub끼리 묶기
    const groups = [];
    let i = 0;
    while (i < classified.length) {
      const cl = classified[i];
      if (cl.type === 'title-sub') {
        const subs = [{ marker: cl.firstSub.slice(0, 2), body: cl.firstSub.slice(3) }];
        i++;
        while (i < classified.length && classified[i].type === 'sub') { subs.push(classified[i]); i++; }
        groups.push({ type: 'title-with-subs', title: cl.title, subs });
      } else if (cl.type === 'sub') {
        const subs = [cl];
        i++;
        while (i < classified.length && classified[i].type === 'sub') { subs.push(classified[i]); i++; }
        groups.push({ type: 'subs-standalone', subs });
      } else {
        groups.push(cl);
        i++;
      }
    }

    // 4. 렌더링
    /* a./b./c. 하위 줄의 들여쓰기(.abc-line)는 그 줄이 "맨 처음부터" 마커로 시작한
       덩어리일 때만 준다. 앞에 소제목(item-lead)이 붙는 title-with-subs 그룹은 이미
       소제목 폭만큼 오른쪽으로 밀려 있어서, 거기에 또 들여쓰면 층이 어긋나 보인다. */
    function renderSub(sub, indent) {
      return `<span class="sub-line${indent ? ' abc-line' : ''}"><span class="item-sublead">${sub.marker}</span><span class="sub-body">${parseTextB(sub.body)}</span></span>`;
    }

    const itemsHtml = groups.map(g => {
      if (g.type === 'title-with-subs') {
        return `<p class="cr-block"><span class="item-lead">${parseText(g.title)}</span><span class="item-text">${g.subs.map(s => renderSub(s, false)).join('')}</span></p>`;
      }
      if (g.type === 'subs-standalone') {
        return `<p class="cr-block"><span class="item-text">${g.subs.map(s => renderSub(s, true)).join('')}</span></p>`;
      }
      if (g.type === 'title-colon') {
        return `<p class="cr-block"><span class="item-lead">${parseText(g.title)}</span><span class="item-text">${parseTextB(g.content)}</span></p>`;
      }
      if (g.type === 'title-alone') {
        return `<p class="cr-block title-alone"><span class="item-lead">${parseText(g.title)}</span></p>`;
      }
      return `<p class="cr-block"><span class="item-text">${parseTextB(g.content)}</span></p>`;
    }).join('');

    // 행 라벨 밑에 사료 인용을 같이 보이고 싶을 때(3번 기능): 페이지 하단에 따로 떨어뜨리지
    // 않고, 이 행의 항목(들) 바로 아래 같은 내용 칸(라벨 옆)에 이어서 렌더한다. 라벨/오렌지
    // 선은 원래 정한 대로 첫 소제목 높이에만 맞추고(아래 참고), 이 블록 때문에 늘어나지 않는다.
    const bqHtml = bottomQuote ? (() => {
      const srcWrapped = normalizeSource(bottomQuote.source);
      const sub = bottomQuote.label ? `<div class="qt-subtitle">${preserveSpaces(bottomQuote.label)}</div>` : '';
      return `
        <div class="cr-block row-bq">
          ${sub}
          <div class="fmt-quote qt-inline">
            <p class="qt-text"><span class="qt-open">&ldquo;</span>${renderWithBreaks(bottomQuote.text || '')}<span class="qt-close">&rdquo;</span></p>
            ${srcWrapped ? `<p class="qt-src">${preserveSpaces(srcWrapped)}</p>` : ''}
          </div>
        </div>`;
    })() : '';

    // 라벨 위치 기본값은 '상단'. 명시적으로 'left'인 경우에만 좌측 배치.
    const posClass = labelPos === 'left' ? '' : ' label-top';
    // 라벨이 비어 있으면 라벨 칸(네이비 박스) 자체를 렌더하지 않고 내용이 폭을 다 쓰게 한다.
    const hasLabel = !!(row.label && String(row.label).trim());
    // 라벨 여러 줄 규칙:
    //  · 그냥 줄바꿈(엔터/<br>) → 같은 수준(같은 크기)으로 다음 줄 (긴 라벨용)
    //  · 줄 맨 앞에 '>' → 그 줄만 한 수준 낮게(작게·연하게)
    //  · 줄 끝의 (연도) 같은 괄호 → 아랫줄에 작게 분리
    let labelHtml = '';
    if (hasLabel) {
      // 규칙은 labelLines가 쥐고 있다 — 연표(세로)의 라벨도 같은 것을 쓴다.
      // 좁은 좌측 라벨일 때만 6자 줄바꿈이 걸리고, 상단 배치는 칸이 화면 폭을 다 쓰므로
      // 줄을 나누지 않는다(엔터로 나뉜 조각과 끝 괄호도 한 줄에 이어서 보인다).
      // 줄바꿈되면 라벨을 우측정렬(.multi).
      const lines = labelLines(row.label, labelPos === 'left');
      const multiCls = (labelPos === 'left' && lines.length > 1) ? ' multi' : '';
      const inner = lines.map(o => labelLineHTML(o, 'row-label-line')).join('');
      // 좌측 라벨 배치는 라벨과 '첫 소제목'만 세로 가운데로 맞춘다는 원래 정한 규칙 그대로
      // 유지한다(전체 내용/그룹 개수와 무관) — 라벨·오렌지 세로선은 항상 첫 항목 높이만큼만.
      // CSS grid(display:contents 트릭)로 라벨은 1행에, 항목(<p>)들은 각자 행에 자동 배치되고,
      // align-items:center로 라벨과 1행(첫 항목)만 상호 중앙정렬된다.
      labelHtml = `<div class="row-label${multiCls}">${inner}</div>`;
    }
    return `
      <div class="concept-row${posClass}${hasLabel ? '' : ' no-label'}">
        ${labelHtml}
        <div class="row-content">${itemsHtml}${bqHtml}</div>
      </div>`;
  }

  function checkHeaderHTML(badgeLabel, title) {
    return `
      <div class="slide-header">
        <span class="check-badge">${badgeLabel}</span>
        <h2 class="slide-title">${preserveSpaces(title)}</h2>
      </div>`;
  }

  /* ── 새 슬라이드 형식(연표·비교표·사료 인용·플로우) 본문 렌더러 ──
     기존 행 나열(rows)과 달리 좌측 이미지 패널(clayout)은 지원하지 않는다. */
  function timelineHBodyHTML(slide) {
    const events = (slide.events || []).map(ev => `
      <div class="tl-ev">
        <div class="tl-dot"></div>
        <div class="tl-card">
          <span class="tl-year">${preserveSpaces(ev.year || '')}</span>
          <span class="tl-text">${parseText(ev.label || '')}</span>
        </div>
      </div>`).join('');
    return `
      <div class="fmt-timeline-h">
        <div class="tl-line"></div>
        <div class="tl-events">${events}</div>
      </div>`;
  }

  /* 연표(세로)의 라벨은 선 왼쪽의 좁은 칸에 선다. 그래서 행 나열의 좌측 라벨과 같은
     규칙으로 줄을 나눈다(6자 줄바꿈, 끝 괄호는 아랫줄에 작게).
     점은 라벨 칸 안에 넣는다 — 그래야 라벨이 두 줄이 되어도 점이 그 세로 가운데를
     따라간다(칸 밖에 두면 줄 전체 높이를 기준으로 잡혀 내용 쪽에 끌려간다). */
  /* 사건 전체를 격자 하나에 담는다. 사건마다 따로 격자를 만들면 라벨 칸 폭이 제각각이
     되어 선이 곧게 서지 않으므로, 한 격자 안에서 라벨은 1열, 선은 2열, 내용은 3열에
     두고 사건마다 행 번호를 지정한다. 라벨 칸을 max-content로 두면 그 화면에서 가장
     긴 라벨에 딱 맞는 폭이 되어(글자 수로 어림하지 않는다) 라벨 덩이의 왼쪽 끝이
     화면 왼쪽에 붙고, 오른쪽 끝은 선에 붙는다. */
  function timelineVBodyHTML(slide) {
    const list = slide.events || [];
    /* 강조할 사건(focusEvent, 1부터). 지정하면 그 사건만 제 색으로 두고 나머지는 연하게
       깐다. 사건을 지운 뒤 번호가 범위를 벗어나면 마지막 사건으로 당긴다 — 그냥 두면
       어느 사건도 안 맞아 전부 연해지고 강조가 사라진다. 0이나 없음이면 모두 제 색. */
    const focus = slide.focusEvent ? Math.min(slide.focusEvent, list.length) : 0;
    const cells = list.map((ev, i) => {
      const memo = labelLines(ev.memo || '', true).map(o => labelLineHTML(o, 'tlv-memo-line')).join('');
      const dim = focus && (i + 1) !== focus ? ' tlv-dim' : '';
      return `
      <div class="tlv-memo${dim}" style="grid-row:${i + 1}">${memo}<span class="tlv-dot"></span></div>
      <div class="tlv-content${dim}" style="grid-row:${i + 1}">${(ev.content || []).map(t => `<p>${parseItemText(t)}</p>`).join('')}</div>`;
    }).join('');
    // 행을 명시해 두어야 선의 grid-row:1/-1이 사건 전체를 가로지른다(암시적 행이면 1행에서 끝난다).
    // 사건 행 뒤에 빈 1fr 행을 하나 더 둔다. 이 행이 남는 높이를 전부 먹으므로 (a) 사건들은
    // 저절로 위쪽에 붙고 (b) 1/-1로 잡힌 선이 그 행 끝, 곧 페이지 아래까지 내려간다.
    // 선만 늘리려고 따로 절대배치하면 라벨 칸 폭(max-content)을 알 수 없어 가로 위치가
    // 어긋난다 — 선을 격자 안에 둔 채 행을 늘리는 쪽이 맞다.
    const rows = `grid-template-rows:repeat(${Math.max(1, list.length)},max-content) 1fr`;
    return `
      <div class="fmt-timeline-v">
        <div class="tlv-events" style="${rows}">
          <div class="tlv-line"></div>${cells}
        </div>
      </div>`;
  }

  function compareBodyHTML(slide) {
    const left  = slide.left  || { label: '', items: [] };
    const right = slide.right || { label: '', items: [] };
    const col = (side, data) => `
      <div class="cmp-col ${side}">
        <div class="cmp-head">${preserveSpaces(data.label || '')}</div>
        <div class="cmp-body">${(data.items || []).map(t => `<p>${parseItemText(t)}</p>`).join('')}</div>
      </div>`;
    return `
      <div class="fmt-compare">
        ${col('l', left)}
        <div class="cmp-vs">VS</div>
        ${col('r', right)}
      </div>`;
  }

  /* 출처는 항상 겹낫표(『』)로 감싼다. 이미 낫표/꺽쇠류(「」『』〈〉《》【】<>)로 감싸져
     있으면 그 바깥 기호를 벗겨내고 겹낫표로 통일한다 — 예전 데이터가 홑낫표「」로
     저장돼 있어도 화면에는 겹낫표로 보이게 한다. */
  function normalizeSource(src) {
    let s = String(src || '').trim();
    if (!s) return '';
    s = s.replace(/^[『「【《〈<]+\s*/, '').replace(/\s*[』」】》〉>]+$/, '').trim();
    return s ? '『' + s + '』' : '';
  }

  function quoteBodyHTML(slide) {
    const srcWrapped = normalizeSource(slide.source);
    // 소제목이 없으면 화면 세로 중앙에, 있으면 소제목 아래에 그대로 따라붙는다.
    return `
      <div class="fmt-quote${slide.quoteLabel ? '' : ' qt-centered'}">
        <p class="qt-text"><span class="qt-open">&ldquo;</span>${renderWithBreaks(slide.text || '')}<span class="qt-close">&rdquo;</span></p>
        ${srcWrapped ? `<p class="qt-src">${preserveSpaces(srcWrapped)}</p>` : ''}
      </div>`;
  }

  /* 안내(OT·수행평가 등) 자유 문단 슬라이드(1번 기능). 한 줄 = 한 문단,
     "- "로 시작하면 불릿, 빈 줄은 간격. 굵게/빈칸 문법 그대로 적용. */
  function noticeBodyHTML(slide) {
    const lines = String(slide.noticeText || '')
      .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\n')
      .replace(/<\/?br\s*\/?>/gi, '\n')
      .split('\n');
    const html = lines.map(raw => {
      const t = raw.trim();
      if (!t) return '<div class="notice-gap"></div>';
      if (/^-\s/.test(t)) return `<div class="notice-line notice-bullet">${parseText(t.slice(2))}</div>`;
      return `<div class="notice-line">${parseText(t)}</div>`;
    }).join('');
    return `<div class="fmt-notice">${html}</div>`;
  }

  /* 슬라이드에 이미지(img 번호)가 있으면 우측/하단 패널 HTML을 만든다. 없으면 ''. */
  function imgPanelHTML(slide, lesson) {
    const imgBase = slide.img != null ? `img/${lesson.num}_${slide.img}` : null;
    if (!imgBase) return '';
    const imgSize = slide.imgSize != null ? slide.imgSize : 50;
    const style = slide.layout === 'bottom' ? 'flex: 1 1 0; min-height: 0' : `flex: 0 0 ${imgSize}%`;
    return `
      <div class="clayout-img" style="${style}">
        <img src="${imgBase}.png" decoding="async" alt="${slide.imgCaption || ''}" onerror="SlideRenderImgFallback(this,'${imgBase}',0)">
        ${slide.imgCaption ? `<p class="clayout-caption">${slide.imgCaption}</p>` : ''}
      </div>`;
  }

  /* 본문 HTML을 이미지 패널과 함께 우측/하단 레이아웃으로 감싼다. 이미지 없으면 본문 그대로. */
  function wrapWithImg(mainHtml, slide, lesson) {
    const panel = imgPanelHTML(slide, lesson);
    if (!panel) return mainHtml;
    const wrapClass = slide.layout === 'bottom' ? 'clayout-bottom' : 'clayout-right';
    return `<div class="${wrapClass}"><div class="clayout-main">${mainHtml}</div>${panel}</div>`;
  }

  function flowBodyHTML(slide, orientation) {
    const chevClass = orientation === 'v' ? 'fl-chev-v' : 'fl-chev-h';
    const stages = (slide.stages || []);
    const inner = stages.map((st, i) => `
      <div class="fl-stage">
        <div class="fl-stage-label">${preserveSpaces(st.label || '')}</div>
        <p class="fl-stage-text">${renderWithBreaks(st.text || '')}</p>
      </div>${i < stages.length - 1 ? `<div class="${chevClass}"></div>` : ''}`).join('');
    return `<div class="fmt-flow-${orientation}">${inner}</div>`;
  }

  /* 중앙 나열의 실제 내용(대제목 + 가로 균등 칸). 중앙 나열(cols) 형식 페이지와, 행 나열
     페이지 아래에 덧붙는 중앙 나열 블록(bottomCols)이 같은 모양으로 나와야 하므로 둘이
     이 함수를 같이 쓴다. extraClass로 바깥 래퍼에 변형 클래스만 더한다. */
  function colsInnerHTML(colList, title, extraClass, styleVars) {
    const cols = (colList || []).map(c => `
      <div class="cx-col">
        <div class="cx-head">${parseText(c.head || '')}</div>
        ${(c.body && c.body.trim()) ? `<div class="cx-body">${renderWithBreaks(c.body)}</div>` : ''}
      </div>`).join('');
    // 상단 배지 헤더(slide.title)와 별개로, 본문 가운데에 큰 대제목을 둔다.
    const bigTitle = (title && title.trim()) ? `<div class="cx-title">${parseText(title)}</div>` : '';
    const st = styleVars ? ` style="${styleVars}"` : '';
    return `<div class="fmt-cols-wrap${extraClass || ''}"${st}>${bigTitle}<div class="fmt-cols">${cols}</div></div>`;
  }

  /* 중앙 나열 형식(cols): 대제목(slide.colsTitle) 아래에 소제목+내용 칸을 가로로 균등
     배치하고 전체를 화면 정중앙에 놓는다. 칸 개수(2~N)에 상관없이 여백은 균등. */
  function colsBodyHTML(slide) {
    return colsInnerHTML(slide.cols, slide.colsTitle, '');
  }

  // 제목 없는 헤더(배지 없이 제목만) — 안내 슬라이드와 '배지 숨김' 옵션에서 공용.
  function titleOnlyHeaderHTML(title) {
    return title ? `<div class="slide-header slide-header-notice"><h2 class="slide-title">${preserveSpaces(title)}</h2></div>` : '';
  }

  function checkStyleHTML(slide, lesson, badgeLabel) {
    const format = slide.format || 'rows';
    // slide.hideBadge가 켜져 있으면 어떤 형식이든 개념/미션 배지 없이 제목만 표시한다(A 기능).
    const mkHeader = (title) => slide.hideBadge ? titleOnlyHeaderHTML(title) : checkHeaderHTML(badgeLabel, title);

    if (format === 'notice') {
      // OT·수행 안내 등 자유 문단 슬라이드. 개념/미션 배지를 달지 않고 제목만 표시한다.
      // (제목이 비어 있으면 헤더 자체를 렌더하지 않는다.)
      return wrapWithImg(titleOnlyHeaderHTML(slide.title) + noticeBodyHTML(slide), slide, lesson);
    }
    if (format === 'cols') {
      // 일반 배지 헤더(제목) + 소제목/내용 균등 나열(가운데). hideBadge/이미지도 지원.
      return wrapWithImg(mkHeader(slide.title) + colsBodyHTML(slide), slide, lesson);
    }
    if (format === 'quote') {
      // 전체 슬라이드 제목은 다른 슬라이드와 똑같이 좌상단 헤더로 고정.
      const header = slide.title ? mkHeader(slide.title) : '';
      // 사료 소제목((가) 등)만 사료 본문 위에 가운데 정렬로 한 번 더 표시.
      const sub = slide.quoteLabel ? `<div class="qt-subtitle">${preserveSpaces(slide.quoteLabel)}</div>` : '';
      // 사료 인용도 우측/하단 이미지 패널을 지원한다(3번 기능).
      return wrapWithImg(`${header}${sub}${quoteBodyHTML(slide)}`, slide, lesson);
    }
    if (format === 'timeline-h') return mkHeader(slide.title) + timelineHBodyHTML(slide);
    if (format === 'timeline-v') return mkHeader(slide.title) + timelineVBodyHTML(slide);
    if (format === 'compare')    return mkHeader(slide.title) + compareBodyHTML(slide);
    if (format === 'flow-h')     return mkHeader(slide.title) + flowBodyHTML(slide, 'h');
    if (format === 'flow-v')     return mkHeader(slide.title) + flowBodyHTML(slide, 'v');

    // format === 'rows' (기본값) — 행 나열 + (선택) 하단 사료 + 이미지 우/하 배치
    const header = mkHeader(slide.title);
    // 2번 기능: 하단 사료 인용(bottomQuote, 본문이 비어있지 않을 때만). 페이지 맨 아래에
    // 따로 떨어뜨리지 않고 마지막 행의 라벨 옆(내용 칸) 밑에 같이 붙여서, 그 행의 라벨과
    // 오렌지 구분선이 사료 인용까지 자연스럽게 이어지게 한다(3번 기능).
    const bq = slide.bottomQuote;
    const hasBQ = !!(bq && bq.text && bq.text.trim());
    const rows = `
      <div class="concept-rows">
        ${slide.rows.map((r, idx) => rowHTML(r, slide.labelPos, hasBQ && idx === slide.rows.length - 1 ? bq : null)).join('')}
      </div>`;
    /* 행 나열 + 중앙 나열 혼합: 행들 아래에 중앙 나열 블록(bottomCols)을 이어 붙인다.
       하단 사료(bottomQuote)와 같은 방식 — 페이지의 형식(format)은 그대로 'rows'로 두고
       다른 유형의 블록 하나만 덧붙이므로, 기존 행 나열 페이지는 필드가 없으면 그대로다.
       블록은 남은 높이의 가운데에 서고(cols-inline), 자리가 없으면 내용 높이만 차지한다. */
    const bcCols = (slide.bottomCols || []).filter(c => (c.head && c.head.trim()) || (c.body && c.body.trim()));
    const bcTitle = (slide.bottomColsTitle || '').trim();
    /* 페이지 글자 크기 칸(fontSize)은 행 본문(--fs-rows-body)만 건드린다. 블록은 원래
       중앙 나열 페이지였던 내용이라 크기를 따로 잡을 수 있게 자기 필드를 쓴다.
       비우면 디자인 탭의 중앙 나열 값을 그대로 따른다. */
    const bcVars = [
      slide.bottomColsSize      ? `--fs-cols-head:${slide.bottomColsSize}px;--fs-cols-body:${slide.bottomColsSize}px` : '',
      slide.bottomColsTitleSize ? `--fs-cols-title:${slide.bottomColsTitleSize}px` : ''
    ].filter(Boolean).join(';');
    // 행이 하나도 없으면 블록 위 점선을 지운다(cols-solo) — 나눌 구역이 위에 없다.
    const hasRows = (slide.rows || []).some(r => (r.label && String(r.label).trim()) || (r.items || []).some(it => it && String(it).trim()));
    const colsBlock = (bcCols.length || bcTitle)
      ? colsInnerHTML(bcCols, bcTitle, ' cols-inline' + (hasRows ? '' : ' cols-solo'), bcVars) : '';
    return wrapWithImg(`${header}${rows}${colsBlock}`, slide, lesson);
  }

  /* 슬라이드 묶음 섹션의 한 장. 2026에는 개념과 미션 두 함수가 배지 글자만 다르게 같은
     코드를 불렀다. 섹션을 몇 개든 만들 수 있게 됐으므로 배지를 슬라이드에서 받는다. */
  function blockHTML(slide, lesson) { return checkStyleHTML(slide, lesson, slide.badge || ''); }

  /* 여는 질문 슬라이드. 질문 앞뒤를 따옴표로 감싸 인용처럼 크게 띄운다.
     배지, 작은 라벨, 아래 안내 문구를 전부 섹션에서 받는다(2026에는 셋 다 코드에 박혀 있었다). */
  function openingHTML(slide) {
    return `
      <div class="intro-sweep"></div>
      <div class="dive-head">
        ${slide.badge ? `<span class="check-badge">${preserveSpaces(slide.badge)}</span>` : ''}
        ${slide.kicker ? `<span class="dive-kicker">${preserveSpaces(slide.kicker)}</span>` : ''}
      </div>
      <div class="dive-body">
        <p class="dive-q"><span class="qt-open">&ldquo;</span>${renderWithBreaks(slide.question || '')}<span class="qt-close">&rdquo;</span></p>
        ${slide.guide ? `<p class="dive-guide">${renderWithBreaks(slide.guide)}</p>` : ''}
      </div>
    `;
  }

  function imageHTML(slide, lesson) {
    const images = slide.images && slide.images.length ? slide.images : [{ img: slide.img, src: slide.src, caption: slide.caption }];
    const cols = images.length === 4 ? 2 : Math.min(images.length, 3) || 1;
    const cells = images.map(im => {
      if (im.img != null) {
        const base = `img/${lesson.num}_${im.img}`;
        return `
          <div class="grid-img-cell">
            <img src="${base}.png" decoding="async" alt="${im.caption || slide.title || ''}" class="grid-img" onerror="SlideRenderImgFallback(this,'${base}',0)">
            ${im.caption ? `<p class="grid-img-caption">${im.caption}</p>` : ''}
          </div>`;
      }
      return `
        <div class="grid-img-cell">
          <img src="${im.src || ''}" decoding="async" alt="${im.caption || slide.title || ''}" class="grid-img">
          ${im.caption ? `<p class="grid-img-caption">${im.caption}</p>` : ''}
        </div>`;
    }).join('');
    const sz = slide.size != null ? slide.size : 100;
    const sizeStyle = sz < 100 ? `;flex:0 0 auto;width:${sz}%;height:${sz}%;margin:auto` : '';
    return `
      ${slide.title ? `<div class="slide-header"><span class="check-badge">자료</span><h2 class="slide-title">${preserveSpaces(slide.title)}</h2></div>` : ''}
      <div class="image-body" style="grid-template-columns: repeat(${cols}, 1fr)${sizeStyle}">
        ${cells}
      </div>
    `;
  }

  /* 학생이 답을 쓰는 질문 슬라이드. 배지는 섹션에서 받고, 제목을 비우면 강 번호를 쓴다. */
  function promptHTML(slide, lesson) {
    return `
      <div class="slide-header">
        ${slide.badge ? `<span class="check-badge think">${preserveSpaces(slide.badge)}</span>` : ''}
        <h2 class="slide-title">${preserveSpaces(slide.title || lessonNumTag(lesson.num))}</h2>
      </div>
      <p class="think-question">${linesWithBullets(slide.question, s => boldOnly(preserveSpaces(s)))}</p>
      <div class="think-body">
        <p class="think-guide">${linesWithBullets(slide.guide, preserveSpaces).replace('50자', '<strong>50자</strong>')}</p>
      </div>
    `;
  }

  /* 슬라이드 항목을 원문자(①②③…) 경계로 그룹 분리.
     rows가 1개인 rows 형식 슬라이드에만 적용.
     분리 가능하면 { row, groups } 반환, 아니면 null */
  const CIRCLED_RE = /^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]/;
  function circledGroups(slide) {
    if (slide.format && slide.format !== 'rows') return null;
    if (!slide.rows || slide.rows.length !== 1) return null;
    const row = slide.rows[0];
    const items = row.items || [];
    if (!items.some(it => CIRCLED_RE.test(it))) return null;
    const groups = [];
    let cur = [];
    for (const item of items) {
      if (CIRCLED_RE.test(item) && cur.length > 0) { groups.push(cur); cur = []; }
      cur.push(item);
    }
    if (cur.length) groups.push(cur);
    return groups.length > 1 ? { row, groups } : null;
  }

  /* contentLines(구분선/행/이미지 배열)를 slide 배열로 변환. 개념 체크·미션 체크가
     같은 구조를 쓰므로 type만 다르게 해서 공유한다. */
  function buildCheckSlides(lines, sec) {
    const type = 'block';
    const raw = [];
    let current = null;
    (lines || []).forEach(line => {
      if (line.type === 'divider') {
        current = { type, title: line.title, rows: [] };
        if (line.fontSize != null) current.fontSize = line.fontSize; // 페이지별 본문 글자 크기(px) 오버라이드
        if (line.hideBadge) current.hideBadge = true;                 // 페이지별 개념/미션 배지 숨김(A 기능)
        if (line.align) current.align = line.align;                   // 페이지별 본문 정렬(기본 왼쪽, 'justify'면 양쪽)
        const fmt = line.format;
        if (fmt && fmt !== 'rows') {
          current.format = fmt;
          if (fmt === 'timeline-h' || fmt === 'timeline-v') {
            current.events = line.events || [];
            // 강조할 사건 번호(1부터). 없으면 필드를 아예 안 넘겨 예전 연표가 그대로 보이게 한다.
            if (fmt === 'timeline-v' && line.focusEvent) current.focusEvent = line.focusEvent;
          }
          else if (fmt === 'compare') { current.left = line.left || { label: '', items: [] }; current.right = line.right || { label: '', items: [] }; }
          else if (fmt === 'quote') { current.text = line.quoteText || ''; current.source = line.quoteSource || ''; current.quoteLabel = line.quoteLabel || ''; }
          else if (fmt === 'flow-h' || fmt === 'flow-v') current.stages = line.stages || [];
          else if (fmt === 'notice') current.noticeText = line.noticeText || '';
          else if (fmt === 'cols') {
            current.cols = line.cols || []; current.colsTitle = line.colsTitle || '';
            if (line.colsTitleSize != null) current.colsTitleSize = line.colsTitleSize; // 페이지별 대제목 크기
          }
        } else if (line.labelPos) {
          current.labelPos = line.labelPos;
        }
        // 행 나열(rows) 페이지에 하단 사료 인용이 붙어 있으면 함께 넘긴다(2번 기능).
        if ((!fmt || fmt === 'rows') && line.quoteText && line.quoteText.trim()) {
          current.bottomQuote = { text: line.quoteText, source: line.quoteSource || '', label: line.quoteLabel || '' };
        }
        /* 행 나열 페이지에 중앙 나열 블록이 붙어 있으면 함께 넘긴다(행+중앙 혼합).
           내용이 있는 칸만 걸러 넘겨야 빈 칸이 가로 균등 배치의 폭을 먹지 않는다. */
        if (!fmt || fmt === 'rows') {
          const bcKept = (line.bottomCols || []).filter(c => (c.head && c.head.trim()) || (c.body && c.body.trim()));
          const bcTitle = (line.bottomColsTitle || '').trim();
          if (bcKept.length || bcTitle) {
            current.bottomCols = bcKept;
            current.bottomColsTitle = bcTitle;
            if (line.bottomColsSize != null) current.bottomColsSize = line.bottomColsSize;
            if (line.bottomColsTitleSize != null) current.bottomColsTitleSize = line.bottomColsTitleSize;
          }
        }
        if (line.img != null) {
          current.img = line.img;
          current.layout = line.imgLayout || 'right';
          current.imgSize = line.imgSize != null ? line.imgSize : 50;
        }
        raw.push(current);
      } else if (line.type === 'image') {
        raw.push({
          type: 'image',
          title: line.title || '',
          images: line.images.map(im => ({ img: im.img || 1, caption: im.caption || '' })),
          size: line.size != null ? line.size : 100
        });
        current = null;
      } else if (line.type === 'fullimage') {
        raw.push({ type: 'fullimage', img: line.img != null ? line.img : null, url: line.url || '', size: line.size != null ? line.size : 100 });
        current = null;
      } else if (line.type === 'video') {
        // videoStart가 저장돼 있으면 그걸 쓰고, 없으면(예전에 만든 슬라이드) 원본 url에서 읽는다.
        raw.push({ type: 'video', videoId: line.videoId || '', videoStart: line.videoStart || youTubeStartSec(line.url) });
        current = null;
      } else {
        if (!current) { current = { type, title: '', rows: [] }; raw.push(current); }
        current.rows.push({ label: line.label, items: line.items });
      }
    });
    /* 섹션이 들고 있는 값(배지, 글자 배율, 복습 포함)을 슬라이드마다 복사한다.
       renderSlideHTML은 슬라이드 하나만 받아 그리므로 섹션을 되짚을 방법이 없다. */
    if (sec) raw.forEach(s => {
      if (s.badge == null && sec.badge) s.badge = sec.badge;
      if (sec.fontScale != null && sec.fontScale !== 100) s.fontScale = sec.fontScale;
      s.sectionId = sec.id;
      s.review = sec.review === true;
    });
    // 내용이 비어 있는 슬라이드(제목만 있고 본문이 없는 사료·행 등)는 렌더하지 않는다.
    return raw.filter(s => {
      if (s.type === 'image' || s.type === 'fullimage' || s.type === 'video') return true;
      if (s.img != null) return true;
      if (s.format === 'notice') return !!(s.noticeText && s.noticeText.trim());
      if (s.format === 'cols') return !!(s.colsTitle && s.colsTitle.trim()) || (s.cols || []).some(c => (c.head && c.head.trim()) || (c.body && c.body.trim()));
      if (s.format === 'quote') return !!(s.text && s.text.trim());
      if (s.format === 'timeline-h' || s.format === 'timeline-v') return (s.events || []).length > 0;
      if (s.format === 'compare') return (((s.left && s.left.items) || []).length + ((s.right && s.right.items) || []).length) > 0;
      if (s.format === 'flow-h' || s.format === 'flow-v') return (s.stages || []).length > 0;
      if (s.bottomQuote && s.bottomQuote.text && s.bottomQuote.text.trim()) return true;
      if ((s.bottomCols || []).length || (s.bottomColsTitle || '').trim()) return true;
      return (s.rows || []).some(r => (r.label && r.label.trim()) || (r.items || []).some(it => it && String(it).trim()));
    });
  }

  /* ══════ 섹션 (2026-10-26 범용화) ══════
   *
   * 2026 구조는 표지, Dive, 개념, 미션, 생각 다섯 칸이 코드에 못 박혀 있었다. 역사 수업
   * 한 가지에만 맞는 틀이라 선생님이 메뉴를 직접 짤 수 없었다(선생님 지시 2026-10-26).
   * 이제 강의 내용은 섹션 배열이고, 선생님이 섹션을 더하고 빼고 이름을 바꾸고 순서를 바꾼다.
   *
   *   content.sections = [{ id, type, title, badge, enabled, ... }]
   *
   * "개념"과 "미션"은 더 이상 특별한 것이 아니라 slides 섹션 두 개의 이름일 뿐이다.
   * 국어면 "작품 읽기 / 활동 / 감상", 과학이면 "원리 / 실험 / 정리"로 짜면 된다.
   *
   * 섹션 종류는 화면에 그려지는 방식이 실제로 다른 것만 둔다. 더 늘리려면 여기에 한 줄,
   * buildSlidesFromData에 한 갈래, renderSlideHTML에 한 갈래를 더한다.
   */
  const SECTION_TYPES = [
    { type: 'cover',      name: '표지',        once: true, fixed: true,
      desc: '강 번호, 제목, 단원, 교과서 쪽수' },
    { type: 'list',       name: '번호 목록',   badge: '',
      desc: '학습 목표, 지난 시간 복습처럼 번호가 붙는 목록' },
    { type: 'opening',    name: '여는 질문',   badge: '',
      desc: '큰 따옴표로 감싸 크게 띄우는 질문 하나' },
    { type: 'slides',     name: '슬라이드',    badge: '',
      desc: '본문. 행 나열, 이미지, 영상, 인용, 연표, 비교, 단계' },
    { type: 'prompt',     name: '질문',        badge: '',
      desc: '학생이 답을 쓰는 질문' },
  ];
  const sectionType = t => SECTION_TYPES.find(s => s.type === t) || null;

  let _secSeq = 0;
  function newSectionId() { return 's' + Date.now().toString(36) + (_secSeq++).toString(36); }

  function blankSection(type, title) {
    const spec = sectionType(type);
    const s = { id: newSectionId(), type, title: title || (spec ? spec.name : type), badge: '', enabled: true };
    if (type === 'list')    { s.items = []; s.fontScale = 100; }
    if (type === 'opening') { s.question = ''; s.guide = ''; s.kicker = ''; }
    if (type === 'slides')  { s.lines = []; s.review = false; s.fontScale = 100; }
    if (type === 'prompt')  { s.question = ''; s.guide = ''; }
    return s;
  }

  /* 2026 구조({dive, contentLines, mission, think})를 섹션 배열로 옮긴다.
     2027에 아직 실제 강의 내용이 없어서 옮길 데이터는 사실상 없지만, 10-25에 만들어 본
     강의가 남아 있을 수 있고 옛 모양으로 저장된 문서가 열리면 화면이 비기 때문에 둔다.
     원본 칸은 지우지 않는다 — 저장하기 전까지는 되돌릴 수 있어야 한다. */
  function migrateToSections(d) {
    if (!d || Array.isArray(d.sections)) return d;
    const out = [];
    out.push(Object.assign(blankSection('cover'), { title: '표지' }));
    const dive = d.dive || (d.opening ? { title: d.opening.question, guide: d.opening.guide } : null);
    if (d.dive && d.dive.chosungEnabled && (d.dive.chosungItems || []).length) {
      out.push(Object.assign(blankSection('list'), {
        title: '지난 시간', badge: 'Dive into History', items: d.dive.chosungItems.slice(),
      }));
    }
    if (dive && (dive.title || dive.guide)) {
      out.push(Object.assign(blankSection('opening'), {
        title: '여는 질문', badge: 'Dive into History', kicker: 'Opening Question',
        question: dive.guide || dive.title || '',
        guide: '질문에 대한 본인의 답변을 자유롭게 생각해 보고 활동지에 작성해 보세요.',
        enabled: dive.openingEnabled !== false,
      }));
    }
    out.push(Object.assign(blankSection('list'), {
      title: '학습 목표', badge: 'Dive into History',
      items: ((d.lesson && d.lesson.objectives) || []).slice(),
    }));
    out.push(Object.assign(blankSection('slides'), {
      title: '개념', badge: '개념 Check', lines: (d.contentLines || []).slice(), review: true,
    }));
    if (d.mission && (d.mission.contentLines || []).length) {
      out.push(Object.assign(blankSection('slides'), {
        title: '미션', badge: '미션 Check', lines: d.mission.contentLines.slice(), review: false,
      }));
    }
    if (d.think && (d.think.question || d.think.guide)) {
      out.push(Object.assign(blankSection('prompt'), {
        title: '오늘의 질문', badge: '오늘의 질문',
        question: d.think.question || '', guide: d.think.guide || '',
      }));
    }
    d.sections = out;
    return d;
  }

  /* 섹션 배열을 실제 화면이 쓰는 slides 배열로 편다. 어드민 미리보기와 학생 수업 화면이
     이 함수 하나를 같이 써서 두 화면이 언제나 일치한다. */
  function buildSlidesFromData(d) {
    if (!d) return [];
    if (!Array.isArray(d.sections)) migrateToSections(d);
    const slides = [];
    (d.sections || []).forEach(sec => {
      if (sec.enabled === false) return;
      const tag = { sectionId: sec.id, badge: sec.badge || '', title: sec.title || '' };
      if (sec.type === 'cover') {
        slides.push({ type: 'cover', sectionId: sec.id });
      } else if (sec.type === 'list') {
        if ((sec.items || []).length) slides.push(...buildListSlides(sec));
      } else if (sec.type === 'opening') {
        if (sec.question) slides.push(Object.assign({ type: 'opening', kicker: sec.kicker || '',
          question: sec.question, guide: sec.guide || '' }, tag));
      } else if (sec.type === 'slides') {
        slides.push(...buildCheckSlides(sec.lines, sec));
      } else if (sec.type === 'prompt') {
        if (sec.question || sec.guide) slides.push(Object.assign({ type: 'prompt',
          question: sec.question || '', guide: sec.guide || '' }, tag));
      }
    });
    return slides;
  }

  /* slide + lesson 데이터를 받아 완성된 <div class="slide ...">...</div> HTML 문자열을 돌려준다 */
  /* 페이지별 글자 크기가 덮어써야 할 변수. 본문 글자를 그리는 변수만 적는다
     (사료 인용의 소제목·출처, 연표의 연도처럼 곁다리 글자는 디자인 탭 값을 따른다). */
  const PAGE_FS_VARS = {
    rows:         ['--fs-rows-body'],
    quote:        ['--fs-qt-text'],
    notice:       ['--fs-notice'],
    compare:      ['--fs-cmp-body'],
    'timeline-h': ['--fs-tl-text'],
    'timeline-v': ['--fs-tl-text'],
    'flow-h':     ['--fs-fl-text'],
    'flow-v':     ['--fs-fl-text'],
    cols:         ['--fs-cols-head', '--fs-cols-body']
  };

  function renderSlideHTML(slide, lesson) {
    let extraClass = '';
    let inner = '';
    /* CSS 클래스 이름은 2026 것을 그대로 쓴다(slide-objectives, slide-dive,
       slide-think). slide-style.css를 건드리지 않으려는 것이고, 뜻은 섹션 종류와 같다. */
    if (slide.type === 'cover') {
      extraClass = ' slide-cover';
      inner = coverHTML(lesson);
    } else if (slide.type === 'list') {
      extraClass = ' slide-objectives';
      inner = listHTML(slide);
    } else if (slide.type === 'opening') {
      extraClass = ' slide-dive'; // 다크 무빙 포스터 톤
      inner = openingHTML(slide);
    } else if (slide.type === 'block') {
      inner = blockHTML(slide, lesson);
    } else if (slide.type === 'image') {
      inner = imageHTML(slide, lesson);
    } else if (slide.type === 'fullimage') {
      extraClass = ' slide-full';
      // 100%는 기존 그대로 화면 전체를 채우는 cover(전면 이미지 본래 취지, 크롭 허용).
      // 100% 미만으로 줄일 때는 그 반대로 "이만큼만 차지시키고 나머지는 여백으로 두는" 것이
      // 목적이므로 contain을 써서 사진 내용이 잘리지 않게 한다(크기 = 화면 기준 %는 그대로 유지).
      const sz = slide.size != null ? slide.size : 100;
      const sizeStyle = sz < 100 ? ` style="width:${sz}%;height:${sz}%;object-fit:contain"` : '';
      if (slide.img != null) {
        const base = `img/${lesson.num}_${slide.img}`;
        inner = `<img class="full-img"${sizeStyle} decoding="async" src="${base}.png" alt="" onerror="SlideRenderImgFallback(this,'${base}',0)">`;
      } else if (slide.url) {
        inner = `<img class="full-img"${sizeStyle} decoding="async" src="${slide.url}" alt="">`;   // 예전 업로드분 호환
      } else {
        inner = `<div class="slide-media-empty" style="color:#999">이미지 없음</div>`;
      }
    } else if (slide.type === 'video') {
      extraClass = ' slide-video';
      inner = slide.videoId
        // start= 를 붙이면 유튜브 주소에 적힌 시작 시간부터 재생된다(없으면 0이라 붙이지 않는다).
        ? `<iframe class="video-frame" data-vsrc="https://www.youtube-nocookie.com/embed/${slide.videoId}?rel=0&modestbranding=1${slide.videoStart ? '&start=' + slide.videoStart : ''}" src="" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`
        : `<div class="slide-media-empty" style="color:#fff">영상 URL 없음</div>`;
    } else if (slide.type === 'prompt') {
      extraClass = ' slide-think';
      inner = promptHTML(slide, lesson);
    }
    // 페이지별 본문 정렬. 기본은 왼쪽이고, 어드민에서 켠 페이지에만 클래스가 붙는다.
    // justify는 행 나열·안내문(오른쪽 끝 맞춤), center는 비교표(가운데)에 쓴다.
    // 예전에는 미션 Check 전체가 CSS로 양쪽 정렬이라 끌 수가 없었다.
    if (slide.align === 'justify') extraClass += ' align-justify';
    else if (slide.align === 'center') extraClass += ' align-center';
    /* 페이지별 본문 글자 크기 오버라이드("형식 변경 / 페이지 설정"의 글자 크기 칸).
       형식마다 본문이 읽는 변수가 다르므로(--fs-rows-body, --fs-qt-text …) 그 형식의
       변수를 함께 덮어쓴다. 예전에는 --fs-body 하나만 덮어썼는데, 디자인 탭이 형식별
       변수를 언제나 채우기 때문에 --fs-body는 어느 규칙에도 닿지 않아 이 설정이 통째로
       먹지 않았다(중앙 나열만 따로 손봐 둔 상태였다). 형식을 새로 만들면 여기 한 줄을
       더해야 그 형식에서도 페이지별 크기가 먹는다. */
    let fsStyle = '';
    const decls = [];
    if (slide.fontSize) {
      // --fs-body 도 같이 남긴다 — 아직 PAGE_FS_VARS 에 안 올라온 규칙을 위한 안전판.
      decls.push(`--fs-body:${slide.fontSize}px`);
      (PAGE_FS_VARS[slide.format || 'rows'] || []).forEach(v => decls.push(`${v}:${slide.fontSize}px`));
    }
    if (slide.colsTitleSize) decls.push(`--fs-cols-title:${slide.colsTitleSize}px`);
    /* 섹션 글자 배율 — 2026에는 미션 Check만 글자 크기를 따로 둘 수 있었다. 그러려고
       CSS에 -m 변수 한 벌(.slide-mission)을 박아 뒀는데, 섹션을 몇 개든 만들 수 있게 된
       지금은 그 방식이 안 된다(섹션마다 변수 한 벌을 CSS에 더할 수는 없다).
       섹션마다 배율(%) 한 칸으로 바꾸고, 그 섹션 슬라이드에만 계산한 px를 인라인으로 건다.
       100이면 아무것도 걸지 않으므로 기본 모양은 그대로다. */
    if (slide.fontScale != null && slide.fontScale !== 100 && _lastFonts) {
      const k = slide.fontScale / 100;
      SCALABLE_KEYS.forEach(key => {
        const v = _lastFonts[key];
        if (v != null && FONT_VARS[key]) decls.push(`${FONT_VARS[key]}:${Math.round(v * k)}px`);
      });
    }
    if (decls.length) fsStyle = ` style="${decls.join(';')}"`;
    return `<div class="slide${extraClass}"${fsStyle}>${inner}</div>`;
  }

  /* img 번호로 만든 경로는 확장자를 png로 가정하는데, 실제 저장 파일이 jpg·webp인
     경우가 섞여 있어서 로드 실패 시 jpg -> jpeg -> webp -> gif 순으로 다시 시도한다.
     선생님이 파일을 올릴 때 확장자를 신경 쓰지 않아도 되게 하는 것이 목적이므로,
     새 확장자를 쓰게 되면 여기 한 줄에 더한다.
     onerror 인라인 속성에서 호출해야 하므로 전역(window)에 노출한다. */
  function SlideRenderImgFallback(imgEl, basePath, idx) {
    const exts = ['jpg', 'jpeg', 'webp', 'gif'];
    if (idx >= exts.length) { imgEl.onerror = null; return; }
    imgEl.onerror = () => SlideRenderImgFallback(imgEl, basePath, idx + 1);
    imgEl.src = `${basePath}.${exts[idx]}`;
  }
  global.SlideRenderImgFallback = SlideRenderImgFallback;

  /* 이미지 클릭 → 확대 라이트박스. 오버레이는 최초 호출 시 한 번만 만들어 body에 붙인다. */
  let lightbox = null;
  function ensureLightbox() {
    if (lightbox) return lightbox;
    const overlay = document.createElement('div');
    overlay.className = 'img-lightbox-overlay';
    overlay.innerHTML = `<button class="img-lightbox-close" aria-label="닫기">&times;</button><img>`;
    document.body.appendChild(overlay);
    const imgEl = overlay.querySelector('img');
    const close = () => overlay.classList.remove('open');
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('.img-lightbox-close').addEventListener('click', close);
    /* 확대 상태에서는 아무 키나 누르면 닫는다(Escape만 받지 않는다). 발표용 리모컨의
       버튼이 PageUp/PageDown으로 들어오는데, 그 버튼으로 사진을 닫으려는 것이다.

       - capture 단계에서 잡는다. lecture.html의 슬라이드 넘김 핸들러도 document에
         걸려 있어서, bubble로 두면 등록 순서에 따라 슬라이드가 먼저 넘어가 버린다.
       - 사진을 닫은 키는 거기서 멈춘다(stopPropagation). 한 번 눌러 사진을 닫고 다시
         눌러 넘어가는 것이 리모컨을 쥔 손에 자연스럽다 — 닫으면서 슬라이드까지
         건너뛰면 어디로 갔는지 모르게 된다.
       - 조합키(Ctrl+R 등)와 수식키 단독 누름, 빈칸 타이핑 중에는 흘려보낸다. */
    document.addEventListener('keydown', e => {
      if (!overlay.classList.contains('open')) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
      if (e.target && e.target.classList && e.target.classList.contains('blank-input')) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    }, true);
    lightbox = { overlay, imgEl, close };
    return lightbox;
  }

  /* container 안의 슬라이드 이미지들에 클릭 시 확대 보기를 붙인다. 렌더 후(슬라이드를 새로 그릴 때마다) 호출. */
  function wireLightbox(container) {
    const box = ensureLightbox();
    container.querySelectorAll('.grid-img, .clayout-img img').forEach(img => {
      img.addEventListener('click', () => {
        box.imgEl.src = img.src;
        box.overlay.classList.add('open');
      });
    });
  }

  /* 확대된 상태면 닫는다. 슬라이드 전환 시(다음/이전) 호출해서 확대 이미지가 그대로 남지 않게 한다. */
  function closeLightbox() {
    if (lightbox) lightbox.close();
  }

  // 강 번호 + 제목 결합 표기: 숫자면 "N강. 제목", 문자면 "OT: 제목".
  function lessonTitleLabel(num, title) { return isNumericNum(num) ? `${num}강. ${title}` : `${num}: ${title}`; }

  /* 슬라이드에서 쓰는 웹폰트를 실제로 내려받을 때까지 기다린다.

     쪽 나눔(줄 수·높이 측정)은 폰트 메트릭에 그대로 좌우되는데, document.fonts.ready만
     기다리면 "그 시점까지 요청된" 폰트만 보장된다. Paperlogy나 Gowun Batang은 슬라이드가
     DOM에 들어가기 전까지 아무도 안 쓰므로 아직 요청조차 안 된 상태이고, 그러면 측정은
     대체 폰트(맑은 고딕 등) 기준으로 이뤄진다. 폰트가 이미 캐시된 컴퓨터는 진짜 폰트로,
     처음 접속한 컴퓨터는 대체 폰트로 재는 바람에 컴퓨터마다 한 슬라이드에 들어가는
     줄 수가 달라졌다. 그래서 필요한 폰트를 이름으로 콕 집어 먼저 받아 둔다.
     한글 표본을 같이 넘겨야 한글 서브셋까지 받아온다(구글 폰트는 unicode-range로 쪼개져 있다). */
  let _fontsP = null;
  function ensureSlideFonts() {
    if (_fontsP) return _fontsP;
    if (typeof document === 'undefined' || !document.fonts) return (_fontsP = Promise.resolve());
    const SAMPLE = '가나다라마바사아자차카타파하 0123456789';
    const wanted = [
      '400 60px Pretendard', '500 60px Pretendard', '700 60px Pretendard', '900 60px Pretendard',
      '400 60px Paperlogy', '600 60px Paperlogy', '700 60px Paperlogy', '900 60px Paperlogy',
      '400 60px "Gowun Batang"', '700 60px "Gowun Batang"',
    ];
    _fontsP = Promise.all(wanted.map(f => document.fonts.load(f, SAMPLE).catch(() => {})))
      .then(() => document.fonts.ready)
      .catch(() => {});
    return _fontsP;
  }

  /* ════════════ 글꼴 크기 설정 스펙 ════════════
     디자인 탭의 "글꼴 크기" 패널과 실제 CSS 변수를 한 곳에서 정의한다. 어드민(미리보기)과
     lecture.html(수업 화면)이 이 표를 같이 읽으므로, 항목을 늘릴 때 여기만 고치면 양쪽에
     동시에 반영된다.

     구조: 섹션(표지/Dive/개념/미션/생각) > 그룹(슬라이드 형식) > 행(조절 항목).
     행의 key는 settings/class_design 의 fonts 안에 저장되는 이름이고, v는 CSS 변수명이다.

     개념과 미션은 같은 CSS 규칙을 쓰기 때문에, 미션 값은 변수 이름 뒤에 -m을 붙여 따로
     두고 slide-style.css의 `.slide-mission { ... }` 블록에서 갈아끼운다. */
  const FONT_SPEC = [
    { name: '표지', groups: [
      { name: '표지', rows: [
        { key: 'cover',        label: '제목',         v: '--fs-cover-title',   max: 260 },
        { key: 'coverTagline', label: '태그라인',     v: '--fs-cover-tagline' },
        { key: 'coverMeta',    label: '단원/쪽수',    v: '--fs-cover-meta' },
        { key: 'coverScript',  label: '필기체(배경)', v: '--fs-cover-script', min: 100, max: 900 },
        { key: 'coverNum',     label: '강 숫자',      v: '--fs-cover-num',    max: 260 },
      ]},
    ]},
    { name: '여는 질문', groups: [
      { name: '여는 질문', rows: [
        { key: 'diveQ',      label: '질문',       v: '--fs-dive-q' },
        { key: 'diveGuide',  label: '안내 문구',  v: '--fs-dive-guide' },
        { key: 'diveKicker', label: '라벨',       v: '--fs-dive-kicker' },
      ]},
    ]},
    { name: '번호 목록', groups: [
      { name: '번호 목록', rows: [
        { key: 'obj',    label: '항목', v: '--fs-obj' },
        { key: 'objNum', label: '번호', v: '--fs-obj-num', max: 240 },
      ]},
    ]},
    { name: '슬라이드', groups: [
      { name: '공통', rows: [
        { key: 'title', label: '슬라이드 제목', v: '--fs-slide-title' },
      ]},
      { name: '행 나열', rows: [
        { key: 'rowsLabel', label: '행 라벨', v: '--fs-rows-label' },
        { key: 'rowsBody',  label: '본문',    v: '--fs-rows-body' },
      ]},
      { name: '연표 (가로/세로)', rows: [
        { key: 'tlYear',  label: '연도',      v: '--fs-tl-year' },
        { key: 'tlvMemo', label: '세로 라벨', v: '--fs-tlv-memo' },
        { key: 'tlText',  label: '내용',      v: '--fs-tl-text' },
      ]},
      { name: '비교표', rows: [
        { key: 'cmpHead', label: '머리', v: '--fs-cmp-head' },
        { key: 'cmpBody', label: '내용', v: '--fs-cmp-body' },
      ]},
      { name: '사료 인용', rows: [
        { key: 'qtSub',  label: '소제목', v: '--fs-qt-sub' },
        { key: 'qtText', label: '본문',   v: '--fs-qt-text' },
        { key: 'qtSrc',  label: '출처',   v: '--fs-qt-src' },
      ]},
      { name: '플로우 (가로/세로)', rows: [
        { key: 'flLabel', label: '단계 라벨', v: '--fs-fl-label' },
        { key: 'flText',  label: '내용',      v: '--fs-fl-text' },
      ]},
      { name: '안내 (OT/수행)', rows: [
        { key: 'notice', label: '본문', v: '--fs-notice' },
      ]},
      { name: '중앙 나열', rows: [
        { key: 'colsTitle', label: '대제목', v: '--fs-cols-title' },
        { key: 'colsHead',  label: '소제목', v: '--fs-cols-head' },
        { key: 'colsBody',  label: '내용',   v: '--fs-cols-body' },
      ]},
    ]},
    /* 2026에는 여기에 "미션 Check" 한 벌(m*로 시작하는 키 19개)이 통째로 더 있었다.
       개념과 미션의 글자 크기를 따로 두려고 CSS 변수를 -m으로 복사해 둔 것인데,
       섹션을 몇 개든 만들 수 있게 된 지금은 섹션마다 한 벌씩 늘어나 감당이 안 된다.
       섹션의 글자 배율(%) 한 칸으로 바꿨다(renderSlideHTML의 SCALABLE_KEYS). */
    { name: '질문', groups: [
      { name: '질문', rows: [
        { key: 'think',      label: '질문',      v: '--fs-question' },
        { key: 'thinkGuide', label: '안내 문구', v: '--fs-think-guide' },
      ]},
    ]},
    { name: '공통', groups: [
      { name: '공통', rows: [
        { key: 'badge', label: '배지', v: '--fs-badge', max: 120 },
      ]},
    ]},
  ];

  // 스펙을 한 줄짜리 목록으로 편다.
  function fontRows() {
    const out = [];
    FONT_SPEC.forEach(sec => sec.groups.forEach(g => g.rows.forEach(r => out.push(r))));
    return out;
  }
  const FONT_KEYS = fontRows().map(r => r.key);
  const FONT_VARS = fontRows().reduce((m, r) => (m[r.key] = r.v, m), {});

  /* 예전 설정(개념/미션이 label·body·bodyMission 세 값만 갖고 있던 시절)을 형식별 값으로 편다.
     이미 있는 값은 절대 건드리지 않으므로, 처음 열었을 때 화면이 지금과 똑같이 나온다. */
  function normalizeFonts(fonts) {
    const f = Object.assign({}, fonts || {});
    const label = f.label != null ? f.label : 70;
    const body  = f.body  != null ? f.body  : 60;
    const put = (k, v) => { if (f[k] == null) f[k] = v; };

    /* 슬라이드 글자 크기는 디자인 문서에서 오는데, 그 문서가 아직 없거나 칸이 비어 있으면
       slide-style.css의 :root 기본값으로 떨어진다. 그 값들은 옛 화면에서 쓰던 작은 수치라
       (--fs-obj가 17px이다) 슬라이드가 깨알같이 나온다. 2026에는 디자인 문서가 늘 있어서
       드러나지 않던 구멍인데, 번호 목록 섹션을 누구나 만들 수 있게 되면서 눈에 띈다.
       렌더러가 스스로 제 기본값을 채워 어떤 경우에도 읽을 만한 크기가 되게 한다. */
    put('title', 40); put('obj', 70); put('think', 80); put('thinkGuide', 50);
    put('objNum', 130);
    // 2026에는 초성 퀴즈 전용 크기(chosung 48, chosungNum 110)가 따로 있었다. 번호 목록
    // 섹션 하나로 합쳐지면서 obj/objNum 한 벌만 쓰고, 글자가 많으면 섹션 배율로 줄인다.
    // 개념 — 예전엔 라벨 계열은 전부 --fs-label, 본문 계열은 전부 --fs-body를 썼다.
    put('rowsLabel', label);        put('rowsBody', body);
    put('tlYear', Math.round(label * 1.1)); put('tlText', body);   // 연표 연도는 라벨의 1.1배였다
    put('tlvMemo', f.tlYear);   // 세로 연표 라벨은 연도 크기를 함께 쓰다가 따로 뗐다
    put('cmpHead', label);          put('cmpBody', body);
    put('flLabel', label);          put('flText', body);
    put('notice', body);
    put('qtSub', 40); put('qtText', 60); put('qtSrc', 40);
    put('colsTitle', label); put('colsHead', body); put('colsBody', body);
    // 미션 전용 한 벌(m*)은 섹션 글자 배율로 바뀌어 없앴다(2026-10-26).
    return f;
  }

  /* 섹션 배율이 걸린 슬라이드에서 다시 계산할 본문 글자 변수들.
     곁다리(표지, 여는 질문, 번호 목록, 배지)는 섹션 종류가 하나뿐이라 배율을 걸지 않는다. */
  const SCALABLE_KEYS = ['title', 'rowsLabel', 'rowsBody', 'tlYear', 'tlvMemo', 'tlText',
    'cmpHead', 'cmpBody', 'qtSub', 'qtText', 'qtSrc', 'flLabel', 'flText', 'notice',
    'colsTitle', 'colsHead', 'colsBody', 'obj', 'objNum'];

  /* 마지막으로 건 글꼴 값. renderSlideHTML은 슬라이드 하나만 받아서 디자인 설정을 모르는데,
     섹션 배율을 px로 계산하려면 기준값이 필요하다. */
  let _lastFonts = null;

  /* fonts 객체를 CSS 변수로 el(문서 루트 또는 미리보기 컨테이너)에 건다. */
  function applyFontVars(el, fonts) {
    const f = normalizeFonts(fonts);
    _lastFonts = f;
    FONT_KEYS.forEach(k => { if (f[k] != null) el.style.setProperty(FONT_VARS[k], f[k] + 'px'); });
    // 예전 변수도 남겨 둔다 — 혹시 스펙에 안 올라온 규칙이 있어도 예전처럼 동작하도록.
    if (f.label != null) el.style.setProperty('--fs-label', f.label + 'px');
    if (f.body  != null) el.style.setProperty('--fs-body',  f.body  + 'px');
    return f;
  }

  global.SlideRender = { parseText, renderWithBreaks, parseItemText, renderSlideHTML, wireLightbox, closeLightbox, buildSlidesFromData, buildCheckSlides, circledGroups, lessonNumTag, lessonTitleLabel, ensureSlideFonts,
    SECTION_TYPES, sectionType, blankSection, newSectionId, migrateToSections,
    FONT_SPEC, FONT_KEYS, FONT_VARS, normalizeFonts, applyFontVars };

})(window);
