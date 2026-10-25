/* 2027 LMS 학생 화면
 *
 * 로그인은 2026 lms/index.js의 동작을 그대로 옮겼다(선생님 지시).
 * 같은 것:
 *   - 입력 중에는 학번과 이름의 일치 여부를 표시하지 않고 조용히 대조만 한다.
 *     맞을 때만 비밀번호 안내(설정 또는 입력)를 띄우고, 에러는 [입장하기]에서만 낸다.
 *   - 비밀번호는 SHA-256(학번 소금) 해시. 처음이면 4자 이상으로 설정하게 한다.
 *   - 자동 로그인 카드(localStorage), 개인정보 동의 팝업, 비밀번호 초기화 안내,
 *     홈 화면에 추가 버튼과 iOS 안내 시트.
 * 달라진 것:
 *   - 명단을 찾는 곳. 2026은 RTDB 명단 하나를 봤고 지금은 그 해 개설된 반들의
 *     명단에서 찾는다(반이 1년 단위이므로). 학번과 함께 어느 반인지도 나온다.
 *   - 비밀번호와 동의 문서 id에 반이 들어간다. 해가 바뀌어도 같은 학번이
 *     작년 비밀번호를 물려받지 않는다.
 *
 * 메뉴 구성(개념, 미션, 생각, 성적, 콘텐츠, 경험치)은 2026과 같다. 어드민이
 * 반별 또는 메뉴별로 관리하는 대상이 이 칸들이며, 양쪽이 같은 MENUS 표(model.js)를
 * 읽으므로 한쪽만 늘어나는 일이 없다.
 *
 * 아직 안 옮긴 것: 각 메뉴의 실제 내용, 공지, 뽑기, 경험치.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./shared/firebase-config.js";
import { icon } from "./shared/icons.js?v=20260918";
import {
  MENUS, schoolYear, courseLabel, getCourse, loadYearRoster, clearRosterCache,
  getAuthHash, setPw, hashPw, isHash, hasConsent, saveConsent,
  listCourseLessons, lessonTag
} from "./model.js?v=20261023c";

// 여기까지 왔으면 모듈은 다 받았다. 디자인(index.css)도 들어왔는지 확인해서 본문을 연다.
// 디자인이 빠졌으면 깨진 화면 대신 새로고침 안내를 띄운다(index.html의 bootFail).
if (getComputedStyle(document.documentElement).getPropertyValue('--lms-css-ok').trim() === '1') {
  document.documentElement.classList.add('lms-ready');
} else {
  document.documentElement.classList.add('lms-fail');
}

const app = initializeApp(firebaseConfig);
// getFirestore(app) 대신 initializeFirestore로 여는 이유 —
// iOS 사파리(특히 홈 화면에 추가한 standalone)나 학교 와이파이 프록시 조합에서
// WebChannel 스트리밍이 열린 채 멈춰 쓰기가 영영 pending으로 남는 일이 있다.
// autoDetectLongPolling을 켜면 막히는 환경에서 롱폴링으로 자동 전환한다.
// 2026 lms에서 실제로 겪은 문제라 처음부터 켜 둔다.
const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function mountIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => {
    el.innerHTML = icon(el.dataset.icon, el.dataset.iconSize ? +el.dataset.iconSize : 24);
  });
}
mountIcons();

/* ── 상태 ── */

const idInput    = $('idInput');
const nameInput  = $('nameInput');
const pwInput    = $('pwInput');
const enterBtn   = $('enterBtn');
const statusArea = $('statusArea');

let _roster = {};                  // 학번 -> { name, courseId }
let _rosterLoaded = false;
let _matched = false;              // 학번과 이름이 명단과 조용히 일치하는지(에러는 표시하지 않음)
let _hit = null;                   // 맞았을 때 { studentNo, name, courseId }
let _hasPw = false, _storedPw = null, _pwChecked = false, _pwAttemptFailed = false;
let _pwLookupToken = 0;            // 입력이 바뀌면 이전 비밀번호 조회 결과를 무시

