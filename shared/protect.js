/* ════════════════════════════════════════════════════════════════
   화면 보호 — 우클릭·복사·드래그·인쇄 차단 + 캡처 억제.

   먼저 분명히 해 둘 것: 웹 페이지는 OS 스크린샷을 막을 수 없다.
   아이폰의 전원+볼륨, 윈도우의 Win+Shift+S, 화면 녹화, 다른 기기로 찍는 사진은
   브라우저가 알 수도 막을 수도 없다. 여기서 하는 일은 "손쉬운 복제"를 걷어내는 것이다.
     · 우클릭 / 길게 눌러 이미지 저장 / 드래그 / 텍스트 선택·복사 차단
     · 인쇄(Ctrl+P)와 PDF로 저장 차단
     · PrintScreen 키를 누르면 클립보드를 지우고 경고
     · 개발자도구 단축키(F12, Ctrl+Shift+I/J/C, Ctrl+U) 차단
     · 탭이 백그라운드로 넘어가면 화면을 흐리게(캡처 도구를 띄우는 동안 가려짐)

   applyScreenProtection(document) 한 줄로 켠다.
   ════════════════════════════════════════════════════════════════ */

const STYLE_ID = 'hi-protect-style';

// 선택·드래그·롱프레스 메뉴를 끄고, 인쇄와 블러용 규칙을 심는다.
function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
    html.hi-protected, html.hi-protected body {
      -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none; user-select: none;
      -webkit-touch-callout: none;   /* iOS: 이미지·링크 길게 누르기 메뉴 차단 */
      -webkit-tap-highlight-color: transparent;
    }
    /* 입력이 필요한 곳(타이핑 복습 등)은 예외 — 여기까지 막으면 수업이 안 된다. */
    html.hi-protected input,
    html.hi-protected textarea,
    html.hi-protected [contenteditable="true"] {
      -webkit-user-select: text; -moz-user-select: text; -ms-user-select: text; user-select: text;
    }
    html.hi-protected img, html.hi-protected svg { -webkit-user-drag: none; user-drag: none; }

    /* 탭이 가려진 동안에는 불투명한 덮개로 가린다.
       예전에는 덮개와 별개로 body 자식 전체에 filter: blur(18px)를 걸었는데, 그러면
       브라우저가 흐리게 할 대상(강의 페이지의 경우 슬라이드 전체 스크롤 내용)을 한 장의
       비트맵으로 통째로 그려야 해서 아이폰이 메모리 한계로 탭을 강제 종료했다.
       덮개를 불투명하게 만들면 가림 효과는 같으면서 그리기 비용이 0에 가깝다. */
    .hi-protect-veil {
      position: fixed; inset: 0; z-index: 2147483647;
      display: none; align-items: center; justify-content: center;
      background: #14120e; color: #fff;
      font-family: 'Pretendard', -apple-system, sans-serif;
      font-size: 15px; font-weight: 700; letter-spacing: .2px; text-align: center;
      padding: 24px;
    }
    html.hi-protected.hi-blurred .hi-protect-veil { display: flex; }

    /* 인쇄·PDF 저장으로 통째로 빼가는 것 차단 */
    @media print {
      html.hi-protected body { display: none !important; }
      html.hi-protected::after {
        content: '이 자료는 인쇄할 수 없습니다.';
        display: block; padding: 40px; font-size: 18px; font-weight: 700;
      }
    }`;
  document.head.appendChild(st);
}

function ensureVeil(message) {
  let el = document.querySelector('.hi-protect-veil');
  if (!el) {
    el = document.createElement('div');
    el.className = 'hi-protect-veil';
    document.body.appendChild(el);
  }
  el.textContent = message;
  return el;
}

// 화면 위쪽에 잠깐 떴다 사라지는 경고 띠(외부 토스트 모듈에 의존하지 않게 자체 구현).
function warn(msg) {
  let el = document.getElementById('hi-protect-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'hi-protect-toast';
    el.style.cssText = [
      'position:fixed', 'top:16px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:2147483647', 'background:rgba(20,18,14,.92)', 'color:#fff',
      "font-family:'Pretendard',-apple-system,sans-serif", 'font-size:14px', 'font-weight:700',
      'padding:11px 18px', 'border-radius:999px', 'box-shadow:0 4px 16px rgba(0,0,0,.28)',
      'pointer-events:none', 'opacity:0', 'transition:opacity .18s',
    ].join(';');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 2200);
}

// PrintScreen을 누르면 클립보드에 방금 담긴 화면을 덮어써 지운다.
// (권한이 없거나 브라우저가 거부하면 조용히 넘어간다 — 경고 문구만 남는다.)
async function clobberClipboard() {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(' ');
    }
  } catch (_) {}
}

/**
 * 화면 보호를 켠다.
 * @param {Document} [doc=document]
 * @param {Object} [opts]
 * @param {boolean} [opts.blurWhenHidden=true] 탭이 가려지면 화면을 흐리게 할지
 * @param {string}  [opts.veilMessage] 가려졌을 때 덮개에 띄울 문구
 */
export function applyScreenProtection(doc = document, opts = {}) {
  const { blurWhenHidden = true, veilMessage = '화면 보호 중입니다. 창을 다시 선택하면 이어서 볼 수 있어요.' } = opts;

  injectStyle();
  document.documentElement.classList.add('hi-protected');
  if (blurWhenHidden) ensureVeil(veilMessage);

  doc.addEventListener('contextmenu', e => e.preventDefault());
  doc.addEventListener('dragstart',  e => e.preventDefault());
  doc.addEventListener('copy',       e => e.preventDefault());
  doc.addEventListener('cut',        e => e.preventDefault());

  // 선택 자체를 막되, 글자를 입력해야 하는 칸은 그대로 둔다.
  doc.addEventListener('selectstart', e => {
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, [contenteditable="true"]')) return;
    e.preventDefault();
  });

  doc.addEventListener('keydown', e => {
    const k = (e.key || '').toLowerCase();

    // 인쇄 / 소스 보기 / 저장
    if ((e.ctrlKey || e.metaKey) && (k === 'p' || k === 'u' || k === 's')) {
      e.preventDefault();
      warn('이 자료는 인쇄·저장할 수 없습니다.');
      return;
    }
    // 개발자도구
    if (k === 'f12' || ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c'].includes(k))) {
      e.preventDefault();
      return;
    }
    // 전체 선택 — 입력칸 안에서는 정상 동작해야 한다
    if ((e.ctrlKey || e.metaKey) && k === 'a') {
      const t = e.target;
      if (!(t && t.closest && t.closest('input, textarea, [contenteditable="true"]'))) e.preventDefault();
      return;
    }
    // 화면 캡처 키 — 키가 눌린 시점엔 이미 찍힌 뒤라 막을 수는 없고, 클립보드를 지운다.
    if (k === 'printscreen') {
      clobberClipboard();
      warn('화면 캡처는 허용되지 않습니다.');
    }
  });

  if (blurWhenHidden) {
    const sync = () => {
      document.documentElement.classList.toggle('hi-blurred', document.hidden);
    };
    document.addEventListener('visibilitychange', sync);
    sync();
  }
}
