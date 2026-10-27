// model.js — LMS2027 뼈대 (2026-10-26 제로베이스 재설계)
// ───────────────────────────────────────────────────────────────────────────
// 데이터 모델의 단일 출처. 컬렉션 이름, 칸/메뉴 표, (지금은) 데모 데이터와 조회를 한곳에 둔다.
// 학생 화면(index.js)과 어드민(admin.js)이 이 파일 하나만 읽어 같은 표를 쓴다.
//
// 조직 원리:
//   강의실(course)은 "강의(차시)"와 "복습"을 담고,
//   강의 하나는 개념노트 / 미션 / 질문노트 / 형성평가 네 칸을 각각 있거나 없거나로 채운다.
//   각 종류 최대 1개, 순서 자유. 사료·사진·영상은 개념노트 안의 내용.
//
// ※ 지금은 Firestore 대신 아래 DEMO(메모리)로 돈다. 화면 뼈대를 먼저 보기 위함.
//   컬렉션 이름과 문서 모양은 실제와 같게 맞춰 두었으므로, 다음 단계에서 이 파일의
//   조회 함수만 Firestore 호출로 바꾸면 화면은 그대로 둔다.
// ───────────────────────────────────────────────────────────────────────────

// 컬렉션 이름 — 강의실에 매인 것은 course_ 접두, 재사용 창고는 접두 없는 복수형.
export const COLLECTIONS = {
  schoolYears:        'school_years',
  courses:            'courses',
  courseStudents:     'course_students',
  courseAuth:         'course_auth',
  courseConsent:      'course_consent',
  courseLessons:      'course_lessons',
  courseQuizzes:      'course_quizzes',
  courseSubmissions:  'course_submissions',
  courseScores:       'course_scores',
  courseXp:           'course_xp',
  lessons:            'lessons',
  quizzes:            'quizzes',
  missionApps:        'mission_apps',
};

// 강의 안 네 칸 — 각 강의에 최대 1개, 순서 자유.
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