let currentStudentId   = sessionStorage.getItem('lms_sid')   || '';
let currentStudentName = sessionStorage.getItem('lms_sname') || '';
let currentCourseId    = sessionStorage.getItem('lms_cid')   || '';

const _savedSid   = localStorage.getItem('lms_autosave_sid');
const _savedSname = localStorage.getItem('lms_autosave_sname');
const _savedCid   = localStorage.getItem('lms_autosave_cid');

/* ── 명단 ──
   2026은 shared/auth.js가 RTDB 명단을 24시간 캐시했다. 여기서는 그 해 반들의
   명단을 같은 방식으로 캐시한다(model.js의 loadYearRoster). */
async function initRoster() {
  try {
    _roster = await loadYearRoster(db, schoolYear());
  } catch (e) {
    console.warn('[roster]', e);
    _roster = {};
  }
  _rosterLoaded = true;
  refreshCreds();   // 명단이 로그인 화면보다 늦게 와도 한 번 다시 대조한다
}

const lookupRoster = no => _roster[String(no).trim()] || null;

/* ── 로그인 ── */

async function pwMatches(input, stored, salt) {
  if (stored == null) return false;
  // 새 컬렉션이라 평문으로 들어간 값은 없지만, 2026의 판정 모양을 그대로 둔다.
  return isHash(stored) ? (await hashPw(input, salt)) === stored : input === stored;
}

function setStatusLine(line) {
  statusArea.innerHTML = line
    ? `<div class="status-line ${line.type}"><span class="status-icon">${icon(line.icon, 16)}</span>${esc(line.text)}</div>`
    : '';
}

function updateLoginUI() {
  let line = null;
  if (_matched && _pwChecked) {
    if (_hasPw) {
      line = _pwAttemptFailed
        ? { type: 'err',  icon: 'x',    text: '비밀번호가 틀렸습니다. 다시 입력해 주세요.' }
        : { type: 'info', icon: 'lock', text: '비밀번호를 입력하세요.' };
    } else {
      line = { type: 'ok', icon: 'check', text: '처음이시네요! 사용할 비밀번호를 설정하세요 (4자 이상).' };
    }
  } else if (_matched && !_pwChecked) {
    line = { type: 'muted', icon: 'hourglass', text: '확인 중' };
  }
  // 명단과 안 맞으면 아무것도 표시하지 않는다. 에러는 [입장하기]에서만 낸다.
  setStatusLine(line);
  pwInput.classList.toggle('error', _pwAttemptFailed);
  pwInput.disabled = !_matched;
  enterBtn.disabled = !(idInput.value.trim() && nameInput.value.trim());
}

// 조용한 명단 대조 + 비밀번호 존재 여부 조회
async function refreshCreds() {
  const no   = idInput.value.trim();
  const name = nameInput.value.trim();
  _pwAttemptFailed = false;

  const found = /^\d{5}$/.test(no) ? lookupRoster(no) : null;
  _matched = !!(found && name && found.name === name);
  _hit = _matched ? { studentNo: no, name: found.name, courseId: found.courseId } : null;

  if (!_matched) {
    _pwChecked = false; _hasPw = false; _storedPw = null;
    pwInput.value = '';
    updateLoginUI();
    return;
  }

  const token = ++_pwLookupToken;
  _pwChecked = false;
  updateLoginUI();                       // "확인 중"
  let stored = null;
  try { stored = await getAuthHash(db, _hit.courseId, no); } catch (_) {}
  if (token !== _pwLookupToken) return;  // 그 사이 입력이 바뀌었으면 결과 무시
  _hasPw = !!stored; _storedPw = stored || null; _pwChecked = true;
  updateLoginUI();
}

