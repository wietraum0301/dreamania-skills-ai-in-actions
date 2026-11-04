# AI in Actions

## Azure Web App 배포

Linux Azure Web App `nacho`에서 `/`와 `/index.html`은 메인 화면을 제공합니다.
Node.js 24 LTS에서 `npm ci` 후 `npm start`로 로컬 실행하고 `npm test`로 확인합니다.
서버는 Azure가 지정하는 `PORT`를 사용하며 로컬 기본 포트는 `8080`입니다.

`main_nacho.yml`이 `main` 변경 시 Production에 배포합니다. PR에서는 확인만 수행하며
수동 배포도 `main`에서만 가능합니다. 기존 Azure OIDC GitHub Secrets와 페더레이션 설정을
유지하세요. 서비스 주체에는 `nacho` 조회, 런타임/시작 명령 변경 및 배포 권한이 필요합니다.
워크플로는 Node.js 24 LTS와 `npm start`를 자동 설정하고 의존성을 포함하여 배포한 뒤,
실제 기본 도메인의 응답이 `index.html`과 일치하는지 확인합니다.

`POST /api/roulette`만 추첨을 처리하며 저장소 파일이나 참가자 목록 조회 API는 공개하지 않습니다.

## 실제 행사 추첨: Azure Table Storage

**SharePoint 및 Power Automate는 사용하지 않습니다.** 기존 `ROULETTE_API_URL` 설정은
제거해도 됩니다. 서버가 Azure Table SDK로 추첨과 참가 정보 저장을 직접 처리합니다.
메일 발송은 포함되지 않으며 쿠폰 화면에서도 발송됐다고 표시하지 않습니다.

### 연결과 최초 초기화

1. Azure에서 **Table Storage를 지원하는 StorageV2 계정**을 준비합니다.
   Cosmos DB Table API나 Blob 전용 계정이 아닌 Azure Storage Tables를 사용하세요.
   Storage 방화벽/프라이빗 엔드포인트를 사용하는 경우 Web App에서 접근 가능하도록 설정합니다.
2. `nacho`의 환경 변수에 **`AZURE_STORAGE_CONNECTION_STRING`**(해당 계정의 연결 문자열)과
   **`ROULETTE_IDENTITY_SECRET`**(최소 32바이트의 암호학적 난수 비밀 값)을 설정합니다.
   연결 문자열과 비밀 값은 채팅/저장소에 넣지 말고 Azure 환경 변수 또는 Key Vault 참조로
   관리하세요. 연결 문자열에는 쓰기 권한이 필요합니다. 로컬에서는 커밋하지 않는 환경 변수로
   동일 값을 설정할 수 있습니다.
3. 같은 환경 변수가 설정된 환경에서 `npm ci` 후 **`npm run setup:table`**을 한 번 실행합니다.
   Azure SSH를 사용한다면 배포 후 `/home/site/wwwroot`에서 실행하세요.
   이 명령은 `GSTARRoulette` 테이블과 `GSTAR2026` 파티션의 초기 재고 행을 만듭니다.
   기존 재고가 있으면 검증만 하고 재고를 복구하거나 재설정하지 않습니다.
   참가 기록이 남아 있는데 재고 행이 없으면 초기화를 거부합니다.
4. Web App을 재시작하고 기본 도메인에서 참가 → 게임 → 룰렛 → 쿠폰을 확인합니다.
   초기화하지 않거나 환경 변수가 없으면 503과 명시적인 설정 오류를 반환합니다.
   운영 배포 워크플로는 연결 문자열이 없으면 `nacho`와 같은 리소스 그룹/지역에 전용
   StorageV2 Standard LRS 계정을 생성하고 연결 문자열과 난수 identity secret을 앱 환경 변수에
   등록한 다음 테이블을 초기화합니다. 계정은 앱 리소스 ID로 결정되는 고정 이름을 사용하며
   기존 연결/비밀 값/재고를 보존합니다. Azure 사용 요금이 발생합니다.
   워크플로 인증에는 Storage 계정 생성 및 키 조회, Web App 환경 변수 수정 권한이 추가로 필요합니다.
   연결 문자열 대신 Key Vault 참조를 쓰는 경우 자동 초기화가 참조를 해석하지 않으므로
   위 수동 초기화 절차를 사용하도록 워크플로를 조정해야 합니다.

