/**
 * ============================================================
 *  HOISTORY · shared/textLimit.js  v1.0
 * ------------------------------------------------------------
 *  글자수 카운트·자르기·페이스트 차단 공통 모듈.
 *  blind_ryeo · s_threads · sillaver에 흩어져있던 동일 로직 통합.
 *
 *  사용:
 *    import { mountCharCounter, blockPaste }
 *      from '/hoistory/shared/textLimit.js';
 *
 *    mountCharCounter({
 *      input: document.getElementById('postInput'),
 *      counter: document.getElementById('charCount'),
 *      max: 300,
 *      excludeSpaces: true,
 *      format: (n, max) => `${n} / ${max}`
 *    });
 *
 *    blockPaste(document.getElementById('answerText'), {
 *      onPaste: () => showToast('직접 작성해주세요!')
 *    });
 * ============================================================
 */

/**
 * 공백 제외 글자수를 셉니다.
 * @param {string} text
 * @returns {number}
 */
export function countCharsNoSpace(text) {
  if (!text) return 0;
  return String(text).replace(/\s/g, '').length;
}

/**
 * 공백 포함 글자수를 셉니다.
 */
export function countChars(text) {
  return text ? String(text).length : 0;
}

/**
 * 공백 제외 기준으로 입력을 최대 글자수까지 자릅니다.
 * @param {string} text
 * @param {number} max - 공백 제외 최대 글자수
 * @returns {string}
 */
export function truncateNoSpace(text, max) {
  if (!text) return '';
  const s = String(text);
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== ' ' && ch !== '\n' && ch !== '\t') count++;
    if (count > max) return s.slice(0, i);
  }
  return s;
}

/**
 * Input/textarea에 글자수 카운터를 자동으로 wiring합니다.
 *
 * @param {Object} opts
 * @param {HTMLInputElement|HTMLTextAreaElement} opts.input
 * @param {HTMLElement} opts.counter - 카운터 표시 element
 * @param {number} opts.max - 최대 글자수
 * @param {boolean} [opts.excludeSpaces=true] - 공백 제외 카운트
 * @param {boolean} [opts.truncate=true] - 초과시 자동 자르기
 * @param {(count:number, max:number)=>string} [opts.format] - 카운터 포맷
 *
 * @returns {() => void} cleanup 함수 (이벤트 리스너 해제)
 */
export function mountCharCounter(opts) {
  const {
    input,
    counter,
    max,
    excludeSpaces = true,
    truncate = true,
    format
  } = opts;

  if (!input || !counter || !max) {
    throw new Error('[textLimit] input, counter, max는 필수입니다.');
  }

  const countFn = excludeSpaces ? countCharsNoSpace : countChars;
  const fmt = format || ((n, m) => `${n} / ${m}`);

  const update = () => {
    const len = countFn(input.value);

    // 초과 시 자르기
    if (truncate && len > max) {
      input.value = excludeSpaces
        ? truncateNoSpace(input.value, max)
        : input.value.slice(0, max);
    }

    const finalLen = countFn(input.value);
    counter.textContent = fmt(finalLen, max);

    // 상태 클래스
    counter.classList.remove('hi-count-ok', 'hi-count-warn');
    if (finalLen >= max) counter.classList.add('hi-count-warn');
    else if (finalLen > 0) counter.classList.add('hi-count-ok');
  };

  input.addEventListener('input', update);
  update();

  return () => input.removeEventListener('input', update);
}

/* 막았다는 것을 알리는 기본 안내 띠.
   앱마다 토스트가 있기도 없기도 하고, 있어도 테마 토큰에 기대는 경우가 있어
   어떤 페이지에 붙여도 똑같이 보이도록 스타일을 스스로 들고 있는다. */
let _pasteNoticeEl = null, _pasteNoticeTimer = null;
function pasteNotice(msg = '붙여넣기는 쓸 수 없어요. 직접 써 주세요.') {
  if (typeof document === 'undefined' || !document.body) return;
  if (!_pasteNoticeEl) {
    _pasteNoticeEl = document.createElement('div');
    _pasteNoticeEl.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:32px', 'transform:translateX(-50%) translateY(12px)',
      'z-index:2147483647', 'max-width:min(88vw,420px)', 'box-sizing:border-box',
      'background:#1b1b1b', 'color:#fff', 'border-radius:9999px', 'padding:12px 22px',
      "font-family:'Pretendard',-apple-system,sans-serif", 'font-size:14px', 'font-weight:700',
      'line-height:1.4', 'text-align:center', 'word-break:keep-all',
      'box-shadow:0 6px 20px rgba(0,0,0,.28)', 'pointer-events:none',
      'opacity:0', 'transition:opacity .18s, transform .18s',
    ].join(';');
    document.body.appendChild(_pasteNoticeEl);
  }
  _pasteNoticeEl.textContent = msg;
  requestAnimationFrame(() => {
    _pasteNoticeEl.style.opacity = '1';
    _pasteNoticeEl.style.transform = 'translateX(-50%) translateY(0)';
  });
  clearTimeout(_pasteNoticeTimer);
  _pasteNoticeTimer = setTimeout(() => {
    _pasteNoticeEl.style.opacity = '0';
    _pasteNoticeEl.style.transform = 'translateX(-50%) translateY(12px)';
  }, 2400);
}