idInput.addEventListener('input', () => {
  const v = idInput.value.replace(/\D/g, '');
  if (idInput.value !== v) idInput.value = v;
  refreshCreds();
});
nameInput.addEventListener('input', refreshCreds);
pwInput.addEventListener('input', () => { _pwAttemptFailed = false; updateLoginUI(); });

[idInput, nameInput, pwInput].forEach(el => {
  el.addEventListener('keydown', e => { if (e.key === 'Enter' && !enterBtn.disabled) enterBtn.click(); });
});

enterBtn.addEventListener('click', async () => {
  const no   = idInput.value.trim();
  const name = nameInput.value.trim();
  if (!no || !name) return;

  // 1) [입장하기]를 눌렀을 때만 명단을 검증하고 에러를 표시한다.
  if (!/^\d{5}$/.test(no)) {
    setStatusLine({ type: 'err', icon: 'x', text: '학번은 숫자 5자리입니다.' });
    return;
  }
  // 명단이 아직 안 왔으면 여기서 한 번 더 기다린다(캐시가 비어 있는 첫 방문).
  if (!_rosterLoaded) {
    setStatusLine({ type: 'muted', icon: 'hourglass', text: '명단을 불러오고 있습니다.' });
    try { _roster = await loadYearRoster(db, schoolYear()); _rosterLoaded = true; } catch (_) {}
  }
  const found = lookupRoster(no);
  if (!found) {
    // 반이 하나도 없으면 학번이 틀린 게 아니라 아직 개설 전일 수 있다.
    setStatusLine({ type: 'err', icon: 'x', text: Object.keys(_roster).length
      ? '학번 또는 이름을 확인해 주세요.'
      : '아직 개설된 반이 없습니다. 선생님께 문의해 주세요.' });
    return;
  }
  if (found.name !== name) {
    setStatusLine({ type: 'err', icon: 'x', text: '학번 또는 이름을 확인해 주세요.' });
    return;
  }
  const cid = found.courseId;
  const registeredName = found.name;

  // 2) 비밀번호 확인 또는 설정 (조회 결과가 아직이면 여기서 한 번 더 읽는다)
  let stored = _storedPw;
  if (!_pwChecked || !_hit || _hit.studentNo !== no) {
    try { stored = await getAuthHash(db, cid, no) || null; } catch (_) {}
  }
  const pw = pwInput.value;
  if (stored) {
    if (!(await pwMatches(pw, stored, no))) {
      _pwAttemptFailed = true; updateLoginUI(); pwInput.focus(); return;
    }
  } else {
    if (pw.length < 4) {
      setStatusLine({ type: 'err', icon: 'x', text: '비밀번호를 4자 이상으로 설정해 주세요.' });
      pwInput.focus(); return;
    }
    // 저장이 실패한 채 들여보내면 비밀번호 없는 계정이 남아 아무나 선점할 수 있다.
    try { await setPw(db, cid, no, pw); }
    catch (e) {
      console.warn('[setPw]', e);
      setStatusLine({ type: 'err', icon: 'x', text: '비밀번호를 저장하지 못했어요. 잠시 후 다시 눌러 주세요.' });
      return;
    }
  }

  // 3) 세션 저장 + 자동 로그인 + 진입 (첫 로그인이면 진입 흐름에서 개인정보 동의)
  sessionStorage.setItem('lms_sid',   no);
  sessionStorage.setItem('lms_sname', registeredName);
  sessionStorage.setItem('lms_cid',   cid);
  if ($('autosaveCheck')?.checked) {
    localStorage.setItem('lms_autosave_sid',   no);
    localStorage.setItem('lms_autosave_sname', registeredName);
    localStorage.setItem('lms_autosave_cid',   cid);
  } else {
    localStorage.removeItem('lms_autosave_sid');
    localStorage.removeItem('lms_autosave_sname');
    localStorage.removeItem('lms_autosave_cid');
  }
  currentStudentId = no; currentStudentName = registeredName; currentCourseId = cid;
  checkConsentThenEnter(cid, no, registeredName);
});

