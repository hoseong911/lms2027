// 여러 페이지가 공유하는 공용 유틸.

// 생각 체크 등 AI 채점용 Claude 프록시(Cloud Function). 키는 서버 Secret Manager에만 있다.
export const CLAUDE_PROXY_URL = 'https://asia-northeast3-ho0911seong-56638.cloudfunctions.net/claudeProxy';

// 한국시간(KST, UTC+9) 기준 날짜(YYYY-MM-DD). 출석·마일리지·타이핑복습 일일 게이트, 대시보드 '오늘' 집계가 이 값을 쓴다.
export function kstDate(ms = Date.now()) {
  return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// ── 학습 활동 이용 시간 (히스토리 마일리지 / 타이핑 복습 / OX 퀴즈) ──
// 수업 시간 딴짓과 늦은 밤 이용을 함께 막는다. 시각은 언제나 한국시간(KST)으로 판정한다.
//   평일          15:00 ~ 24:00
//   주말, 공휴일  06:00 ~ 24:00  (재량휴업일도 공휴일 목록에 넣어 같은 규칙을 탄다)
// 공휴일 목록은 LMS 어드민 설정 SYSTEM의 [공휴일 지정]이 settings/holidays({dates:[YYYY-MM-DD]})에 쓴다.
// 그 문서가 아직 없으면 DEFAULT_HOLIDAYS를 쓴다(어드민에서 한 번 저장하면 그때부터는 문서가 기준).
export const STUDY_OPEN = { weekday: 15, restDay: 6 };

// 2026년 법정 공휴일(대체공휴일 포함) + 재량휴업일(11/19, 11/20)
export const DEFAULT_HOLIDAYS = [
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-01', '2026-03-02',
  '2026-05-05', '2026-05-24', '2026-05-25', '2026-06-03', '2026-06-06', '2026-08-15',
  '2026-08-17', '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-03', '2026-10-05',
  '2026-10-09', '2026-11-19', '2026-11-20', '2026-12-25',
];

// settings/holidays를 읽어 날짜 배열을 돌려준다. 페이지마다 Firebase SDK 버전이 달라
// doc/getDoc은 부르는 쪽 것을 넘겨받는다. 못 읽으면 기본 목록을 쓴다.
export async function loadHolidays(db, { doc, getDoc }) {
  try {
    const snap = await getDoc(doc(db, 'settings', 'holidays'));
    const dates = snap.exists() ? snap.data().dates : null;
    if (Array.isArray(dates)) return dates;
  } catch (_) {}
  return DEFAULT_HOLIDAYS;
}

// 주말이거나 공휴일 목록에 든 날이면 true.
export function isRestDay(ms = Date.now(), holidays = DEFAULT_HOLIDAYS) {
  const k = new Date(ms + 9 * 3600 * 1000); // KST로 옮긴 뒤 getUTC*로 읽는다
  const day = k.getUTCDay();
  return day === 0 || day === 6 || holidays.includes(k.toISOString().slice(0, 10));
}

// 이용 시간이 아니면 안내 문구를, 이용 가능하면 null을 돌려준다.
// ms는 가급적 서버 시각(Date.now() + RTDB serverTimeOffset)을 넘겨 기기 시계 조작을 무디게 한다.
export function studyClosedReason(ms = Date.now(), holidays = DEFAULT_HOLIDAYS) {
  const rest = isRestDay(ms, holidays);
  const hour = new Date(ms + 9 * 3600 * 1000).getUTCHours();
  if (hour >= (rest ? STUDY_OPEN.restDay : STUDY_OPEN.weekday)) return null;
  return rest
    ? '주말과 공휴일은 오전 6시부터 자정까지 할 수 있어요. 조금 뒤에 다시 와 주세요'
    : '평일은 오후 3시부터 자정까지 할 수 있어요. 수업 마친 뒤에 다시 와 주세요';
}
