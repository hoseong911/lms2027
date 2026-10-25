/* 2027 개념 노트 편집기 — 2026 hoistory/lms/admin.js의 "개념 체크"(1705~3751행)를 옮겼다(2026-10-25).
 *
 * 선생님 지시: 개념 체크를 "개념 노트"라는 이름으로 이식. 기능만 옮기고 2026 강의 내용은 가져오지 않는다.
 *
 * 2026과 달라진 것
 *  - 강의는 class_lessons가 아니라 lesson_library(강의 라이브러리)에 둔다. 강 번호 칸은 lessonNo.
 *    코드 안에서는 2026처럼 l.num으로 읽도록 불러올 때 맞춰 준다(ceGetLessonsFromFirestore).
 *  - 디자인은 settings/concept_note_design. 2026의 settings/class_design을 쓰면 2026 슬라이드가 바뀐다.
 *  - 그림은 이 레포의 img/{강번호}_{번호}. 2027 강 번호가 2026과 겹쳐도 2026 그림이 뜨지 않게.
 *  - 2026 진도표(plSyncLectureRow)와 생각 체크 강의 자동 생성(ceSyncThinkLecture)은 2027에 아직
 *    그 기능이 없어 뺐다. 진도 일정에 따른 자동 공개는 다음 단계에서 붙인다.
 *  - alert/confirm/prompt 대신 어드민의 ask()와 toast()를 받아 쓴다(initConceptNote).
 *  - 화면 규칙(CLAUDE.md)에 맞춰 작은 글씨 안내문을 빼고, 설명이 필요 없는 버튼은 아이콘으로.
 *
 * 2026 코드가 인라인 onclick/oninput을 많이 써서 함수들을 window에 노출한다(파일 맨 끝).
 * 2,000줄을 위임 방식으로 다시 짜면 옮기는 중에 동작이 틀어질 위험이 커서 그대로 둔 예외다.
 * 새로 붙이는 코드는 이 방식을 따르지 말 것.
 */
import {
  collection, getDocs, getDoc, doc, addDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { CLAUDE_PROXY_URL } from "./shared/util.js?v=20261025a";
import { lessonOrderKey as lecOrderKey, lessonTag as lecTag } from "./model.js?v=20261025k";

const LIB = 'lesson_library';
const DESIGN_REF = () => doc(db, 'settings', 'concept_note_design');

// 어드민이 넘겨 주는 것들. initConceptNote가 채운다.
let db = null, ask = null, toast = null, esc = s => String(s ?? '');

// 2026의 lecLabel — "N강. 제목"
const lecLabel = (num, title) => `${lecTag(num)}${title ? '. ' + title : ''}`;

// alert 대신 — 짧은 결과와 오류는 토스트로.
const notify = (msg, kind = 'err') => toast ? toast(msg, kind) : console.warn(msg);
// confirm 대신 — 확인 창(빈 값이면 취소).
const confirmAsk = async (title, body = '', danger = false) => !!(await ask({ title, body: esc(body), danger }));

// 글꼴 크기 항목 정의는 slide-render.js의 FONT_SPEC 한 곳에만 둔다 — 어드민 패널과
// 수업 화면(lecture.html)이 같은 표를 읽어야 항목이 어긋나지 않는다.
const CE_FONT_KEYS = SlideRender.FONT_KEYS;
const CE_FONT_VAR_MAP = SlideRender.FONT_VARS;
const CE_LH_KEYS = ['body','label','obj','think','thinkGuide'];
const CE_LH_VAR_MAP = {
  body: '--lh-body', label: '--lh-label', obj: '--lh-obj',
  think: '--lh-question', thinkGuide: '--lh-think-guide',
};
const CE_SD = {
  fonts: { title: 40, body: 60, label: 70, obj: 70, cover: 200, coverTagline: 40, coverMeta: 40, think: 80, thinkGuide: 50,
    coverScript: 680, coverNum: 100, diveQ: 80, diveGuide: 50, diveKicker: 40, badge: 30, qtSub: 40, qtText: 60, qtSrc: 40,
    chosung: 48, chosungNum: 110,
    colsTitle: 70, colsHead: 60, colsBody: 60 },
  lineHeights: { body: 1.6, label: 1.6, obj: 1.6, think: 1.6, thinkGuide: 1.6 },
  letterSpacing: -15, // -20~10 슬라이더 값, 100분의 1em 단위 (-15 = -0.15em)
  textWidth: 95,      // % (장평, scaleX = 값/100)
  fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif",
  navy: '#27384F', red: '#FF6B3D',
  bg: '#F0F0EF', slideBg: '#F0F0EF', rowBg: '#FFFFFF', text: '#1E293B',
  thinkGuideColor: '#6b675e',
  badgeColor: '#27384F'
};
// 2026에는 23강 기본 내용이 박혀 있었다. 2027은 강의를 새로 만들므로 비워 둔다.
const CE_LESSON_DEFAULTS = {};

let ceCs = {}, ceCd = {};
let ceCurrentLessonNum = '';

function switchSubTab(name) {
  document.querySelectorAll('.sub-tab').forEach(t => t.classList.toggle('active', t.dataset.sub === name));
  document.querySelectorAll('.sub-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('sub-' + name).classList.add('active');
  requestAnimationFrame(() => document.getElementById('sub-' + name).querySelectorAll('textarea').forEach(autoResizeTa));
}

// ── 미리보기 스케일 ──
function rescalePreview() {
  const outer = document.getElementById('design-pv-outer');
  const inner = document.getElementById('design-pv-inner');
  if (!outer || !inner) return;
  const scale = outer.clientWidth / 1920;
  inner.style.transform = `scale(${scale})`;
  outer.style.height = (1080 * scale) + 'px';
}
window.addEventListener('resize', rescalePreview);

// ── 디자인 탭 ──
// 폰트 크기와 색상은 강의별이 아니라 전체 공통 설정이라 settings/concept_note_design 문서 하나에 저장한다.
async function ceInitDesign() {
  const snap = await getDoc(DESIGN_REF());
  if (snap.exists()) {
    ceCs = ceDeepMerge(CE_SD, snap.data());
  } else {
    // 학생 페이지도 같은 값을 봐야 하므로 기본값을 바로 Firestore에도 기록해둔다.
    ceCs = ceDeepMerge(CE_SD, {});
    await setDoc(DESIGN_REF(), ceCs);
  }
  ceLoadDesignInputs();
  ceRenderPreview();
  ceApplyDesignPreview();
  requestAnimationFrame(rescalePreview);
}

/* 글꼴 크기 패널을 FONT_SPEC대로 그린다. 항목이 50개 가까이 되므로 섹션(표지/Dive/개념/
   미션/생각)마다 접었다 펴는 형태로 두고, 그 안에서 슬라이드 형식별로 묶는다.
   슬라이더 개수가 많아 HTML로 일일이 적어 두면 관리가 안 되므로 스펙에서 생성한다. */
let _fontPanelDrawn = false;
function ceRenderFontPanel() {
  const wrap = document.getElementById('fs-panel');
  if (!wrap || _fontPanelDrawn) return;
  const row = r => {
    const min = r.min != null ? r.min : 10;
    const max = r.max != null ? r.max : 200;
    return `<div class="fs-row">
      <span class="fs-name">${esc(r.label)}</span>
      <input type="range" class="fs-slider" id="fs-${r.key}" min="${min}" max="${max}" step="1" oninput="onFsSliderInput('${r.key}')">
      <input type="number" class="fs-val" id="fv-${r.key}" min="${min}" max="${max}" oninput="onFsNumberInput('${r.key}')">
    </div>`;
  };
  wrap.innerHTML = SlideRender.FONT_SPEC.map((sec, i) => `
    <details class="fs-sec"${i === 0 ? ' open' : ''}>
      <summary class="fs-sec-sum">${esc(sec.name)}</summary>
      <div class="fs-sec-body">
        ${sec.groups.map(g => `
          <div class="fs-group">
            ${sec.groups.length > 1 || g.name !== sec.name ? `<div class="fs-section">${esc(g.name)}</div>` : ''}
            ${g.rows.map(row).join('')}
          </div>`).join('')}
      </div>
    </details>`).join('');
  _fontPanelDrawn = true;
}

function ceLoadDesignInputs() {
  // 예전 설정(label/body/bodyMission 3개)만 있으면 형식별 값으로 펴 준다.
  // 이미 있는 값은 그대로 두므로 처음 열었을 때 화면이 지금과 똑같다.
  const f = SlideRender.normalizeFonts(ceCs.fonts);
  ceCs.fonts = f;
  ceRenderFontPanel();
  CE_FONT_KEYS.forEach(k => {
    const s = document.getElementById('fs-' + k), n = document.getElementById('fv-' + k);
    if (s) s.value = f[k];
    if (n) n.value = f[k];
  });
  const lh = ceCs.lineHeights || CE_SD.lineHeights;
  CE_LH_KEYS.forEach(k => {
    document.getElementById('lh-' + k).value = lh[k];
    document.getElementById('lv-' + k).value = lh[k];
  });
  const ls = ceCs.letterSpacing ?? CE_SD.letterSpacing;
  const tw = ceCs.textWidth ?? CE_SD.textWidth;
  document.getElementById('ls-global').value = ls; document.getElementById('lsv-global').value = ls;
  document.getElementById('tw-global').value = tw; document.getElementById('twv-global').value = tw;
  document.getElementById('c-navy').value    = ceCs.navy;
  document.getElementById('c-red').value     = ceCs.red;
  document.getElementById('c-bg').value      = ceCs.bg;
  document.getElementById('c-slidebg').value = ceCs.slideBg;
  document.getElementById('c-rowbg').value   = ceCs.rowBg;
  document.getElementById('c-text').value    = ceCs.text;
  document.getElementById('c-thinkGuide').value = ceCs.thinkGuideColor || CE_SD.thinkGuideColor;
  document.getElementById('c-badge').value      = ceCs.badgeColor      || CE_SD.badgeColor;
  document.getElementById('ff-family').value    = ceCs.fontFamily       || CE_SD.fontFamily;
}

function ceReadDesignInputs() {
  // 예전 키(label/body/bodyMission)는 이제 슬라이더가 없지만, 값은 그대로 들고 간다.
  // 스펙에 아직 안 올라온 규칙이 남아 있어도 예전처럼 동작하게 하는 안전판이다.
  const prev = ceCs.fonts || {};
  const fonts = { label: prev.label, body: prev.body, bodyMission: prev.bodyMission };
  CE_FONT_KEYS.forEach(k => {
    const el = document.getElementById('fs-' + k);
    if (el) fonts[k] = +el.value;
    else if (prev[k] != null) fonts[k] = prev[k];
  });
  const lineHeights = {};
  CE_LH_KEYS.forEach(k => { lineHeights[k] = +document.getElementById('lh-' + k).value; });
  ceCs = {
    fonts,
    lineHeights,
    letterSpacing: +document.getElementById('ls-global').value,
    textWidth:     +document.getElementById('tw-global').value,
    fontFamily:    document.getElementById('ff-family').value,
    navy:    document.getElementById('c-navy').value,
    red:     document.getElementById('c-red').value,
    bg:      document.getElementById('c-bg').value,
    slideBg: document.getElementById('c-slidebg').value,
    rowBg:   document.getElementById('c-rowbg').value,
    text:    document.getElementById('c-text').value,
    thinkGuideColor: document.getElementById('c-thinkGuide').value,
    badgeColor: document.getElementById('c-badge').value,
  };
}

function onFsSliderInput(k) {
  document.getElementById('fv-' + k).value = document.getElementById('fs-' + k).value;
  ceReadDesignInputs();
  ceApplyDesignPreview();
}
function onFsNumberInput(k) {
  const v = document.getElementById('fv-' + k).value;
  if (v === '') return;
  document.getElementById('fs-' + k).value = v;
  ceReadDesignInputs();
  ceApplyDesignPreview();
}
function onLhSliderInput(k) {
  document.getElementById('lv-' + k).value = document.getElementById('lh-' + k).value;
  ceReadDesignInputs();
  ceApplyDesignPreview();
}
function onLhNumberInput(k) {
  const v = document.getElementById('lv-' + k).value;
  if (v === '') return;
  document.getElementById('lh-' + k).value = v;
  ceReadDesignInputs();
  ceApplyDesignPreview();
}
function onLsSliderInput() {
  document.getElementById('lsv-global').value = document.getElementById('ls-global').value;
  ceReadDesignInputs();
  ceApplyDesignPreview();
}
function onLsNumberInput() {
  const v = document.getElementById('lsv-global').value;
  if (v === '') return;
  document.getElementById('ls-global').value = v;
  ceReadDesignInputs();
  ceApplyDesignPreview();
}
function onTwSliderInput() {
  document.getElementById('twv-global').value = document.getElementById('tw-global').value;
  ceReadDesignInputs();
  ceApplyDesignPreview();
}
function onTwNumberInput() {
  const v = document.getElementById('twv-global').value;
  if (v === '') return;
  document.getElementById('tw-global').value = v;
  ceReadDesignInputs();
  ceApplyDesignPreview();
}
function onColorChange() { ceReadDesignInputs(); ceApplyDesignPreview(); }

function ceApplyDesignPreview() {
  ceSetSlideVars(document.getElementById('design-pv-solo'), ceCs);
}

// slide-style.css가 실제로 쓰는 변수 이름(--navy, --fs-slide-title 등)에 그대로 값을 설정한다.
// 미리보기 컨테이너에만 스코프해서 설정하므로 이 페이지의 다른 --navy/--text 등에는 영향이 없다.
let ceFontsReady = false; // 슬라이드 폰트를 한 번 받아 뒀는지(미리보기 쪽 나눔 정확도용)

function ceSetSlideVars(el, cfg) {
  const c = cfg || ceCs;
  const f = c.fonts || CE_SD.fonts;
  el.style.setProperty('--navy',     c.navy    || CE_SD.navy);
  el.style.setProperty('--red',      c.red     || CE_SD.red);
  el.style.setProperty('--bg',       c.bg      || CE_SD.bg);
  el.style.setProperty('--slide-bg', c.slideBg || CE_SD.slideBg);
  el.style.setProperty('--row-bg',   c.rowBg   || CE_SD.rowBg);
  el.style.setProperty('--text',     c.text    || CE_SD.text);
  // 재디자인 색 역할 매핑: 라벨/구조=navy, 강조=red, 본문 글자=text
  el.style.setProperty('--label',    c.navy    || CE_SD.navy);
  el.style.setProperty('--accent',   c.red     || CE_SD.red);
  el.style.setProperty('--ink',      c.text    || CE_SD.text);
  el.style.setProperty('--border',   '#e2ddd2');
  el.style.setProperty('--think-guide-color', c.thinkGuideColor || CE_SD.thinkGuideColor);
  el.style.setProperty('--badge-color',       c.badgeColor      || CE_SD.badgeColor);
  el.style.setProperty('--font',              c.fontFamily      || CE_SD.fontFamily);
  // 글꼴 크기 변수는 slide-render.js가 스펙대로 한 번에 걸어 준다(수업 화면과 같은 코드).
  const nf = SlideRender.applyFontVars(el, f);
  // 미션 본문 전용 변수. 저장값 없으면 개념 본문값을 따른다.
  el.style.setProperty('--fs-body-mission', ((nf.bodyMission != null ? nf.bodyMission : nf.body) || CE_SD.fonts.body) + 'px');
  // 초성 퀴즈 쪽 나눔은 화면 밖 임시 DOM(document.body 밑)에서 줄 수를 재기 때문에,
  // 이 두 값만은 문서 루트에도 같이 걸어 줘야 미리보기와 학생 화면의 쪽 나눔이 일치한다.
  // 이름이 --fs-chosung* 으로 고유해서 어드민 자체 CSS 토큰과 부딪히지 않는다.
  document.documentElement.style.setProperty('--fs-chosung',     (nf.chosung    || CE_SD.fonts.chosung)    + 'px');
  document.documentElement.style.setProperty('--fs-chosung-num', (nf.chosungNum || CE_SD.fonts.chosungNum) + 'px');
  const lh = c.lineHeights || CE_SD.lineHeights;
  CE_LH_KEYS.forEach(k => {
    el.style.setProperty(CE_LH_VAR_MAP[k], lh[k] || CE_SD.lineHeights[k]);
  });
  el.style.setProperty('--ls-global', (c.letterSpacing ?? CE_SD.letterSpacing) / 100 + 'em');
  el.style.setProperty('--tw-global', (c.textWidth ?? CE_SD.textWidth) / 100);
}

async function saveDesign() {
  ceReadDesignInputs();
  await setDoc(DESIGN_REF(), ceCs);
  ceShowToast('toast-design');
}
async function resetDesign() {
  ceCs = ceDeepMerge(CE_SD, {});
  ceCs.fonts = SlideRender.normalizeFonts(ceCs.fonts); // 형식별 값까지 채워서 저장
  await setDoc(DESIGN_REF(), ceCs);
  ceLoadDesignInputs();
  ceApplyDesignPreview();
}

// ── 강의 목록 (Firestore) ──
let ceLessonsCache = [];

async function ceGetLessonsFromFirestore() {
  // 강의 라이브러리 페이지에서 만든 강의는 order가 없을 수 있어 orderBy 쿼리 대신 전부 받아 정렬한다
  // (orderBy는 그 칸이 없는 문서를 빼 버린다). 강 번호 칸 이름(lessonNo)을 2026처럼 num으로 맞춰 둔다.
  const snap = await getDocs(collection(db, LIB));
  ceLessonsCache = snap.docs.map(d => {
    const v = d.data();
    const num = String(v.lessonNo ?? v.num ?? '');
    return { docId: d.id, ...v, num, order: v.order ?? lecOrderKey(num) };
  }).sort((a, b) => a.order - b.order);
  return ceLessonsCache;
}

// ── 강의 선택 드롭다운 공통 정렬 ──
// 개념·성적(class_lessons)·생각(think_lectures) 세 체크의 강의 선택 드롭다운은 모두
// 이 비교 함수 하나만 쓴다: order 필드 내림차순(최신 강의가 위, OT/인트로처럼 order 낮은 건 맨 아래).
// (예전엔 화면마다 asc+reverse / desc / num 파싱 등 기준이 제각각이라 OT(num="OT")가 튀어 올라왔다.)
function lecSortByOrderDesc(a, b) { return (b.order ?? -1) - (a.order ?? -1); }

function cePopulateLessonSelect() {
  const sel = document.getElementById('lesson-select');
  const cur = sel.value || ceCurrentLessonNum; // 선택 유지 (새 강의 추가/갱신 시)
  sel.innerHTML = '<option value="">— 강의 선택 —</option>' +
    [...ceLessonsCache].sort(lecSortByOrderDesc).map(l => `<option value="${esc(l.num)}" ${cur && l.num===cur?'selected':''}>${lecLabel(esc(l.num), esc(String(l.title||'').replace(/\*\*/g,'').replace(/[{}]/g,'')))}</option>`).join('');
}

// 개념 체크 강의 순서 목록(미션 체크 카드처럼 ▲▼로 순서 변경). 드롭다운과 같은 기준으로 정렬한다.
function ceLessonOrderList() { return [...ceLessonsCache].sort(lecSortByOrderDesc); }

function renderCeLessonOrder() {
  const box = document.getElementById('ce-lesson-order');
  if (!box) return;
  const list = ceLessonOrderList();
  if (!list.length) {
    box.innerHTML = '<div class="empty-panel" style="padding:14px;font-size:13px">강의가 없습니다.</div>';
    return;
  }
  box.innerHTML = list.map((l, idx) => {
    const clean = String(l.title || '').replace(/\*\*/g, '').replace(/[{}]/g, '');
    return `<div class="item-row">
        <div class="item-info"><div class="item-label">${lecLabel(esc(String(l.num)), esc(clean))}</div></div>
        <div class="item-meta">
          <button class="edit-btn" ${idx===0?'disabled':''} title="위로" onclick="ceMoveLesson('${l.docId}','up',${idx})">▲</button>
          <button class="edit-btn" ${idx===list.length-1?'disabled':''} title="아래로" onclick="ceMoveLesson('${l.docId}','down',${idx})">▼</button>
        </div>
      </div>`;
  }).join('');
}

window.ceOpenOrderModal = function() {
  renderCeLessonOrder();
  document.getElementById('ceOrderBackdrop')?.classList.add('open');
};
window.ceCloseOrderModal = function() {
  document.getElementById('ceOrderBackdrop')?.classList.remove('open');
};

window.ceMoveLesson = async function(docId, dir, idx) {
  const list = ceLessonOrderList(); // 화면과 동일한 내림차순 목록 기준
  const targetIdx = dir === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= list.length) return;
  const cur = list[idx], target = list[targetIdx];
  try {
    const batch = writeBatch(db);
    // 인접한 두 강의의 order 값을 맞바꾼다(표시 방향과 무관하게 안전).
    const curOrder    = cur.order    ?? ceLessonsCache.indexOf(cur);
    const targetOrder = target.order ?? ceLessonsCache.indexOf(target);
    batch.update(doc(db, LIB, cur.docId),    { order: targetOrder });
    batch.update(doc(db, LIB, target.docId), { order: curOrder });
    await batch.commit();
    await ceGetLessonsFromFirestore();
    cePopulateLessonSelect();
    renderCeLessonOrder();
  } catch(e) { notify('순서를 바꾸지 못했습니다. ' + e.message); }
};

// 강의 선택 줄의 ▲▼ — 현재 선택된 강의를 순서 목록에서 위/아래로 옮긴다(순서 모달 대체).
window.ceMoveCurrentLesson = function(dir) {
  const num = document.getElementById('lesson-select')?.value;
  if (!num) { notify('강의를 먼저 골라 주세요.'); return; }
  const list = ceLessonOrderList();
  const idx = list.findIndex(l => String(l.num) === String(num));
  if (idx < 0) return;
  window.ceMoveLesson(list[idx].docId, dir, idx);
};

window.ceLessonPreview = function() {
  // preview=1 을 붙여 비공개(편집 중) 강의도 미리보기로 열 수 있게 한다.
  const l = ceLessonsCache.find(x => x.num === ceCurrentLessonNum);
  if (l) window.open('lecture.html?id=' + l.docId + '&mode=complete&preview=1', '_blank', 'noopener');
};

function onLessonChange(num) {
  const area = document.getElementById('ce-editor-area');
  const prevBtn = document.getElementById('ce-preview-btn');
  // 업로드 상태 줄은 방금 만든 그 강의에 대한 말이다. 다른 강의로 옮기면 지운다
  // (줄 바깥에 선 뒤로는 자리를 차지하는 띠라, 남아 있으면 계속 눈에 밟힌다).
  const statusEl = document.getElementById('ce-file-status');
  if (statusEl) statusEl.textContent = '';
  if (!num) {
    if (area) area.style.display = 'none';
    return; // 미리보기 버튼은 항시 표시(강의 미선택 시 클릭해도 무시됨)
  }
  ceCurrentLessonNum = num;
  ceLoadLessonData(num);
  if (area) area.style.display = '';
  if (prevBtn) prevBtn.style.display = '';
}

async function addLesson() {
  // 2026은 prompt를 네 번 띄웠다(강 번호, 제목, 단원, 연도). 2027은 창 하나로 받고, 연도는 받지 않는다
  // (강의 라이브러리는 연도와 무관하게 남는다).
  const v = await ask({
    title: '강의 추가',
    fields: [
      { key: 'num',   type: 'text', placeholder: '강 번호 (예: 24, OT)', suffix: '강' },
      { key: 'title', type: 'text', placeholder: '수업 제목' },
      { key: 'unit',  type: 'text', placeholder: '학습 단원 (예: Ⅲ-4. 고려의 생활과 문화)' },
    ],
    check: v => !v.num ? '강 번호를 입력해 주세요.'
      : ceLessonsCache.find(l => l.num === v.num) ? `${lecTag(v.num)}는 이미 있습니다.` : '',
  });
  if (!v) return;
  const num = v.num, title = v.title || '새 강의', unit = v.unit || '';
  const content = ceBlankLessonData(num);
  content.lesson.title = title; content.lesson.unit = unit;
  await addDoc(collection(db, LIB), {
    lessonNo: num, title, unit, order: lecOrderKey(num), isOpen: false, content, createdAt: serverTimestamp()
  });
  await ceGetLessonsFromFirestore();
  ceCurrentLessonNum = num;
  cePopulateLessonSelect();
  renderCeLessonOrder();
  ceLoadLessonData(num);
  const area = document.getElementById('ce-editor-area');
  if (area) area.style.display = '';
  const prevBtn = document.getElementById('ce-preview-btn');
  if (prevBtn) prevBtn.style.display = '';
  notify(`${lecTag(num)}을 추가했습니다.`, 'ok');
}

async function deleteLesson() {
  const lesson = ceLessonsCache.find(l => l.num === ceCurrentLessonNum);
  if (!lesson) return;
  // 2026 문구는 "슬라이드 내용은 삭제되지 않습니다"였지만 내용이 강의 문서 안에 있어 함께 지워진다.
  if (!await confirmAsk(`${lecTag(ceCurrentLessonNum)} 삭제`, '슬라이드 내용까지 함께 지워지고 되돌릴 수 없습니다.', true)) return;
  await deleteDoc(doc(db, LIB, lesson.docId));
  await ceGetLessonsFromFirestore();
  ceCurrentLessonNum = '';
  cePopulateLessonSelect();
  renderCeLessonOrder();
  const area = document.getElementById('ce-editor-area');
  if (area) area.style.display = 'none';
}

// ── 강의 내용 탭 ──
function ceBlankLessonData(num) {
  return {
    lesson: { num, title: '새 강의', unit: '', page: '', objectives: ['학습 목표를 입력하세요'] },
    dive: { headerTitle: '', title: '', guide: '', img: null, imgCaption: '', imgLayout: 'right', guideBox: true, openingEnabled: true, chosungEnabled: false, chosungItems: [] },
    contentLines: [],
    mission: { contentLines: [] },
    think: { question: '', guide: '' }
  };
}

// dive(Dive into HISTORY)·미션 체크는 나중에 추가된 필드라 그 전에 저장된 강의는 없을 수
// 있다. 없으면 빈 값으로 채워서(기존 데이터를 지우지 않고) 렌더링이 깨지지 않게 한다.
// 구버전에서 쓰던 opening{question,guide} 필드가 남아있으면 dive{title,guide}로 옮긴다.
function ceEnsureNewFields(cd) {
  if (!cd.dive) {
    cd.dive = cd.opening
      ? { title: cd.opening.question || '', guide: cd.opening.guide || '', chosungEnabled: false, chosungItems: [] }
      : { title: '', guide: '', chosungEnabled: false, chosungItems: [] };
  }
  if (cd.dive.headerTitle === undefined) cd.dive.headerTitle = '';
  if (cd.dive.img === undefined) cd.dive.img = null;
  if (cd.dive.imgCaption === undefined) cd.dive.imgCaption = '';
  if (cd.dive.imgLayout === undefined) cd.dive.imgLayout = 'right';
  if (cd.dive.guideBox === undefined) cd.dive.guideBox = true;
  if (cd.dive.chosungEnabled === undefined) cd.dive.chosungEnabled = false;
  if (cd.dive.openingEnabled === undefined) cd.dive.openingEnabled = true;
  if (!Array.isArray(cd.dive.chosungItems)) cd.dive.chosungItems = [];
  delete cd.opening;
  if (!cd.mission || !Array.isArray(cd.mission.contentLines)) cd.mission = { contentLines: [] };
  ceNormalizeContentLines(cd.contentLines);
  ceNormalizeContentLines(cd.mission.contentLines);
}

// row는 반드시 앞선 divider(=페이지)에 딸려야 한다는 것이 편집기의 전제다. 그런데 페이지
// 사이에 이미지·전면 이미지·영상이 끼어들면 그 뒤 row들이 divider를 잃어버리는 경우가 생긴다.
// 이렇게 붕 뜬 row를 편집기(ceBuildGroups)는 통째로 버려서 화면에서 사라지지만, 슬라이드
// 렌더러(SlideRender.buildCheckSlides)는 제목 없는 슬라이드로 그려 준다 — 편집기에서는
// 안 보이는데 실제 슬라이드에는 나오는 상태다. 로드 시점에 제목 없는 divider를 끼워 넣어
// 두 쪽 해석을 일치시킨다. (title:''은 렌더러가 만드는 슬라이드와 같은 값)
function ceNormalizeContentLines(lines) {
  if (!Array.isArray(lines)) return lines;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i] || lines[i].type !== 'row') continue;
    const prev = lines[i - 1];
    if (prev && (prev.type === 'divider' || prev.type === 'row')) continue;
    lines.splice(i, 0, { type: 'divider', title: '' });
  }
  return lines;
}