/* 학생이 강의실 안에서 쓰는 세 배치 (선생님 지시 2026-10-27, 요구사항 85·90)
 *   강의 보기 — 1강, 2강을 고르면 그 강의의 칸이 차례로 이어진다
 *   메뉴      — 개념노트만, 미션만 모아 본다. 2026 lms 메뉴와 같은 방식
 *   콘텐츠    — 뽑기, 게임 같은 흥미 요소가 들어올 자리(요구사항 69의 다섯 번째 용도). 아직 비었다
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
// 칸 이름(PART_TYPES)과 메뉴 이름이 다른 것이 있다 — 메뉴는 선생님이 부르는 이름으로 쓴다.
export const ADMIN_MENUS = [
  { key:'rooms',     name:'강의실 관리',     icon:'graduation-cap' },
  { key:'students',  name:'학생 관리',       icon:'users' },
  { key:'lessons',   name:'강의 라이브러리', icon:'book' },
  { key:'progress',  name:'진도 관리',       icon:'clipboard-list' },
  { key:'concept',   name:'개념 노트',       icon:'book-open' },
  { key:'mission',   name:'미션 활동',       icon:'layout-grid' },
  { key:'question',  name:'오늘의 질문',     icon:'message-square' },
  { key:'formative', name:'형성평가',        icon:'circle-check' },
  { key:'review',    name:'복습',           icon:'list-ordered' },
  { key:'grading',   name:'채점, 공유',      icon:'clipboard-check' },
];

// 메뉴 안의 서브 메뉴. 미션 활동은 열어 둔 앱이 탭이 되므로 여기 적지 않는다.
export const ADMIN_SUBMENUS = {
  concept:  [ { v:'content', label:'콘텐츠' },    { v:'design',  label:'디자인' } ],
  question: [ { v:'manage',  label:'질문 관리' }, { v:'answers', label:'답변, 채점' } ],
};

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
// 데모 데이터 (Firestore 붙이기 전 임시). 한 세션 안에서는 추가/삭제가 반영된다.
// ───────────────────────────────────────────────────────────────────────────
const DEMO = {
  years: [ { id:'2027', year:2027 } ],

  courses: [
    { id:'c_s301', year:2027, subject:'사회', grade:3, classNo:1, status:'active' },
    { id:'c_s302', year:2027, subject:'사회', grade:3, classNo:2, status:'active' },
    { id:'c_h301', year:2027, subject:'역사', grade:3, classNo:1, status:'active' },
  ],

  // course_students: id = 강의실id_학번
  students: [
    { id:'c_s301_30101', courseId:'c_s301', studentNo:'30101', name:'홍길동' },
    { id:'c_s301_30102', courseId:'c_s301', studentNo:'30102', name:'김영희' },
    { id:'c_s301_30103', courseId:'c_s301', studentNo:'30103', name:'이철수' },
    { id:'c_h301_30101', courseId:'c_h301', studentNo:'30101', name:'홍길동' },
    { id:'c_h301_30102', courseId:'c_h301', studentNo:'30102', name:'김영희' },
    { id:'c_s302_30201', courseId:'c_s302', studentNo:'30201', name:'박민지' },
  ],

  // lessons: 재사용 창고. parts에 있는 칸만 그 강의가 가진 칸. order가 칸 순서.
  lessons: [
    { id:'L1', title:'붕당정치의 전개',
      parts:{ concept:{ title:'붕당의 형성과 전개', content:[
                { type:'divider', title:'붕당의 형성' },
                { type:'row', text:'선조 때 사림이 동인과 서인으로 나뉘었다.' },
                { type:'row', text:'척신 정치 청산을 둘러싼 갈등이 계기가 되었다.' },
                { type:'divider', title:'붕당의 전개' },
                { type:'row', text:'동인은 다시 남인과 북인으로 갈라졌다.' },
              ] },
              mission:{ appKey:'4cut', title:'네컷 만화 그리기' },
              question:{ title:'오늘의 질문', prompt:'붕당정치의 긍정적 면과 부정적 면은 무엇인가?', guide:'두 측면을 모두 한 문장 이상으로 쓴다.' },
              formative:{ title:'OX 5문항', items:[
                { type:'ox',      q:'붕당은 선조 때 처음 갈라졌다.' },
                { type:'short',   q:'동인과 서인으로 갈라진 계기가 된 자리는?' },
                { type:'initial', q:'붕당의 시작이 된 인물 둘 가운데 한 명 (ㄱㅎㅇ)' },
                { type:'choice',  q:'다음 중 서인에 속한 인물은?' },
              ] } },
      order:['concept','mission','question','formative'] },
    { id:'L2', title:'예송논쟁',
      parts:{ concept:{ title:'예송논쟁의 쟁점' } },
      order:['concept'] },
    { id:'L3', title:'환국',
      parts:{ mission:{ appKey:'timeline', title:'환국 타임라인' },
              formative:{ title:'환국 확인 퀴즈', items:[] } },
      order:['mission','formative'] },
  ],

  // course_lessons: 강의실에 꽂힌 자리. date는 그 강의실의 수업일자('M/D', 진도표의 셀)
  courseLessons: [
    { id:'cl1', courseId:'c_s301', lessonId:'L1', order:1, isOpen:true,  date:'9/3'  },
    { id:'cl2', courseId:'c_s301', lessonId:'L2', order:2, isOpen:true,  date:'9/10' },
    { id:'cl3', courseId:'c_s301', lessonId:'L3', order:3, isOpen:false, date:'9/17' },
  ],

  quizzes: [
    { id:'Q1', title:'붕당정치 복습 OX',        source:'auto',     items:[] },
    { id:'Q2', title:'조선 후기 외부 문제모음',  source:'external', items:[] },
  ],
  courseQuizzes: [
    { id:'cq1', courseId:'c_s301', quizId:'Q1', isOpen:true },
  ],

  // mission_apps: 문서 id가 곧 앱 키(= apps/ 아래 폴더 이름). 주소 둘은 APP_규약.md의 표 그대로.
  missionApps: [
    { id:'_template', name:'템플릿',        studentUrl:'apps/_template/index.html', adminUrl:'apps/_template/admin.html' },
    { id:'4cut',      name:'네컷 만화',      studentUrl:'apps/4cut/index.html',      adminUrl:'apps/4cut/admin.html' },
    { id:'timeline',  name:'타임라인',       studentUrl:'apps/timeline/index.html',  adminUrl:'apps/timeline/admin.html' },
  ],

  // course_submissions: 제출물(지금은 오늘의 질문 답변만 데모). clId = 꽂힌 강의 자리.
  submissions: [
    { id:'sub1', clId:'cl1', part:'question', courseId:'c_s301', studentNo:'30101', name:'홍길동',
      answer:'붕당정치는 여론을 모으는 긍정적 면과, 대립이 깊어지면 정치가 마비되는 부정적 면이 있다.', score:null, max:15, shared:false },
    { id:'sub2', clId:'cl1', part:'question', courseId:'c_s301', studentNo:'30102', name:'김영희',
      answer:'서로 견제해 권력 독점을 막지만, 싸움이 길어지면 백성이 피해를 본다.', score:12, max:15, shared:true },
  ],

  // course_scores: 강의실id_학번
  scores: [
    { id:'c_s301_30101', courseId:'c_s301', studentNo:'30101',
      items:{ concept:18, mission:9, question:14 }, max:{ concept:20, mission:10, question:15 } },
  ],

  // course_xp: 강의실id_학번. 레벨은 저장하지 않고 xp에서 계산한다.
  xp: [
    { id:'c_s301_30101', courseId:'c_s301', studentNo:'30101', xp:420, point:15 },
    { id:'c_s301_30102', courseId:'c_s301', studentNo:'30102', xp:180, point:8  },
  ],
};

/* 레벨 표 — 2026 LMS shared/xp.js의 기본값을 그대로 옮겼다(누적 경험치 기준).
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

// ── 조회 (뒤에 Firestore로 교체할 자리) ──
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
/* 메뉴별 배치가 쓰는 조회 — 한 강의실에서 그 칸을 가진 공개 강의만 차례로.
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
export function getScore(courseId, studentNo){
  return DEMO.scores.find(s => s.courseId === courseId && s.studentNo === studentNo) || null;
}
export function getXp(courseId, studentNo){
  return DEMO.xp.find(x => x.courseId === courseId && x.studentNo === studentNo) || null;
}

// ── 변경 (데모: 메모리에만. 다음 단계에서 Firestore 쓰기로 교체) ──
let seq = 100;
const nid = p => `${p}${++seq}`;
/* 학년도 — 강의실이 없어도 학년도가 먼저 있어야 한다(요구사항 5, 16).
   비어 있는 데이터베이스에서 제일 먼저 만드는 것이 이것이다. */
