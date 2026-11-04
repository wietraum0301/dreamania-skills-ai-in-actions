# AI in Actions

## Azure Web App 배포

Linux Azure Web App `nacho`에서 루트 주소(`/`)와 `/index.html`은 이 저장소의
`index.html`을 메인 화면으로 제공합니다. HTML은 변경하지 않으며, 외부 패키지 없이
Node.js 서버로 제공합니다.

1. 배포 워크플로가 `nacho`의 Linux 앱 여부를 확인하고 런타임을
   **Node.js 24 LTS**, 시작 명령을 **`npm start`**로 자동 설정합니다.
   서버는 Azure가 지정하는 `PORT`를 사용하고, 로컬 기본 포트는 `8080`입니다.
2. 기존 `.github/workflows/main_nacho.yml`에서 사용하는 Azure 인증용 GitHub
   Secrets와 OIDC 페더레이션 설정을 유지합니다. 해당 서비스 주체에는 `nacho`의
   앱 조회, 배포 및 런타임/시작 명령 변경 권한이 있어야 합니다.
3. 변경 사항을 `main`에 병합하면 GitHub Actions가 서버를 확인한 후 `nacho`의
   `Production` 슬롯에 배포합니다. **Actions > Deploy homepage to Azure Web App - nacho >
   Run workflow**에서 `main`을 선택해 수동 배포할 수도 있습니다.
   PR과 다른 브랜치에서는 확인 작업만 수행합니다.
   런타임과 시작 명령은 배포마다 위 값으로 설정됩니다.
   배포는 `main_nacho.yml` 하나로 통합되어 동일 앱에 대한 중복 배포를 방지합니다.
4. 배포 후 워크플로가 기본 도메인의 응답이 원본 `index.html`과 일치하는지 확인합니다.
   성공하면 Azure Portal의 `nacho` **기본 도메인**에서 메인 화면을 열 수 있습니다.

로컬 실행은 Node.js 24 LTS에서 `npm start`, 서버 확인은 `npm test`를 사용합니다.
`/`와 `/index.html`에서 화면을 제공하고 `POST /api/roulette`에서 추첨 흐름을 호출합니다.
그 외의 경로는 404를 반환하며 저장소 파일을 공개하지 않습니다.

## 실제 행사 추첨: SharePoint + Power Automate

**코드만 배포하면 실제 추첨이 활성화되지 않습니다.** Microsoft 365에서 아래 열과 흐름을
생성하고 Azure 환경 변수를 설정해야 합니다. 현재 코드에는 Microsoft 365 접속 권한이 없으며
목록이나 흐름을 자동 생성하지 않습니다. Power Automate HTTP 트리거의 라이선스도 확인하세요.

### SharePoint 목록

사이트 `https://megazone0.sharepoint.com/sites/axjouney`의 `GSTARWinners`를 사용합니다.
기존 열의 실제 내부 이름은 목록 설정에서 확인하고 Power Automate의 동적 콘텐츠로 매핑하세요.
표시 이름에 공백이 있으면 내부 이름이 다를 수 있습니다.

| 열 | 형식 / 설정 | 저장 값 |
|---|---|---|
| Nickname | 한 줄 텍스트 | nickname |
| Company | 한 줄 텍스트 | company |
| 폰넘어 뒷자리 4 | 한 줄 텍스트 | phoneLast4 (앞자리 0 보존) |
| PhoneNumber (신규) | 한 줄 텍스트 | phone (하이픈 없는 전체 번호, 앞자리 0 보존) |
| Prize name | 한 줄 텍스트 | 경품 한글 이름 |
| Score | 숫자, 소수 0 | score |
| Bugs | 숫자, 소수 0 | bugs |
| Redeemed | 예/아니요, 기본 아니요 | 최초 발급 시 false |
| Won at | 날짜 및 시간 | 발급 시 utcNow() |
| ParticipantId (신규) | 한 줄 텍스트, 고유 값 적용 | participantId |
| CouponCode (신규) | 한 줄 텍스트, 고유 값 적용 | GS- 뒤에 guid() |
| PrizeKey (신규) | 한 줄 텍스트 | beer5 / nachos / quesa / beer1 |