// Firestore에 저장된 content가 지금 코드가 기대하는 구조(lesson/contentLines/think)와
// 맞는지 검사한다. 구조가 안 맞으면 렌더링이 통째로 깨지므로 그런 경우 기본값으로 대체한다.
function ceIsValidContentData(d) {
  return !!d
    && d.lesson && typeof d.lesson === 'object' && Array.isArray(d.lesson.objectives)
    && Array.isArray(d.contentLines)
    && d.think && typeof d.think === 'object';
}

async function ceInitContent() {
  await ceGetLessonsFromFirestore();
  cePopulateLessonSelect();
  renderCeLessonOrder();
  // 강의를 선택해야 편집 영역이 나타나도록 초기에는 숨겨둔다.
}

function ceLoadLessonData(num) {
  const lesson = ceLessonsCache.find(l => l.num === num);

  if (ceIsValidContentData(lesson?.content)) {
    ceCd = lesson.content;
    ceEnsureNewFields(ceCd);
  } else {
    const def = CE_LESSON_DEFAULTS[num];
    ceCd = def ? ceDeepCopy(def) : ceBlankLessonData(num);
    ceEnsureNewFields(ceCd);
    // Firestore에 저장된 content가 없거나 깨져 있었던 것이므로, 방금 만든 기본값을
    // 바로 Firestore에도 반영해서 실제 학생 페이지도 같은 내용을 보게 한다.
    if (lesson) ceSaveContentToFirestore(lesson.docId, ceCd);
  }

  ceRenderCoverForm();
  ceRenderOpenToggle();
  ceRenderDiveForm();
  ceRenderObjectivesForm();
  ceRenderContentLines('concept');
  ceRenderContentLines('mission');
  ceRenderThinkForm();
  ceRenderPreview();
}

// ── 표지 폼 (수업 정보) — 학습 목표는 Dive 메뉴로 이동 ──
function ceRenderCoverForm() {
  const l = ceCd.lesson;
  const el = document.getElementById('cover-form');
  el.innerHTML = `
    ${ceFInputInline('강 번호', l.num, `updateLesson('num',this.value)`)}
    ${ceFInputInline('수업 제목', l.title, `updateLesson('title',this.value)`)}
    ${ceFInputInline('학습 단원', l.unit, `updateLesson('unit',this.value)`)}
    ${ceFInputInline('교과서 페이지', l.page, `updateLesson('page',this.value)`)}`;
}

// ── 학습 목표 폼 (Dive 메뉴 안, 항상 표시되는 슬라이드) ──
function ceRenderObjectivesForm() {
  const l = ceCd.lesson;
  const el = document.getElementById('objectives-form');
  if (!el) return;
  el.innerHTML = `<textarea class="field-input" rows="4" placeholder="한 줄 = 목표 하나" oninput="updateObjectives(this.value);autoResizeTa(this)">${esc(l.objectives.join('\n'))}</textarea>`;
}

