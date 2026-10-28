// model.js: LMS2027 뼈대 (2026-10-26 제로베이스 재설계)
// ───────────────────────────────────────────────────────────────────────────
// 데이터 모델의 단일 출처. 컬렉션 이름, 칸/메뉴 표, (지금은) 데모 데이터와 조회를 한곳에 둔다.
// 학생 화면(index.js)과 어드민(admin.js)이 이 파일 하나만 읽어 같은 표를 쓴다.
//
// 조직 원리:
//   강의실(course)은 "강의(차시)"와 "복습"을 담고,
//   강의 하나는 개념노트 / 미션 / 질문노트 / 형성평가 네 칸을 각각 있거나 없거나로 채운다.
//   각 종류 최대 1개, 순서 자유. 사료, 사진, 영상은 개념노트 안의 내용.
//
// ※ 지금은 Firestore 대신 아래 DEMO(메모리)로 돈다. 화면 뼈대를 먼저 보기 위함.
//   컬렉션 이름과 문서 모양은 실제와 같게 맞춰 두었으므로, 다음 단계에서 이 파일의
//   조회 함수만 Firestore 호출로 바꾸면 화면은 그대로 둔다.
// ───────────────────────────────────────────────────────────────────────────

import { db, collection, getDocs, doc, getDoc, setDoc, deleteDoc } from './shared/fb.js?v=20261028a';
import { CLAUDE_PROXY_URL } from './shared/util.js?v=20261028f';

/* 컬렉션 설계: 제로베이스 재합의 (2026-10-27, 선생님 Q&A)
 * 규칙:
 *   - 이름에 연도/버전을 박지 않는다. 학년도는 문서의 year 필드로 구분하고,
 *     지난 해는 status:'archived'로 숨긴다. (2028이 와도 같은 컬렉션을 그대로 쓴다)
 *   - 강의실에 매인 것은 전부 course_ 접두, 재사용 창고는 접두 없는 복수형.
 *   - 저장은 전부 Firestore 하나로. (RTDB는 나중에 실시간 미션의 '그 순간' 상태 전용으로만,
 *     끝나면 최종 결과를 course_submissions에 남긴다)
 *
 * 학생이 낸 답은 종류를 가리지 않고 course_submissions 한 곳에 모은다(제출물 통합).
 *   종류는 part 필드(question/formative/mission)로 구분. 성적은 따로 컬렉션을 두지 않고
 *   이 제출물에서 뽑아 보여 주는 것으로 시작한다. */
export const COLLECTIONS = {
  // ── 지금 쓰는 7개 ──
  schoolYears:        'school_years',   // { year, status }  문서 id = '2027'
  courses:            'courses',        // 강의실 { year, subject, grade, classNo, status }
  courseStudents:     'course_students',// 명단 { courseId, studentNo, name }  id = 강의실id_학번
  courseAuth:         'course_auth',    // 비밀번호 해시 { hash }  id = 학년도_학번 (로그인 때만 읽음)
  courseLessons:      'course_lessons', // 강의실에 꽂힌 차시 { courseId, lessonId, order, isOpen, date }
  lessons:            'lessons',        // 강의 본체 창고(과목 없음). parts 4칸 + order
  courseSubmissions:  'course_submissions', // 제출물 통합 { clId, part, courseId, studentNo, answer, score, ... }
  courseGrades:       'course_grades',  // 성적 기록 { clId, studentNo, 영역별 달성/기한, absent, feedback }
                                        //   id = 꽂힌강의id_학번. 급간 표와 반영 강의는 settings/grade

  // ── 나중(예약): 해당 단계에서 실제로 만든다 ──
  quizzes:            'quizzes',        // 복습 문제 창고            (5단계 복습 허브)
  courseQuizzes:      'course_quizzes', // 강의실에 걸린 복습        (5단계)
  missionApps:        'mission_apps',   // 미션 미니앱 등록부 { name, studentUrl, adminUrl, lessonId, archive }
  courseConsent:      'course_consent', // 학생 동의서              (학생 화면 붙일 때)
  courseScores:       'course_scores',  // 안 쓴다. 성적은 course_grades와 제출물에서 집계한다
  courseXp:           'course_xp',       // 경험치/포인트            (6단계 게임 요소)
};

// 강의 안 네 칸: 각 강의에 최대 1개, 순서 자유.
//   portfolio: 성적(포트폴리오)에 들어가는가   submits: 학생 제출물이 생기는가
export const PART_TYPES = [
  { key:'concept',   name:'개념노트',  icon:'book-open',      portfolio:true,  submits:false },
  { key:'mission',   name:'미션',      icon:'layout-grid',    portfolio:true,  submits:true  },
  { key:'question',  name:'질문노트',  icon:'message-square', portfolio:true,  submits:true  },
  { key:'formative', name:'형성평가',  icon:'circle-check',   portfolio:false, submits:true  },
];
export const PART_ORDER = PART_TYPES.map(p => p.key);
export function partDef(key){ return PART_TYPES.find(p => p.key === key) || null; }

// 독립 메뉴
export const REVIEW = { key:'review', name:'복습', icon:'list-ordered' };

/* 학생이 강의실 안에서 쓰는 세 배치 (선생님 지시 2026-10-27, 요구사항 85, 90)
 *   강의 보기: 1강, 2강을 고르면 그 강의의 칸이 차례로 이어진다
 *   메뉴     : 개념노트만, 미션만 모아 본다. 2026 lms 메뉴와 같은 방식
 *   콘텐츠   : 뽑기, 게임 같은 흥미 요소가 들어올 자리(요구사항 69의 다섯 번째 용도). 아직 비었다
 * 앞의 둘은 같은 내용으로 들어가는 두 개의 길이다. 메뉴에는 강의에 안 매인 복습과 성적도 선다. */
export const STUDENT_VIEWS = [
  { key:'byLesson', name:'강의 보기' },
  { key:'byMenu',   name:'메뉴' },
  { key:'extras',   name:'콘텐츠' },
];
export const STUDENT_MENUS = [
  ...PART_TYPES.map(p => ({ key:p.key, name:p.name, icon:p.icon, kind:'part' })),
  { key:'review', name:'복습', icon:'list-ordered', kind:'review' },
  { key:'score',  name:'성적', icon:'bar-chart-3',  kind:'score'  },
];

// 어드민 왼쪽 메뉴
// 가운데 넷(개념 노트, 미션 활동, 오늘의 질문, 형성평가)은 강의 안 네 칸을 각각 관리하는 자리다.
// 칸 이름(PART_TYPES)과 메뉴 이름이 다른 것이 있다: 메뉴는 선생님이 부르는 이름으로 쓴다.
export const ADMIN_MENUS = [
  { key:'rooms',     name:'강의실 관리',     icon:'graduation-cap' },
  { key:'students',  name:'학생 관리',       icon:'users' },
  { key:'progress',  name:'진도 관리',       icon:'clipboard-list' },
  { key:'concept',   name:'개념 노트',       icon:'book-open' },
  { key:'mission',   name:'미션 활동',       icon:'layout-grid' },
  { key:'question',  name:'오늘의 질문',     icon:'message-square' },
  { key:'formative', name:'형성평가',        icon:'circle-check' },
  { key:'scores',    name:'성적',            icon:'bar-chart-3' },
  { key:'general',   name:'일반 설정',       icon:'settings' },
];

/* 메뉴 안의 서브 메뉴. 미션 활동은 열어 둔 앱이 탭이 되므로 여기 적지 않는다.
   강의 라이브러리는 개념 노트의 서브 메뉴로 둔다(선생님 지시 2026-10-28) :
   강의(차시) 자체를 만들고 칸을 채우는 자리가 개념 노트를 고치는 자리와 같기 때문. */
export const ADMIN_SUBMENUS = {
  concept:  [ { v:'library', label:'강의 라이브러리' }, { v:'content', label:'콘텐츠' }, { v:'design',  label:'디자인' } ],
  question: [ { v:'manage',  label:'질문 관리' }, { v:'answers', label:'답변, 채점' }, { v:'pick', label:'PICK' } ],
  // 성적은 hoistory/lms의 성적 Check 세 화면(입력, 설정, 조회)을 그대로 옮긴 것이다.
  scores:   [ { v:'input',   label:'성적 입력' }, { v:'setting', label:'성적 설정' }, { v:'view',  label:'성적 조회' } ],
};