/* ── 자동 로그인 카드 ── */

if (currentStudentId && currentStudentName && currentCourseId) {
  checkConsentThenEnter(currentCourseId, currentStudentId, currentStudentName);
} else if (_savedSid && _savedSname && _savedCid) {
  $('autosaveAvatar').textContent    = _savedSname.charAt(0);
  $('autosaveName').textContent      = _savedSname;
  $('autosaveStudentId').textContent = `학번 ${_savedSid}`;
  $('autoSaveCard').style.display    = 'flex';
  $('normalLoginForm').style.display = 'none';
}

$('autoEnterBtn').addEventListener('click', () => {
  sessionStorage.setItem('lms_sid',   _savedSid);
  sessionStorage.setItem('lms_sname', _savedSname);
  sessionStorage.setItem('lms_cid',   _savedCid);
  currentStudentId = _savedSid; currentStudentName = _savedSname; currentCourseId = _savedCid;
  checkConsentThenEnter(_savedCid, _savedSid, _savedSname);
});

$('autosaveResetBtn').addEventListener('click', () => {
  localStorage.removeItem('lms_autosave_sid');
  localStorage.removeItem('lms_autosave_sname');
  localStorage.removeItem('lms_autosave_cid');
  $('autoSaveCard').style.display    = 'none';
  $('normalLoginForm').style.display = 'flex';
});

/* ── 비밀번호 초기화 안내 (학생 자가 재설정 없음, 교사만 초기화) ── */

$('forgotPwBtn').addEventListener('click', () => { $('pwResetHelpModal').style.display = 'flex'; });
$('pwHelpClose').addEventListener('click', () => { $('pwResetHelpModal').style.display = 'none'; });
$('pwResetHelpModal').addEventListener('click', e => {
  if (e.target.id === 'pwResetHelpModal') e.currentTarget.style.display = 'none';
});

/* ── 개인정보 동의 ── */

async function checkConsentThenEnter(cid, no, name) {
  try {
    if (await hasConsent(db, cid, no)) { enterHub(cid, no, name); return; }
  } catch (_) { enterHub(cid, no, name); return; }
  showConsentPopup(cid, no, name);
}

function showConsentPopup(cid, no, name) {
  $('loginScreen').style.display  = 'none';
  $('consentPopup').style.display = 'flex';
  $('consentAgreeBtn').onclick = async () => {
    try { await saveConsent(db, cid, no, name); } catch (_) {}
    $('consentPopup').style.display = 'none';
    enterHub(cid, no, name);
  };
  $('consentDenyBtn').onclick = () => {
    alert('개인정보 수집 및 이용에 동의하지 않으면 학습 공간을 이용할 수 없습니다.');
    $('consentPopup').style.display = 'none';
    $('loginScreen').style.display  = 'flex';
    sessionStorage.removeItem('lms_sid');
    sessionStorage.removeItem('lms_sname');
    sessionStorage.removeItem('lms_cid');
  };
}

/* ── 수업 홈 ── */

async function enterHub(cid, no, name) {
  $('loginScreen').style.display = 'none';
  $('courseScreen').hidden = false;
  $('chipStudent').textContent = `${no} ${name}`.trim();
  renderMenus();

  try {
    const course = await getCourse(db, cid);
    // 반이 지워졌거나 아카이브됐으면 더 들어가지 않는다(학년이 바뀌면 생기는 상황).
    if (!course || course.status === 'archived') {
      backToLogin('이 반은 더 이상 운영되지 않습니다. 선생님께 문의해 주세요.');
      return;
    }
    $('courseBadge').textContent = `${course.year}학년도`;
    $('courseTitle').textContent = courseLabel(course);
    renderLessons(await listCourseLessons(db, cid, { openOnly: true }));
  } catch (e) {
    console.warn('[enterHub]', e);
    $('lessonList').innerHTML =
      '<p class="empty">수업을 불러오지 못했습니다. 새로고침해 주세요.</p>';
  }
}

