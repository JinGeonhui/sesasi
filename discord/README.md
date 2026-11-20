# 디스코드 양방향 메모 연동

기본 입력 방식은 **`/적용` 명령어**입니다. 지정한 Discord 채널에 날짜 제목과 메모를 작성한 뒤 명령어를 실행하면 시작일 이후의 본인 메모를 서사시에 반영합니다. 원문 수정·삭제도 명령어를 다시 실행할 때 반영합니다. 결과는 실행한 본인에게만 보입니다. 기존 앱 → Discord 웹후크 출력은 유지합니다.

Supabase가 Discord의 HTTP 명령 요청을 받아 처리하므로 노트북·별도 상시 서버·주기 조회가 필요 없습니다. 명령어가 없으면 수신 조회를 실행하지 않습니다. 매 요청의 Ed25519 서명과 앱·서버·채널·작성자를 확인하고, 서버의 실행 기록으로 재전송과 동시 실행을 차단합니다. 명령어는 서버 관리자에게만 기본 노출하며 실제 처리 권한은 연결된 작성자로 추가 제한합니다.

한 번에 최대 1,000개 채널 메시지를 탐색하며 함수 실행 시간 안에서 처리합니다. 범위를 끝까지 읽지 못하면 삭제를 추정하지 않습니다. 일부 메시지의 형식 오류·충돌·시간 제한이 있으면 결과에 알리고, 성공한 저장은 유지합니다.

### 명령어 배포

아래의 봇·Supabase 환경변수와 입력용 마이그레이션을 먼저 준비합니다.

1. `npm run discord:command -- --prepare`로 앱 ID·공개 검증 키를 `.env.discord-command.local`에 저장합니다.
2. `supabase db push --remote --yes`로 명령어 실행 기록 마이그레이션까지 적용합니다.
3. `supabase secrets set --env-file .env.discord-command.local`로 검증 설정을 서버에 저장합니다. 토큰 등은 `.env.discord-bridge.local`을 사용합니다.
4. `supabase functions deploy discord-command --use-api --yes`로 명령어 함수를 배포합니다.
5. `npm run discord:command -- --register`로 Interactions Endpoint URL과 서버용 명령어를 등록합니다. Discord가 실제 서명된 PING으로 URL을 검증합니다.
6. 지정한 채널에서 `/적용`를 실행합니다. 앱 화면은 기존 서버 새로고침 때 반영됩니다.

아래의 Gateway 봇 실행은 선택적 실시간 방식입니다. 명령어 방식에서는 `npm run discord:bot`이나 Cron을 실행하지 않습니다.

## 동작