function updateLesson(f,v){ ceCd.lesson[f]=v; ceRenderPreview(); }
function updateObjectives(v){ ceCd.lesson.objectives = v.split('\n').filter(s=>s.trim()!==''); ceRenderPreview(); }

// ── 학생 공개/비공개 토글 ──
// isOpen 필드가 아예 없는 예전 강의(이 기능 추가 전에 만든 강의)는 이미 학생들이
// 보고 있었을 수 있으므로 공개 상태로 취급한다. 새로 만드는 강의만 명시적으로
// isOpen:false로 시작해 기본이 비공개가 되도록 한다.
function ceRenderOpenToggle() {
  const lesson = ceLessonsCache.find(l => l.num === ceCurrentLessonNum);
  const isOpen = lesson?.isOpen === true;   // 2027은 isOpen이 true일 때만 공개(새 강의와 라이브러리 강의는 비공개로 시작)
  const tog = document.getElementById('ce-open-toggle');
  if (!tog) return;
  tog.classList.toggle('on', isOpen);
  tog.title = isOpen ? '공개 중 (클릭하면 비공개)' : '비공개 (클릭하면 공개)';
  // 생각 Check의 강의 선택 줄과 같은 자리에 같은 문구를 띄운다.
  const lbl = document.getElementById('ce-open-toglbl');
  if (lbl) {
    lbl.textContent = lesson ? (isOpen ? '공개 중' : '비공개') : '';
    lbl.style.color = isOpen ? 'var(--primary)' : 'var(--sub)';
  }
}
async function ceToggleLessonOpen() {
  const lesson = ceLessonsCache.find(l => l.num === ceCurrentLessonNum);
  if (!lesson) return;
  const next = lesson.isOpen !== true;
  await updateDoc(doc(db, LIB, lesson.docId), { isOpen: next });
  lesson.isOpen = next;
  ceRenderOpenToggle();
}

// ── 개념/미션 Check 콘텐츠 (구분선 + 행, 드래그로 순서 변경) ──
// 개념 체크와 미션 체크는 완전히 같은 방식(구분선/행/이미지)으로 편집하므로, 어느 쪽을
// 편집 중인지를 target('concept'|'mission')으로 받아서 같은 함수를 재사용한다.
function ceLinesFor(target) {
  return target === 'mission' ? ceCd.mission.contentLines : ceCd.contentLines;
}
function ceContainerIdFor(target) {
  return target === 'mission' ? 'mission-content-lines' : 'content-lines';
}

// 드래그 핸들이 잘 안 잡힐 때를 위한 대체 수단 (위/아래로 한 칸씩 이동)
function ceMoveButtons(target, i) {
  const last = ceLinesFor(target).length - 1;
  return `
    <span class="cl-move">
      <button class="cl-move-btn" onclick="moveLine('${target}',${i},-1)" ${i === 0 ? 'disabled' : ''} title="위로 이동">↑</button>
      <button class="cl-move-btn" onclick="moveLine('${target}',${i},1)" ${i === last ? 'disabled' : ''} title="아래로 이동">↓</button>
    </span>`;
}
function moveLine(target, i, dir) {
  const lines = ceLinesFor(target);
  const j = i + dir;
  if (j < 0 || j >= lines.length) return;
  const [item] = lines.splice(i, 1);
  lines.splice(j, 0, item);
  ceRenderContentLines(target);
  ceRenderPreview();
}

// ── 슬라이드 형식(연표/비교표/사료 인용/플로우) 선택 및 형식별 데이터 편집 ──
// 기본값은 'rows'(지금까지의 행 나열)라서, 기존 강의는 아무 필드도 없어도 그대로 동작한다.
const CE_FORMAT_LABELS = {
  rows: '행 나열', 'timeline-h': '연표(가로)', 'timeline-v': '연표(세로)',
  compare: '비교표', quote: '사료 인용', 'flow-h': '플로우(가로)', 'flow-v': '플로우(세로)',
  notice: '안내(OT/수행)', cols: '중앙 나열'
};
const CE_FORMATS = ['rows','timeline-h','timeline-v','compare','quote','flow-h','flow-v','notice','cols'];

function ceFormatChips(target, i, current) {
  return CE_FORMATS.map(f => `<button type="button" class="cl-fmt-chip${current===f?' active':''}" onclick="setLineFormat('${target}',${i},'${f}')">${CE_FORMAT_LABELS[f]}</button>`).join('');
}

function setLineFormat(target, i, fmt) {
  const line = ceLinesFor(target)[i];
  if (fmt === 'rows') { delete line.format; }
  else { line.format = fmt; }
  if ((fmt === 'timeline-h' || fmt === 'timeline-v') && !line.events) {
    line.events = fmt === 'timeline-h' ? [{ year: '', label: '' }] : [{ memo: '', content: [''] }];
  }
  if (fmt === 'compare') {
    if (!line.left)  line.left  = { label: '', items: [''] };
    if (!line.right) line.right = { label: '', items: [''] };
  }
  if (fmt === 'quote') {
    if (line.quoteText == null)   line.quoteText = '';
    if (line.quoteSource == null) line.quoteSource = '';
    if (line.quoteLabel == null)  line.quoteLabel = '';
  }
  if ((fmt === 'flow-h' || fmt === 'flow-v') && !line.stages) {
    line.stages = [{ label: '', text: '' }];
  }
  if (fmt === 'notice' && line.noticeText == null) line.noticeText = '';
  if (fmt === 'cols' && !line.cols) line.cols = [{ head:'', body:'' }, { head:'', body:'' }, { head:'', body:'' }];
  ceRenderContentLines(target);
  ceToggleFmt(target, i);
  ceRenderPreview();
}

function toggleLabelPos(target, i, isChecked) {
  const line = ceLinesFor(target)[i];
  // 기본은 상단. 체크하면 좌측 배치로 되돌린다.
  if (isChecked) line.labelPos = 'left';
  else delete line.labelPos;
  const lines = ceLinesFor(target);
  const nth = lines.slice(0, i).filter(l => l.type === 'divider').length;
  const type = target === 'mission' ? 'mission' : 'concept';
  ceRenderPreview(slides => {
    const typed = slides.filter(s => s.type === type);
    return typed[nth] || slides.find(s => s.type === 'concept') || slides[0];
  });
}

// 페이지(슬라이드)별 본문 글자 크기 절대값(px). 비우면 필드를 지워 디자인 기본값을 따른다.
// 페이지별 개념/미션 배지 숨김(A 기능) — 켜면 형식(rows 등) 상관없이 배지 없이 제목만 표시.
function toggleHideBadge(target, i, checked) {
  const line = ceLinesFor(target)[i];
  if (checked) line.hideBadge = true;
  else delete line.hideBadge;
  ceRenderPreview();
}

/* 페이지별 본문 정렬. 기본은 왼쪽 정렬이고, 켠 페이지만 mode대로 바꾼다.
   mode는 'justify'(행 나열·안내문 — 오른쪽 끝을 맞춤)와 'center'(비교표 — 가운데) 둘.
   예전에는 미션 Check 슬라이드 전체가 CSS로 양쪽 정렬이라 끌 방법이 없었다. */
function toggleAlign(target, i, mode, checked) {
  const line = ceLinesFor(target)[i];
  if (checked) line.align = mode;
  else delete line.align;
  ceRenderPreview();
}

/* 세로 연표 "강조 사건" 선택칸 (페이지 설정 줄).
   고른 사건 하나만 제 색으로 두고 나머지는 연해진다. 사건마다 슬라이드를 따로 만들어
   번호만 바꿔 가며 넘기는 쓰임새라, 켜고 끄는 체크박스가 아니라 번호를 고르는 선택칸이다.
   사건을 지워 저장된 번호가 범위를 넘으면 마지막 사건으로 당겨서 보여 준다 — 렌더러도
   같은 규칙으로 당기므로(timelineVBodyHTML), 이렇게 해야 선택칸과 화면이 어긋나지 않는다. */
function ceFocusEventSelect(target, divIdx, div) {
  const events = div.events || [];
  const cur = div.focusEvent ? Math.min(div.focusEvent, events.length) : 0;
  const opts = ['<option value="0"' + (cur ? '' : ' selected') + '>없음</option>']
    .concat(events.map((_, k) => `<option value="${k + 1}"${cur === k + 1 ? ' selected' : ''}>${k + 1}번째</option>`))
    .join('');
  return `<label class="cl-opt">강조 사건
    <select class="cl-img-select" onclick="event.stopPropagation()"
            onchange="setFocusEvent('${target}',${divIdx},this.value)">${opts}</select></label>`;
}

function setFocusEvent(target, i, v) {
  const line = ceLinesFor(target)[i];
  const n = parseInt(v, 10);
  if (!n) delete line.focusEvent;   // 0/빈값 = 강조 없음 → 필드 자체를 지워 예전 연표와 같게 둔다
  else line.focusEvent = n;
  ceRenderPreview();
}

function setLineFontSize(target, i, v) {
  const line = ceLinesFor(target)[i];
  const n = parseInt(v, 10);
  if (v === '' || isNaN(n)) delete line.fontSize;
  else line.fontSize = n;
  ceRenderPreview();
}

// 중앙 나열 페이지의 대제목만 따로 키우거나 줄인다. 비우면 디자인 탭 기본값을 따른다.
function setColsTitleSize(target, i, v) {
  const line = ceLinesFor(target)[i];
  const n = parseInt(v, 10);
  if (v === '' || isNaN(n)) delete line.colsTitleSize;
  else line.colsTitleSize = n;
  ceRenderPreview();
}

function autoResizeTa(ta) {
  ta.style.height = '1px';
  ta.style.height = ta.scrollHeight + 'px';
}

/* 콘텐츠 textarea 입력 보조: Tab → " : "(소제목 구분). Shift+Enter는 일반 Enter와 동일하게
   처리(줄바꿈)하며, a./b./c. 로 시작하는 줄은 updateLineItems가 저장 시 자동으로 <br>로 합친다. */