/* ── 화면 문구 (선생님 지시 2026-10-28) ──────────────────────────────────
   "모든 건 하드코딩이 우선이 아니라 관리자가 모든 문구를 직접 심고 바꿀 수 있게."
   화면에 보이는 글자(제목, 안내문, 버튼, 오류 메시지, 외부 링크 등)는 코드에 직접 적지 않고
   여기 TEXT_FIELDS에 "키 + 기본값"으로만 등록한다. 화면은 항상 getText(key)로 읽는다.
   어드민의 "일반 설정"은 이 표를 그대로 돌며 입력 칸을 그리므로, 새 문구를 추가할 때
   이 표에 한 줄만 더하면 어드민 쪽은 따로 안 고쳐도 된다.
   관리자가 고친 값은 settings/general 문서(texts 맵)에 저장된다. 안 고치면 기본값을 쓴다.

   기본값은 선생님이 일반 설정에서 직접 입력한 문구를 그대로 옮긴 것이다(2026-10-28).
   경어(~습니다체)로 쓴다 — "~다체로" 했던 지시는 같은 날 바로 정정됐다(CLAUDE.md 참고). */
export const TEXT_FIELDS = [
  { group:'일반', items:[
    { key:'browserTitle', label:'브라우저 탭 제목',   def:'HO TEACHER LMS' },
    { key:'siteName',     label:'사이트 이름',         def:'호성T 수업 : 학습 관리 시스템' },
    { key:'kakaoUrl',     label:'오픈카톡 링크',       def:'' },
    { key:'installUrl',   label:'홈 화면에 추가 안내 링크', def:'' },
  ]},
  { group:'학생 로그인 화면', items:[
    { key:'loginTitle',     label:'제목',                     def:'HO TEACHER LMS' },
    { key:'loginSubtitle',  label:'부제목',                   def:'호성T 수업 : 학습 관리 시스템' },
    { key:'loginGuide',     label:'안내문구',                 def:'호성쌤 수업에 대한 학습 관리 시스템에 오신 것을 환영합니다.' },
    { key:'loginBtn',       label:'로그인 버튼 글자',         def:'로그인' },
    { key:'kakaoCaption',   label:'오픈카톡 버튼 문구',       def:'호성T와 연락하기' },
    { key:'installCaption', label:'홈 화면에 추가 버튼 문구', def:'홈 화면에 추가' },
    { key:'setupGuide',     label:'첫 접속 안내문구',        def:'LMS에 처음 접속하셨습니다. 사용하실 비밀번호를 생성하시길 바랍니다.' },
    { key:'setupBtn',       label:'첫 접속 버튼 글자',       def:'비밀번호 생성' },
  ]},
  { group:'오류와 안내 문구', items:[
    { key:'errNoRoom',       label:'그 학번으로 든 강의실이 없을 때', def:'학번에 해당하는 강의실이 개설되지 않았습니다.' },
    { key:'errNameMismatch', label:'이름이 명단과 다를 때',           def:'이름이 학생 명단과 일치하지 않습니다.' },
    { key:'errPwEmpty',      label:'비밀번호를 안 쳤을 때',           def:'비밀번호를 입력하시길 바랍니다.' },
    { key:'errPwWrong',      label:'비밀번호가 틀렸을 때',            def:'비밀번호가 일치하지 않습니다.' },
    { key:'errPwShort',      label:'새 비밀번호가 너무 짧을 때',      def:'비밀번호는 4자 이상이어야 합니다.' },
    { key:'errPwMismatch',   label:'비밀번호 확인이 다를 때',         def:'비밀번호가 일치하지 않습니다.' },
    { key:'errNetwork',      label:'저장과 연결에 문제가 있을 때',     def:'연결이 원활하지 않습니다.' },
  ]},
];
let siteTexts = {};   // 관리자가 고친 값만. loadCore가 settings/general에서 채운다.
export function getText(key){
  const v = siteTexts[key];
  if (v != null && v !== '') return v;
  for (const g of TEXT_FIELDS){ const f = g.items.find(i => i.key === key); if (f) return f.def; }
  return '';
}
// 일반 설정의 저장 버튼이 한 번에 부른다 — 필드마다 따로 쓰지 않고 texts 맵 전체를 한 번에 쓴다.
export async function setTexts(patch){
  Object.entries(patch).forEach(([k, v]) => { siteTexts[k] = String(v ?? '').trim(); });
  await setDoc(doc(db, 'settings', 'general'), { texts: siteTexts }, { merge:true });
}

// 형성평가 문제 유형 넷 (선생님 지시 2026-10-27)
export const FORMATIVE_TYPES = [
  { key:'short',   name:'단답' },
  { key:'ox',      name:'OX' },
  { key:'initial', name:'초성' },
  { key:'choice',  name:'선택형' },
];
export function formativeTypeDef(key){ return FORMATIVE_TYPES.find(t => t.key === key) || null; }

// 표시 이름 헬퍼
const pad2 = n => String(n).padStart(2, '0');
export function roomName(course){ return `${course.subject} ${course.grade}${pad2(course.classNo)}`; }
export function roomNo(course){ return `${course.grade}${pad2(course.classNo)}`; }

/* 수업일자는 연도 없이 'M/D'로만 적는다(진도 관리, hoistory와 같다).
   오늘과 가장 가까운 해로 읽어 학기가 연말을 넘어가도 자연스럽게 맞는다.
   Date 또는 null(빈 값, 형식 오류)을 돌려준다. 진도표 색칠과 성적 기한 판정이 같이 쓴다. */
export function resolveMmdd(mmdd, today = new Date()){
  const mt = /^(\d{1,2})\s*\/\s*(\d{1,2})$/.exec(String(mmdd ?? '').trim());
  if (!mt) return null;
  const m = +mt[1], d = +mt[2];
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let best = null;
  [base.getFullYear() - 1, base.getFullYear(), base.getFullYear() + 1].forEach(yy => {
    const cand = new Date(yy, m - 1, d), diff = Math.abs(cand - base);
    if (!best || diff < best.diff) best = { date:cand, diff };
  });
  return best.date;
}
// 'past' | 'today' | 'future' | 'none'. 진도표와 강의 진도의 날짜 강조에 쓴다.
export function dateStatus(mmdd, today = new Date()){
  const d = resolveMmdd(mmdd, today);
  if (!d) return 'none';
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (d.getTime() === base.getTime()) return 'today';
  return d < base ? 'past' : 'future';
}

// ───────────────────────────────────────────────────────────────────────────
// 메모리 캐시: 화면은 이 메모리를 보고, loadCore가 Firestore에서 채운다.
// 제로베이스(2026-10-27): 가짜 시드 없이 빈 상태로 시작한다. 어드민에서 학년도 →
// 강의실 → 학생 → 강의를 만들면 그때부터 Firestore에 쌓인다. 각 문서 모양은 아래 주석 참고.
// ───────────────────────────────────────────────────────────────────────────
const DEMO = {
  years:        [],   // school_years   { id:'2027', year:2027, status:'active' }
  courses:      [],   // courses        { id, year, subject, grade, classNo, status }
  students:     [],   // course_students{ id:'강의실id_학번', courseId, studentNo, name }
  lessons:      [],   // lessons        { id, title, parts:{concept,mission,question,formative}, order:[] }
  courseLessons:[],   // course_lessons { id, courseId, lessonId, order, isOpen, date:'M/D' }
  submissions:  [],   // course_submissions { id:'꽂힌강의id_칸_학번', clId, part, courseId, studentNo, name, answer, score, at, shared }
  grades:       [],   // course_grades   { id:'꽂힌강의id_학번', clId, studentNo, concept:{achievedN,onTimeN}, mission, question, absent, feedback, manual }
  gradeConf:    { bands:null, lessons:[] },  // settings/grade  급간 표 + 성적에 반영할 강의 목록

  // ── 나중 단계에서 채운다(지금은 비움) ──
  quizzes:       [],  // quizzes        { id, title, source, items:[] }
  courseQuizzes: [],  // course_quizzes { id, courseId, quizId, isOpen }
  missionApps:   [],  // mission_apps   { id:앱키, name, studentUrl, adminUrl }
  xp:            [],  // course_xp      { id:'강의실id_학번', courseId, studentNo, xp, point }
};

/* 레벨 표: 2026 LMS shared/xp.js의 기본값을 그대로 옮겼다(누적 경험치 기준).
   표 끝을 넘으면 공식으로 이어 간다(마지막 간격 550, 레벨마다 25씩 커짐). */