- 지정한 본인 Discord 계정이 지정한 서버의 일반 텍스트 채널에 쓴 메시지만 읽습니다.
- 메시지 앞의 `# YYYY.MM.DD` 또는 `# YYYY-MM-DD`가 대상 날짜입니다. 다른 날짜 제목을 추가하여 여러 날짜를 한 메시지에 쓸 수도 있습니다.
- `1. [카테고리] 내용`은 계획, `- [카테고리] 내용`은 수행 기록, `- ~~[카테고리] 내용~~`은 완료한 계획입니다. 작성 시각으로 이 표시를 다시 추정하지 않습니다.
- 내용은 일반 텍스트입니다. 쉼표, 괄호, 금액, `>>`는 명령이나 별도 결과가 아닙니다. `- ~~[면허] 시험~~ >> 95점, 합격`은 완료한 계획이며 본문은 `시험 >> 95점, 합격` 하나로 저장합니다. 출력할 때는 기존 앱 규칙에 따라 완료한 메모 전체에 취소선을 표시합니다.
- 기존 앱과 같은 카테고리 40자·본문 120자 제한을 적용합니다. 본문을 자르지 않습니다. 한 줄이 잘못되면 메시지 전체를 반영하지 않고 오류를 남깁니다. 날짜 제목만 남기면 연결된 모든 메모의 삭제로 해석합니다. 제목까지 지우고 일반 대화로 바꾼 경우는 삭제가 아닌 형식 오류입니다.
- 원문 수정·행 삭제·메시지 삭제를 연결된 메모에 반영합니다. 앱에서 바뀐 필드는 원문에서 바뀐 필드와 충돌하지 않을 때만 합칩니다. 같은 필드의 충돌이나 모호한 여러 행 동시 이름 변경은 `MEMO_CONFLICT`로 멈춥니다. 앱에서 삭제한 메모는 오래된 원문으로 되살리지 않습니다.
- 동일 메시지의 재전송은 중복 생성하지 않습니다. 최초 연결 때 날짜·카테고리·본문·유형·완료가 완전히 같은 기존 메모 하나가 있으면 연결합니다. 이미 다른 메시지에 연결됐거나 후보가 여러 개면 충돌로 남깁니다.
- 본문이 같은 행은 연결 ID를 유지합니다. 한 번에 하나의 행 이름 변경도 지원합니다. 여러 행의 본문/날짜/카테고리를 동시에 바꾸면 식별이 모호할 수 있으므로 한 행씩 수정합니다.
- 앱의 변경 사항은 기존 웹후크가 관리하는 날짜별 목록에 반영합니다. **봇은 본인이 직접 작성한 Discord 원문을 수정하지 않습니다.** 같은 채널을 쓰면 입력 원문과 웹후크의 최신 목록이 함께 보입니다. 봇·웹후크 메시지는 가져오지 않아 순환 전송이 없습니다.
- 봇은 메시지를 실시간 수신하고 60초마다 시작일 이후 이력을 다시 확인합니다. 중단 중의 수정·삭제도 서버에 저장된 연결 정보로 확인합니다. 페이지 조회를 끝내지 못하면 없는 메시지로 추정해서 삭제하지 않습니다. 웹후크 출력은 15초마다 확인하며, 앱은 현재의 30초 새로고침/화면 복귀 때 서버 변경을 읽습니다.

## 필요한 설정

Discord Developer Portal에서 Application/Bot을 만들고 Bot의 **Message Content Intent**를 활성화합니다. 서버에 봇을 초대하고 해당 채널에 **View Channel / Read Message History** 권한을 줍니다. 봇은 직접 채팅을 보내거나 관리하지 않으므로 Administrator, Manage Messages, Send Messages 권한은 필요하지 않습니다. Developer Mode를 켜서 서버 ID·채널 ID·본인 사용자 ID를 복사합니다.

서버 환경변수와 봇 실행 환경을 분리합니다. 실제 값을 소스 파일이나 `NEXT_PUBLIC_` 변수에 넣지 않습니다.

| 변수 | 위치 | 의미 |
|---|---|---|
| `DISCORD_BOT_TOKEN` | 봇 + Supabase secrets | 메시지를 읽는 봇 토큰 |
| `DISCORD_BRIDGE_SECRET` | 봇 + Supabase secrets | 양쪽이 공유하는 새 32자 이상 비밀키 |
| `DISCORD_GUILD_ID` | 봇 + Supabase secrets | 허용할 서버 ID |
| `DISCORD_CHANNEL_ID` | 봇 + Supabase secrets | 입력용 일반 텍스트 채널 ID |
| `DISCORD_AUTHOR_ID` | 봇 + Supabase secrets | 본인 Discord 사용자 ID |
| `DISCORD_IMPORT_FROM` | 봇 + Supabase secrets | 가져올 메시지의 최초 작성일, 한국 시간 `YYYY-MM-DD` |
| `DISCORD_OWNER_USER_ID` | Supabase secrets만 | 연결할 서사시 계정의 Supabase Auth UUID |
| `SUPABASE_URL` | 봇 | 기존 Supabase 프로젝트 주소 |
| `DISCORD_WEBHOOK_URL`, `DISCORD_SYNC_FROM` | 기존 Supabase secrets | 출력 웹후크와 메모 대상 날짜의 하한, 기존 설정 유지 |

`DISCORD_IMPORT_FROM`은 메시지 작성일, `DISCORD_SYNC_FROM`은 메시지 안의 메모 대상 날짜입니다. 대상 날짜가 출력 범위보다 과거인 입력은 `OUTSIDE_SYNC_RANGE`로 거부합니다. 시작일을 정하면 그 이후 기존 메시지도 가져오므로 첫 연결 전에 범위를 확인합니다.