function handleContentKeydown(e) {
  if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    const ta = e.target;
    ta.setRangeText(' : ', ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
/* 행 항목(.cl-items) 전용: Tab → " : ", Shift+Enter → 같은 항목 안 줄바꿈.
   Shift+Enter는 실제 개행(\n) + 보이지 않는 ZWSP(U+200B, 이어붙임 표시)를 넣어
   편집기에선 줄바꿈처럼 보이고, updateLineItems가 그 줄을 직전 항목에 U+2028로 합친다. */
function handleItemsKeydown(e) {
  if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    const ta = e.target;
    ta.setRangeText(' : ', ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    const ta = e.target;
    ta.setRangeText('\n' + String.fromCharCode(0x200B), ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function ceFormatPanelBody(target, i, line) {
  const fmt = line.format || 'rows';
  if (fmt === 'timeline-h' || fmt === 'timeline-v') return ceTimelineEditor(target, i, line);
  if (fmt === 'compare') return ceCompareEditor(target, i, line);
  if (fmt === 'quote') return ceQuoteEditor(target, i, line);
  if (fmt === 'flow-h' || fmt === 'flow-v') return ceFlowEditor(target, i, line);
  if (fmt === 'notice') return ceNoticeEditor(target, i, line);
  if (fmt === 'cols') return ceColsEditor(target, i, line);
  // 행 나열(rows)의 옵션(라벨 좌측·배지 숨김·글자 크기)과 하단 사료는 페이지 설정 패널에서 직접 렌더한다.
  return '';
}

// 중앙 나열(cols) 편집기 — 대제목은 슬라이드 제목칸, 항목마다 소제목+내용.
function ceColsEditor(target, i, line) {
  const cols = line.cols || [];
  const rows = cols.map((c, j) => `
    <div class="cl-fmt-row">
      <input type="text" class="cl-fmt-sm" style="width:150px" placeholder="소제목" value="${esc(c.head||'')}" oninput="updateColField('${target}',${i},${j},'head',this.value)">
      <input type="text" class="cl-fmt-grow" placeholder="내용 (선택), {단어}는 빈칸" value="${esc(c.body||'')}" oninput="updateColField('${target}',${i},${j},'body',this.value)">
      <button class="cl-fmt-del" onclick="removeCol('${target}',${i},${j})">삭제</button>
    </div>`).join('');
  return `<div class="cl-fmt-fields">
      <div class="cl-fmt-hint">상단 배지 헤더는 위 슬라이드 제목칸 / 아래 대제목은 본문 가운데 큰 제목(선택) / 항목은 가로로 균등 배치 / **글자**로 감싸면 강조색</div>
      <input type="text" class="cl-fmt-sm" style="width:100%" placeholder="대제목 (본문 가운데 큰 제목, 선택)" value="${esc(line.colsTitle||'')}" oninput="updateLine('${target}',${i},'colsTitle',this.value)">
      ${rows}
      <div class="cl-fmt-row">
        <button type="button" class="cbtn-sm" onclick="addCol('${target}',${i})">+ 항목 추가</button>
        ${ceColsMergeUpBtn(target, i)}
      </div>
    </div>`;
}

/* 중앙 나열 페이지를 바로 위 행 나열 페이지의 "중앙 나열 블록"으로 옮겨 한 페이지로 합친다.
   (행 나열 페이지를 만들고 블록에 다시 타이핑하지 않아도 되도록 둔 단추.)
   위 페이지가 행 나열이 아니면 단추를 아예 내보내지 않는다 — 블록은 행 나열에만 붙는다. */
function cePrevDividerIdx(lines, i) {
  for (let k = i - 1; k >= 0; k--) if (lines[k].type === 'divider') return k;
  return -1;
}
function ceColsMergeUpBtn(target, i) {
  const lines = ceLinesFor(target);
  const pd = cePrevDividerIdx(lines, i);
  const prev = pd > -1 ? lines[pd] : null;
  if (!prev || (prev.format && prev.format !== 'rows')) return '';
  if ((prev.bottomCols || []).length || (prev.bottomColsTitle || '').trim()) return '';  // 이미 블록이 있으면 덮어쓰지 않는다
  return `<button type="button" class="cbtn-sm" onclick="mergeColsIntoPrevPage('${target}',${i})">↑ 위 행 나열 페이지에 합치기</button>`;
}
async function mergeColsIntoPrevPage(target, i) {
  const lines = ceLinesFor(target);
  const pd = cePrevDividerIdx(lines, i);
  if (pd < 0) return;
  const prev = lines[pd], cur = lines[i];
  /* 이 페이지 블록의 끝(다음 divider 전까지). 중앙 나열로 바꾸기 전에 행이 남아 있었다면
     그 행들은 화면에 안 나오던 것이고, 페이지를 없애면서 같이 사라지므로 미리 알린다. */
  let end = i + 1;
  while (end < lines.length && lines[end].type !== 'divider') end++;
  const strayRows = end - i - 1;
  const msg = strayRows
    ? `이 중앙 나열을 위 페이지 아래에 붙이고 이 페이지를 없앱니다.
이 페이지에 안 쓰이고 남아 있던 행 ${strayRows}개도 함께 지워집니다.`
    : '이 중앙 나열을 위 페이지 아래에 붙이고 이 페이지를 없앱니다.';
  if (!await confirmAsk('위 페이지에 합치기', msg)) return;
  prev.bottomCols = (cur.cols || []).map(c => ({ head: c.head || '', body: c.body || '' }));
  prev.bottomColsTitle = cur.colsTitle || '';
  // 중앙 나열 페이지에서 쓰던 글자 크기를 블록 전용 필드로 옮겨, 합쳐도 크기가 그대로다.
  if (cur.fontSize != null) prev.bottomColsSize = cur.fontSize;
  if (cur.colsTitleSize != null) prev.bottomColsTitleSize = cur.colsTitleSize;
  lines.splice(i, end - i);
  ceRenderContentLines(target);
  ceRenderPreview();
}
function updateColField(target,i,j,f,v){ ceLinesFor(target)[i].cols[j][f]=v; ceRenderPreview(); }
function addCol(target,i){ ceLinesFor(target)[i].cols.push({head:'',body:''}); ceRenderContentLines(target); ceRenderPreview(); }
function removeCol(target,i,j){ ceLinesFor(target)[i].cols.splice(j,1); ceRenderContentLines(target); ceRenderPreview(); }

// 안내(OT·수행평가) 자유 문단 편집기 — 한 줄 = 한 문단, "- "로 시작하면 불릿, 빈 줄은 간격.
function ceNoticeEditor(target, i, line) {
  return `
    <div class="cl-fmt-fields">
      <div class="cl-fmt-hint">한 줄 = 한 문단 / 줄 앞에 "- "를 붙이면 불릿 / 빈 줄은 간격 / **굵게**/{빈칸} 문법 사용 가능</div>
      <textarea class="cl-fmt-grow" placeholder="예)&#10;- 수행평가 안내&#10;- 제출 기한: 다음 주 금요일&#10;&#10;**모둠별**로 발표 자료를 준비하세요." oninput="updateLine('${target}',${i},'noticeText',this.value);autoResizeTa(this)" onkeydown="handleContentKeydown(event)">${esc(line.noticeText||'')}</textarea>
    </div>`;
}

// 행 나열 하단 사료 인용(선택). 채우면 행 아래에 사료 블록이 붙는다. quote 형식과 같은 필드를 공유.
function ceBottomQuoteEditor(target, i, line) {
  return `
    <details class="cl-bq" ${(line.quoteText && line.quoteText.trim()) ? 'open' : ''}>
      <summary class="cl-bq-summary">하단 사료 인용 (선택)</summary>
      <div class="cl-fmt-fields">
        <input type="text" class="cl-fmt-sm" style="width:100%" placeholder="사료 소제목 (선택, 예: (가) …)" value="${esc(line.quoteLabel||'')}" oninput="updateLine('${target}',${i},'quoteLabel',this.value)">
        <textarea class="cl-fmt-grow" placeholder="사료 원문 (비우면 사료 안 붙음), {단어}는 빈칸" oninput="updateLine('${target}',${i},'quoteText',this.value);autoResizeTa(this)" onkeydown="handleContentKeydown(event)">${esc(line.quoteText||'')}</textarea>
        <input type="text" class="cl-fmt-sm" style="width:100%" placeholder="출처 (선택, 자동으로 겹낫표 『』 표시)" value="${esc(line.quoteSource||'')}" oninput="updateLine('${target}',${i},'quoteSource',this.value)">
      </div>
    </details>`;
}

/* 행 나열 아래에 붙는 중앙 나열 블록(선택) — 한 페이지에 행 나열 + 중앙 나열 두 유형을
   같이 두려고 만든 칸. 하단 사료 인용과 같은 방식으로, 페이지 형식은 '행 나열' 그대로 두고
   블록 데이터만 따로 담는다(bottomCols / bottomColsTitle). 칸을 다 비우면 안 붙는다. */
function ceBottomColsEditor(target, i, line) {
  const cols = line.bottomCols || [];
  const hasAny = !!(cols.some(c => (c.head && c.head.trim()) || (c.body && c.body.trim())) || (line.bottomColsTitle || '').trim());
  const rows = cols.map((c, j) => `
    <div class="cl-fmt-row">
      <input type="text" class="cl-fmt-sm" style="width:150px" placeholder="소제목" value="${esc(c.head||'')}" oninput="updateBottomColField('${target}',${i},${j},'head',this.value)">
      <input type="text" class="cl-fmt-grow" placeholder="내용 (선택), {단어}는 빈칸" value="${esc(c.body||'')}" oninput="updateBottomColField('${target}',${i},${j},'body',this.value)">
      <button class="cl-fmt-del" onclick="removeBottomCol('${target}',${i},${j})">삭제</button>
    </div>`).join('');
  return `
    <details class="cl-bq" ${hasAny ? 'open' : ''}>
      <summary class="cl-bq-summary">중앙 나열 블록 (선택)</summary>
      <div class="cl-fmt-fields">
        <div class="cl-fmt-hint">행들 아래에 중앙 나열이 한 구역으로 붙는다 / 항목을 다 비우면 안 붙음 / **글자**로 감싸면 강조색</div>
        <input type="text" class="cl-fmt-sm" style="width:100%" placeholder="대제목 (블록 가운데 큰 제목, 선택)" value="${esc(line.bottomColsTitle||'')}" oninput="updateLine('${target}',${i},'bottomColsTitle',this.value)">
        ${rows}
        <div class="cl-fmt-row">
          <button type="button" class="cbtn-sm" onclick="addBottomCol('${target}',${i})">+ 항목 추가</button>
          <label class="cl-opt">글자 크기(소제목/내용) <input type="number" min="10" max="140" placeholder="기본" value="${line.bottomColsSize != null ? line.bottomColsSize : ''}" oninput="setBottomColsSize('${target}',${i},'bottomColsSize',this.value)"> px</label>
          <label class="cl-opt">글자 크기(대제목) <input type="number" min="10" max="200" placeholder="기본" value="${line.bottomColsTitleSize != null ? line.bottomColsTitleSize : ''}" oninput="setBottomColsSize('${target}',${i},'bottomColsTitleSize',this.value)"> px</label>
        </div>
      </div>
    </details>`;
}
function updateBottomColField(target,i,j,f,v){ ceLinesFor(target)[i].bottomCols[j][f]=v; ceRenderPreview(); }
function addBottomCol(target,i){
  const line = ceLinesFor(target)[i];
  if (!line.bottomCols) line.bottomCols = [];
  line.bottomCols.push({head:'',body:''});
  ceRenderContentLines(target); ceRenderPreview();
}
function removeBottomCol(target,i,j){
  const line = ceLinesFor(target)[i];
  line.bottomCols.splice(j,1);
  // 항목을 다 지우면 필드째 없애서 예전 행 나열 페이지와 똑같은 데이터로 돌려 둔다.
  if (!line.bottomCols.length) delete line.bottomCols;
  ceRenderContentLines(target); ceRenderPreview();
}
// 블록 자체 글자 크기(소제목·내용 / 대제목). 비우면 필드를 지워 디자인 탭 기본값을 따른다.
function setBottomColsSize(target,i,field,v){
  const line = ceLinesFor(target)[i];
  const n = parseInt(v, 10);
  if (v === '' || isNaN(n)) delete line[field];
  else line[field] = n;
  ceRenderPreview();
}

function ceTimelineEditor(target, i, line) {
  const isV = line.format === 'timeline-v';
  const rows = line.events.map((ev, j) => isV ? `
    <div class="cl-fmt-row">
      <input type="text" class="cl-fmt-sm" placeholder="메모(연도 등)" value="${esc(ev.memo||'')}" oninput="updateEventField('${target}',${i},${j},'memo',this.value)">
      <textarea class="cl-fmt-grow" placeholder="내용, 한 줄 = 한 항목, {단어}는 빈칸, ' : '로 소제목 구분, Shift+Enter로 같은 항목 안 줄바꿈" oninput="updateEventContent('${target}',${i},${j},this.value);autoResizeTa(this)" onkeydown="handleItemsKeydown(event)">${esc(itemsToText(ev.content))}</textarea>
      <button class="cl-fmt-del" onclick="removeEvent('${target}',${i},${j})">삭제</button>
    </div>` : `
    <div class="cl-fmt-row">
      <input type="text" class="cl-fmt-sm" placeholder="연도" value="${esc(ev.year||'')}" oninput="updateEventField('${target}',${i},${j},'year',this.value)">
      <input type="text" class="cl-fmt-grow" placeholder="라벨, {단어}는 빈칸" value="${esc(ev.label||'')}" oninput="updateEventField('${target}',${i},${j},'label',this.value)">
      <button class="cl-fmt-del" onclick="removeEvent('${target}',${i},${j})">삭제</button>
    </div>`).join('');
  return `<div class="cl-fmt-fields">${rows}<button type="button" class="cbtn-sm" onclick="addEvent('${target}',${i})">+ 사건 추가</button></div>`;
}
function updateEventField(target,i,j,f,v) { ceLinesFor(target)[i].events[j][f] = v; ceRenderPreview(); }
function updateEventContent(target,i,j,v) { ceLinesFor(target)[i].events[j].content = itemsFromText(v); ceRenderPreview(); }
function addEvent(target,i) {
  const line = ceLinesFor(target)[i];
  line.events.push(line.format === 'timeline-v' ? { memo:'', content:[''] } : { year:'', label:'' });
  ceRenderContentLines(target); ceRenderPreview();
}
function removeEvent(target,i,j) { ceLinesFor(target)[i].events.splice(j,1); ceRenderContentLines(target); ceRenderPreview(); }

function ceCompareEditor(target, i, line) {
  const side = (key, label) => `
    <div class="cl-fmt-col">
      <input type="text" class="cl-fmt-sm" style="width:100%" placeholder="${label} 라벨" value="${esc(line[key].label||'')}" oninput="updateCompareField('${target}',${i},'${key}','label',this.value)">
      <textarea class="cl-fmt-grow" placeholder="한 줄 = 한 항목, {단어}는 빈칸, ' : '로 소제목 구분, Shift+Enter로 같은 항목 안 줄바꿈" oninput="updateCompareItems('${target}',${i},'${key}',this.value);autoResizeTa(this)" onkeydown="handleItemsKeydown(event)">${esc(itemsToText(line[key].items))}</textarea>
    </div>`;
  return `<div class="cl-fmt-fields cl-fmt-fields-2col">${side('left','왼쪽(네이비)')}${side('right','오른쪽(레드)')}</div>`;
}
function updateCompareField(target,i,side,f,v) { ceLinesFor(target)[i][side][f] = v; ceRenderPreview(); }
function updateCompareItems(target,i,side,v)  { ceLinesFor(target)[i][side].items = itemsFromText(v); ceRenderPreview(); }

function ceQuoteEditor(target, i, line) {
  return `
    <div class="cl-fmt-fields">
      <input type="text" class="cl-fmt-sm" style="width:100%" placeholder="사료 소제목 (선택, 예: (가) 조선의 통치제도) — 전체 제목은 위 그룹 제목칸에서 편집" value="${esc(line.quoteLabel||'')}" oninput="updateLine('${target}',${i},'quoteLabel',this.value)">
      <textarea class="cl-fmt-grow" placeholder="원문 텍스트, {단어}는 빈칸" oninput="updateLine('${target}',${i},'quoteText',this.value);autoResizeTa(this)" onkeydown="handleContentKeydown(event)">${esc(line.quoteText||'')}</textarea>
      <input type="text" class="cl-fmt-sm" style="width:100%" placeholder="출처" value="${esc(line.quoteSource||'')}" oninput="updateLine('${target}',${i},'quoteSource',this.value)">
    </div>`;
}

function ceFlowEditor(target, i, line) {
  const rows = line.stages.map((st, j) => `
    <div class="cl-fmt-row">
      <input type="text" class="cl-fmt-sm" placeholder="단계명" value="${esc(st.label||'')}" oninput="updateStageField('${target}',${i},${j},'label',this.value)">
      <textarea class="cl-fmt-grow" placeholder="설명, {단어}는 빈칸" oninput="updateStageField('${target}',${i},${j},'text',this.value);autoResizeTa(this)" onkeydown="handleContentKeydown(event)">${esc(st.text||'')}</textarea>
      <button class="cl-fmt-del" onclick="removeStage('${target}',${i},${j})">삭제</button>
    </div>`).join('');
  return `<div class="cl-fmt-fields">${rows}<button type="button" class="cbtn-sm" onclick="addStage('${target}',${i})">+ 단계 추가</button></div>`;
}
function updateStageField(target,i,j,f,v) { ceLinesFor(target)[i].stages[j][f] = v; ceRenderPreview(); }
function addStage(target,i) { ceLinesFor(target)[i].stages.push({label:'',text:''}); ceRenderContentLines(target); ceRenderPreview(); }
function removeStage(target,i,j) { ceLinesFor(target)[i].stages.splice(j,1); ceRenderContentLines(target); ceRenderPreview(); }

// 전체 슬라이드(표지·목표·Dive·초성·개념·미션·생각 전부)에서 이 섹션의 첫 페이지 앞까지의 슬라이드 수.
// = 이 섹션 페이지 번호의 전역 시작 오프셋. 실제 발표 순서와 맞추려고 SlideRender로 전체 덱을 만들어 계산한다.
function ceGlobalBaseOffset(target) {
  try {
    const all = SlideRender.buildSlidesFromData(ceCd);
    const type = target === 'mission' ? 'mission' : 'concept';
    const idx = all.findIndex(s => s.type === type);
    if (idx >= 0) return idx;                 // 해당 섹션 첫 슬라이드의 0-based 위치
    // 아직 이 섹션 슬라이드가 없으면 앞 섹션 수로 추정
    if (type === 'concept') return all.filter(s => ['cover','objectives','dive','chosung'].includes(s.type)).length;
    const lastConcept = all.map(s => s.type).lastIndexOf('concept');
    if (lastConcept >= 0) return lastConcept + 1;
    return all.filter(s => ['cover','objectives','dive','chosung'].includes(s.type)).length;
  } catch { return 0; }
}

let _ceSyncing = false; // 개념↔미션 페이지 번호 동기화 재진입 방지

function ceRenderContentLines(target) {
  const lines = ceLinesFor(target);
  const container = document.getElementById(ceContainerIdFor(target));
  if (!lines.length) {
    container.innerHTML = '<p class="field-hint">아직 내용이 없습니다. 아래 버튼으로 구분선과 행을 추가하세요.</p>';
    return;
  }
  const groups = ceBuildGroups(lines);
  let pageNum = ceGlobalBaseOffset(target); // 전체 슬라이드 기준 시작 번호
  container.innerHTML = groups.map(group => {
    if (group.type === 'image') {
      const i = group.idx, line = lines[i];
      const pg = ++pageNum;
      return `
        <div class="cl-image" data-idx="${i}">
          <div class="cl-divider-top">
            <span class="cl-handle">⋮⋮</span>
            <span class="cl-slide-meta">${pg}페이지 <span class="cl-meta-sep">｜</span> 이미지 슬라이드</span>
            <input type="text" class="cl-divider-title" placeholder="제목 (선택)" value="${esc(line.title||'')}" oninput="updateLine('${target}',${i},'title',this.value)" style="max-width:220px">
            ${ceBlockActions(target, i, lines.length, `deleteLine('${target}',${i})`, '이 페이지 삭제')}
          </div>
          ${line.images.map((im, j) => `
            <div class="cl-img-row">
              <span class="cl-img-label">번호</span>
              <input type="number" class="cl-img-input" min="1" max="99" value="${im.img||1}" oninput="updateImageItem('${target}',${i},${j},'img',+this.value)">
              <input type="text" class="cl-divider-title" placeholder="캡션 (선택)" value="${esc(im.caption||'')}" oninput="updateImageItem('${target}',${i},${j},'caption',this.value)" style="max-width:180px">
              ${line.images.length > 1 ? `<button class="cbtn-sm" onclick="removeImageItem('${target}',${i},${j})">이 이미지 제거</button>` : ''}
            </div>`).join('')}
          <button class="cbtn-sm" onclick="addImageItem('${target}',${i})">+ 이미지 추가 (그리드 배치)</button>
          <div class="cl-img-row">
            <span class="cl-img-label">화면 차지 비율</span>
            <input type="number" class="cl-img-input" min="10" max="100" value="${line.size != null ? line.size : 100}" oninput="updateLine('${target}',${i},'size',+this.value)">
            <span class="cl-img-label" style="font-weight:400;color:var(--stone)">%</span>
          </div>
        </div>`;
    }
    if (group.type === 'fullimage') {
      const i = group.idx, line = lines[i];
      const pg = ++pageNum;
      const legacy = line.img == null && line.url; // 예전 업로드분
      return `
        <div class="cl-image" data-idx="${i}">
          <div class="cl-divider-top">
            <span class="cl-handle">⋮⋮</span>
            <span class="cl-slide-meta">${pg}페이지 <span class="cl-meta-sep">｜</span> 전면 이미지</span>
            ${ceBlockActions(target, i, lines.length, `deleteFullImage('${target}',${i})`, '이 페이지 삭제')}
          </div>
          <div class="cl-img-row">
            <span class="cl-img-label">이미지 번호</span>
            <input type="number" class="cl-img-input" min="1" max="99" value="${line.img != null ? line.img : 1}" oninput="updateLine('${target}',${i},'img',+this.value)">
            <span class="cl-img-label">화면 차지 비율</span>
            <input type="number" class="cl-img-input" min="10" max="100" value="${line.size != null ? line.size : 100}" oninput="updateLine('${target}',${i},'size',+this.value)">
            <span class="cl-img-label" style="font-weight:400;color:var(--stone)">%</span>
          </div>
          ${legacy ? `<div style="padding:0 12px 8px;color:var(--stone);font-size:12px">※ 예전에 업로드한 이미지가 남아 있습니다. 번호를 입력하면 그 이미지로 교체됩니다.</div>` : ''}
        </div>`;
    }
    if (group.type === 'video') {
      const i = group.idx, line = lines[i];
      const pg = ++pageNum;
      return `
        <div class="cl-image" data-idx="${i}">
          <div class="cl-divider-top">
            <span class="cl-handle">⋮⋮</span>
            <span class="cl-slide-meta">${pg}페이지 <span class="cl-meta-sep">｜</span> 영상</span>
            <input type="text" class="cl-divider-title" placeholder="유튜브 URL 붙여넣기" value="${esc(line.url||'')}" onchange="updateVideoUrl('${target}',${i},this.value)" style="flex:1;max-width:none">
            ${ceBlockActions(target, i, lines.length, `deleteLine('${target}',${i})`, '이 페이지 삭제')}
          </div>
          ${line.videoId
            ? `<div style="padding:8px 12px"><img src="https://img.youtube.com/vi/${line.videoId}/mqdefault.jpg" style="max-height:120px;border-radius:6px;border:1px solid var(--cborder)"></div>`
            : `<div style="padding:10px 12px;color:var(--stone);font-size:13px">유효한 유튜브 URL을 입력하면 미리보기가 표시됩니다.</div>`}
        </div>`;
    }
    if (group.type === 'slide-group') {
      const { title, slides } = group;
      const allDivIds = slides.map(s => s.divIdx);
      const slidesHtml = slides.map(({ divIdx, rowIndices }) => {
        const div = lines[divIdx];
        const hasImg = div.img != null, fmt = div.format || 'rows';
        // 내용이 빈 페이지는 슬라이드 렌더러가 덱에서 빼버린다(slide-render.js의 buildCheckSlides).
        // 편집기가 따로 판정하면 또 어긋나므로 그 함수를 그대로 불러 쓰고, 덱에 나오는 페이지에만
        // 번호를 준다. 그래야 여기 번호와 실제 슬라이드 번호가 항상 같다.
        const willRender = SlideRender.buildCheckSlides(
          [div, ...rowIndices.map(ri => lines[ri])], target === 'mission' ? 'mission' : 'concept'
        ).length > 0;
        const pg = willRender ? ++pageNum : null;
        // 페이지 단위 공통 액션바(가로, 페이지/형식 표시 옆) — 모든 형식에서 동일한 모양으로 쓴다.
        const blockEnd = divIdx + 1 + rowIndices.length;   // 이 페이지 블록의 끝(다음 블록 시작 인덱스)
        const canUp = divIdx > 0, canDown = blockEnd < lines.length;
        const pageActions = `
              <div class="cl-row-actions">
                <button class="cl-icon-btn" onclick="moveSlideBlock('${target}',${divIdx},-1)" ${canUp?'':'disabled'} title="페이지 위로 이동">${ceIconUp()}</button>
                <button class="cl-icon-btn" onclick="moveSlideBlock('${target}',${divIdx},1)" ${canDown?'':'disabled'} title="페이지 아래로 이동">${ceIconDown()}</button>
                <button class="cl-icon-btn" onclick="ceShowAddMenu(event,'${target}',${divIdx})" title="추가 (행/페이지)">${ceIconPlus()}</button>
                <button class="cl-icon-btn" onclick="toggleDividerImg('${target}',${divIdx})" title="${hasImg?'이미지 제거':'이미지 삽입'}">${ceIconImage()}</button>
                <button class="cl-icon-btn${fmt !== 'rows' ? ' active' : ''}" onclick="ceToggleFmt('${target}',${divIdx})" title="형식 변경">${ceIconSliders()}</button>
                <button class="cl-icon-btn danger" onclick="${slides.length > 1 ? `deletePair('${target}',${divIdx})` : `deleteGroup('${target}',${slides[0].divIdx})`}" title="이 페이지 삭제">${ceIconTrash()}</button>
              </div>`;
        // 한 페이지 안의 행(라벨+내용). 여러 행이면 행별 삭제 버튼만 인라인으로 둔다.
        const rowInner = (rowIdx) => {
          const row = lines[rowIdx];
          const rowDelete = rowIndices.length > 1
            ? `<button class="cl-icon-btn danger cl-row-del" onclick="deleteRow('${target}',${rowIdx})" title="행 삭제">${ceIconTrash()}</button>` : '';
          return `
              <div class="cl-row-inner" data-row-idx="${rowIdx}">
                <textarea class="cl-label" placeholder="라벨" oninput="updateLine('${target}',${rowIdx},'label',this.value);autoResizeTa(this)">${esc(row.label)}</textarea>
                <textarea class="cl-items" placeholder="{단어}는 빈칸, **굵게**, 엔터로 항목 구분, Shift+Enter로 같은 항목 안 줄바꿈 (a./b./c. 줄은 하위 항목)" oninput="updateLineItems('${target}',${rowIdx},this.value);autoResizeTa(this)" onkeydown="handleItemsKeydown(event)">${esc(itemsToText(row.items))}</textarea>
                ${rowDelete}
              </div>`;
        };
        // 본문 내용: 행 나열은 행들, 그 외(사료·연표 등)는 형식 편집기. 어느 형식이든 래퍼+우측 세로 액션바는 동일.
        const contentInner = fmt !== 'rows'
          ? ceFormatPanelBody(target, divIdx, div)
          : (rowIndices.length ? rowIndices.map(rowInner).join('') : `<div class="cl-norow-hint">내용이 없는 페이지입니다. 행을 추가하세요.</div>`);
        const bodyHtml = `<div class="cl-slide-row cl-slide-special"><div class="cl-special-editor">${contentInner}</div></div>`;
        const pageHandle = slides.length > 1 ? `<span class="cl-handle cl-page-handle" title="페이지 순서 변경">⋮⋮</span>` : '';
        const imgLayout = div.imgLayout || 'right';
        // 텍스트 폭(%)은 우측 배치에서만 의미가 있음. 나머지 폭을 이미지가 세로로 꽉 채움.
        // 저장값 imgSize는 '이미지 칸 폭%'이라, 입력은 텍스트 폭(=100-imgSize)으로 주고받는다.
        const textWidth = 100 - (div.imgSize != null ? div.imgSize : 50);
        const sizeInput = imgLayout === 'right' ? `
              <span class="cl-img-label">텍스트 폭</span>
              <input type="number" class="cl-img-input" min="40" max="90" value="${textWidth}" oninput="updateLine('${target}',${divIdx},'imgSize',100-(+this.value))">
              <span class="cl-img-label">%</span>` : '';
        const imgRow = hasImg ? `
            <div class="cl-img-row" style="padding:6px 12px 8px 12px;border-top:1px solid #eee;margin-top:4px">
              <span class="cl-img-label">이미지 번호</span>
              <input type="number" class="cl-img-input" min="1" max="99" value="${div.img}" oninput="updateLine('${target}',${divIdx},'img',+this.value)">
              <span class="cl-img-label">배치</span>
              <select class="cl-img-select" onchange="updateImgLayout('${target}',${divIdx},this.value)">
                <option value="right" ${imgLayout==='right'?'selected':''}>우측</option>
                <option value="bottom" ${imgLayout==='bottom'?'selected':''}>하단</option>
              </select>${sizeInput}
            </div>` : '';
        return `
          <div class="cl-slide-item" data-div-idx="${divIdx}">
            <div class="cl-slide-head">
              ${pageHandle}
              <span class="cl-slide-meta${pg ? '' : ' cl-slide-ghost'}">${pg ? `${pg}페이지` : '슬라이드 없음'} <span class="cl-meta-sep">｜</span> ${CE_FORMAT_LABELS[fmt]}</span>
              ${pageActions}
            </div>
            <details class="cl-fmt-details" style="margin:0 12px 6px">
              <summary class="cl-fmt-summary">형식 변경 / 페이지 설정</summary>
              <div class="cl-fmt-panel">
                <div class="cl-fmt-chips">${ceFormatChips(target,divIdx,fmt)}</div>
                <div class="cl-fmt-opts">
                  ${fmt === 'rows' ? `<label class="cl-opt"><input type="checkbox" class="cl-opt-labelpos" ${div.labelPos === 'left' ? 'checked' : ''} onclick="event.stopPropagation();toggleLabelPos('${target}',${divIdx},this.checked)"> 라벨 좌측</label>` : ''}
                  ${fmt !== 'notice' ? `<label class="cl-opt"><input type="checkbox" ${div.hideBadge ? 'checked' : ''} onclick="event.stopPropagation();toggleHideBadge('${target}',${divIdx},this.checked)"> 배지 숨김</label>` : ''}
                  ${fmt === 'rows' || fmt === 'notice' ? `<label class="cl-opt"><input type="checkbox" ${div.align === 'justify' ? 'checked' : ''} onclick="event.stopPropagation();toggleAlign('${target}',${divIdx},'justify',this.checked)"> 양쪽 정렬</label>` : ''}
                  ${fmt === 'compare' ? `<label class="cl-opt"><input type="checkbox" ${div.align === 'center' ? 'checked' : ''} onclick="event.stopPropagation();toggleAlign('${target}',${divIdx},'center',this.checked)"> 가운데 정렬</label>` : ''}
                  ${fmt === 'timeline-v' ? ceFocusEventSelect(target, divIdx, div) : ''}
                  <label class="cl-opt">${fmt === 'cols' ? '글자 크기(소제목/내용)' : '글자 크기'} <input type="number" min="10" max="140" placeholder="기본" value="${div.fontSize != null ? div.fontSize : ''}" oninput="setLineFontSize('${target}',${divIdx},this.value)"> px</label>
                  ${fmt === 'cols' ? `<label class="cl-opt">글자 크기(대제목) <input type="number" min="10" max="200" placeholder="기본" value="${div.colsTitleSize != null ? div.colsTitleSize : ''}" oninput="setColsTitleSize('${target}',${divIdx},this.value)"> px</label>` : ''}
                </div>
                ${fmt === 'rows' ? ceBottomQuoteEditor(target,divIdx,div) : ''}
                ${fmt === 'rows' ? ceBottomColsEditor(target,divIdx,div) : ''}
              </div>
            </details>
            <div class="cl-slide-body">${bodyHtml}</div>
            ${imgRow}
          </div>`;
      }).join('');
      return `
        <div class="cl-group" data-first-div="${slides[0].divIdx}">
          <div class="cl-group-header">
            <span class="cl-handle">⋮⋮</span>
            <input type="text" class="cl-divider-title" placeholder="슬라이드 제목" value="${esc(title)}" oninput="updateGroupTitle('${target}',[${allDivIds.join(',')}],this.value)">
            <div class="cl-row-actions">
              <button class="cl-icon-btn danger" onclick="deleteGroup('${target}',${slides[0].divIdx})" title="전체 삭제">${ceIconTrash()}</button>
            </div>
          </div>
          <div class="cl-group-body">${slidesHtml}</div>
        </div>`;
    }
    return '';
  }).join('');
  ceWireDragEvents(target);
  requestAnimationFrame(() => requestAnimationFrame(() => container.querySelectorAll('textarea').forEach(autoResizeTa)));
  // 페이지 번호가 전역이므로, 한 섹션을 다시 그리면 반대 섹션 번호도 즉시 갱신되도록 1회 동기화한다.
  if (!_ceSyncing) {
    _ceSyncing = true;
    const other = target === 'concept' ? 'mission' : 'concept';
    if (document.getElementById(ceContainerIdFor(other))) ceRenderContentLines(other);
    _ceSyncing = false;
  }
}

/* 이미지·전면 이미지·영상처럼 한 줄로 끝나는 슬라이드의 액션바.
   슬라이드 그룹의 페이지 액션바(pageActions)와 같은 모양으로 오른쪽 위에 붙이되,
   여기서 의미가 있는 것은 순서 이동과 삭제뿐이라 그 셋만 둔다. */
function ceBlockActions(target, i, total, delCall, delTitle) {
  return `
            <div class="cl-row-actions">
              <button class="cl-icon-btn" onclick="moveSlideBlock('${target}',${i},-1)" ${i > 0 ? '' : 'disabled'} title="페이지 위로 이동">${ceIconUp()}</button>
              <button class="cl-icon-btn" onclick="moveSlideBlock('${target}',${i},1)" ${i + 1 < total ? '' : 'disabled'} title="페이지 아래로 이동">${ceIconDown()}</button>
              <button class="cl-icon-btn danger" onclick="${delCall}" title="${delTitle}">${ceIconTrash()}</button>
            </div>`;
}

/* ── 슬라이드 그룹 헬퍼 ── */
function ceBuildGroups(lines) {
  const groups = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.type === 'image') {
      groups.push({ type: 'image', idx: i++ });
    } else if (line.type === 'fullimage') {
      groups.push({ type: 'fullimage', idx: i++ });
    } else if (line.type === 'video') {
      groups.push({ type: 'video', idx: i++ });
    } else if (line.type === 'divider') {
      const title = line.title;
      const slides = [];
      while (i < lines.length && lines[i].type === 'divider' && lines[i].title === title) {
        const divIdx = i++;
        const rowIndices = [];
        while (i < lines.length && lines[i].type === 'row') rowIndices.push(i++);
        slides.push({ divIdx, rowIndices });
      }
      groups.push({ type: 'slide-group', title, slides });
    } else { i++; }
  }
  return groups;
}

const _svgPlus    = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>`;
const _svgImage   = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="5.5" cy="6.5" r="1"/><polyline points="2,12 5,8.5 7.5,11 10,8 14,12"/></svg>`;
const _svgSliders = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="2" y1="5" x2="14" y2="5"/><line x1="2" y1="11" x2="14" y2="11"/><circle cx="6" cy="5" r="1.8" fill="white" stroke="currentColor"/><circle cx="10" cy="11" r="1.8" fill="white" stroke="currentColor"/></svg>`;
const _svgTrash   = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,4 13,4"/><path d="M5,4V3a1,1,0,0,1,1-1h4a1,1,0,0,1,1,1V4"/><path d="M6,7v4M10,7v4"/><rect x="4" y="4" width="8" height="9" rx="1"/></svg>`;
const _svgUp   = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,10 8,6 12,10"/></svg>`;
const _svgDown = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,6 8,10 12,6"/></svg>`;
function ceIconPlus()    { return _svgPlus; }
function ceIconImage()   { return _svgImage; }
function ceIconSliders() { return _svgSliders; }
function ceIconTrash()   { return _svgTrash; }
function ceIconUp()      { return _svgUp; }
function ceIconDown()    { return _svgDown; }

/* 페이지(=divider + 딸린 row들)를 한 덩어리로 위/아래 인접 블록과 자리 바꾼다.
   그룹(제목) 경계도 넘나들 수 있어, 원하는 순서로 페이지를 재배치할 수 있다.
   dir: -1(위) / +1(아래). 이미지·영상 등 단일 라인 블록과도 자리 바꿈이 된다. */
/* 페이지 블록 하나를 통째로 위아래로 옮긴다.
   블록 = 시작 줄 + (구분선일 때만) 뒤따르는 행들. 이미지·전면 이미지·영상 줄은
   그 자체로 한 블록이라 행을 딸려 세지 않는다 — 예전에는 구분선이 아니면 아예
   돌려보냈고, 그래서 이미지·영상 슬라이드에 위아래 버튼을 달 수가 없었다. */
function moveSlideBlock(target, divIdx, dir) {
  const lines = ceLinesFor(target);
  const head = lines[divIdx];
  if (!head) return;
  let count = 1;
  if (head.type === 'divider') {
    while (divIdx + count < lines.length && lines[divIdx + count].type === 'row') count++;
  }
  if (dir < 0) {
    if (divIdx === 0) return;
    let p = divIdx - 1;                          // 앞 블록의 시작 지점을 찾는다
    while (p > 0 && lines[p].type === 'row') p--;
    const moved = lines.splice(divIdx, count);
    lines.splice(p, 0, ...moved);
  } else {
    const nextStart = divIdx + count;
    if (nextStart >= lines.length) return;
    let nextCount = 1;
    if (lines[nextStart].type === 'divider') {
      while (nextStart + nextCount < lines.length && lines[nextStart + nextCount].type === 'row') nextCount++;
    }
    const moved = lines.splice(divIdx, count);
    lines.splice(divIdx + nextCount, 0, ...moved);
  }
  ceRenderContentLines(target); ceRenderPreview();
}

function updateGroupTitle(target, indices, v) {
  const lines = ceLinesFor(target);
  indices.forEach(i => { lines[i].title = v; });
  ceRenderPreview();
}

function addRowToGroup(target, divIdx) {
  const lines = ceLinesFor(target);
  let insertAt = divIdx + 1;
  while (insertAt < lines.length && lines[insertAt].type === 'row') insertAt++;
  lines.splice(insertAt, 0, { type: 'row', label: '', items: [] });
  ceRenderContentLines(target); ceRenderPreview();
}

function deletePair(target, divIdx) {
  const lines = ceLinesFor(target);
  let count = 1;
  while (divIdx + count < lines.length && lines[divIdx + count].type === 'row') count++;
  lines.splice(divIdx, count);
  ceRenderContentLines(target); ceRenderPreview();
}

function deleteRow(target, rowIdx) {
  ceLinesFor(target).splice(rowIdx, 1);
  ceRenderContentLines(target); ceRenderPreview();
}

function addSlide(target) {
  ceLinesFor(target).push(
    { type: 'divider', title: '새 슬라이드' },
    { type: 'row', label: '', items: [] }
  );
  ceRenderContentLines(target); ceRenderPreview();
}

function ceToggleFmt(target, divIdx) {
  const container = document.getElementById(ceContainerIdFor(target));
  const item = container.querySelector(`.cl-slide-item[data-div-idx="${divIdx}"]`);
  if (!item) return;
  const details = item.querySelector('.cl-fmt-details');
  if (details) details.open = !details.open;
}

function addPageToGroup(target, lastDivIdx) {
  const lines = ceLinesFor(target);
  const title = lines[lastDivIdx].title;
  let insertAt = lastDivIdx + 1;
  while (insertAt < lines.length && lines[insertAt].type === 'row') insertAt++;
  lines.splice(insertAt, 0,
    { type: 'divider', title },
    { type: 'row', label: '', items: [] }
  );
  ceRenderContentLines(target); ceRenderPreview();
}

/* 다른 제목의 새 페이지(=새 슬라이드 그룹)를 이 그룹 바로 뒤에 만든다.
   제목이 그룹 기준이라, 같은 제목이면 한 그룹으로 묶여버리므로 새 제목을 주려면
   그룹 전체가 끝난 지점에 별도 제목의 divider를 넣어야 한다. */
function addTitledPageAfter(target, divIdx) {
  const lines = ceLinesFor(target);
  const title = lines[divIdx].title;
  // 이 그룹(같은 제목의 연속 divider + 각자의 row들)의 끝 지점을 찾는다.
  let end = divIdx;
  while (end < lines.length) {
    if (lines[end].type === 'row') { end++; continue; }
    if (lines[end].type === 'divider' && lines[end].title === title) { end++; continue; }
    break;
  }
  // 그룹은 "제목이 같으면" 합쳐지므로, 새 페이지 제목이 앞(현재 그룹)이나 뒤 그룹 제목과
  // 같으면 별도 그룹이 되지 않는다. 앞뒤와 겹치지 않는 기본 제목을 만들어 준다.
  const afterTitle = (lines[end] && lines[end].type === 'divider') ? lines[end].title : null;
  const base = '새 슬라이드';
  let newTitle = base, n = 2;
  while (newTitle === title || newTitle === afterTitle) newTitle = `${base} ${n++}`;
  lines.splice(end, 0,
    { type: 'divider', title: newTitle },
    { type: 'row', label: '', items: [] }
  );
  ceRenderContentLines(target); ceRenderPreview();
}

/* 액션바의 + 버튼: 누르면 "행 추가 / 페이지 추가(같은 제목) / 새 페이지(다른 제목)"를
   고를 수 있는 작은 메뉴를 연다. 행 추가는 이 페이지에 행 하나를, 같은 제목 페이지 추가는
   같은 그룹에 새 페이지를, 다른 제목 새 페이지는 이 그룹 뒤에 별도 제목의 새 그룹을 만든다. */
function ceShowAddMenu(ev, target, divIdx) {
  ev.stopPropagation();
  document.querySelectorAll('.cl-add-menu').forEach(m => m.remove());
  const btn = ev.currentTarget || (ev.target && ev.target.closest('button'));
  if (!btn) return;
  const menu = document.createElement('div');
  menu.className = 'cl-add-menu';
  const mkBtn = (label, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', () => { menu.remove(); fn(); });
    return b;
  };
  menu.appendChild(mkBtn('행 추가', () => addRowToGroup(target, divIdx)));
  menu.appendChild(mkBtn('페이지 추가 (같은 제목)', () => addPageToGroup(target, divIdx)));
  menu.appendChild(mkBtn('새 페이지 (다른 제목)', () => addTitledPageAfter(target, divIdx)));
  document.body.appendChild(menu);
  const r = btn.getBoundingClientRect();
  const left = Math.max(8, window.scrollX + r.right - menu.offsetWidth);
  menu.style.top  = `${window.scrollY + r.bottom + 4}px`;
  menu.style.left = `${left}px`;
  const off = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', off); } };
  setTimeout(() => document.addEventListener('mousedown', off), 0);
}

function deleteGroup(target, firstDivIdx) {
  const lines = ceLinesFor(target);
  const title = lines[firstDivIdx].title;
  let end = firstDivIdx;
  while (end < lines.length) {
    if ((lines[end].type === 'divider' && lines[end].title === title) || lines[end].type === 'row') { end++; }
    else break;
  }
  lines.splice(firstDivIdx, end - firstDivIdx);
  ceRenderContentLines(target); ceRenderPreview();
}

function updateLine(target,i,f,v)    { ceLinesFor(target)[i][f]=v; ceRenderPreview(); }
// 배치 변경 시 '텍스트 폭' 입력 노출 여부가 바뀌므로 편집기까지 다시 그린다.
function updateImgLayout(target,i,v) { const l=ceLinesFor(target)[i]; l.imgLayout=v; ceRenderContentLines(target); ceRenderPreview(); }
/* "한 줄 = 한 항목" 편집칸의 글을 항목 배열로 나눈다.
   행 나열 항목, 연표 사건 내용, 비교표 항목이 같은 규칙을 함께 쓴다 — 예전에는 행 나열만
   이 규칙을 갖고 있어서, 연표와 비교표에서 Shift+Enter를 치면 그 줄이 별개 항목이 되어
   내어쓰기(a. 뒤에 맞춰 들여쓰는 것)가 풀렸다. */
function itemsFromText(v) {
  // 규칙: 일반 엔터(\n) = 새 항목. ZWSP(U+200B)로 시작하는 줄 = 같은 항목 안 줄바꿈(Shift+Enter,
  //   → U+2028로 이어 붙임). a./b./c. 로 시작하는 줄 = 하위 항목(<br>로 이어 붙임).
  const LS = String.fromCharCode(0x2028);
  const ZWSP = String.fromCharCode(0x200B);
  const LEADING_ZWSP_RE = new RegExp('^' + ZWSP + '+');
  const lines = v.split('\n');
  const items = [];
  let cur = null;
  for (const raw of lines) {
    const soft = raw.charCodeAt(0) === 0x200B;
    // ZWSP가 한 개가 아니라 여러 개 연달아 남아있는 경우(예전 버그로 실제 저장된 데이터에서
    // 확인됨)에도 전부 걷어낸다 — 하나만 벗기면 남은 ZWSP 때문에 a./b. 마커 검사가 실패한다.
    const ln = soft ? raw.replace(LEADING_ZWSP_RE, '') : raw;
    // a./b./c. 줄은 Shift+Enter(soft)로 넘어왔든 그냥 Enter로 넘어왔든 항상 하위 항목으로
    // 취급한다. soft만 먼저 걸러 무조건 LS로 이어붙이면, a. 다음 줄을 Shift+Enter로 쳤을 때
    // b.가 하위 항목(<br>)이 아니라 그냥 이어지는 일반 줄(굵게 표시 안 됨)로 저장되는 버그가 있었다.
    if (/^[a-z]\.\s/.test(ln) && cur !== null) {       // 하위 항목
      cur += '<br>' + ln;
      continue;
    }
    if (soft) {                                       // 같은 항목 안 줄바꿈
      cur = (cur === null) ? ln : cur + LS + ln;
      continue;
    }
    if (ln.trim() === '') continue;                     // 일반 빈 줄은 버림
    if (cur !== null) items.push(cur);
    cur = ln;
  }
  if (cur !== null) items.push(cur);
  return items;
}
/* 항목 배열을 편집칸 글로 되돌린다. 같은 항목 안 줄바꿈(U+2028)은 줄바꿈 + ZWSP로,
   하위 항목(<br>)은 그냥 줄바꿈으로 편다 — a./b. 마커가 남아 있으므로 저장할 때
   itemsFromText가 도로 하위 항목으로 합친다. */
function itemsToText(items) {
  const LS = new RegExp(String.fromCharCode(0x2028), 'g');
  const ZWSP = String.fromCharCode(0x200B);
  return (items || []).map(it => String(it).replace(LS, '\n' + ZWSP).replace(/<\/?br\s*\/?>/gi, '\n')).join('\n');
}
function updateLineItems(target,i,v) {
  ceLinesFor(target)[i].items = itemsFromText(v);
  ceRenderPreview();
}
function deleteLine(target,i)        { ceLinesFor(target).splice(i,1); ceRenderContentLines(target); ceRenderPreview(); }
function addDivider(target)          { ceLinesFor(target).push({ type:'divider', title:'새 슬라이드' }); ceRenderContentLines(target); ceRenderPreview(); }
function toggleDividerImg(target,i) {
  const line = ceLinesFor(target)[i];
  if (line.img != null) {
    delete line.img; delete line.imgLayout; delete line.imgSize;
  } else {
    line.img = 1; line.imgLayout = 'right'; line.imgSize = 50;
  }
  ceRenderContentLines(target); ceRenderPreview();
}
function addContentRow(target)      { ceLinesFor(target).push({ type:'row', label:'새 라벨', items:['내용을 입력하세요'] }); ceRenderContentLines(target); ceRenderPreview(); }
function addImageSlide(target)      { ceLinesFor(target).push({ type:'image', images:[{ img:1, caption:'' }], title:'' }); ceRenderContentLines(target); ceRenderPreview(); }
function updateImageItem(target,li,ii,f,v) { ceLinesFor(target)[li].images[ii][f] = v; ceRenderPreview(); }
function addImageItem(target,li)     { ceLinesFor(target)[li].images.push({ img:1, caption:'' }); ceRenderContentLines(target); ceRenderPreview(); }
function removeImageItem(target,li,ii) { ceLinesFor(target)[li].images.splice(ii,1); ceRenderContentLines(target); ceRenderPreview(); }

// ── 전면 이미지 슬라이드 (이미지 슬라이드처럼 번호로 참조) ──
// 이미지 슬라이드와 동일하게 img:숫자(=/hoistory/lms/img/{강번호}_{번호}.png)를 참조한다.
// 화면을 꽉 채우는 슬라이드로 렌더된다. (예전 Storage 업로드분은 line.url로 계속 표시된다.)
function addFullImageSlide(target) {
  ceLinesFor(target).push({ type:'fullimage', img:1 });
  ceRenderContentLines(target); ceRenderPreview();
}
function deleteFullImage(target, i) {
  const line = ceLinesFor(target)[i];
  ceLinesFor(target).splice(i, 1);
  ceRenderContentLines(target); ceRenderPreview();
}

// ── 영상 슬라이드 (유튜브 임베드) ──
function ceParseYouTubeId(url) {
  if (!url) return '';
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  const m2 = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (m2) return m2[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(url.trim())) return url.trim();
  return '';
}

// 유튜브 주소에 붙은 시작 시간(t 또는 start)을 초로 바꾼다.
// "공유"로 복사하면 t=90 또는 t=90s, 주소창에서 그대로 가져오면 t=1m30s / t=1h2m3s 형태다.
// 시작 시간이 없으면 0.
function ceParseYouTubeStart(url) {
  if (!url) return 0;
  const m = String(url).match(/[?&#](?:t|start)=([0-9hms]+)/i);
  if (!m) return 0;
  const raw = m[1].toLowerCase();
  if (/^\d+s?$/.test(raw)) return parseInt(raw, 10) || 0;
  const hms = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!hms) return 0;
  return (+(hms[1] || 0)) * 3600 + (+(hms[2] || 0)) * 60 + (+(hms[3] || 0));
}
function addVideoSlide(target) {
  ceLinesFor(target).push({ type:'video', url:'', videoId:'', videoStart:0 });
  ceRenderContentLines(target); ceRenderPreview();
}
function updateVideoUrl(target, i, v) {
  const line = ceLinesFor(target)[i];
  line.url = v.trim();
  line.videoId = ceParseYouTubeId(v);
  line.videoStart = ceParseYouTubeStart(v); // 주소에 시작 시간이 있으면 그 지점부터 재생한다
  if (v.trim() && !line.videoId) notify('유튜브 주소를 알아보지 못했습니다. 주소를 확인해 주세요.');
  ceRenderContentLines(target); ceRenderPreview();
}

let ceDragSrcIdx = null;
let ceDragSrcTarget = null;
function ceWireDragEvents(target) {
  const containerId = ceContainerIdFor(target);

  function wireGroup(el, getFirstIdx, countLines) {
    const handle = el.querySelector(':scope > .cl-group-header > .cl-handle, :scope > .cl-divider-top > .cl-handle');
    if (handle) {
      handle.style.cursor = 'grab';
      handle.addEventListener('mousedown', () => el.setAttribute('draggable', 'true'));
      handle.addEventListener('mouseup',   () => el.setAttribute('draggable', 'false'));
    }
    el.addEventListener('dragstart', e => {
      ceDragSrcIdx = getFirstIdx(el);
      ceDragSrcTarget = target;
      el.classList.add('dragging');
      e.stopPropagation();
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      el.setAttribute('draggable', 'false');
    });
    el.addEventListener('dragover', e => e.preventDefault());
    el.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      if (ceDragSrcTarget !== target) return;
      const lines = ceLinesFor(target);
      const src = ceDragSrcIdx;
      const dst = getFirstIdx(el);
      if (src === null || src === dst) return;
      const count = countLines(lines, src);
      const moved = lines.splice(src, count);
      lines.splice(src < dst ? dst - count : dst, 0, ...moved);
      ceDragSrcIdx = null;
      ceRenderContentLines(target);
      ceRenderPreview();
    });
  }

  // 그룹 드래그
  document.querySelectorAll(`#${containerId} .cl-group[data-first-div]`).forEach(el => {
    wireGroup(
      el,
      el => +el.dataset.firstDiv,
      (lines, src) => {
        const title = lines[src].title;
        let c = 0, j = src;
        while (j < lines.length && ((lines[j].type === 'divider' && lines[j].title === title) || lines[j].type === 'row')) { j++; c++; }
        return c;
      }
    );
  });

  // 이미지 슬라이드 드래그
  document.querySelectorAll(`#${containerId} .cl-image`).forEach(el => {
    wireGroup(
      el,
      el => +el.dataset.idx,
      (_lines, _src) => 1
    );
  });

  // 페이지 순서 변경 드래그 (같은 그룹 내)
  document.querySelectorAll(`#${containerId} .cl-slide-item[data-div-idx]`).forEach(el => {
    const handle = el.querySelector('.cl-page-handle');
    if (!handle) return;
    handle.addEventListener('mousedown', () => el.setAttribute('draggable', 'true'));
    handle.addEventListener('mouseup',   () => el.setAttribute('draggable', 'false'));
    el.addEventListener('dragstart', e => {
      ceDragSrcIdx = +el.dataset.divIdx;
      ceDragSrcTarget = target;
      el.classList.add('dragging');
      e.stopPropagation();
    });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); el.setAttribute('draggable', 'false'); });
    el.addEventListener('dragover', e => e.preventDefault());
    el.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation();
      if (ceDragSrcTarget !== target) return;
      const lines = ceLinesFor(target);
      const srcDiv = ceDragSrcIdx, dstDiv = +el.dataset.divIdx;
      if (srcDiv === null || srcDiv === dstDiv) return;
      let srcCount = 1;
      while (srcDiv + srcCount < lines.length && lines[srcDiv + srcCount].type === 'row') srcCount++;
      const moved = lines.splice(srcDiv, srcCount);
      lines.splice(srcDiv < dstDiv ? dstDiv - srcCount : dstDiv, 0, ...moved);
      ceDragSrcIdx = null;
      ceRenderContentLines(target); ceRenderPreview();
    });
  });
}