행사 중 `ROULETTE_IDENTITY_SECRET`을 바꾸면 중복 판별 키가 달라지므로 서버는 재고에 저장된
키 검증값과 비교해 추첨을 중단합니다. 재고/키/당첨 행을 수동 삭제·편집하여 초기화하거나
다른 프로그램으로 당첨 행을 추가하지 마세요. 기존 참가 기록과 재고를 다른 계정으로
이전할 때도 두 종류의 행과 identity secret을 함께 보존해야 합니다.

### 저장되는 정보

Azure Table은 스키마가 없으므로 SharePoint처럼 열을 미리 생성할 필요가 없습니다.
모든 엔터티는 `partitionKey=GSTAR2026`이며 아래 속성은 최초 저장 시 생성됩니다.

| 행 | 키 / 속성 | 의미 |
|---|---|---|
| 재고 | `rowKey=inventory` | 재고 전용 행 |
| 재고 | `beer5`, `nachos`, `quesa`, `beer1` | 현재 남은 수량 |
| 재고 | `awarded`, `identityFingerprint` | 총 발급 수와 HMAC 키 검증값 |
| 참가자 | `rowKey=winner-<participantId>` | 전화번호 기반 HMAC-SHA256 고유 키 |
| 참가자 | `fullName`, `nickname`, `company`, `email`, `jobRole` | 참가 정보 |
| 참가자 | `phone`, `phoneLast4` | **전체 전화번호** 및 뒤 4자리(문자열, 앞자리 0 보존) |
| 참가자 | `participantId`, `consent` | 중복 판별 ID와 동의 여부 |
| 참가자 | `score`, `bugs` | 게임 점수와 버그 수 |
| 참가자 | `couponCode`, `prizeKey`, `prizeName`, `wonAt` | 쿠폰 코드, 경품 키/이름, UTC 당첨 시각 |
| 참가자 | `redeemed`, `redeemedAt` | 수령 여부(기본 `false`), 수령 확정 시 UTC 시각 |

전체 전화번호는 운영자 요청에 따라 저장하지만 브라우저 응답/쿠폰 화면/서버 로그에는
전화번호나 HMAC ID를 넣지 않습니다. Storage 접근 권한은 행사 스태프/서버에 한정하고
개인정보 동의 안내 및 행사 종료 후 삭제 절차를 실제 운영 정책에 맞게 확정하세요.
전화번호 소유권 확인(OTP)은 없으므로 번호 기준 중복 제한이며 실명 기준 1인 1회 보장은 아닙니다.
점수도 서버에서 검증된 게임 기록이 아니므로 경품 확률에 사용하지 않습니다.

### 재고와 동시성

초기 재고는 **맥주 5잔 세트 15 / 나초 30 / 퀘사디아 20 / 맥주 1잔 435 = 총 500개**입니다.
서버는 암호학적 난수로 남은 수량에 비례하여 경품을 선택합니다.
룰렛의 그림상 칸 크기는 실제 확률을 의미하지 않습니다.

재고 행의 **ETag 조건부 변경**과 참가자 행의 **신규 생성**을 같은 파티션의
**단일 Azure Table 트랜잭션**으로 제출합니다. 둘 다 성공하거나 둘 다 실패하므로
동시 요청/다중 서버에서도 재고만 차감되거나 쿠폰만 저장되지 않습니다.
ETag 충돌이나 중복 행 충돌은 최신 데이터를 읽고 제한된 횟수만 재시도합니다.
혼잡 시 503을 반환하고 사용자에게 재시도를 안내합니다.
응답이 유실돼도 같은 번호로 다시 요청하면 기존 쿠폰을 반환하고 추가 차감하지 않습니다.
재고가 소진되어도 기존 참가자의 쿠폰은 복원되며 신규 참가자는 409 `sold_out`을 받습니다.
`redeemed=true`인 쿠폰도 재고를 다시 늘리거나 새로 발급하지 않습니다.

### 스태프 전용 실시간 현장 인증

1. 배포 후 **`/staff`**를 스태프 기기에서 엽니다. 참가자 페이지에는 이 링크를 표시하지 않습니다.
2. Azure Portal → Web App `nacho` → 환경 변수에서 **`ROULETTE_STAFF_PASSWORD`**를 확인하고
   스태프에게만 안전하게 전달합니다. 배포 워크플로는 값이 없을 때만 32바이트 난수 비밀번호를
   생성하고, 기존 값은 유지합니다. 로그·코드·채팅에 비밀번호를 남기지 마세요.
   직접 설정할 때는 16~256바이트의 강한 별도 비밀번호를 사용하세요.
   로컬에서도 같은 환경 변수가 필요합니다. Key Vault 참조는 직접 문자열로 설정하지 말고
   Azure가 해석한 값이 앱에 전달되도록 설정하세요. 해석되지 않은 참조로는 로그인할 수 없습니다.