export const XP_LEVELS = [0,100,225,375,550,750,975,1225,1500,1800,
                          2125,2475,2850,3250,3675,4125,4600,5100,5625,6175];
const XP_FORMULA = { lastGap:550, increment:25 };
export function levelFromXp(total){
  const t = +total || 0;
  for (let i = XP_LEVELS.length - 1; i >= 0; i--){
    if (t >= XP_LEVELS[i]){ if (i < XP_LEVELS.length - 1) return i + 1; break; }
  }
  let threshold = XP_LEVELS[XP_LEVELS.length - 1], gap = XP_FORMULA.lastGap, lv = XP_LEVELS.length;
  while (t >= threshold + gap){ threshold += gap; gap += XP_FORMULA.increment; lv++; }
  return lv;
}

/* ── Firestore 연결 (2026-10-27 제로베이스) ──
   부팅 때 '지금 쓰는' 컬렉션을 메모리(DEMO)로 한 번 불러오고, 이후 화면은 이 메모리를 본다.
   쓰기는 메모리를 먼저 고치고(화면 즉시 반영) Firestore에도 보낸다(백그라운드).
   비밀번호(course_auth)는 로그인 때만 읽으므로 여기서 통째로 불러오지 않는다.
   나중 단계 컬렉션(복습, 미션앱, 성적요약, 경험치)은 그 단계에서 붙인다. */
function put(coll, obj){ setDoc(doc(db, coll, obj.id), obj).catch(e => console.error('save', coll, obj.id, e)); }
function del(coll, id){ deleteDoc(doc(db, coll, id)).catch(e => console.error('del', coll, id, e)); }

export async function loadCore(){
  const C = COLLECTIONS;
  const [ys, cs, ss, cls, ls, subs, grs, mas, gen, grc] = await Promise.all([
    getDocs(collection(db, C.schoolYears)),
    getDocs(collection(db, C.courses)),
    getDocs(collection(db, C.courseStudents)),
    getDocs(collection(db, C.courseLessons)),
    getDocs(collection(db, C.lessons)),
    getDocs(collection(db, C.courseSubmissions)),
    getDocs(collection(db, C.courseGrades)),
    getDocs(collection(db, C.missionApps)),
    getDoc(doc(db, 'settings', 'general')),
    getDoc(doc(db, 'settings', 'grade')),
  ]);
  const rows = snap => snap.docs.map(d => ({ ...d.data(), id:d.id }));
  DEMO.years       = rows(ys).sort((a,b) => b.year - a.year);
  DEMO.courses     = rows(cs);
  DEMO.students    = rows(ss);
  DEMO.courseLessons = rows(cls);
  DEMO.lessons     = rows(ls);
  DEMO.submissions = rows(subs);
  DEMO.grades      = rows(grs);
  DEMO.missionApps = rows(mas);
  siteTexts        = gen.exists() ? (gen.data().texts || {}) : {};
  DEMO.gradeConf   = grc.exists() ? { bands:grc.data().bands || null, lessons:grc.data().lessons || [] }
                                  : { bands:null, lessons:[] };
}

// ── 조회 (메모리에서. loadCore가 Firestore에서 채워 둔다) ──
export function getYears(){ return [...DEMO.years]; }
export function getCourses(year){ return DEMO.courses.filter(c => !year || c.year === +year); }
export function getCourse(id){ return DEMO.courses.find(c => c.id === id) || null; }
export function getStudentsByCourse(courseId){ return DEMO.students.filter(s => s.courseId === courseId); }
export function getStudentsByYear(year){
  const ids = new Set(DEMO.courses.filter(c => c.year === +year).map(c => c.id));
  return DEMO.students.filter(s => ids.has(s.courseId));
}
// 한 학년도에서 한 학번이 든 강의실들
export function getCoursesOfStudent(year, studentNo){
  const mine = DEMO.students.filter(s => s.studentNo === studentNo);
  return DEMO.courses.filter(c => c.year === +year && mine.some(m => m.courseId === c.id));
}
export function getLessons(){ return [...DEMO.lessons]; }
export function getLesson(id){ return DEMO.lessons.find(l => l.id === id) || null; }
// 강의실에 꽂힌 강의 (order 순). 각 항목에 lesson 본체를 붙여 준다.
export function getCourseLessons(courseId){
  return DEMO.courseLessons
    .filter(cl => cl.courseId === courseId)
    .sort((a,b) => a.order - b.order)
    .map(cl => ({ ...cl, lesson: getLesson(cl.lessonId) }));
}
/* 메뉴별 배치가 쓰는 조회: 한 강의실에서 그 칸을 가진 공개 강의만 차례로.
   돌려주는 것은 { cl(꽂힌 자리), lesson, part(그 칸의 내용), no(몇 번째 강의인가) }. */
export function getPartItems(courseId, partKey){
  return getCourseLessons(courseId)
    .filter(cl => cl.isOpen && cl.lesson)
    .map((cl, i) => ({ cl, lesson:cl.lesson, part:cl.lesson.parts?.[partKey], no:i + 1 }))
    .filter(x => !!x.part);
}

// 그 칸(개념노트/미션/질문노트/형성평가)을 가진 강의만. 칸별 메뉴 넷이 쓴다.
export function getLessonsWithPart(key){ return DEMO.lessons.filter(l => !!l.parts?.[key]); }

export function getMissionApps(){ return [...DEMO.missionApps]; }
export function getMissionApp(appKey){ return DEMO.missionApps.find(a => a.id === appKey) || null; }

export function getQuizzes(){ return [...DEMO.quizzes]; }
export function getCourseQuizzes(courseId){
  return DEMO.courseQuizzes
    .filter(cq => cq.courseId === courseId)
    .map(cq => ({ ...cq, quiz: DEMO.quizzes.find(q => q.id === cq.quizId) }));
}
export function getXp(courseId, studentNo){
  return DEMO.xp.find(x => x.courseId === courseId && x.studentNo === studentNo) || null;
}

// ── 변경 (메모리를 고치고 Firestore에도 보낸다) ──
// id는 새로고침해도 겹치지 않게 시각+증가값으로 만든다(예전 c_101 같은 재사용 충돌 방지).
let seq = 0;
const nid = p => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
/* 학년도: 강의실이 없어도 학년도가 먼저 있어야 한다(요구사항 5, 16).
   비어 있는 데이터베이스에서 제일 먼저 만드는 것이 이것이다. */
export function addYear(year){
  const y = +year;
  if (!(y >= 2000 && y <= 2199)) throw new Error('학년도를 확인해 주세요.');
  if (DEMO.years.some(x => x.year === y)) throw new Error(`${y}학년도는 이미 있습니다.`);
  const row = { id:String(y), year:y };
  DEMO.years.push(row);
  DEMO.years.sort((a, b) => b.year - a.year);   // 큰 해부터
  put(COLLECTIONS.schoolYears, row);
  return row;
}

/* 한 강의실을 지우면 같이 없어지는 것. 삭제 확인 창이 숫자를 보여 주는 데 쓴다. */
export function courseDeps(id){
  return {
    students: DEMO.students.filter(s => s.courseId === id).length,
    lessons:  DEMO.courseLessons.filter(cl => cl.courseId === id).length,
    quizzes:  DEMO.courseQuizzes.filter(cq => cq.courseId === id).length,
    subs:     DEMO.submissions.filter(s => s.courseId === id).length,
    grades:   DEMO.grades.filter(g => g.courseId === id).length,
  };
}

export function addCourse({ year, subject, grade, classNo }){
  const c = { id:nid('c_'), year:+year, subject:String(subject).trim(), grade:+grade, classNo:+classNo, status:'active' };
  if (!c.subject) throw new Error('과목을 적어 주세요.');
  if (!(c.grade >= 1 && c.grade <= 6)) throw new Error('학년을 확인해 주세요.');
  if (!(c.classNo >= 1 && c.classNo <= 99)) throw new Error('반을 확인해 주세요.');
  if (sameRoomExists(c)) throw new Error(`${roomName(c)} 강의실이 이미 있습니다.`);
  DEMO.courses.push(c); put(COLLECTIONS.courses, c); return c;
}

// 같은 학년도에 과목과 학년과 반이 똑같은 강의실이 또 있는가(자기 자신은 뺀다)
function sameRoomExists({ id, year, subject, grade, classNo }){
  return DEMO.courses.some(c => c.id !== id && c.year === +year &&
    c.subject === subject && c.grade === +grade && c.classNo === +classNo);
}