// ── Opening Question 폼 (안내 문구 = 질문 하나만) ──
// 사료처럼 양끝 따옴표 + Paperlogy 굵게로 질문만 크게 띄우므로, 질문 한 칸만 받는다.
function ceRenderDiveForm() {
  const d = ceCd.dive;
  const el = document.getElementById('dive-form');
  // 토글: 질문 내용이 있을 때만 활성. 없으면 비활성 표시.
  const hasContent = !!(d.guide || d.title || d.img != null);
  const tog = document.getElementById('opening-toggle');
  if (tog) {
    tog.classList.toggle('on', d.openingEnabled !== false && hasContent);
    tog.classList.toggle('disabled', !hasContent);
  }
  el.innerHTML = ceFTextarea('질문', d.guide || d.title || '', `updateDive('guide',this.value)`, 3, '사료처럼 큰 따옴표와 함께 크게 표시됩니다.');
  ceRenderChosungForm();
}
function updateDive(f,v){ ceCd.dive[f]=v; ceRenderPreview(); }
function updateDiveImg(v){ ceCd.dive.img = v.trim()==='' ? null : +v; ceRenderPreview(); }
function toggleOpeningEnabled() {
  const d = ceCd.dive;
  if (!(d.title || d.guide || d.img != null)) return; // 내용 없으면 토글 비활성
  updateOpeningEnabled(!(d.openingEnabled !== false));
}
function updateOpeningEnabled(v) { ceCd.dive.openingEnabled = v; ceRenderDiveForm(); ceRenderPreview(); }