3. 로그인 후 참가자의 **전체 쿠폰 코드**를 입력해 실시간 조회합니다. Azure Table의 경품,
   닉네임, 발급 시각, 수령 여부를 확인하며 전화번호·이메일·회사 정보는 반환하지 않습니다.
   선택된 쿠폰은 화면이 열려 있는 동안 5초마다 갱신됩니다. 코드를 변경하거나 조회가 실패하면
   수령 확정 버튼은 비활성화됩니다.
4. **미사용** 상태에서 `수령 확정` → 확인을 누릅니다. 서버는 최신 행을 다시 읽고 **ETag 조건부
   Merge 업데이트**로 `redeemed=true`, `redeemedAt`을 저장합니다. 동시에 여러 창구가 같은 쿠폰을
   처리해도 하나만 성공하며 나머지는 409 오류를 받습니다. 재고나 다른 참가 정보는 변경하지 않습니다.
5. **수령 확정 성공 메시지를 확인한 뒤** 경품을 전달하세요. 이미 사용된 쿠폰이나 통신 오류는
   전달 근거가 아닙니다. 응답이 유실되면 다시 조회해 실제 저장 상태를 확인하고, 다른 스태프와
   전달 여부를 확인하세요. 스크린샷이나 브라우저 저장 쿠폰은 인증 근거로 사용하지 않습니다.

API는 `/api/staff/login`, `/session`, `/logout`, `/verify`, `/redeem`이며 로그인·쿠폰 목록을
공개하지 않습니다. 쿠폰 조회/수령은 인증 쿠키가 있어야 가능합니다. 쿠키는 HttpOnly,
SameSite=Strict, HTTPS에서 Secure이며 8시간 후 만료됩니다. POST 요청의 커스텀 헤더와
CORS 미허용으로 브라우저의 교차 출처 요청을 차단합니다. 로그인은 서버 프로세스당 분당
20회로 제한합니다. 다중 인스턴스 전체 제한이 필요하면 Azure 앞단에서도 제한하세요.
공용 기기는 사용 후 로그아웃하세요. 로그아웃은 해당 브라우저 쿠키를 지우며, 유출된 세션까지
무효화하려면 스태프 비밀번호를 바꾸고 앱을 재시작하세요. identity secret은 변경하지 마세요.
공유 비밀번호 방식이라 개인별 스태프 감사 로그나 수령 취소 기능은 제공하지 않습니다.

### 확인

`npm test`는 HTTP 입력 검증 및 저장 트랜잭션 모델을 확인합니다.
같은 저장소 테스트를 실제 SDK와 로컬 Azurite Table 서비스에서도 실행할 수 있습니다:

```bash
AZURITE_TEST_CONNECTION='UseDevelopmentStorage=true' node --test table-store.test.js
```

이 명령은 Azurite가 기본 Table 포트 `10002`에서 실행 중이어야 하며 고유한 `Test...`
테이블만 생성/삭제합니다. 테스트 연결 문자열로 운영 계정을 지정하지 마세요.
검증 항목은 동시 동일/다른 번호 요청, 뒤 4자리 충돌, 응답 유실, 500개 정확한 품목별 할당과
501번째 차단, 재초기화 재고 보존, 잘못된 설정/키 교체 거부입니다.
운영 배포는 `/api/roulette/status`로 실제 Table 접근 및 재고/키 설정을 확인합니다.
이 확인은 참가 행을 만들거나 경품을 소비하지 않으며 준비 여부만 공개합니다.

---

<img src="https://octodex.github.com/images/Professortocat_v2.png" align="right" height="200px" />

Hey wietraum0301!

Mona here. I'm done preparing your exercise. Hope you enjoy! 💚

Remember, it's self-paced so feel free to take a break! ☕️

[![](https://img.shields.io/badge/Go%20to%20Exercise-%E2%86%92-1f883d?style=for-the-badge&logo=github&labelColor=197935)](https://github.com/wietraum0301/dreamania-skills-ai-in-actions/issues/3)

---

&copy; 2025 GitHub &bull; [Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/code_of_conduct.md) &bull; [MIT License](https://gh.io/mit)