/**
 * 입력 요소에서 복사/붙여넣기를 차단합니다.
 *
 * 붙여넣기(Ctrl+V, 길게 눌러 붙여넣기)만 막으면 뒷문이 하나 남는다 —
 * 다른 탭에서 글을 드래그해 입력칸에 떨어뜨리는 길이다. 이 경로는 paste 이벤트가
 * 아예 발생하지 않아서 여기까지 막아야 한다(AI가 쓴 글을 그대로 옮겨 오는 데
 * 실제로 쓰이는 방법이다). drop에서 preventDefault를 하면 브라우저의 기본
 * 삽입이 취소되고, dragover에서 dropEffect를 none으로 두면 커서도 금지 표시가 된다.
 *
 * @param {HTMLElement|Document} el
 * @param {Object} [opts]
 * @param {() => void} [opts.onPaste] - 붙여넣기(드롭 포함) 시도 시 콜백
 * @param {() => void} [opts.onCopy] - 복사 시도 시 콜백
 * @param {boolean} [opts.notice] - true면 막았을 때 기본 안내 띠를 띄운다
 *   (onPaste를 직접 주면 그쪽이 우선). 조용히 막기만 하면 학생은 앱이 고장 난 줄 안다.
 */
export function blockPaste(el, opts = {}) {
  if (!el) return;
  const tell = opts.onPaste || (opts.notice ? () => pasteNotice() : null);
  const onPaste = (e) => {
    e.preventDefault();
    tell?.();
  };
  const onCopy = (e) => {
    e.preventDefault();
    opts.onCopy?.();
  };
  const onDrop = (e) => {
    e.preventDefault();
    tell?.();
  };
  const onDragOver = (e) => {
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
  };
  el.addEventListener('paste', onPaste);
  el.addEventListener('copy', onCopy);
  el.addEventListener('cut', onCopy);
  el.addEventListener('drop', onDrop);
  el.addEventListener('dragover', onDragOver);
  el.addEventListener('contextmenu', e => e.preventDefault());
}

/**
 * 양쪽 공백 + 중간 다중 공백을 단일 공백으로 정리합니다.
 * @param {string} text
 * @returns {string}
 */
export function trimCompact(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

/**
 * 입력값 검증 (최소 글자수, 비속어 등).
 * @param {string} text
 * @param {Object} opts
 * @param {number} [opts.min=0] - 최소 글자수 (공백 제외)
 * @param {number} [opts.max] - 최대 글자수 (공백 제외)
 * @param {boolean} [opts.checkRepeats=false] - 반복 문자(ㅋㅋㅋㅋㅋ) 차단
 * @returns {{ok:boolean, reason?:string, message?:string, length?:number}}
 */
export function validateText(text, opts = {}) {
  const { min = 0, max, checkRepeats = false } = opts;
  const len = countCharsNoSpace(text);

  if (len < min) {
    return {
      ok: false, reason: 'too_short', length: len,
      message: `공백 제외 ${min}자 이상 작성해주세요. (현재 ${len}자)`
    };
  }
  if (max && len > max) {
    return {
      ok: false, reason: 'too_long', length: len,
      message: `최대 ${max}자까지 작성 가능합니다. (현재 ${len}자)`
    };
  }
  if (checkRepeats) {
    if (/ㅋ{5,}|ㅎ{5,}|ㅠ{5,}|ㅜ{5,}|\.{5,}/.test(text)) {
      return {
        ok: false, reason: 'repeat_chars', length: len,
        message: '반복 문자 남발은 지양해주세요.'
      };
    }
    if (text && text.match(/(.{4,})\1{2,}/)) {
      return {
        ok: false, reason: 'repeat_phrase', length: len,
        message: '반복된 문구가 감지되었습니다.'
      };
    }
  }
  return { ok: true, length: len };
}
