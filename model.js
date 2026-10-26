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

// 어드민 왼쪽 메뉴
export const ADMIN_MENUS = [
  { key:'rooms',    name:'강의실 관리',     icon:'graduation-cap' },
  { key:'students', name:'학생 관리',       icon:'users' },
  { key:'lessons',  name:'강의 라이브러리', icon:'book-open' },
  { key:'review',   name:'복습',           icon:'list-ordered' },
  { key:'grading',  name:'채점, 공유',      icon:'clipboard-check' },
];

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
      parts:{ concept:{ title:'붕당의 형성과 전개' },
              mission:{ appKey:'4cut', title:'네컷 만화 그리기' },
              question:{ title:'오늘의 질문', prompt:'붕당정치의 긍정적 면과 부정적 면은 무엇인가?' },
              formative:{ title:'OX 5문항' } },
      order:['concept','mission','question','formative'] },
    { id:'L2', title:'예송논쟁',
      parts:{ concept:{ title:'예송논쟁의 쟁점' } },
      order:['concept'] },
    { id:'L3', title:'환국',
      parts:{ mission:{ appKey:'timeline', title:'환국 타임라인' },
              formative:{ title:'환국 확인 퀴즈' } },
      order:['mission','formative'] },
  ],

  // course_lessons: 강의실에 꽂힌 자리
  courseLessons: [
    { id:'cl1', courseId:'c_s301', lessonId:'L1', order:1, isOpen:true  },
    { id:'cl2', courseId:'c_s301', lessonId:'L2', order:2, isOpen:true  },
    { id:'cl3', courseId:'c_s301', lessonId:'L3', order:3, isOpen:false },
  ],

  quizzes: [
    { id:'Q1', title:'붕당정치 복습 OX',        source:'auto',     items:[] },
    { id:'Q2', title:'조선 후기 외부 문제모음',  source:'external', items:[] },
  ],
  courseQuizzes: [
    { id:'cq1', courseId:'c_s301', quizId:'Q1', isOpen:true },
  ],

  // course_scores: 강의실id_학번
  scores: [
    { id:'c_s301_30101', courseId:'c_s301', studentNo:'30101',
      items:{ concept:18, mission:9, question:14 }, max:{ concept:20, mission:10, question:15 } },
  ],
};

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
export function getQuizzes(){ return [...DEMO.quizzes]; }
export function getCourseQuizzes(courseId){
  return DEMO.courseQuizzes
    .filter(cq => cq.courseId === courseId)
    .map(cq => ({ ...cq, quiz: DEMO.quizzes.find(q => q.id === cq.quizId) }));
}
export function getScore(courseId, studentNo){
  return DEMO.scores.find(s => s.courseId === courseId && s.studentNo === studentNo) || null;
}

// ── 변경 (데모: 메모리에만. 다음 단계에서 Firestore 쓰기로 교체) ──
let seq = 100;
const nid = p => `${p}${++seq}`;
export function addCourse({ year, subject, grade, classNo }){
  const c = { id:nid('c_'), year:+year, subject, grade:+grade, classNo:+classNo, status:'active' };
  DEMO.courses.push(c); return c;
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
