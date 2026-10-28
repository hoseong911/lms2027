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

  // ── 나중(예약): 해당 단계에서 실제로 만든다 ──
  quizzes:            'quizzes',        // 복습 문제 창고            (5단계 복습 허브)
  courseQuizzes:      'course_quizzes', // 강의실에 걸린 복습        (5단계)
  missionApps:        'mission_apps',   // 미션 미니앱 등록부        (3단계)
  courseConsent:      'course_consent', // 학생 동의서              (학생 화면 붙일 때)
  courseScores:       'course_scores',  // 성적 요약(집계가 무거워지면 얹음. 그 전엔 제출물에서 도출)
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
  question: [ { v:'manage',  label:'질문 관리' }, { v:'answers', label:'답변, 채점' } ],
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
  submissions:  [],   // course_submissions { id:'꽂힌강의id_칸_학번', clId, part, courseId, studentNo, name, answer, score, max, shared }

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
  const [ys, cs, ss, cls, ls, subs, gen] = await Promise.all([
    getDocs(collection(db, C.schoolYears)),
    getDocs(collection(db, C.courses)),
    getDocs(collection(db, C.courseStudents)),
    getDocs(collection(db, C.courseLessons)),
    getDocs(collection(db, C.lessons)),
    getDocs(collection(db, C.courseSubmissions)),
    getDoc(doc(db, 'settings', 'general')),
  ]);
  const rows = snap => snap.docs.map(d => ({ ...d.data(), id:d.id }));
  DEMO.years       = rows(ys).sort((a,b) => b.year - a.year);
  DEMO.courses     = rows(cs);
  DEMO.students    = rows(ss);
  DEMO.courseLessons = rows(cls);
  DEMO.lessons     = rows(ls);
  DEMO.submissions = rows(subs);
  siteTexts        = gen.exists() ? (gen.data().texts || {}) : {};
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
/* ── 성적 (2026-10-28 선생님 지시 "성적 메뉴 만들어보자") ─────────────────
   포트폴리오 세 요소만 들어간다(요구사항 70). 형성평가와 복습은 빠진다.
   집계 컬렉션(course_scores)을 따로 두지 않고 course_submissions에서 뽑는다(머리 주석).
     개념노트 : 활동지에 수기로 쓰므로 LMS에 제출물이 없다. 교사가 넣는 점수를
                part:'concept' 제출물 행으로 남긴다(선생님 지시: 강의 차시마다 입력).
     미션     : 점수가 아니라 참여 여부다. 낸 차시마다 1점, 만점은 미션이 걸린 차시 수.
     질문노트 : 제출물의 score를 더한다.
   배점은 강의(차시)마다 하나씩 lessons.parts.<칸>.max에 둔다. 강의가 창고에 있는 것이라
   그 강의를 꽂은 모든 강의실에 같은 배점이 걸린다. 제출물이 없는 학생도 그 차시 배점은
   만점에 들어간다(안 낸 것이 점수에 드러나게). */
export function partMax(lessonId, partKey){
  return +(getLesson(lessonId)?.parts?.[partKey]?.max) || 0;
}
export function setPartMax(lessonId, partKey, max){
  const l = getLesson(lessonId), p = l?.parts?.[partKey];
  if (!p) throw new Error('그 칸이 없는 강의입니다.');
  const raw = String(max ?? '').trim();
  const n = raw === '' ? 0 : Math.round(+raw);
  if (!Number.isFinite(n) || n < 0) throw new Error('배점을 확인해 주세요.');
  p.max = n;
  put(COLLECTIONS.lessons, l);
  return n;
}
function subOf(clId, part, studentNo){
  return DEMO.submissions.find(s => s.clId === clId && s.part === part && s.studentNo === studentNo) || null;
}
// 개념노트 점수(교사 수기 입력). 빈칸으로 두면 기록을 지운다.
export function setConceptScore(clId, studentNo, score){
  const cl = DEMO.courseLessons.find(x => x.id === clId);
  if (!cl) throw new Error('강의를 찾지 못했습니다.');
  const id = `${clId}_concept_${studentNo}`;
  const i = DEMO.submissions.findIndex(s => s.id === id);
  const raw = String(score ?? '').trim();
  if (raw === ''){
    if (i >= 0){ DEMO.submissions.splice(i, 1); del(COLLECTIONS.courseSubmissions, id); }
    return null;
  }
  const n = +raw;
  if (!Number.isFinite(n) || n < 0) throw new Error('점수를 확인해 주세요.');
  const stu = DEMO.students.find(s => s.courseId === cl.courseId && s.studentNo === studentNo);
  const row = { ...(i >= 0 ? DEMO.submissions[i] : {}),
    id, clId, part:'concept', courseId:cl.courseId, studentNo, name:stu?.name || '', score:n };
  if (i >= 0) DEMO.submissions[i] = row; else DEMO.submissions.push(row);
  put(COLLECTIONS.courseSubmissions, row);
  return row;
}