`Title`이 필수이면 쿠폰 코드를 함께 저장합니다. `ParticipantId`는 전체 번호의 HMAC-SHA256이며,
뒤 4자리가 같아도 전체 번호가 다르면 다른 참가자입니다. 전체 번호 저장은 운영자 요청에 따라
`PhoneNumber`에 추가하며, 목록 읽기 권한은 행사 스태프에만 부여하세요. 화면의 개인정보 동의와
행사 종료 후 삭제 정책을 실제 운영 정책에 맞게 확정하세요. 전화번호 소유권 확인(OTP)은 없으므로
번호 기준 중복 제한이지 실명 기준 1인 1회 보장은 아닙니다.

### 추첨 흐름 생성

1. **HTTP 요청을 받은 경우** 트리거와 SharePoint 연결을 생성합니다. 현재 서버는 서명 URL
   방식으로 호출하므로 해당 트리거의 호출 인증 설정을 확인합니다. URL을 브라우저/저장소/채팅에
   공개하지 마세요. 트리거 **동시성 제어를 켜고 병렬 처리 정도를 1**로 지정합니다.
   재고를 계산하는 모든 추첨은 이 흐름 하나만 사용해야 하며, 다른 흐름이나 수동 작업에서
   당첨 행을 추가/삭제하거나 PrizeKey를 바꾸면 안 됩니다. 트리거와 개인정보를 다루는 작업에서
   **보안 입력/보안 출력**을 활성화해 실행 기록에 전화번호가 노출되지 않도록 합니다.
2. JSON 요청 스키마에서 다음 필드를 필수로 지정합니다: `fullName`, `nickname`, `company`,
   `phone`, `phoneLast4`, `email`, `jobRole`, `participantId`는 문자열,
   `score`, `bugs`는 정수, `consent`는 boolean입니다. `consent=true`,
   `participantId` 64자리 16진수, `phone` 11자리 및 허용 범위를 흐름에서도 확인합니다.
   전화번호/점수는 검증된 게임 기록이나 인증 정보가 아니며 점수는 당첨 확률에 사용하지 않습니다.
3. SharePoint **항목 가져오기**에서
   `ParticipantId eq '<요청 participantId>'`로 기존 참가자를 먼저 조회합니다.
   존재하면 **새 행을 만들지 않고** 그 행의 원래 쿠폰, 경품, 닉네임, 회사, 당첨 시각을
   아래 성공 응답의 `status=duplicate`로 반환합니다. Redeemed가 true여도 새 쿠폰은 발급하지 않습니다.
4. 중복이 아니면 **항목 가져오기**로 모든 발급 기록을 조회합니다. **페이지 매김을 활성화**하고
   임계값은 최소 500 이상(권장 5000)으로 설정합니다. Redeemed=true인 행도 재고에서 차감합니다.
   기존 기록이 있으면 운영 전에 PrizeKey/ParticipantId/CouponCode를 정리해야 합니다.
   알 수 없는 PrizeKey나 누락된 키가 있으면 추첨을 중단하고 오류를 반환하세요.
5. **배열 필터링**으로 PrizeKey별 발급 수를 구합니다. 남은 수량은
   `beer5=15-발급수`, `nachos=30-발급수`, `quesa=20-발급수`, `beer1=435-발급수`입니다.
   음수이면 운영 오류로 중단합니다. 남은 합계가 0이면 HTTP **409**와
   `{"error":"sold_out"}`를 반환합니다. 500개를 넘는 쿠폰이나 무제한 맥주는 발급하지 않습니다.
6. 남은 합계를 `total`이라 할 때 `rand(0, total)`을 한 번 계산합니다(상한 제외).
   값이 beer5 잔여 미만이면 beer5, 그다음 nachos 누적 잔여 미만이면 nachos,
   그다음 quesa 누적 잔여 미만이면 quesa, 나머지는 beer1을 선택합니다.
   재고가 0인 경품은 선택되지 않습니다. 그림의 칸 크기는 실제 확률을 의미하지 않습니다.