function backToLogin(message) {
  sessionStorage.removeItem('lms_sid');
  sessionStorage.removeItem('lms_sname');
  sessionStorage.removeItem('lms_cid');
  localStorage.removeItem('lms_autosave_sid');
  localStorage.removeItem('lms_autosave_sname');
  localStorage.removeItem('lms_autosave_cid');
  clearRosterCache();   // 반이 바뀌었으면 캐시도 낡았다
  $('courseScreen').hidden = true;
  $('autoSaveCard').style.display    = 'none';
  $('normalLoginForm').style.display = 'flex';
  $('loginScreen').style.display = 'flex';
  if (message) setStatusLine({ type: 'err', icon: 'x', text: message });
}

/* 메뉴 칸 — 아직 내용이 없는 메뉴는 "준비 중"으로 둔다. 빈 칸을 숨기지 않는 쪽을
   고른 것은, 어드민에서 메뉴별로 관리할 때 학생 화면에 무엇이 있는지가 한눈에
   보여야 하기 때문이다. */
function renderMenus() {
  $('menuGrid').innerHTML = MENUS.map(m => `
    <button type="button" class="menu-card" data-menu="${esc(m.key)}" disabled>
      <span class="menu-ic">${icon(m.icon, 22)}</span>
      <span class="menu-label">${esc(m.label)}</span>
      <span class="menu-state">준비 중</span>
    </button>`).join('');
}

function renderLessons(rows) {
  const box = $('lessonList');
  if (!rows.length) {
    box.innerHTML = '<p class="empty">아직 공개된 강의가 없습니다.</p>';
    return;
  }
  box.innerHTML = rows.map(r => `
    <div class="lesson">
      <span class="lesson-no">${esc(lessonTag(r.lessonNo))}</span>
      <span class="lesson-title">${esc(r.title || '제목 없음')}</span>
    </div>`).join('');
}

$('btnLogout').addEventListener('click', () => backToLogin(''));

/* ── 홈 화면에 추가 (PWA 설치) 버튼 ──
   안드로이드와 PC 크롬: beforeinstallprompt를 잡아 눌렀을 때 설치창을 바로 띄운다.
   iOS: 애플이 프롬프트를 막아 두어 공유 메뉴 안내 시트를 대신 띄운다. */
(function initInstallButton() {
  const btn = $('installBtn');
  if (!btn) return;
  // 이미 홈 화면 앱으로 실행 중이면 버튼을 숨긴다.
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  if (isStandalone) return;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    btn.style.display = 'flex';
  });
  window.addEventListener('appinstalled', () => { btn.style.display = 'none'; });

  // iOS는 이벤트가 없으므로 바로 보여주고, 안드로이드도 설치 안내 폴백이 있으니 노출한다.
  btn.style.display = 'flex';

  const guide = $('iosInstallGuide');
  const closeGuide = () => { if (guide) guide.style.display = 'none'; };

  btn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch (_) {}
      deferredPrompt = null;
      btn.style.display = 'none';
    } else if (guide) {
      // iOS가 아니어도 안내 시트를 띄운다. 크롬 메뉴 설명이 들어 있어도 해가 없고,
      // 2026에서 쓰던 showToast는 아직 안 옮겼다.
      guide.style.display = 'flex';
    }
  });

  $('iosGuideClose')?.addEventListener('click', closeGuide);
  guide?.addEventListener('click', e => { if (e.target === guide) closeGuide(); });
  if (!isIOS) {
    // 안드로이드와 PC에서는 1번 단계 문구가 맞지 않으므로 공유 버튼 설명을 바꿔 둔다.
    const step = guide?.querySelector('.ios-guide-step');
    if (step) step.innerHTML =
      '<span class="ios-guide-num">1</span> 브라우저 메뉴를 누르세요';
  }
})();

/* ── 시작 ── */

initRoster();
updateLoginUI();