/* 한 학생의 한 강의실 성적: 차시별 내역(lines)과 항목별, 최종 합계.
   lines의 각 칸은 그 차시에 그 칸이 없으면 null이다. */
export function courseScore(courseId, studentNo){
  const items = { concept:{ got:0, max:0 }, mission:{ got:0, max:0 }, question:{ got:0, max:0 } };
  const lines = getCourseLessons(courseId).map((cl, i) => {
    const parts = cl.lesson?.parts || {};
    const line = { clId:cl.id, lessonId:cl.lessonId, no:i + 1,
                   title:cl.lesson?.title || '(삭제된 강의)', concept:null, mission:null, question:null };
    if (parts.concept){
      const mx = +parts.concept.max || 0, got = subOf(cl.id, 'concept', studentNo)?.score;
      line.concept = { score: got ?? null, max: mx };
      items.concept.got += (+got || 0); items.concept.max += mx;
    }
    if (parts.mission){
      const done = !!subOf(cl.id, 'mission', studentNo);
      line.mission = { done };
      items.mission.got += done ? 1 : 0; items.mission.max += 1;
    }
    if (parts.question){
      const sub = subOf(cl.id, 'question', studentNo);
      const mx = +parts.question.max || +sub?.max || 0;
      line.question = { score: sub?.score ?? null, max: mx, sent: !!sub };
      items.question.got += (+sub?.score || 0); items.question.max += mx;
    }
    return line;
  });
  const total = { got:0, max:0 };
  PART_TYPES.filter(p => p.portfolio).forEach(p => { total.got += items[p.key].got; total.max += items[p.key].max; });
  return { lines, items, total, has: total.max > 0 || total.got > 0 };
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
export function setQuestion(lessonId, patch){
  const l = getLesson(lessonId); if (l?.parts?.question){ Object.assign(l.parts.question, patch); saveLesson(lessonId); }
}
export function getQuestionSubs(clId){
  return DEMO.submissions.filter(s => s.clId === clId && s.part === 'question');
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

// ── 미션 앱 등록부 CRUD: 문서 id가 곧 앱 키(apps/ 폴더 이름) ──
export function addMissionApp({ name, studentUrl, adminUrl, key }){
  const nm = String(name || '').trim(); if (!nm) throw new Error('앱 이름을 적어 주세요.');
  const id = String(key || '').trim() || nid('app_');
  if (DEMO.missionApps.some(a => a.id === id)) throw new Error('이미 있는 앱 키입니다.');
  const a = { id, name:nm, studentUrl:String(studentUrl || '').trim(), adminUrl:String(adminUrl || '').trim() };
  DEMO.missionApps.push(a); return a;
}
export function updateMissionApp(id, patch){
  const a = getMissionApp(id); if (!a) return null;
  if (patch.name != null) a.name = String(patch.name).trim();
  if (patch.studentUrl != null) a.studentUrl = String(patch.studentUrl).trim();
  if (patch.adminUrl != null) a.adminUrl = String(patch.adminUrl).trim();
  return a;
}
export function deleteMissionApp(id){ DEMO.missionApps = DEMO.missionApps.filter(a => a.id !== id); }

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