function ceRenderChosungForm() {
  const d = ceCd.dive;
  const tog = document.getElementById('chosung-toggle');
  if (tog) tog.classList.toggle('on', !!d.chosungEnabled);
  const el = document.getElementById('chosung-form');
  el.innerHTML = d.chosungEnabled
    ? ceFTextarea('초성 퀴즈 항목', d.chosungItems.join('\n'), `updateChosungItems(this.value)`, 4, '한 줄 = 항목 하나, 학습 목표 슬라이드와 같은 번호 목록으로 표시됩니다.')
    : '';
}
function toggleChosungEnabled()  { updateChosungEnabled(!ceCd.dive.chosungEnabled); }
function updateChosungEnabled(v) { ceCd.dive.chosungEnabled = v; ceRenderChosungForm(); ceRenderPreview(); }
function updateChosungItems(v)   { ceCd.dive.chosungItems = v.split('\n').filter(s=>s.trim()!==''); ceRenderPreview(); }

// ── 생각 Check 폼 ──
function ceRenderThinkForm() {
  const t = ceCd.think;
  const el = document.getElementById('think-form');
  el.innerHTML = `
    ${ceFTextarea('오늘의 질문', t.question, `updateThink('question',this.value)`, 3)}
    ${ceFTextarea('안내 문구', t.guide, `updateThink('guide',this.value)`, 3)}`;
}
function updateThink(f,v){ ceCd.think[f]=v; ceRenderPreview(); }