export function addYear(year){
  const y = +year;
  if (!(y >= 2000 && y <= 2199)) throw new Error('학년도를 확인해 주세요.');
  if (DEMO.years.some(x => x.year === y)) throw new Error(`${y}학년도는 이미 있습니다.`);
  const row = { id:String(y), year:y };
  DEMO.years.push(row);
  DEMO.years.sort((a, b) => b.year - a.year);   // 큰 해부터
  return row;
}

/* 한 강의실을 지우면 같이 없어지는 것. 삭제 확인 창이 숫자를 보여 주는 데 쓴다. */
export function courseDeps(id){
  return {
    students: DEMO.students.filter(s => s.courseId === id).length,
    lessons:  DEMO.courseLessons.filter(cl => cl.courseId === id).length,
    quizzes:  DEMO.courseQuizzes.filter(cq => cq.courseId === id).length,
  };
}

export function addCourse({ year, subject, grade, classNo }){
  const c = { id:nid('c_'), year:+year, subject:String(subject).trim(), grade:+grade, classNo:+classNo, status:'active' };
  if (!c.subject) throw new Error('과목을 적어 주세요.');
  if (!(c.grade >= 1 && c.grade <= 6)) throw new Error('학년을 확인해 주세요.');
  if (!(c.classNo >= 1 && c.classNo <= 99)) throw new Error('반을 확인해 주세요.');
  if (sameRoomExists(c)) throw new Error(`${roomName(c)} 강의실이 이미 있습니다.`);
  DEMO.courses.push(c); return c;
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
  return c;
}

/* 강의실 하나 삭제 — 그 강의실에 매인 것(course_ 접두)이 전부 같이 없어진다.
   창고(lessons, quizzes)는 건드리지 않는다. 강의 내용 자체는 남는다. */