export function updateCourse(id, { subject, grade, classNo }){
  const c = getCourse(id); if (!c) throw new Error('강의실을 찾지 못했습니다.');
  const next = { id, year:c.year, subject:String(subject).trim(), grade:+grade, classNo:+classNo };
  if (!next.subject) throw new Error('과목을 적어 주세요.');
  if (!(next.grade >= 1 && next.grade <= 6)) throw new Error('학년을 확인해 주세요.');
  if (!(next.classNo >= 1 && next.classNo <= 99)) throw new Error('반을 확인해 주세요.');
  if (sameRoomExists(next)) throw new Error(`${roomName(next)} 강의실이 이미 있습니다.`);
  Object.assign(c, { subject:next.subject, grade:next.grade, classNo:next.classNo });
  put(COLLECTIONS.courses, c); return c;
}

/* 강의실 하나 삭제: 그 강의실에 매인 것(course_ 접두)이 전부 같이 없어진다.
   창고(lessons, quizzes)는 건드리지 않는다. 강의 내용 자체는 남는다. */
export function deleteCourse(id){
  const c = getCourse(id); if (!c) return null;
  // 같이 없어지는 것(course_ 접두). 지울 id를 먼저 모아 Firestore에서도 지운다.
  DEMO.students.filter(s => s.courseId === id).forEach(s => del(COLLECTIONS.courseStudents, s.id));
  DEMO.courseLessons.filter(cl => cl.courseId === id).forEach(cl => del(COLLECTIONS.courseLessons, cl.id));
  DEMO.courses = DEMO.courses.filter(x => x.id !== id);
  DEMO.students = DEMO.students.filter(s => s.courseId !== id);
  DEMO.courseLessons = DEMO.courseLessons.filter(cl => cl.courseId !== id);
  DEMO.courseQuizzes = DEMO.courseQuizzes.filter(cq => cq.courseId !== id);
  DEMO.submissions.filter(s => s.courseId === id).forEach(s => del(COLLECTIONS.courseSubmissions, s.id));
  DEMO.submissions = DEMO.submissions.filter(s => s.courseId !== id);
  DEMO.grades.filter(g => g.courseId === id).forEach(g => del(COLLECTIONS.courseGrades, g.id));
  DEMO.grades = DEMO.grades.filter(g => g.courseId !== id);
  del(COLLECTIONS.courses, id);
  return c;
}
export function addStudent({ year, grade, classNo, studentNo, name }){
  // 그 학년도, 그 반(과목 무관)의 강의실 전부에 등록
  const rooms = DEMO.courses.filter(c =>
    c.year === +year && c.grade === +grade && c.classNo === +classNo && c.status === 'active');
  const added = [];
  rooms.forEach(c => {
    const id = `${c.id}_${studentNo}`;
    if (DEMO.students.some(s => s.id === id)) return;
    const s = { id, courseId:c.id, studentNo, name };
    DEMO.students.push(s); added.push(s); put(COLLECTIONS.courseStudents, s);
  });
  return { rooms, added };
}
export function removeStudentEverywhere(year, studentNo){
  const ids = new Set(DEMO.courses.filter(c => c.year === +year).map(c => c.id));
  DEMO.students.filter(s => ids.has(s.courseId) && s.studentNo === studentNo)
    .forEach(s => del(COLLECTIONS.courseStudents, s.id));
  DEMO.students = DEMO.students.filter(s => !(ids.has(s.courseId) && s.studentNo === studentNo));
}
// 학생 한 명을 한 강의실에 넣고 빼기: 수강 과목(강의실) 체크에 쓴다.
export function enrollStudent(courseId, studentNo, name){
  const c = getCourse(courseId); if (!c) return null;
  const id = `${courseId}_${studentNo}`;
  if (DEMO.students.some(s => s.id === id)) return null;
  const s = { id, courseId, studentNo, name: name || '' };
  DEMO.students.push(s); put(COLLECTIONS.courseStudents, s); return s;
}
export function unenrollStudent(courseId, studentNo){
  const id = `${courseId}_${studentNo}`;
  const before = DEMO.students.length;
  DEMO.students = DEMO.students.filter(s => s.id !== id);
  if (DEMO.students.length < before){ del(COLLECTIONS.courseStudents, id); return true; }
  return false;
}
// 강의 본체를 Firestore에 통째로 저장한다(parts, order, 개념 콘텐츠, 질문이 다 lessons 문서 안에 있다).
function saveLesson(lessonId){ const l = getLesson(lessonId); if (l) put(COLLECTIONS.lessons, l); }

export function addLesson(title){
  const l = { id:nid('L'), title, parts:{}, order:[] };
  DEMO.lessons.push(l); put(COLLECTIONS.lessons, l); return l;
}
// 강의 제목 고치기(진도표의 주제 칸, 강의 라이브러리 공용).
export function setLessonTitle(lessonId, title){
  const l = getLesson(lessonId); if (!l) return null;
  const t = String(title ?? '').trim();
  if (!t) throw new Error('강의 제목을 적어 주세요.');
  l.title = t; saveLesson(lessonId); return l;
}
export function setLessonPart(lessonId, key, on){
  const l = getLesson(lessonId); if (!l) return;
  if (on){
    if (!l.parts[key]) l.parts[key] = { title:partDef(key).name };
    if (!l.order.includes(key)) l.order.push(key);
  } else {
    delete l.parts[key];
    l.order = l.order.filter(k => k !== key);
  }
  saveLesson(lessonId);
}
export function moveLessonPart(lessonId, key, dir){
  const l = getLesson(lessonId); if (!l) return;
  const i = l.order.indexOf(key); if (i < 0) return;
  const j = i + dir; if (j < 0 || j >= l.order.length) return;
  [l.order[i], l.order[j]] = [l.order[j], l.order[i]];
  saveLesson(lessonId);
}
export function placeLesson(courseId, lessonId){
  const order = DEMO.courseLessons.filter(c => c.courseId === courseId).length + 1;
  const cl = { id:nid('cl'), courseId, lessonId, order, isOpen:false, date:'' };
  DEMO.courseLessons.push(cl); put(COLLECTIONS.courseLessons, cl); return cl;
}
export function toggleCourseLessonOpen(id){
  const cl = DEMO.courseLessons.find(c => c.id === id);
  if (cl){ cl.isOpen = !cl.isOpen; put(COLLECTIONS.courseLessons, cl); }
}
// 한 강의실 안에서 꽂힌 강의의 차례를 위/아래로(dir: -1 위, +1 아래). order 값을 맞바꾼다.
export function moveCourseLesson(courseId, clId, dir){
  const arr = DEMO.courseLessons.filter(c => c.courseId === courseId).sort((a,b) => a.order - b.order);
  const i = arr.findIndex(c => c.id === clId); if (i < 0) return;
  const j = i + dir; if (j < 0 || j >= arr.length) return;
  const a = arr[i], b = arr[j]; const t = a.order; a.order = b.order; b.order = t;
  put(COLLECTIONS.courseLessons, a); put(COLLECTIONS.courseLessons, b);
}
export function toggleCourseQuizOpen(id){
  const cq = DEMO.courseQuizzes.find(c => c.id === id); if (cq) cq.isOpen = !cq.isOpen;
}
// 수업일자('M/D') 저장: 진도표와 강의실 상세가 같은 course_lessons를 써서 서로 맞물린다.
export function setCourseLessonDate(clId, date){
  const cl = DEMO.courseLessons.find(c => c.id === clId); if (!cl) return null;
  cl.date = String(date ?? '').trim(); put(COLLECTIONS.courseLessons, cl); return cl;
}
// 꽂힌 강의 하나를 그 강의실에서 뺀다. 강의 내용 자체는 창고에 남는다.
export function unplaceLesson(clId){
  const cl = DEMO.courseLessons.find(c => c.id === clId); if (!cl) return null;
  DEMO.courseLessons = DEMO.courseLessons.filter(c => c.id !== clId);
  del(COLLECTIONS.courseLessons, clId);
  DEMO.grades.filter(g => g.clId === clId).forEach(g => del(COLLECTIONS.courseGrades, g.id));
  DEMO.grades = DEMO.grades.filter(g => g.clId !== clId);
  DEMO.submissions.filter(s => s.clId === clId).forEach(s => del(COLLECTIONS.courseSubmissions, s.id));
  DEMO.submissions = DEMO.submissions.filter(s => s.clId !== clId);
  return cl;
}