function ceFInputInline(label, val, handler) {
  return `<div class="field-inline"><label class="field-inline-label">${label}</label><input class="field-input" type="text" value="${esc(val)}" oninput="${handler}"></div>`;
}
function ceFTextarea(label, val, handler, rows=2, hint='') {
  const h = hint ? ` <span class="field-hint">${hint}</span>` : '';
  return `<div class="field-group"><div class="field-label">${label}${h}</div><textarea class="field-input" rows="${rows}" oninput="${handler};autoResizeTa(this)">${esc(val)}</textarea></div>`;
}

// ceCd({lesson, contentLines, think})를 현재 강의의 Firestore 문서에 그대로 저장.
// 슬라이드 화면(lecture.html)은 이 content 필드를 읽어서 SlideRender.buildSlidesFromData로
// 직접 slides를 만들기 때문에, 여기서 slides를 미리 계산해서 같이 저장할 필요는 없다.
async function ceSaveContentToFirestore(docId, cd) {
  await updateDoc(doc(db, LIB, docId), {
    lessonNo: cd.lesson.num,
    title: cd.lesson.title,
    unit: cd.lesson.unit,
    content: { lesson: cd.lesson, dive: cd.dive, contentLines: cd.contentLines, mission: cd.mission, think: cd.think }
  });
}

async function saveContent() {
  ['concept', 'mission'].forEach(target => {
    document.querySelectorAll(`#${ceContainerIdFor(target)} .cl-opt-labelpos`).forEach(cb => {
      const item = cb.closest('[data-div-idx]');
      if (!item) return;
      const line = ceLinesFor(target)[+item.dataset.divIdx];
      if (!line) return;
      if (cb.checked) line.labelPos = 'left';
      else delete line.labelPos;
    });
  });
  const lesson = ceLessonsCache.find(l => l.num === ceCurrentLessonNum);
  if (!lesson) return;
  await ceSaveContentToFirestore(lesson.docId, ceCd);
  await ceGetLessonsFromFirestore();
  ceCurrentLessonNum = ceCd.lesson.num;
  cePopulateLessonSelect();
  ceShowToast('toast-content');
}

async function resetContent() {
  if (!await confirmAsk('내용 초기화', '이 강의의 슬라이드 내용을 비웁니다.', true)) return;
  const lesson = ceLessonsCache.find(l => l.num === ceCurrentLessonNum);
  if (lesson) {
    await updateDoc(doc(db, LIB, lesson.docId), { content: null });
    await ceGetLessonsFromFirestore();
  }
  ceLoadLessonData(ceCurrentLessonNum);
}

// ── 활동지 파일(hwpx/pdf) 업로드로 새 강의 자동 생성 ──
// hwpx는 zip 안의 Preview/PrvText.txt(한글이 검색 색인용으로 만들어두는 순수 텍스트)를
// 우선 사용하고, 없으면 Contents/section*.xml에서 태그만 제거해 텍스트를 뽑아낸다.
// pdf는 텍스트 추출 없이 파일 그대로 Claude에 문서로 전달한다(Claude가 PDF를 직접 읽을 수 있음).
async function ceExtractHwpxText(file) {
  const zip = await JSZip.loadAsync(file);
  // Preview/PrvText.txt는 한글이 미리보기·검색 색인용으로 만드는 요약 텍스트라
  // 문서가 길면 중간에서 잘려 있을 수 있다. 전체 본문이 들어있는 section*.xml을
  // 먼저 시도하고, 그게 비어 있을 때만 PrvText.txt로 대체한다.
  const sectionNames = Object.keys(zip.files)
    .filter(n => /^Contents\/section\d+\.xml$/.test(n))
    .sort();
  let text = '';
  for (const name of sectionNames) {
    const xml = await zip.file(name).async('string');
    text += xml.replace(/<[^>]+>/g, '\n').replace(/\n{2,}/g, '\n') + '\n';
  }
  if (text.trim()) return text;

  const preview = zip.file('Preview/PrvText.txt');
  if (preview) {
    const previewText = await preview.async('string');
    if (previewText.trim()) return previewText;
  }
  return text;
}

function ceFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const CE_LESSON_JSON_SCHEMA = `{
  "lesson": { "title": "수업 제목", "unit": "학습 단원 (예: Ⅲ-4. 고려의 생활과 문화)", "page": "교과서 페이지", "objectives": ["학습 목표 문장(번호 없이)", "..."] },
  "dive": { "title": "", "guide": "수업 여는 질문(Opening Question) 문장 하나 (없으면 빈 문자열)" },
  "chosungItems": ["초성 퀴즈 문제/정답 한 줄(번호 없이) (초성 퀴즈가 없으면 빈 배열)", "..."],
  "conceptContentLines": [
    { "type": "divider", "title": "슬라이드 제목" },
    { "type": "row", "label": "회색 칸(행 라벨) 텍스트", "items": ["원문자(①②③) 단위 항목. 하위 a.b.c. 줄은 <br>로 이어붙임", "..."] },
    { "type": "divider", "title": "전체 슬라이드 제목", "format": "quote", "quoteLabel": "사료 소제목((가)/① 등, 없으면 빈 문자열)", "quoteText": "사료 원문 텍스트 (빈칸은 {정답} 표기)", "quoteSource": "출처 (예: 「삼국사기」)" }
  ],
  "missionContentLines": [
    { "type": "divider", "title": "슬라이드 제목" },
    { "type": "row", "label": "회색 칸(행 라벨) 텍스트", "items": ["원문자(①②③) 단위 항목. 하위 a.b.c. 줄은 <br>로 이어붙임", "..."] },
    { "type": "divider", "title": "전체 슬라이드 제목", "format": "quote", "quoteLabel": "사료 소제목((가)/① 등, 없으면 빈 문자열)", "quoteText": "사료 원문 텍스트 (빈칸은 {정답} 표기)", "quoteSource": "출처 (예: 「삼국사기」)" }
  ],
  "think": { "question": "오늘의 생각 질문", "guide": "답변 안내 문구" }
}`;

const CE_LESSON_JSON_INSTRUCTION = `다음은 중학교 역사 수업 활동지 내용이다. 이 내용을 아래 JSON 스키마로 옮겨 적어줘.

가장 중요한 원칙: 이건 활동지를 그대로 옮기는 "전사" 작업이다. 활동지에 없는 문장·설명·예시·학습 목표를 새로 만들어서 추가하지 마라. 활동지에 적힌 텍스트만 그대로 옮겨라. 아래 "빈칸 채우기"만 유일한 예외다(빈칸에 들어갈 정답을 채워 넣는 것).

활동지 내용은 성격에 따라 나눠 담아야 한다:
- dive(Opening Question): 수업을 여는 질문. 활동지에 "오프닝 퀘스천" 또는 수업 시작 질문이 있으면 그 질문 문장을 guide에 담아라(질문 하나만, 따옴표 없이). title은 빈 문자열("")로 둔다. 이런 질문이 없으면 guide도 빈 문자열로 둔다.
- chosungItems: 활동지에 초성 퀴즈(예: ㄱㄴㄷ으로 단어 맞히기)가 있으면 문제를 한 줄씩 배열로 그대로 옮겨라. 없으면 빈 배열로 둬라.
- conceptContentLines: 개념 설명, 빈칸 채우기, 용어 정리 등 "배우는" 내용.
- missionContentLines: 학생이 직접 해보는 활동·과제·퀘스트·게임형 미션 내용.
- think: 수업 마무리에 학생 스스로 생각해서 답하는 서술형 질문.

conceptContentLines·missionContentLines 규칙 (정확히 지켜라. 표 하나를 예로 설명한다):
활동지의 표는 왼쪽에 회색(음영) 칸, 오른쪽에 실제 내용이 있는 구조다.
- 회색 칸 하나(행 라벨, 예: "1. 태조")가 슬라이드 하나에 대응한다. 회색 칸이 바뀔 때마다 반드시 새로 {"type":"divider","title":"..."}를 만들고 바로 뒤에 row 하나를 배치해라. 구분선 1개 + row 1개가 항상 짝을 이뤄 반복돼야 한다 — 회색 칸이 여러 개면 divider도 그 개수만큼 반복해서 각각 넣어라. 절대 두 개 이상의 row를 하나의 divider 아래 연달아 두지 마라.
- divider의 title은 그 표가 속한 절/구역의 부제목(활동지에서 "개념 체크" 뒤에 적힌 소제목)을 그대로 옮겨 적어라. 같은 부제 아래 회색 칸이 여러 개면 그 부제를 각 슬라이드 title에 반복해서 써라.
- row의 label은 회색 칸에 적힌 텍스트를 그대로 옮겨라.
- row의 items 배열은 원문자(①②③...) 단위로 하나씩 나눠 담아라 — ①로 시작하는 내용 전체가 items의 원소 하나, ②로 시작하는 내용이 다음 원소, 이런 식이다.
- 원문자 뒤에 a. b. c. 같은 하위 글자 목록이나 "→"로 이어지는 줄이 붙어 있으면, 그 하위 줄들은 새 item으로 쪼개지 말고 같은 item 문자열 안에 <br>로 이어붙여서 한 줄씩 표시되게 해라. (예: "① 건국 과정 : a. {이성계} : {위화도 회군} 이후 정권 장악<br>b. {과전법} 실시(1391) : 경기 지역의 토지에 한해 관직 복무 대가로 {수조권} 지급<br>c. 국가 통치 이념으로 {성리학}을 내세우고, {온건파} 사대부를 숙청 → {조선} 건국(1392)") <br> 태그는 한 번에 하나씩만 써라(<br><br> 같은 중복 금지).
- 빈칸 처리: 활동지에 실제로 비어 있는 칸(밑줄 ___, 괄호 ( ), ○○, 네모칸 등 학생이 채워 넣도록 비워 둔 자리)에 대해서만 정답을 중괄호 한 겹으로 감싸라: {정답}. 이미 인쇄되어 있는(비어 있지 않은) 단어·문장은 그게 정답에 해당하더라도 절대 {}로 감싸지 마라 — 원문 그대로 둬라. 즉 원래 빈칸이 아닌 것을 빈칸으로 만들면 안 된다. 중괄호를 두 겹({{정답}})으로 쓰지 마라 — 항상 한 겹만. 빈칸의 정답을 확신할 수 없으면 빈칸 표시 없이 원문 그대로 둬라(추측해서 틀린 답을 넣지 마라).
- 빈칸을 채우는 것 외에는 원문에 있는 문구를 고치거나 다듬지 말고 그대로 옮겨라.
- 활동지에 점선 테두리 박스(사료 인용)가 있으면 {"type":"divider","title":"슬라이드 제목","format":"quote","quoteText":"박스 안 원문","quoteSource":"출처(있을 경우)"} 형식으로 표현해라. 이 경우 row를 추가하지 않는다.
  - 사료 title/quoteLabel 규칙: title에는 그 사료가 속한 "전체 슬라이드 제목"(활동지의 구역·소단원 제목, 예: "사료를 통해 바라본 조선 초기 국왕들의 모습")을 넣어라. 같은 구역에 속한 여러 사료는 title을 똑같이 맞춰라(그래야 한 묶음으로 표시된다). 사료 앞에 (가)/(나)/(다) 또는 ①/②/③ 같은 글머리 기호(그 뒤에 소제목이 붙어 있으면 소제목까지)가 있으면 그 부분을 quoteLabel에 넣고 quoteText에서는 뺀다. 예: 구역 제목 "…국왕들의 모습" 아래 "(가) 조선의 통치제도\n의정부의 여러 일을…" → title="…국왕들의 모습", quoteLabel="(가) 조선의 통치제도", quoteText="의정부의 여러 일을…". 글머리 기호가 없으면 quoteLabel은 빈 문자열("")로 둔다.
- 표 안의 그림·도식은 텍스트로 옮길 수 없으면 생략해도 된다.
- 해당하는 내용이 활동지에 없으면 빈 배열 []로 둬라.

- objectives(학습 목표)와 chosungItems(초성 퀴즈 항목)는 화면에 표시할 때 자동으로 번호가 매겨지므로, 활동지에 적힌 번호(1. / ① / 가. 등)는 결과에 포함하지 말고 번호를 뗀 내용만 적어라.
- 학습 목표가 활동지에 명시적으로 적혀 있지 않으면 objectives를 빈 배열로 둬라. 추측해서 만들어내지 마라.
- 다른 설명 없이 아래 스키마와 동일한 구조의 JSON만 출력해줘.

스키마:
${CE_LESSON_JSON_SCHEMA}

활동지 내용:
`;