export function deleteCourse(id){
  const c = getCourse(id); if (!c) return null;
  DEMO.courses = DEMO.courses.filter(x => x.id !== id);
  DEMO.students = DEMO.students.filter(s => s.courseId !== id);
  DEMO.courseLessons = DEMO.courseLessons.filter(cl => cl.courseId !== id);
  DEMO.courseQuizzes = DEMO.courseQuizzes.filter(cq => cq.courseId !== id);
  DEMO.scores = DEMO.scores.filter(s => s.courseId !== id);
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
    DEMO.students.push(s); added.push(s);
  });
  return { rooms, added };
}
export function removeStudentEverywhere(year, studentNo){
  const ids = new Set(DEMO.courses.filter(c => c.year === +year).map(c => c.id));
  DEMO.students = DEMO.students.filter(s => !(ids.has(s.courseId) && s.studentNo === studentNo));
}
// 학생 한 명을 한 강의실에 넣고 빼기 — 수강 과목(강의실) 체크에 쓴다.
export function enrollStudent(courseId, studentNo, name){
  const c = getCourse(courseId); if (!c) return null;
  const id = `${courseId}_${studentNo}`;
  if (DEMO.students.some(s => s.id === id)) return null;
  const s = { id, courseId, studentNo, name: name || '' };
  DEMO.students.push(s); return s;
}
export function unenrollStudent(courseId, studentNo){
  const id = `${courseId}_${studentNo}`;
  const before = DEMO.students.length;
  DEMO.students = DEMO.students.filter(s => s.id !== id);
  return DEMO.students.length < before;
}
export function addLesson(title){
  const l = { id:nid('L'), title, parts:{}, order:[] };
  DEMO.lessons.push(l); return l;
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
}
export function moveLessonPart(lessonId, key, dir){
  const l = getLesson(lessonId); if (!l) return;
  const i = l.order.indexOf(key); if (i < 0) return;
  const j = i + dir; if (j < 0 || j >= l.order.length) return;
  [l.order[i], l.order[j]] = [l.order[j], l.order[i]];
}
export function placeLesson(courseId, lessonId){
  const order = DEMO.courseLessons.filter(c => c.courseId === courseId).length + 1;
  const cl = { id:nid('cl'), courseId, lessonId, order, isOpen:false };
  DEMO.courseLessons.push(cl); return cl;
}
export function toggleCourseLessonOpen(id){
  const cl = DEMO.courseLessons.find(c => c.id === id); if (cl) cl.isOpen = !cl.isOpen;
}
// 한 강의실 안에서 꽂힌 강의의 차례를 위/아래로(dir: -1 위, +1 아래). order 값을 맞바꾼다.
export function moveCourseLesson(courseId, clId, dir){
  const arr = DEMO.courseLessons.filter(c => c.courseId === courseId).sort((a,b) => a.order - b.order);
  const i = arr.findIndex(c => c.id === clId); if (i < 0) return;
  const j = i + dir; if (j < 0 || j >= arr.length) return;
  const a = arr[i], b = arr[j]; const t = a.order; a.order = b.order; b.order = t;
}
export function toggleCourseQuizOpen(id){
  const cq = DEMO.courseQuizzes.find(c => c.id === id); if (cq) cq.isOpen = !cq.isOpen;
}
// 수업일자('M/D') 저장 — 진도표와 강의실 상세가 같은 course_lessons를 써서 서로 맞물린다.
export function setCourseLessonDate(clId, date){
  const cl = DEMO.courseLessons.find(c => c.id === clId); if (!cl) return null;
  cl.date = String(date ?? '').trim(); return cl;
}
// 포트폴리오(성적) 요약 — 학생 한 명의 성적 doc에서 들어가는 칸만 합산. 없으면 null.
export function scoreSummary(courseId, studentNo){
  const s = getScore(courseId, studentNo); if (!s) return null;
  const keys = PART_TYPES.filter(p => p.portfolio).map(p => p.key);
  let got = 0, max = 0, any = false;
  keys.forEach(k => { if (s.items?.[k] != null){ got += s.items[k]; max += (s.max?.[k] || 0); any = true; } });
  return any ? { got, max } : null;
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
}
export function conceptSetLine(lessonId, idx, value){
  const c = conceptOf(lessonId), line = c?.[idx]; if (!line) return;
  if (line.type === 'divider') line.title = value; else line.text = value;
}
export function conceptMoveLine(lessonId, idx, dir){
  const c = conceptOf(lessonId); if (!c) return;
  const j = idx + dir; if (j < 0 || j >= c.length) return;
  [c[idx], c[j]] = [c[j], c[idx]];
}
export function conceptDelLine(lessonId, idx){
  const c = conceptOf(lessonId); if (c && c[idx]) c.splice(idx, 1);
}

// ── 오늘의 질문 ──
export function setQuestion(lessonId, patch){
  const l = getLesson(lessonId); if (l?.parts?.question) Object.assign(l.parts.question, patch);
}
export function getQuestionSubs(clId){
  return DEMO.submissions.filter(s => s.clId === clId && s.part === 'question');
}
export function setSubScore(subId, score){
  const s = DEMO.submissions.find(x => x.id === subId); if (!s) return;
  s.score = (score === '' || score == null) ? null : +score;
}
export function toggleSubShared(subId){
  const s = DEMO.submissions.find(x => x.id === subId); if (s) s.shared = !s.shared;
}

// ── 미션 앱 등록부 CRUD — 문서 id가 곧 앱 키(apps/ 폴더 이름) ──
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