7. `concat('GS-', guid())`와 `utcNow()`를 각각 한 번 계산한 뒤 **항목 만들기**로
   위 열을 매핑합니다. 신규 CouponCode/ParticipantId의 고유 값 제약을 유지하세요.
   **항목 저장이 성공한 후에만** HTTP 200을 반환합니다. 응답 유실/재시도는 3단계에서
   원래 쿠폰을 복원하므로 재고를 두 번 차감하지 않습니다. 항목 만들기에서 중복 키 충돌이면
   참가자 재조회 후 원래 쿠폰을 반환하고, 다른 실패는 오류로 처리합니다.
8. 실패/시간 초과를 처리하는 범위를 만들고 **실행 조건 구성**으로 HTTP 500
   `{"error":"storage_failed"}`를 반환합니다. 실패를 당첨 응답으로 바꾸지 마세요.
   대기열이 길면 서버의 25초 호출 제한으로 재시도가 필요할 수 있으며, 원래 실행이 나중에
   완료되어도 동일 참가자에게는 기존 쿠폰만 반환해야 합니다.

성공 응답 형식(예시의 코드는 실제 `guid()` 결과로 대체):

```json
{
  "status": "awarded",
  "code": "GS-00000000-0000-0000-0000-000000000000",
  "prizeKey": "beer1",
  "nickname": "참가자",
  "company": "회사",
  "wonAt": "2026-11-04T03:00:00Z",
  "mailed": false
}
```

중복이면 `status`만 `duplicate`로 바꾸고 기존 행의 값을 사용합니다.
메일 작업을 실제로 구현해 성공한 경우에만 `mailed=true`를 반환하세요.
현재 구성 절차에는 메일 발송이 포함되지 않습니다.

### Azure 연결 및 운영 확인

Azure Web App `nacho`의 환경 변수에 `ROULETTE_API_URL`(흐름의 비밀 HTTPS URL)과
`ROULETTE_IDENTITY_SECRET`(최소 32바이트의 암호학적 난수 비밀 값)을 등록하고 재시작합니다.
비밀 값은 채팅이나 GitHub 파일에 넣지 마세요. 행사 중 identity secret을 교체하면
기존 번호의 참가자 ID가 바뀌므로 같은 번호에 새 쿠폰이 발급될 수 있습니다.
설정이 없으면 API는 503을 반환하고 화면은 준비 중임을 명시합니다.
서버는 전체 번호와 뒤 4자리를 흐름에만 전달하며, 응답/쿠폰 화면/서버 로그에는 번호를 넣지 않습니다.

운영 전 별도 테스트 목록/흐름에서 같은 번호의 동시 요청과 재시도가 같은 쿠폰을 반환하는지,
뒤 4자리만 같은 서로 다른 번호는 별개인지, 500개 발급 후 501번째 신규 참가자는 409인지,
품목별 15/30/20/435개를 초과하지 않는지 확인하세요.
수령 시 스태프는 **화면만 믿지 말고** SharePoint에서 CouponCode를 조회하고 Redeemed=false인지
확인한 뒤 true로 변경해야 합니다. 동시에 같은 쿠폰을 처리하지 않도록 담당 창구를 하나로
운영하거나 별도 원자적 수령 API를 구현하세요. 브라우저 저장 쿠폰은 권한 증명이 아닙니다.

---

<img src="https://octodex.github.com/images/Professortocat_v2.png" align="right" height="200px" />

Hey wietraum0301!

Mona here. I'm done preparing your exercise. Hope you enjoy! 💚

Remember, it's self-paced so feel free to take a break! ☕️

[![](https://img.shields.io/badge/Go%20to%20Exercise-%E2%86%92-1f883d?style=for-the-badge&logo=github&labelColor=197935)](https://github.com/wietraum0301/dreamania-skills-ai-in-actions/issues/3)

---

&copy; 2025 GitHub &bull; [Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/code_of_conduct.md) &bull; [MIT License](https://gh.io/mit)