`bot.env.example`을 루트의 `.env.discord-bot.local`로, `bridge-secrets.env.example`을 `.env.discord-bridge.local`로 복사하여 실제 값을 넣습니다. 두 파일은 Git에서 제외됩니다. 기존 비밀키 파일을 빈 예제 값으로 덮어쓰지 않습니다. 토큰은 채팅이나 커밋에 붙여 넣지 않습니다.

## 연결 순서

1. 봇 설정과 위 환경변수를 준비합니다. `node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"`로 공유 비밀키를 생성할 수 있습니다.
2. `npm run discord:bot -- --check`로 로컬 환경변수 형식을 확인합니다. 이 명령은 Discord 연결·메시지 송신을 하지 않습니다.
3. 테스트 후 `node_modules/.bin/supabase db push`로 `20261120000100_discord_import.sql`을 적용합니다.
4. `node_modules/.bin/supabase secrets set --env-file .env.discord-bridge.local`로 서버 전용 설정을 넣습니다.
5. `node_modules/.bin/supabase functions deploy discord-sync discord-import --use-api --yes`로 출력/입력 함수를 함께 배포합니다. 수신 함수는 사용자 JWT 대신 전용 비밀키를 검증하고, 서버에서 Discord 원문과 작성자를 직접 재확인합니다.
6. 상시 켜 둔 Node.js 22.14 이상 환경에서 `npm ci` 후 `npm run discord:bot`을 실행합니다. 로컬 PC에서 실행하면 PC/프로세스가 꺼진 동안은 반영되지 않으며 재시작하면 이력을 다시 확인합니다. 상시 서버에서는 자동 재시작과 환경변수 저장을 설정합니다. Vercel 웹 배포와 별도로 실행해야 합니다.

컨테이너가 필요하면 저장소 루트에서 `docker build -f discord/Dockerfile -t sesasi-discord .` 후 런타임에 환경변수를 전달합니다. 빌드 컨텍스트와 이미지에는 실제 `.env` 파일이나 로컬 전송 상태를 포함하지 않습니다.

## 오류와 검증

- `MEMO_CONFLICT`: 앱의 최신 메모와 원문을 비교해 충돌한 필드를 같은 값으로 수정합니다. 앱에서 삭제한 메모는 원문에서도 해당 줄을 제거합니다. 여러 행 이름 변경은 한 행씩 적용합니다.
- `RECORD_CONFLICT`: 다른 저장과 동시에 처리되었습니다. 다음 스캔에서 새 서버 상태로 재시도합니다.
- `INVALID_MEMO_FORMAT`: 날짜/목록/카테고리 형식과 글자 수를 확인합니다. 자동으로 일부 내용만 가져오지 않습니다.
- `CHANNEL_DENIED` / `DISCORD_READ_FAILED`: 서버·채널 ID와 권한, Message Content Intent를 확인합니다.
- `BRIDGE_AUTH_REQUIRED` / `BRIDGE_NOT_CONFIGURED`: 양쪽 공유키와 서버 설정을 확인합니다.

로그에는 메시지 ID와 오류 코드만 남기며 메모 본문·이메일·토큰은 출력하지 않습니다. 실패한 메시지는 다음 스캔에 다시 시도합니다. 오류가 나더라도 다른 정상 메시지의 처리는 계속됩니다.

`npm run test:discord-import`는 파싱·일반 텍스트 보존·중복·충돌·삭제·연결 복구·권한·양방향 출력과 실제 PostgreSQL 엔진(PGlite)의 원자적 저장/RLS를 테스트합니다. 기존 출력은 `npm run test:discord`, `npm run test:cloud`로 검증합니다. 모든 테스트는 모의 Discord 응답을 쓰며 실제 채널에 메시지를 보내지 않습니다.

공식 문서: [Gateway/Message Content Intent](https://docs.discord.com/developers/events/gateway), [메시지 조회·수정 권한](https://docs.discord.com/developers/resources/message), [discord.js](https://discord.js.org/docs/packages/discord.js/main).