/* ── 진도표의 강의 줄 (hoistory 진도 계획 틀 이식, 선생님 지시 2026-10-28) ──
   hoistory에서는 진도표 한 줄이 모든 반에 공통이고 반마다 날짜만 달랐다. 2027도 같게 둔다:
   진도표에서 강의를 더하면 **그 과목의 강의실 전부에 같이 꽂힌다**(요구사항 49의 과목 일괄).
   돌려주는 것은 만든 강의와 꽂은 강의실 수다. */
export function addLessonToSubject(year, subject, title){
  const t = String(title ?? '').trim();
  if (!t) throw new Error('강의 제목을 적어 주세요.');
  const rooms = DEMO.courses.filter(c => c.year === +year && c.subject === subject && c.status === 'active');
  if (!rooms.length) throw new Error(`${subject} 강의실이 없습니다.`);
  const lesson = addLesson(t);
  rooms.forEach(c => placeLesson(c.id, lesson.id));
  return { lesson, rooms: rooms.length };
}
// 진도표 한 줄(= 한 강의)을 그 과목 강의실 전부에서 뺀다.
export function removeLessonFromSubject(year, subject, lessonId){
  const ids = new Set(DEMO.courses
    .filter(c => c.year === +year && c.subject === subject).map(c => c.id));
  const targets = DEMO.courseLessons.filter(cl => cl.lessonId === lessonId && ids.has(cl.courseId));
  targets.forEach(cl => unplaceLesson(cl.id));
  return targets.length;
}
/* 반별 수업 요일(hoistory 진도표 머리줄의 "수1, 목5"). 강의실 문서에 적어 둔다.
   시간표 자체를 쓰는 것이 아니라 선생님이 눈으로 보는 메모라 자유 입력으로 둔다. */
export function setCourseSchedule(courseId, schedule){
  const c = getCourse(courseId); if (!c) return null;
  c.schedule = String(schedule ?? '').trim();
  put(COLLECTIONS.courses, c);
  return c;
}
/* ── 성적 (hoistory/lms 성적 Check 기본 틀 이식, 선생님 지시 2026-10-28) ────────
   2026 lms에서 돌려 본 방식을 그대로 가져온다. 점수를 강의마다 직접 적는 것이 아니라,
   강의마다 영역별로 **달성**과 **기한** 두 칸을 체크하고, 전체 달성률을 **급간 표**로
   점수로 환산한다. 그래서 강의가 몇 개든 만점이 흔들리지 않는다.

     1) 강의마다 학생마다 영역(개념노트, 미션, 질문노트)별로 달성 칸과 기한 칸.
        가중치가 2배면 칸이 둘씩이라 반만 깎을 수 있다(lessons.parts.<칸>.weight)
     2) 달성률 = 켜진 칸 / 가능한 칸. 성적 설정의 반영 강의 목록에 든 강의만 센다
     3) 급간 표(bands)에서 그 달성률에 맞는 줄을 찾아 영역 점수를 읽는다
     4) 세 영역 점수를 더한 것이 포트폴리오 성적

   손으로 쓰기와 자동 끌어오기를 둘 다 둔다(선생님 지시):
     자동 : 미션과 질문노트는 제출물(course_submissions)에서 달성과 기한을 계산한다.
            기한은 그 강의의 수업일자(course_lessons.date, 진도 관리에서 넣는 그 값)와
            제출 시각을 견준다. 진도 관리와 성적이 여기서 맞물린다
     손   : 어느 칸이든 교사가 눌러 바꾸면 그 영역은 manual로 표시되고, 다시 불러와도
            자동 감지가 덮어쓰지 않는다. 개념노트는 LMS 밖 활동지라 늘 손으로만 넣는다
   형성평가와 복습은 성적에서 빠진다(요구사항 70). */

// 성적에 드는 영역 셋. PART_TYPES의 portfolio 칸과 같다.
export const GRADE_AREAS = PART_TYPES.filter(p => p.portfolio).map(p => ({ key:p.key, name:p.name }));

/* 급간 표 기본값: hoistory/lms의 DEFAULT_BANDS를 그대로 옮겼다(생각체크 = 질문노트).
   달성률이 min 이상인 첫 줄의 점수를 쓴다. 개념 30, 미션 40, 질문 30으로 100점. */
export const DEFAULT_BANDS = [
  { min:90, concept:30, mission:40, question:30 },
  { min:80, concept:27, mission:36, question:27 },
  { min:70, concept:24, mission:32, question:24 },
  { min:60, concept:21, mission:28, question:21 },
  { min:50, concept:18, mission:24, question:18 },
  { min:40, concept:15, mission:20, question:15 },
  { min:30, concept:12, mission:16, question:12 },
  { min:20, concept: 9, mission:12, question: 9 },
  { min:10, concept: 6, mission: 8, question: 6 },
  { min: 0, concept: 3, mission: 4, question: 3 },
];

export function getBands(){
  const b = DEMO.gradeConf.bands;
  return (Array.isArray(b) && b.length) ? b : DEFAULT_BANDS;
}
// 성적에 반영할 강의(lessons의 id 목록). 비어 있으면 아무것도 집계하지 않는다.
export function getGradeLessons(){ return [...(DEMO.gradeConf.lessons || [])]; }
export function isGradeLesson(lessonId){ return (DEMO.gradeConf.lessons || []).includes(lessonId); }
export function toggleGradeLesson(lessonId, on){
  const list = DEMO.gradeConf.lessons || (DEMO.gradeConf.lessons = []);
  const i = list.indexOf(lessonId);
  if (on && i < 0) list.push(lessonId);
  if (!on && i >= 0) list.splice(i, 1);
  return list;
}
// 성적 설정의 저장 버튼이 한 번에 부른다(급간 표와 반영 강의 목록을 같이 쓴다).
export async function saveGradeConfig(bands){
  const clean = (bands || getBands()).map(b => ({
    min: Math.max(0, Math.min(100, Math.round(+b.min) || 0)),
    concept: Math.max(0, Math.round(+b.concept) || 0),
    mission: Math.max(0, Math.round(+b.mission) || 0),
    question: Math.max(0, Math.round(+b.question) || 0),
  })).sort((a, b) => b.min - a.min);
  DEMO.gradeConf = { bands:clean, lessons:getGradeLessons() };
  await setDoc(doc(db, 'settings', 'grade'), DEMO.gradeConf);
  return DEMO.gradeConf;
}

/* 가중치: 그 강의의 그 칸이 몇 칸을 차지하는가(1 또는 2). 강의는 창고에 있는 것이라
   그 강의를 꽂은 모든 강의실에 같이 걸린다. 칸이 없는 강의는 0(미실시)이다. */
export function partWeight(lessonId, partKey){
  const p = getLesson(lessonId)?.parts?.[partKey];
  if (!p) return 0;
  const w = Math.round(+p.weight) || 1;
  return Math.max(1, Math.min(2, w));
}
export function setPartWeight(lessonId, partKey, weight){
  const l = getLesson(lessonId), p = l?.parts?.[partKey];
  if (!p) throw new Error('그 칸이 없는 강의입니다.');
  p.weight = (Math.round(+weight) === 2) ? 2 : 1;
  put(COLLECTIONS.lessons, l);
  return p.weight;
}

// ── 성적 기록 (course_grades, 문서 id = 꽂힌강의id_학번) ──
const emptyBlock = () => ({ achievedN:0, onTimeN:0 });
function blankRec(clId, studentNo){
  const cl = DEMO.courseLessons.find(x => x.id === clId);
  const rec = { id:`${clId}_${studentNo}`, clId, courseId:cl?.courseId || '', lessonId:cl?.lessonId || '',
                studentNo, absent:false, feedback:'', manual:{} };
  GRADE_AREAS.forEach(a => { rec[a.key] = emptyBlock(); });
  return rec;
}
// 기록이 없으면 빈 것을 돌려준다(저장은 하지 않는다. 화면이 읽기만 할 때가 많다).
export function gradeRec(clId, studentNo){
  return DEMO.grades.find(g => g.clId === clId && g.studentNo === studentNo) || blankRec(clId, studentNo);
}
function gradeRecLive(clId, studentNo){
  let g = DEMO.grades.find(x => x.clId === clId && x.studentNo === studentNo);
  if (!g){ g = blankRec(clId, studentNo); DEMO.grades.push(g); }
  GRADE_AREAS.forEach(a => { if (!g[a.key]) g[a.key] = emptyBlock(); });
  if (!g.manual) g.manual = {};
  return g;
}
function saveGrade(g){ put(COLLECTIONS.courseGrades, g); return g; }

