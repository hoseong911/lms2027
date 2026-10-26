# 미션 앱 규약

새 활동 웹앱을 만들 때 **반드시 같게 할 것**을 모아 둔 문서다.
구조는 2026 그대로다 — 앱을 따로 만들고 LMS는 주소로만 잇는다.
갈라진 적이 있는 네 가지만 여기서 고정한다.

> 왜 이 문서가 생겼나 (2026-10-26)
> 2026 앱 13개를 전수로 열어 보니, `CLAUDE.md`에 **글로 적은 것은 거의 다 지켜졌고**
> 적지 않은 것만 앱마다 갈라져 있었다. 그래서 더 적는다.
> 검토 문서: https://claude.ai/code/artifact/19ec6d42-5f35-4315-9ea6-523fedbbaf81

---

## 새 앱 만들기 (순서대로)

1. `apps/_template/` 폴더를 통째로 복사하고 폴더 이름을 앱 이름으로 바꾼다
2. `index.html`과 `admin.html`의 `APP_KEY`를 **폴더 이름과 똑같이** 고친다
3. `<title>`을 고친다 — 학생 화면은 "앱 이름", 어드민은 "앱 이름 : 관리자 모드"
4. 내용을 만든다
5. LMS 어드민의 **미션 체크**에서 [미션 추가]를 누르고 아래를 적는다

| 칸 | 넣는 값 | 예 |
|---|---|---|
| 미션 제목 | 학생에게 보일 이름 | 조선 전기 가상 인터뷰 |
| 강 번호 | 연결할 강의 번호(비워도 됨) | 12 |
| 앱 키 | **폴더 이름** | `j_interview` |
| 학생 주소 | 학생이 여는 파일 | `apps/j_interview/index.html` |
| 어드민 주소 | 선생님이 여는 파일 | `apps/j_interview/admin.html` |

6. [올릴 강의실]로 쓸 반을 고르고, 공개 스위치를 켠다

**앱 키가 폴더 이름과 다르면 성적이 붙지 않는다.** 그것만 주의한다.
2026 hoistory 앱을 그대로 쓸 때는 주소에 **전체 주소**를 적는다
(`https://hoseong911.github.io/hoistory/apps/j_4cut/index.html`).

---

## 1. 학생이 누구인지 — `shared/lms-session.js`만 쓴다

```js
import { requireStudent } from '../../shared/lms-session.js';
const me = requireStudent(document.getElementById('gate'));
if (!me) { /* 안내가 이미 그려졌다. 여기서 끝 */ }
// me = { studentId, name, courseId, year, grade, classNo, num }
```

**`sessionStorage`를 직접 읽지 않는다.** 2026에 앱마다 따로 읽다가 네 갈래로 갈라졌고,
다섯 앱은 자동 로그인을 끈 학생을 못 들여보냈다. 칸 이름도 `name`과 `studentName`으로 갈렸다.

돌려주는 칸 이름은 **고정**이다. 바꾸지 않는다.

---

## 2. 제출과 채점 — `shared/lms-submit.js`만 쓴다

데이터를 두 군데로 나눈다.

| 어디에 | 무엇을 | 누가 읽나 |
|---|---|---|
| `mission_submissions` | **냈다 / 통과했다**는 사실만 | LMS 성적 |
| `{앱키}_{기능}` | 작품 내용, 좌표, 그림 | 그 앱만 |

```js
// 학생이 낼 때 — 이 한 줄이면 LMS 성적에 붙는다
await markSubmitted(db, APP_KEY, me);

// 선생님이 채점할 때
await setStatus(db, APP_KEY, YEAR, studentId, 'pass');   // 'pass' | 'fail' | null
```

**지킬 것**
- 제출 컬렉션을 앱마다 새로 파지 않는다. 2026에는 그래서 앱 목록을 LMS 코드에 적어야 했고, 채점 있는 11개 중 4개만 성적에 붙었다
- 그림이나 긴 글을 `mission_submissions`에 넣지 않는다. 목록을 통째로 받는 자리가 있다
- 채점은 `status` 한 칸이다. `'pass'`, `'fail'`, 칸 없음(미채점) 셋뿐이다
- 처음 낸 시각(`submittedAt`)은 **다시 내도 바뀌지 않는다**. 기한 판정의 기준이라 그렇다

