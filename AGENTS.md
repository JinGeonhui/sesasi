<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 프로젝트 공통 명칭

- **서사 페이지**: 기록을 필름으로 탐색하고 이야기를 보는 영역 (`/film/`). 기본 주소(`/`)는 작업 페이지(`/planner/`)로 이동한다.
- **작업 페이지**: 서사 페이지를 제외한 홈, 캘린더, 할 일, 교통 노선, 작업 메모, 설정 영역 (`/planner/` 및 하위 경로).
- 작업 페이지의 기본 메뉴는 **홈 · 설정**으로 구성한다. 기존 '한눈에 보기'는 '홈'으로 부르며, 캘린더·할 일·교통 노선·작업 메모는 홈에서 진입한다.
- 홈의 기존 '오늘의 할 일' 영역은 **메모**라고 부르며 오늘 기준으로 표시한다. 일정 목록과 일정 추가는 홈에서 제외하고 캘린더에서 제공한다. 일정 목록의 제목은 **일정**으로 표시한다. 주간 날짜 선택과 날짜별 일정·메모 조회는 **설정 → 기록** (`/planner/settings/history/`)에 둔다. 이 '기록'은 필름을 보는 서사 페이지와 별개의 기능이다.
- 메모 행은 **카테고리 · 내용 · 완료 체크** 순서로 배치한다. 행마다 '아래에 추가'를 두지 않고, 메모 영역의 **+** 버튼 하나로 추가한다.
- 메모에는 카테고리 필터를 표시하지 않는다. 카테고리 추가·삭제·관리는 **설정 → 카테고리 관리** (`/planner/settings/categories/`)에서 제공하며, 각 메모의 카테고리 표시는 유지한다.
- 이 명칭은 서사시 프로젝트 전체의 대화·문서·작업에서 공통으로 사용한다. 작업 페이지 안의 개별 기능은 각각 고유한 URL로 접근할 수 있게 유지한다.