/* 칸 하나를 켜고 끈다. field는 'achievedN' 또는 'onTimeN', n은 0부터 가중치까지.
   교사가 누른 것이므로 그 영역을 manual로 표시한다(자동 감지가 덮어쓰지 못하게). */
export function setGradeCell(clId, studentNo, area, field, n){
  const cl = DEMO.courseLessons.find(x => x.id === clId);
  if (!cl) throw new Error('강의를 찾지 못했습니다.');
  const w = partWeight(cl.lessonId, area);
  if (!w) throw new Error('그 칸이 없는 강의입니다.');
  const g = gradeRecLive(clId, studentNo);
  if (g.absent) throw new Error('결석으로 둔 학생은 미달성으로 고정됩니다.');
  g[area][field] = Math.max(0, Math.min(w, Math.round(+n) || 0));
  g.manual[area] = true;
  return saveGrade(g);
}
// 이름을 누르면 결석. 결석은 전부 미달성으로 고정한다(hoistory와 같다).
export function toggleGradeAbsent(clId, studentNo){
  const g = gradeRecLive(clId, studentNo);
  g.absent = !g.absent;
  if (g.absent) GRADE_AREAS.forEach(a => { g[a.key] = emptyBlock(); g.manual[a.key] = true; });
  return saveGrade(g);
}
// 한 학생의 실시 중인 모든 칸을 한 번에 켜고 끈다(이름 앞 체크박스).
export function setGradeRowAll(clId, studentNo, on){
  const cl = DEMO.courseLessons.find(x => x.id === clId);
  if (!cl) throw new Error('강의를 찾지 못했습니다.');
  const g = gradeRecLive(clId, studentNo);
  if (g.absent) throw new Error('결석으로 둔 학생은 미달성으로 고정됩니다.');
  GRADE_AREAS.forEach(a => {
    const w = partWeight(cl.lessonId, a.key); if (!w) return;
    g[a.key] = { achievedN: on ? w : 0, onTimeN: on ? w : 0 };
    g.manual[a.key] = true;
  });
  return saveGrade(g);
}
export function setGradeFeedback(clId, studentNo, text){
  const g = gradeRecLive(clId, studentNo);
  g.feedback = String(text ?? '').trim();
  return saveGrade(g);
}
// 그 반에 이 강의 성적을 공개했는가. 2027은 꽂힌 강의가 이미 반 단위라 거기에 붙인다.
export function toggleGradePublished(clId){
  const cl = DEMO.courseLessons.find(x => x.id === clId); if (!cl) return null;
  cl.gradePublished = !cl.gradePublished;
  cl.gradePublishedAt = cl.gradePublished ? Date.now() : null;
  put(COLLECTIONS.courseLessons, cl);
  return cl;
}

/* ── 자동 감지 ──
   제출물에서 달성과 기한을 계산한다. 기한은 수업일자(cl.date)의 끝(자정)까지를 본다.
   날짜를 안 넣은 강의는 기한을 따지지 않고 통과로 둔다(진도 관리에서 날짜를 넣으면 그때 걸린다).
   질문노트는 hoistory thinkVerdict의 뼈대를 옮겼다: 50자 미만은 미달성, 지연 제출은
   달성이지만 기한에서 깎인다. 미제출은 둘 다 0이다. */
function lessonDueMs(cl){
  const d = resolveMmdd(cl?.date);
  return d ? d.getTime() + 24 * 60 * 60 * 1000 - 1 : null;
}
export function autoDetect(clId){
  const cl = DEMO.courseLessons.find(x => x.id === clId);
  if (!cl) return {};
  const due = lessonDueMs(cl);
  const out = {};
  DEMO.submissions.filter(s => s.clId === clId).forEach(s => {
    if (s.part !== 'mission' && s.part !== 'question') return;
    const w = partWeight(cl.lessonId, s.part); if (!w) return;
    const at = +s.at || 0;
    const onTime = (!due || !at) ? true : at <= due;
    let achieved = true, note = '통과';
    // 질문노트는 오늘의 질문 채점 화면과 같은 판정(AI 채점, 선생님의 통과/미흡까지)을 쓴다.
    if (s.part === 'question'){ const v = questionVerdict(s); achieved = v.achieved; note = v.verdict; }
    else if (!onTime) note = '미흡(지연 제출)';
    out[s.studentNo] = out[s.studentNo] || {};
    out[s.studentNo][s.part] = { achievedN: achieved ? w : 0, onTimeN: onTime ? w : 0, at, note };
  });
  return out;
}
/* 자동 감지를 기록에 넣는다. manual로 표시된 영역과 결석 학생은 건드리지 않는다.
   돌려주는 것은 { touched, skipped } : 몇 명을 끌어왔는지 화면에 알리는 데 쓴다. */
export function applyAutoDetect(clId){
  const cl = DEMO.courseLessons.find(x => x.id === clId);
  if (!cl) throw new Error('강의를 찾지 못했습니다.');
  const auto = autoDetect(clId);
  let touched = 0, skipped = 0;
  Object.entries(auto).forEach(([studentNo, areas]) => {
    const g = gradeRecLive(clId, studentNo);
    if (g.absent){ skipped++; return; }
    let changed = false;
    Object.entries(areas).forEach(([area, v]) => {
      if (g.manual?.[area]){ skipped++; return; }
      if (g[area].achievedN !== v.achievedN || g[area].onTimeN !== v.onTimeN){
        g[area] = { achievedN:v.achievedN, onTimeN:v.onTimeN };
        changed = true;
      }
    });
    if (changed){ saveGrade(g); touched++; }
  });
  return { touched, skipped };
}
// 손으로 고친 표시를 지운다(그 영역을 자동 감지에 다시 맡긴다).
export function clearGradeManual(clId, studentNo, area){
  const g = gradeRecLive(clId, studentNo);
  if (area) delete g.manual[area]; else g.manual = {};
  return saveGrade(g);
}

/* ── 집계 ──
   한 학생의 한 강의실 성적. 반영 강의 목록(성적 설정)에 들고 그 반에 공개된 강의만 센다.
   돌려주는 것: { areas:{키:{achieved,total,pct,score}}, total, maxScore, lessonCount, rows }
   rows는 강의별 내역이다(어디서 깎였는지 바로 보이게. hoistory 2026-09-03과 같은 뜻). */
export function studentGrade(courseId, studentNo){
  const bands = getBands();
  const picked = new Set(getGradeLessons());
  const cls = getCourseLessons(courseId).filter(cl => picked.has(cl.lessonId) && cl.gradePublished);
  const sum = {}; GRADE_AREAS.forEach(a => { sum[a.key] = { achieved:0, total:0 }; });
  const rows = cls.map((cl, i) => {
    const rec = gradeRec(cl.id, studentNo);
    const row = { clId:cl.id, no:i + 1, title:cl.lesson?.title || '(삭제된 강의)',
                  areas:{}, absent:!!rec.absent, feedback:rec.feedback || '' };
    GRADE_AREAS.forEach(a => {
      const w = partWeight(cl.lessonId, a.key);
      if (!w){ row.areas[a.key] = null; return; }
      const got = Math.min(w, rec[a.key]?.achievedN || 0) + Math.min(w, rec[a.key]?.onTimeN || 0);
      sum[a.key].achieved += got; sum[a.key].total += 2 * w;
      row.areas[a.key] = { weight:w, achievedN:rec[a.key]?.achievedN || 0, onTimeN:rec[a.key]?.onTimeN || 0 };
    });
    return row;
  });
  const areas = {};
  GRADE_AREAS.forEach(a => {
    const { achieved, total } = sum[a.key];
    const pct = total ? Math.round(achieved / total * 100) : 0;
    const band = total ? (bands.find(b => pct >= b.min) || bands[bands.length - 1]) : null;
    areas[a.key] = { achieved, total, pct, score: band ? (+band[a.key] || 0) : 0 };
  });
  const top = bands[0] || {};
  const maxScore = GRADE_AREAS.reduce((n, a) => n + (+top[a.key] || 0), 0);
  const total = GRADE_AREAS.reduce((n, a) => n + areas[a.key].score, 0);
  return { areas, total, maxScore, lessonCount: cls.length, rows, has: cls.length > 0 };
}