---

## 3. 컬렉션 이름 — `appCollection()`이 검사한다

```js
const WORKS = appCollection(APP_KEY, 'works');   // "j_interview_works"
```

- 형식은 **`{앱키}_{기능}`** snake_case
- **연도나 학기 번호를 이름에 넣지 않는다.** 연도는 필드로만 (`escape26_2`, `silla_v3` 같은 것 금지)
- camelCase 금지
- 함수가 규칙을 어기면 바로 예외를 던진다. 직접 문자열로 적지 말고 이 함수를 쓴다

**문서 id는 `{학년도}_{학번}`**으로 짓는다. 학년도가 없으면 다음 해 같은 학번이 작년 작품을 물려받는다.

새 컬렉션을 만들면 **`hoistory/firestore.rules`에 블록을 더해야 한다**
(규칙 파일은 Firebase 프로젝트에 하나뿐이라 hoistory에 있다).

---

## 4. 화면 — `shared/app-base.css`만 쓴다

```html
<link rel="stylesheet" href="../../shared/app-base.css">
<body class="app">              <!-- 학생 화면 -->
<body class="app app-admin">    <!-- 어드민 -->
```

**색은 `--app-*` 변수로만 쓴다.** 앱 파일에 `#FF6B3D` 같은 값을 직접 적지 않는다.

부품은 이미 있다 — `.app-card` `.app-btn` `.app-ib` `.app-tabs` `.app-badge` `.app-inp` `.app-table` `.app-toast` `.app-empty`.

**화면 규칙** (`CLAUDE.md`와 같다)
- 알약 모양(`border-radius:999px`) 테두리를 쓰지 않는다
- 테두리는 진짜 액션 버튼에만. 모서리 8px
- 배지는 테두리 없는 배경색. 탭은 테두리와 배경 없이 글자만, 켜진 것 아래 굵은 선
- 카드 가장자리 색 띠("네일팁")를 두지 않는다. 어느 방향이든
- 작은 글씨 설명문을 버튼이나 입력칸 밑에 붙이지 않는다
- 가운뎃점(`·`)과 화살표(`→`)로 항목을 잇지 않는다
- **이모지를 쓰지 않는다.** 아이콘은 `shared/icons.js`의 `icon()` SVG만
- 숫자 칸에 위아래 화살표를 두지 않는다 (`type="text" inputmode="numeric"`)
- 브라우저 기본 `alert` / `confirm` / `prompt` 대신 토스트와 모달

---

## 5. 어드민 구조

LMS 어드민의 미션 줄에서 톱니를 누르면 **이 화면 안에서 바로** 앱 어드민이 열린다.
그래서 앱 어드민은 LMS 안에 들어갔을 때 모양이 맞아야 한다.

```js
import { markEmbedded, backToLms } from '../../shared/lms-session.js';
if (markEmbedded()) {           // <html class="has-own-back">와 <body class="embedded">를 단다
  backBtn.hidden = false;       // "목록으로"를 띄우고
  backBtn.onclick = backToLms;  // 누르면 LMS가 오버레이를 닫는다
}
```

- 임베드되면 **자기 로그인 게이트를 건너뛴다.** 이미 LMS에 로그인돼 있다
- 자기 로고와 로그아웃은 `.app-hide-embedded`로 숨는다
- `has-own-back`을 달아야 LMS 쪽 중복 바가 사라진다
- 머리 줄은 3열이고 각 칸에 `grid-column`이 박혀 있다. **빼지 말 것** — 로고를 숨겼을 때 탭이 왼쪽으로 밀린다
- 탭 이름은 영문 대문자 (`ANSWER`, `SETTING`, `CONTENTS`, `STATUS`). 이미 쓴 단어가 있으면 그대로 재사용한다
- 본문 폭은 `.app-main-wide`(1280px). 표가 많아 넉넉해야 한다

---

## 하지 않는 것

- **2026 앱 13개를 이 규약으로 고치지 않는다.** 새로 만드는 앱부터 쓰고, 2026 앱은 그 해에 실제로 다시 쓸 때 하나씩 옮긴다
- **앱을 공통 틀에 맞추지 않는다.** 활동 모양이 자유로운 것이 이 구조의 값이다. 고정하는 것은 위 다섯 가지뿐이다
