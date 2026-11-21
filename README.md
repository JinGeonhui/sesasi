# 🎞️ 세사시 (Sesasi) — 나를 이루는 순간들

> **필름 다이얼로 과거의 기억을 서사처럼 탐색하고, 일상의 작업과 기록을 관리하는 개인용 웹앱**  
> 사진 한 장씩 위아래로 넘어가는 아날로그 필름 UI의 **서사 아카이브(`/film/`)**와 날씨·교통·디스코드 연동이 통합된 **작업 플래너(`/planner/`)**를 하나로 결합했습니다.

🔗 **[서비스 바로가기 (Vercel 배포 URL)](https://your-sesasi-app.vercel.app)** · 📄 **[교통 API 설정 가이드](transit/README.md)** · 💬 **[디스코드 연동 가이드](discord/README.md)**

---

## 📸 서비스 미리보기

> 💡 *`docs/images/` 경로에 실제 화면 녹화 GIF나 스크린샷을 추가해 주세요.*

| 서사 아카이브 (`/film/`) | 작업 페이지 (`/planner/`) |
| :---: | :---: |
| <img src="docs/images/film-preview.gif" width="420" alt="필름 다이얼 및 상세 서사 화면" /> | <img src="docs/images/planner-preview.gif" width="420" alt="플래너 홈 및 날씨·메모 화면" /> |
| 필름 다이얼 탐색 및 비대칭 아트 상세 뷰 | 날짜별 메모, 날씨·대기질, 교통 노선 통합 관리 |

---

## 💡 주요 기능

### 1. 서사 아카이브 (`/film/`) — 기억의 시각화
* **필름 다이얼 탐색:** 마우스 휠, 상하 드래그·터치 스와이프, 원형 다이얼 회전, 키보드(`방향키`, `Home`, `End`, `Enter`)를 모두 지원하며 처음과 끝이 끊김 없이 순환합니다. 자동 재생이나 사운드를 배제하고 `prefers-reduced-motion` 접근성 설정을 준수합니다.
* **비대칭 상세 뷰 (`#story/기록ID`):** 넓은 화면에서는 대표 아트를 왼쪽에 크게 기울여 배치하고, 오른쪽에 제목·짧은 소개(최대 240자)·본문을 서로 다른 들여쓰기로 구성합니다.
  * **경험 · 역량 라벨:** 역할·기술·성과·자격 등 사용자 정의 태그를 최대 6개까지 높이를 달리해 배치합니다.
  * **이미지 최적화 및 투명도 보존:** 기록당 최대 12장(JPG·PNG·WebP)을 지원하며, 업로드 시 긴 변을 최대 `1,800px`로 리사이징하되 원본 포맷과 PNG·WebP의 투명 배경을 그대로 보존합니다.
* **분기(Branch) 연결 및 복원:** 특정 순간에서 파생된 기억을 분기로 이어 붙일 수 있습니다. 상위 기록 삭제 시 하위 분기가 유실되지 않고 이전 부모 기록에 자동으로 재연결되며, 전체 기록의 JSON 백업 및 복원을 지원합니다.

### 2. 작업 페이지 (`/planner/`) — 일상의 기록
Artroom 스타일의 밝은 톤과 6px 모서리, 최소 44px 터치 타겟을 적용한 데일리 워크스페이스입니다. 각 기능은 독립된 URL을 가져 새로고침과 브라우저 뒤로/앞으로 가기를 완벽히 지원합니다.

| 기능 | 경로 | 주요 역할 |
| :--- | :--- | :--- |
| **홈** | `/planner/` | 오늘의 날씨·대기질 요약, 날짜별 메모 조회 및 빠른 추가 |
| **캘린더** | `/planner/calendar/` | 종일/시간 지정 일정 관리 및 여러 날에 걸친 장기 일정 조회 |
| **할 일** | `/planner/todos/` | 전체 날짜 할 일 조회, 카테고리별 필터링 및 항목 중간 끼워 넣기 |
| **교통 노선** | `/planner/routes/` | TAGO 기반 버스·지하철 노선 및 승하차 정류장 즐겨찾기, 카카오맵 연동 |
| **작업 메모** | `/planner/notes/` | 날짜별 자유 형식 작업 노트 기록 |
| **설정 / 기록** | `/planner/settings/` | 비밀번호 변경, 카테고리 관리(`/categories/`), 주간·날짜별 통합 기록 조회(`/history/`) |

* **계획 메모와 수행 기록 분리:** 사전에 작성한 **계획 메모**는 번호(`1.`)와 완료 체크박스가 제공되며, 당일 즉시 추가한 **수행 기록**은 `-` 기호로 표시되어 완료 체크나 취소선 없이 깔끔하게 남습니다.
* **날씨 및 대기질 카드:** 기본 지역(광주) 또는 사용자 선택 지역의 기온·습도(파란색 강조)를 크게 표시합니다. 향후 6시간 이내 비·눈·안개 예보가 있을 때만 첫 예상 시각을 강조 노출하며, CAMS 기반 미세먼지·초미세먼지 표시 옵션을 계정 설정에 저장합니다.

### 3. 디스코드 양방향 메모 연동
* **앱 → 디스코드 자동 동기화:** 지정한 시작일(`DISCORD_SYNC_FROM`) 이후의 메모를 날짜별 메시지(`# 2026.11.18`)로 묶어 개인 채널 웹후크로 전송합니다. 앱 내 수정·삭제·완료 체크가 기존 메시지에 그대로 반영되며, 2,000자 초과 시 자동 분할 전송하고 전송 실패 시 앱이 열려 있는 동안 60초 주기로 재시도합니다.
* **디스코드 → 앱 빠른 입력 (`/memo`):** 지정된 디스코드 채널에서 `/memo` 슬래시 커맨드를 실행하면 전용 모달 창으로 메모를 작성할 수 있습니다. 채널에 입력 원문을 남기지 않고(본인에게만 5초간 성공 안내 표시) Supabase에 저장한 뒤 웹후크 목록을 즉시 갱신합니다.

---

## 🛠 기술 스택 (Tech Stack)

* **Frontend:** Next.js (Static Export `out/`), React, TypeScript, Vanilla CSS (`globals.css`, `planner.css`)
* **Backend & Database:** Supabase (Auth, PostgreSQL, Row Level Security, TypeScript Edge Functions)
* **External APIs:** Open-Meteo (날씨 및 CAMS 대기질), TAGO (국토교통부 대중교통 정보), Discord Webhooks & Interactions
* **Deployment & Dev:** Vercel (정적 웹 호스팅), Node.js 로컬 프록시 서버 (교통 `4191`, 디스코드 `4192`)

---

## 🏗 아키텍처 및 기술적 의사결정

### 1. Supabase Edge Function 리전 분리 및 장애 복원력
* 데이터베이스는 서울 리전에 위치하지만, 배포 검증 과정에서 서울 리전 → Open-Meteo API 간 반복적인 응답 지연이 확인되었습니다.
* 이를 해결하기 위해 `weather` Edge Function만 **`x-region: eu-central-1`(프랑크푸르트)**으로 분리 배포하고, `transit`과 `discord-sync`는 인접 리전에 배치했습니다.
* 날씨·대기질 조회는 독립 실행 및 30초 타임아웃을 적용하며, 실패 시 `5초 → 15초 → 1분 → 이후 5분` 간격으로 자동 백오프 재시도합니다. 정상 응답은 15분마다 갱신하며, 장애 시에도 기준 시각으로부터 최대 6시간 동안 마지막 정상 캐시를 유지합니다.

### 2. 정적 배포(Static Export) 환경의 단일 소유자 보안 및 동시성 제어
* Next.js 정적 빌드(`output: 'export'`)로 SSR 서버 없이 Vercel에 배포되면서도, 개인 아카이브의 보안을 유지하기 위해 일반 회원가입을 비활성화하고 모든 Edge Function에서 인증된 소유자 이메일(`SESASI_OWNER_EMAIL`)을 검증합니다.
* 모든 데이터는 Supabase `sesasi_records` 테이블에 계정별 **RLS(Row Level Security)** 정책으로 격리되며, 저장 시 `revision` 번호를 비교해 다중 탭·기기 환경에서 수정 내역이 덮어씌워지는 문제를 방지합니다.

### 3. 클라우드 / 로컬 하이브리드 실행 모드
* `.env.local`에 Supabase 공개 키가 설정되어 있으면 클라우드 Edge Functions와 직접 통신합니다.
* Supabase 설정이 없는 환경에서 `npm run dev`를 실행하면 프론트엔드(`3000`)와 함께 로컬 교통 조회 서버(`4191`) 및 디스코드 연결 서버(`4192`)가 자동으로 동시 실행되며, 종료 시 함께 정리됩니다.

---

## 🚀 실행 및 배포 가이드 (Getting Started)

### 1. 기본 설치 및 로컬 실행
```bash
git clone [https://github.com/your-username/sesasi.git](https://github.com/your-username/sesasi.git)
cd sesasi
npm install
npm run dev
```
* 브라우저에서 `http://localhost:3000`으로 접속합니다.
* **로컬 단독 모드 사용 시** (Supabase 미연결):
  * 교통 API 키는 `.env.transit.local`에 설정합니다.
  * 디스코드 연동은 `.env.discord.local`에 아래 값을 추가해 사용합니다.
    ```dotenv
    DISCORD_WEBHOOK_URL="여기에 개인 채널의 웹후크 URL"
    DISCORD_SYNC_FROM=2026-11-18
    # 선택 사항: DISCORD_PORT=4192, DISCORD_ALLOWED_ORIGINS=...
    ```

### 2. Supabase 클라우드 연동 및 배포
1. **클라이언트 환경변수 설정 (`.env.local`)**  
   *(주의: 서비스 역할 키나 디스코드 웹후크 URL은 절대 `NEXT_PUBLIC_` 변수에 넣지 않습니다.)*
   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
   ```

2. **서버 시크릿 설정 (`.env.supabase.secrets.local`)**
   ```dotenv
   SESASI_OWNER_EMAIL=YOUR_EMAIL
   SESASI_ALLOWED_ORIGINS=http://localhost:3000,[http://127.0.0.1:3000](http://127.0.0.1:3000)
   TAGO_SERVICE_KEY=YOUR_TAGO_KEY
   DISCORD_WEBHOOK_URL=YOUR_DISCORD_WEBHOOK
   DISCORD_SYNC_FROM=2026-11-19
   ```

3. **DB 마이그레이션 및 Edge Functions 배포**
   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT
   npx supabase db push --remote --yes
   npx supabase config push --yes
   npx supabase secrets set --env-file .env.supabase.secrets.local --yes
   npm run supabase:deploy
   ```
   > 💡 초기 세팅 시 `node scripts/supabase-prepare.mjs YOUR_EMAIL`로 설정 파일을 준비하고, `node scripts/supabase-verify.mjs`로 일회용 로그인 링크를 발급받아 최초 로그인 후 **설정 → 개인 계정**에서 비밀번호를 등록할 수 있습니다. (검증 후 `supabase/.temp/` 내 임시 파일은 삭제하세요.)

### 3. 정적 프로덕션 빌드 (Vercel)
```bash
npm run build
```
* 정적 내보내기 프로젝트이므로 `next start`는 사용하지 않으며, 생성된 `out/` 디렉토리를 Vercel 등의 정적 호스팅에 배포합니다.

---

## 📂 프로젝트 구조 및 검증

```text
sesasi/
├── app/
│   ├── components/
│   │   ├── memory-dial.tsx      # 필름 다이얼, 휠·드래그·키보드 순환 탐색
│   │   └── archive.tsx          # 서사 상세 화면, 분기 연결, 작성·수정·백업 UI
│   ├── lib/
│   │   └── archive.ts           # 기록 타입, 서버 저장·IndexedDB 이전, 이미지 리사이징
│   ├── planner/
│   │   └── planner.css          # 데이북 스타일 시스템 (.daybook)
│   └── globals.css              # 반응형 필름·다이얼 및 상세 아트 레이아웃
├── supabase/
│   ├── functions/               # Edge Functions (weather, transit, discord-sync)
│   └── migrations/              # PostgreSQL 스키마 및 RLS 정책
├── scripts/                     # Supabase 초기 설정 및 검증 보조 스크립트
├── tests/                       # 클라우드·DB 권한 및 동시성 검증 SQL
└── next.config.ts               # 정적 내보내기(out/) 빌드 설정
```

### 검증 명령어
* **클라우드·빌드 통합 검증:** `npm run test:cloud`, `npm run check:cloud`, `npm run build`
* **기능별 단위 검증:** `npm run test:weather` (날씨 캐시·재시도), `npm run test:discord` (디스코드 동기화), `npm run test:storage` (계정 저장)
* **DB 권한 및 동시성 검증:** `npx supabase db query --remote --file tests/cloud-database.sql --yes` *(실행 후 자동 롤백)*

---

## 🎨 참고 및 리소스 출처
* **연출 참고:** [MARIA-n PV (1:30–1:50 구간)](https://www.youtube.com/watch?v=XYhqqT2N7SM&t=90s), [Dordogne 공식 소개의 기록장](https://www.focus-entmt.com/en/games/dordogne)
* **배경 질감:** 자체 제작 `public/images/book-paper.png` 및 [Parchement Textures — VWolfdog / OpenGameArt (CC0)](https://opengameart.org/content/parchement-textures)