// 한 강의, 한 반의 달성 통계(성적 입력 화면의 칩). 영역마다 "달성한 학생 / 전체".
export function gradeStats(clId, studentNos){
  const cl = DEMO.courseLessons.find(x => x.id === clId);
  const out = {};
  GRADE_AREAS.forEach(a => {
    const w = cl ? partWeight(cl.lessonId, a.key) : 0;
    if (!w){ out[a.key] = null; return; }
    let done = 0;
    studentNos.forEach(no => { if ((gradeRec(clId, no)[a.key]?.achievedN || 0) >= w) done++; });
    out[a.key] = { done, all: studentNos.length };
  });
  return out;
}

/* ── 개념 노트 콘텐츠 (2026 class_lessons.contentLines 모티브) ──
   content는 줄의 배열: { type:'divider', title }(페이지 제목) | { type:'row', text }(내용 줄). */
function conceptOf(lessonId){
  const l = getLesson(lessonId); if (!l?.parts?.concept) return null;
  if (!Array.isArray(l.parts.concept.content)) l.parts.concept.content = [];
  return l.parts.concept.content;
}
export function getConceptContent(lessonId){ return conceptOf(lessonId) || []; }
export function conceptAddLine(lessonId, type){
  const c = conceptOf(lessonId); if (!c) return;
  c.push(type === 'divider' ? { type:'divider', title:'' } : { type:'row', text:'' });
  saveLesson(lessonId);
}
export function conceptSetLine(lessonId, idx, value){
  const c = conceptOf(lessonId), line = c?.[idx]; if (!line) return;
  if (line.type === 'divider') line.title = value; else line.text = value;
  saveLesson(lessonId);
}
export function conceptMoveLine(lessonId, idx, dir){
  const c = conceptOf(lessonId); if (!c) return;
  const j = idx + dir; if (j < 0 || j >= c.length) return;
  [c[idx], c[j]] = [c[j], c[idx]];
  saveLesson(lessonId);
}
export function conceptDelLine(lessonId, idx){
  const c = conceptOf(lessonId); if (c && c[idx]){ c.splice(idx, 1); saveLesson(lessonId); }
}

// ── 오늘의 질문 ──
/* 질문 관리(선생님 지시 2026-10-28): 깔린 강의마다 질문과 설명문을 바로 적는다.
   적으면 그 강의에 질문노트 칸이 생기고, 둘 다 비우면 칸이 빠진다
   (칸이 있는가가 곧 성적의 실시, 미실시다). */
export function setQuestion(lessonId, patch){
  const l = getLesson(lessonId); if (!l) return;
  const cur = l.parts?.question || {};
  const next = { ...cur, ...patch };
  const filled = String(next.prompt || '').trim() || String(next.guide || '').trim();
  if (!filled){ if (l.parts?.question) setLessonPart(lessonId, 'question', false); return; }
  if (!l.parts.question) setLessonPart(lessonId, 'question', true);
  Object.assign(l.parts.question, patch);
  saveLesson(lessonId);
}
export function getQuestionSubs(clId){
  return DEMO.submissions.filter(s => s.clId === clId && s.part === 'question');
}
/* 제출물 저장: 학생 화면과 미션 미니앱이 쓰는 한 길. 문서 id가 꽂힌강의, 칸, 학번이라
   다시 내면 같은 줄을 고친다. 처음 적힌 at(제출 시각)은 기한 판정의 기준이라 덮어쓰지 않는다
   (2026 네컷에서 다시 낼 때마다 시각이 덮여 기한이 지각으로 뒤집힌 적이 있다). */
export function saveSubmission({ clId, part, studentNo, answer, score }){
  const cl = DEMO.courseLessons.find(x => x.id === clId);
  if (!cl) throw new Error('강의를 찾지 못했습니다.');
  if (!PART_ORDER.includes(part)) throw new Error('칸 종류를 확인해 주세요.');
  const id = `${clId}_${part}_${studentNo}`;
  const i = DEMO.submissions.findIndex(s => s.id === id);
  const stu = DEMO.students.find(s => s.courseId === cl.courseId && s.studentNo === studentNo);
  const prev = i >= 0 ? DEMO.submissions[i] : null;
  const row = { ...(prev || {}), id, clId, part, courseId:cl.courseId, studentNo,
                name: stu?.name || prev?.name || '', at: prev?.at || Date.now() };
  if (answer != null) row.answer = String(answer);
  if (score != null) row.score = +score;
  if (i >= 0) DEMO.submissions[i] = row; else DEMO.submissions.push(row);
  put(COLLECTIONS.courseSubmissions, row);
  return row;
}
export function setSubScore(subId, score){
  const s = DEMO.submissions.find(x => x.id === subId); if (!s) return;
  s.score = (score === '' || score == null) ? null : +score;
  put(COLLECTIONS.courseSubmissions, s);
}
export function toggleSubShared(subId){
  const s = DEMO.submissions.find(x => x.id === subId); if (!s) return;
  s.shared = !s.shared;
  put(COLLECTIONS.courseSubmissions, s);
}

/* 답변 판정 (hoistory/lms thinkVerdict 이식) ────────────────────────────────
   자동으로 통과와 미흡을 가린다. 선생님이 손으로 통과/미흡을 못박으면(verdict 필드)
   그것이 이긴다. 성적의 자동 감지(autoDetect)와 같은 기준을 쓴다.
     50자 미만         : 미흡. 기한은 깎지 않는다
     지연 제출         : 달성은 주고 기한만 깎는다
     그 밖             : 통과
   hoistory의 이탈(cheatCount) 규칙은 학생 화면에 이탈 감시가 아직 없어 다음 단계로 둔다. */
export function questionVerdict(sub){
  const cl = DEMO.courseLessons.find(x => x.id === sub?.clId);
  const due = (() => { const d = resolveMmdd(cl?.date); return d ? d.getTime() + 24*60*60*1000 - 1 : null; })();
  const at = +sub?.at || 0;
  const onTime = (!due || !at) ? true : at <= due;
  const len = (sub?.answer == null) ? (sub?.textLength || 0) : String(sub.answer).trim().length;
  let verdict, achieved;
  if (len < 50){ verdict = '미흡(50자 미만)'; achieved = false; }
  // 정확히 '조금 미흡'(AI 품질 미달)만 잡는다. '미흡(지연 제출)'까지 걸면 지연 제출의 달성이 꺼진다.
  else if (sub?.graded && sub?.aiVerdict === '조금 미흡'){ verdict = '조금 미흡'; achieved = false; }
  else if (!onTime){ verdict = '미흡(지연 제출)'; achieved = true; }
  else { verdict = '통과'; achieved = true; }
  if (sub?.verdict === 'pass'){ verdict = '통과(교사)'; achieved = true; }
  if (sub?.verdict === 'fail'){ verdict = '미흡(교사)'; achieved = false; }
  return { verdict, achieved, onTime, length:len };
}
// 통과/미흡을 손으로 못박는다(같은 값을 다시 누르면 자동 판정으로 되돌린다).
export function setSubVerdict(subId, v){
  const s = DEMO.submissions.find(x => x.id === subId); if (!s) return null;
  s.verdict = (s.verdict === v) ? null : v;
  put(COLLECTIONS.courseSubmissions, s);
  return s;
}

/* AI 채점 (hoistory/lms 생각 Check 채점 모달의 thRunGrading 이식) ──────────────────
   아직 채점 안 된 제출만 매긴다(채점된 것은 고정). 결과는 제출 문서에 그대로 남긴다:
   graded, aiScore(품질 0~100), aiVerdict, aiPt.
     50자 미만        : 미흡(50자 미만), 0pt. AI에 보내지 않는다
     품질 40 미만      : 조금 미흡, 5pt (성적 달성도 꺼진다, questionVerdict)
     그 밖            : 통과 또는 미흡(지연 제출), 10~30pt
   hoistory는 여기서 경험치를 바로 줬다. 2027은 경험치(course_xp)가 아직 없어
   aiPt만 적어 둔다. 이탈(cheatCount)은 학생 화면에 이탈 감시가 없어 뺐다. */
const QUESTION_MAX_PT = 30;
const QUESTION_FULL_Q = 94;   // 이 품질부터 만점(hoistory THINK_FULL_Q)