async function ceRequestLessonJson(content) {
  const messageContent = typeof content === 'string'
    ? [{ type: 'text', text: CE_LESSON_JSON_INSTRUCTION + content }]
    : [
        { type: 'text', text: CE_LESSON_JSON_INSTRUCTION },
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: content.data } }
      ];
  const res = await fetch(CLAUDE_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ model:'claude-opus-4-8', max_tokens:16000, messages:[{ role:'user', content: messageContent }] })
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch(e) {}
    throw new Error(`API 오류 ${res.status}${detail ? ' - ' + detail : ''}`);
  }
  const data = await res.json();
  if (data.stop_reason === 'max_tokens') {
    throw new Error('활동지 내용이 길어서 응답이 중간에 잘렸습니다. 활동지를 나눠서 올려주세요.');
  }
  const raw = (data.content?.[0]?.text || '').replace(/```json|```/g,'').trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI 응답에서 JSON을 찾을 수 없습니다.');
  return ceSanitizeParsedLesson(JSON.parse(jsonMatch[0]));
}

// AI가 프롬프트를 어기고 실수하는 것들을 코드에서 한 번 더 바로잡는다:
// 1) 강조 중괄호를 {{정답}}처럼 두 겹으로 쓰는 경우 -> {정답}로 축소
// 2) 하위 글자 목록(a. b. c.) 앞에 <br>을 빼먹은 경우 -> 자동으로 끼워 넣고, <br>이 중복된 경우 하나로 정리
// 3) 회색 칸(행)마다 새 divider를 안 만들고 여러 row를 divider 하나에 몰아넣은 경우 -> row 앞에 divider가 없으면 자동으로 끼워 넣어서 슬라이드를 분리
// 4) 학습 목표·초성 퀴즈 앞에 번호(1. / ① 등)가 남아있는 경우 -> 제거(화면에서 자동으로 번호가 붙으므로)
function ceSanitizeParsedLesson(d) {
  const fixBraces = s => typeof s === 'string' ? s.replace(/\{{2,}/g, '{').replace(/\}{2,}/g, '}') : s;
  const fixBreaks = s => {
    if (typeof s !== 'string') return s;
    let out = fixBraces(s).replace(/(<br\s*\/?>|<\/br>)+/gi, '<br>');
    // b. c. d. ...(a.는 제외 — 항상 첫 하위 항목이라 앞에 줄바꿈이 필요 없음) 앞에
    // <br>이 빠져 있으면 자동으로 끼워 넣는다.
    out = out.replace(/(?<!<br>)\s+([b-z]\.\s)/g, '<br>$1');
    return out;
  };
  const stripLeadingNumber = s => typeof s === 'string'
    ? s.replace(/^\s*(?:[0-9]+[.)]|[①-⑳])\s*/, '')
    : s;
  const fixLines = lines => (lines || []).map(line => {
    if (line.type === 'row') return { ...line, label: fixBraces(line.label) || '', items: (line.items||[]).map(fixBreaks) };
    if (line.type === 'divider') {
      const out = { ...line, title: fixBraces(line.title) || '' };
      // 사료 인용(quote) 슬라이드가 아니면 quoteText/quoteSource 키 자체가 없다.
      // 없는 값에 fix 함수를 돌리면 undefined가 생겨 Firestore 저장이 실패하므로, 있을 때만 넣는다.
      if (line.quoteText   !== undefined) out.quoteText   = fixBreaks(line.quoteText);
      if (line.quoteSource !== undefined) out.quoteSource = fixBraces(line.quoteSource);
      if (line.quoteLabel  !== undefined) out.quoteLabel  = fixBraces(line.quoteLabel);
      if (line.noticeText  !== undefined) out.noticeText  = fixBreaks(line.noticeText);
      return out;
    }
    return line;
  });
  // 행(row) 하나 = 슬라이드 하나가 기본값이므로, row 앞에 divider가 없으면 자동으로 끼워 넣는다.
  const enforceOnePerSlide = lines => {
    const out = [];
    let lastTitle = '';
    let prevWasDivider = false;
    for (const line of fixLines(lines)) {
      if (line.type === 'divider') {
        lastTitle = line.title || lastTitle;
        out.push(line);
        prevWasDivider = true;
      } else if (line.type === 'row') {
        if (!prevWasDivider) out.push({ type: 'divider', title: lastTitle });
        out.push(line);
        prevWasDivider = false;
      } else {
        out.push(line);
        prevWasDivider = false;
      }
    }
    return out;
  };
  // enforceOnePerSlide 뒤에 남는 "빈 divider"(뒤에 행도 없고 사료 텍스트·이미지·특수형식 데이터도 없이
  // 제목만 있는 슬라이드)를 제거한다. AI가 사료 앞에 구역 제목용 빈 divider를 하나 더 만들어
  // 빈 페이지가 생기던 것을 막는다.
  const dropEmptyDividers = lines => lines.filter((line, k) => {
    if (line.type !== 'divider') return true;
    const next = lines[k + 1];
    if (next && next.type === 'row') return true;   // 뒤에 행이 있으면 내용 있음
    if (line.img != null) return true;              // 이미지 있음
    const fmt = line.format;
    if (fmt === 'notice') return !!(line.noticeText && line.noticeText.trim());
    if (fmt === 'cols') return !!(line.colsTitle && line.colsTitle.trim()) || (line.cols || []).some(c => (c.head && c.head.trim()) || (c.body && c.body.trim()));
    if (fmt === 'quote') return !!(line.quoteText && line.quoteText.trim());
    if (fmt === 'timeline-h' || fmt === 'timeline-v') return (line.events || []).length > 0;
    if (fmt === 'compare') return (((line.left && line.left.items) || []).length + ((line.right && line.right.items) || []).length) > 0;
    if (fmt === 'flow-h' || fmt === 'flow-v') return (line.stages || []).length > 0;
    if (line.quoteText && line.quoteText.trim()) return true;  // rows + 하단 사료만 있는 페이지
    // rows + 중앙 나열 블록만 있는 페이지도 내용 있음
    if ((line.bottomCols || []).some(c => (c.head && c.head.trim()) || (c.body && c.body.trim()))) return true;
    if ((line.bottomColsTitle || '').trim()) return true;
    return false;                                   // rows 형식인데 뒤에 행 없음 → 빈 슬라이드, 제거
  });
  if (d.conceptContentLines) d.conceptContentLines = dropEmptyDividers(enforceOnePerSlide(d.conceptContentLines));
  if (d.missionContentLines) d.missionContentLines = dropEmptyDividers(enforceOnePerSlide(d.missionContentLines));
  if (d.dive) { d.dive.title = fixBraces(d.dive.title); d.dive.guide = fixBraces(d.dive.guide); }
  if (d.lesson?.objectives) d.lesson.objectives = d.lesson.objectives.map(stripLeadingNumber);
  if (d.chosungItems) d.chosungItems = d.chosungItems.map(s => stripLeadingNumber(fixBraces(s)));
  if (d.think) { d.think.question = fixBraces(d.think.question); d.think.guide = fixBraces(d.think.guide); }
  return d;
}

// Firestore는 undefined 필드를 거부한다. AI 응답에서 넘어온 객체/배열을 재귀적으로 훑어 undefined 값을 제거한다(안전망).
function ceStripUndefined(v) {
  if (Array.isArray(v)) return v.map(ceStripUndefined);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k in v) if (v[k] !== undefined) o[k] = ceStripUndefined(v[k]);
    return o;
  }
  return v;
}

function ceValidateParsedLesson(d) {
  const validLines = ls => Array.isArray(ls) && ls.every(l => l && (l.type==='divider'||l.type==='row'||l.type==='image'));
  return !!d && d.lesson && typeof d.lesson === 'object'
    && Array.isArray(d.lesson.objectives)
    && validLines(d.conceptContentLines)
    && validLines(d.missionContentLines)
    && d.dive && typeof d.dive === 'object'
    && Array.isArray(d.chosungItems)
    && d.think && typeof d.think === 'object';
}

async function ceHandleFileUpload(file) {
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  const statusEl = document.getElementById('ce-file-status');
  const btnEl = document.getElementById('ce-file-btn');
  const inputEl = document.getElementById('ce-file-input');
  if (ext !== 'hwpx' && ext !== 'pdf') {
    notify('.hwpx 또는 .pdf 파일만 됩니다.');
    inputEl.value = '';
    return;
  }

  // 파일명에 보통 "24. 제목" 또는 "24강 …"처럼 강 번호가 들어 있으므로 자동으로 뽑아 쓴다. 못 찾을 때만 직접 입력받는다.
  const base = file.name.replace(/\.[^.]+$/, ''); // 확장자 제거
  // "N강" 우선, 없으면 맨 앞 숫자(구분자 . ) 공백 전각마침표 등 무관)를 강 번호로 사용
  const m = base.match(/(\d+)\s*강/) || base.match(/^\s*(\d+)/);
  let num = m ? m[1] : '';
  if (!num) {
    const v = await ask({
      title: '강 번호 입력',
      body: '파일 이름에서 강 번호를 찾지 못했습니다.',
      fields: [{ key: 'num', type: 'text', placeholder: '강 번호 (예: 24)', suffix: '강' }],
      check: v => v.num ? '' : '강 번호를 입력해 주세요.',
    });
    num = v ? v.num : '';
    if (!num) { inputEl.value = ''; return; }
  }
  if (ceLessonsCache.find(l => l.num === num)) { notify(`${lecTag(num)}는 이미 있습니다.`); inputEl.value = ''; return; }

  btnEl.disabled = true;
  if (statusEl) statusEl.textContent = '파일을 읽고 있습니다. 1분쯤 걸릴 수 있습니다.';

  try {
    let parsed;
    if (ext === 'hwpx') {
      const text = await ceExtractHwpxText(file);
      if (!text.trim()) throw new Error('파일에서 텍스트를 찾지 못했습니다.');
      parsed = await ceRequestLessonJson(text);
    } else {
      const base64 = await ceFileToBase64(file);
      parsed = await ceRequestLessonJson({ data: base64 });
    }
    if (!ceValidateParsedLesson(parsed)) throw new Error('AI 응답 구조가 올바르지 않습니다.');

    const order = lecOrderKey(num); // 강 번호 기준(큰 번호가 위)
    const content = {
      lesson: {
        num, title: parsed.lesson.title || '새 강의', unit: parsed.lesson.unit || '', page: parsed.lesson.page || '',
        objectives: parsed.lesson.objectives.length ? parsed.lesson.objectives : ['학습 목표를 입력하세요']
      },
      dive: {
        title: parsed.dive.title || '', guide: parsed.dive.guide || '',
        chosungEnabled: parsed.chosungItems.length > 0, chosungItems: parsed.chosungItems
      },
      contentLines: parsed.conceptContentLines,
      mission: { contentLines: parsed.missionContentLines },
      think: { question: parsed.think.question || '', guide: parsed.think.guide || '' }
    };
    await addDoc(collection(db, LIB), ceStripUndefined({
      lessonNo: num, title: content.lesson.title, unit: content.lesson.unit, order, isOpen: false, content,
      createdAt: serverTimestamp()
    }));
    await ceGetLessonsFromFirestore();
    ceCurrentLessonNum = num;
    cePopulateLessonSelect();
    renderCeLessonOrder();
    ceLoadLessonData(num);
    const area = document.getElementById('ce-editor-area');
    if (area) area.style.display = '';
    const prevBtn2 = document.getElementById('ce-preview-btn');
    if (prevBtn2) prevBtn2.style.display = '';
    if (statusEl) statusEl.textContent = '만들었습니다. 내용을 확인하고 저장해 주세요.';
  } catch (e) {
    if (statusEl) statusEl.textContent = '';
    notify('강의를 만들지 못했습니다. ' + e.message);
  } finally {
    btnEl.disabled = false;
    inputEl.value = '';
  }
}

// 예시 슬라이드 미리보기 (개념 Check 슬라이드 1개, 없으면 표지)
// 실제 페이지(lesson.html)와 완전히 동일한 slide-render.js로 그려서 미리보기와
// 실제 화면이 항상 100% 일치하도록 한다.
function ceRenderPreview(pickSample) {
  const inner = document.getElementById('design-pv-inner');
  if (!inner || !ceCd.contentLines) return;
  // 슬라이드 폰트가 아직 안 받아졌으면 초성 퀴즈 쪽 나눔이 대체 폰트 기준으로 잡힌다.
  // 처음 한 번만 기다렸다가 다시 그린다(그 뒤로는 즉시 통과).
  if (!ceFontsReady) {
    SlideRender.ensureSlideFonts().then(() => { ceFontsReady = true; ceRenderPreview(pickSample); });
    return;
  }
  const slides = SlideRender.buildSlidesFromData(ceCd);
  const sample = pickSample ? pickSample(slides) : (slides.find(s => s.type === 'concept') || slides[0]);
  inner.innerHTML = SlideRender.renderSlideHTML(sample, ceCd.lesson);
  // 미리보기에서는 영상이 바로 보이도록 iframe src를 채운다(발표 화면은 lecture.html이 관리).
  inner.querySelectorAll('iframe[data-vsrc]').forEach(f => f.setAttribute('src', f.dataset.vsrc));
  SlideRender.wireLightbox(inner);
  ceApplyDesignPreview();
  requestAnimationFrame(rescalePreview);
}

// ── 유틸 ──
function ceDeepCopy(o) { return JSON.parse(JSON.stringify(o)); }
function ceDeepMerge(def, src) {
  const r = ceDeepCopy(def);
  for (const k in src) {
    if (src[k] !== null && typeof src[k] === 'object' && !Array.isArray(src[k])) {
      r[k] = ceDeepMerge(def[k] || {}, src[k]);
    } else { r[k] = src[k]; }
  }
  return r;
}

let ceToastTimers = {};
function ceShowToast(id) {
  const el = document.getElementById(id);
  el.classList.add('show');
  clearTimeout(ceToastTimers[id]);
  ceToastTimers[id] = setTimeout(() => el.classList.remove('show'), 2500);
}