export async function gradeQuestionsAI(clId, onStatus = () => {}){
  const cl = DEMO.courseLessons.find(x => x.id === clId);
  const lesson = cl && getLesson(cl.lessonId);
  const q = lesson?.parts?.question;
  if (!q) throw new Error('질문이 걸린 강의가 아닙니다.');
  const course = getCourse(cl.courseId);
  const ungraded = getQuestionSubs(clId).filter(s => !s.graded);
  if (!ungraded.length) return 0;

  const short = [], needAi = [];
  ungraded.forEach(s => (questionVerdict({ ...s, verdict:null }).length < 50 ? short : needAi).push(s));

  const quality = {};
  if (needAi.length){
    onStatus(`${needAi.length}개 답변을 채점하고 있습니다.`);
    const who = course ? `${course.subject} 수업(중학교 ${course.grade}학년)` : '수업';
    const prompt = `${who}의 질문에 대한 학생 답변을 채점합니다. 학생 답변은 보통 공백 제외 150자 안팎으로 짧습니다. 길이가 짧다는 이유로 감점하지 마세요. "질문 취지에 맞게 자기 생각을 근거와 함께 썼는가"를 봅니다. 중학생 눈높이에서 격려하는 태도로 보되, 점수는 실제 품질에 따라 분명히 구분해서 매기세요. 성의 있게 자기 생각을 쓴 보통 수준의 답은 75~85 구간이 기본입니다. 자기 입장이 분명하고 근거나 구체적 사례를 갖춘 답에는 90점 이상을 주는 데 인색하지 마세요.
- 90~100: 자기 입장이 분명하고 이유, 근거나 구체적 사례를 갖춰 설득력이 있음
- 75~89: 질문 취지에 맞게 자기 생각을 성의 있게 씀 (성실한 답의 대부분이 여기)
- 60~74: 자기 생각은 있으나 근거 없이 단편적이거나 질문과 살짝 어긋남
- 45~59: 관련은 있으나 한두 문장으로 성의가 뚜렷이 부족
- 0~44: 질문과 완전히 무관, 무의미한 반복이나 복붙, 장난 답변
질문: "${q.prompt || ''}"
${q.guide ? `수업 참고: "${String(q.guide).slice(0, 300)}"` : ''}
답변 목록(JSON): ${JSON.stringify(needAi.map(s => ({ subId:s.id, text:s.answer || '' })))}
응답은 JSON 배열만 출력(다른 텍스트 없이): [{"subId":"...","quality":0~100 정수}]`;
    const res = await fetch(CLAUDE_PROXY_URL, {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:1024, messages:[{ role:'user', content:prompt }] })
    });
    if (!res.ok) throw new Error(`채점에 실패했습니다. (API ${res.status})`);
    const data = await res.json();
    const arr = JSON.parse((data.content?.[0]?.text || '[]').replace(/```json|```/g, '').trim());
    arr.forEach(r => { const n = Math.round(Number(r.quality)); if (isFinite(n)) quality[r.subId] = Math.max(0, Math.min(100, n)); });
  }

  onStatus('채점 결과를 저장하고 있습니다.');
  const commit = (s, pt, verdict, score) => {
    Object.assign(s, { graded:true, aiPt:pt, aiVerdict:verdict, aiScore:score == null ? null : score });
    put(COLLECTIONS.courseSubmissions, s);
  };
  short.forEach(s => commit(s, 0, '미흡(50자 미만)', null));
  needAi.forEach(s => {
    const n = quality[s.id];
    if (n == null || n < 40){ commit(s, 5, '조금 미흡', n); return; }
    const pt = Math.max(10, Math.min(QUESTION_MAX_PT,
      Math.round(10 + (n - 40) / (QUESTION_FULL_Q - 40) * (QUESTION_MAX_PT - 10))));
    const late = !questionVerdict({ ...s, verdict:null }).onTime;
    commit(s, pt, late ? '미흡(지연 제출)' : '통과', n);
  });
  onStatus('');
  return short.length + needAi.length;
}

// 재채점: 그 강의의 채점 결과와 손으로 정한 통과/미흡을 지운 뒤 다시 매긴다.
export async function regradeQuestionsAI(clId, onStatus){
  getQuestionSubs(clId).filter(s => s.graded).forEach(s => {
    Object.assign(s, { graded:false, aiPt:null, aiScore:null, aiVerdict:null, verdict:null });
    put(COLLECTIONS.courseSubmissions, s);
  });
  return gradeQuestionsAI(clId, onStatus);
}

/* ── 미션 앱 등록부 (hoistory/lms 미션 Check 카드 틀 이식) ──
   문서 id가 곧 앱 키(apps/ 아래 폴더 이름)다. hoistory 카드가 들고 있던 것을 그대로 옮겼다:
   제목, 학생 주소, 어드민 주소, 아이콘, 연결할 강의, 팝업으로 열기, 아카이브 세 칸
   (수업 주제, 활동 의도, 아카이브 내용). 아카이브는 나중에 공개 페이지가 그대로 읽는다. */
export function addMissionApp({ name, studentUrl, adminUrl, key, icon, lessonId, modal, archive }){
  const nm = String(name || '').trim(); if (!nm) throw new Error('앱 이름을 적어 주세요.');
  const id = String(key || '').trim() || nid('app_');
  if (DEMO.missionApps.some(a => a.id === id)) throw new Error('이미 있는 앱 키입니다.');
  const a = { id, name:nm, studentUrl:String(studentUrl || '').trim(), adminUrl:String(adminUrl || '').trim(),
              icon:String(icon || '').trim(), lessonId:lessonId || '', modal:!!modal,
              archive:{ topic:'', intent:'', content:'', ...(archive || {}) } };
  DEMO.missionApps.push(a); put(COLLECTIONS.missionApps, a); return a;
}
export function updateMissionApp(id, patch){
  const a = getMissionApp(id); if (!a) return null;
  ['name','studentUrl','adminUrl','icon'].forEach(k => { if (patch[k] != null) a[k] = String(patch[k]).trim(); });
  if (patch.lessonId != null) a.lessonId = patch.lessonId || '';
  if (patch.modal != null) a.modal = !!patch.modal;
  if (patch.archive) a.archive = { ...(a.archive || {}), ...patch.archive };
  put(COLLECTIONS.missionApps, a); return a;
}
export function deleteMissionApp(id){
  DEMO.missionApps = DEMO.missionApps.filter(a => a.id !== id);
  del(COLLECTIONS.missionApps, id);
}

/* ── 학생 로그인: 학번, 이름, 비밀번호 (선생님 지시 2026-10-28) ──────────────────
   Firebase Auth를 쓰지 않는다(2026-10-23 결정). course_auth 문서 { pw, courseId }를
   학년도_학번 id로 두고, 로그인 때만 그 한 건을 읽는다(통째로 불러오지 않는다).
   처음 온 학생(그 문서가 없음)은 비밀번호를 만드는 쪽으로, 그다음부터는
   비밀번호를 맞혀야 들어오는 쪽으로 index.js가 나눠 보낸다.

   필드 이름과 문서 모양은 hoistory의 firestore.rules가 이미 정해 둔 것을 그대로 따른다
   (create 전용, hoistory/firestore.rules 506~516행): `keys().hasOnly(['pw','courseId'])`,
   `pw`는 `^[0-9a-f]{64}$`, `onYearRoster(id, courseId)`가 그 학번이 courseId 강의실
   명단(course_students)에 있고 그 강의실이 이 학년도인지를 본다. 필드 이름이나 모양을
   바꾸면 규칙에 막혀 학생이 비밀번호를 아예 못 만든다. */
async function sha256Hex(text){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// 그 학년도에 든 강의실 중 한 곳이라도 명단 이름이 같으면 통과
export function matchesRosterName(year, studentNo, name){
  const nm = String(name ?? '').trim(); if (!nm) return false;
  return getCoursesOfStudent(year, studentNo)
    .some(c => DEMO.students.find(s => s.courseId === c.id && s.studentNo === studentNo)?.name === nm);
}
export async function getAuthRecord(year, studentNo){
  const snap = await getDoc(doc(db, COLLECTIONS.courseAuth, `${year}_${studentNo}`));
  return snap.exists() ? snap.data() : null;
}
// 처음 한 번만 만든다(이미 있으면 안 덮어쓴다: 비번 초기화는 어드민의 다음 단계).
// courseId는 그 학번이 든 강의실 중 아무 곳(규칙은 명단에 있는지만 본다).
export async function createPassword(year, studentNo, password, courseId){
  const id = `${year}_${studentNo}`;
  if (await getAuthRecord(year, studentNo)) throw new Error('이미 비밀번호가 있습니다.');
  await setDoc(doc(db, COLLECTIONS.courseAuth, id), { pw: await sha256Hex(password), courseId });
}
export async function verifyPassword(year, studentNo, password){
  const rec = await getAuthRecord(year, studentNo);
  return !!rec && rec.pw === await sha256Hex(password);
}
