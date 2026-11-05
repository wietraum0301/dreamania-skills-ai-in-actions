# GSTAR × GitHub Copilot 팝업 – 완성본 (Azure Static Web Apps)

손님 폰 게임 → 룰렛 → 쿠폰 발급·메일, 스태프 쿠폰 확인·사용 처리까지 한 프로젝트입니다.
모든 기록과 상태는 SharePoint `axjouney` 사이트의 두 목록에 저장됩니다. Power Automate 흐름은 필요 없습니다.

```
gstar-swa/
├─ index.html                  손님용 게임 페이지 (/)
├─ staff.html                  스태프용 쿠폰 확인 페이지 (/staff)
├─ staticwebapp.config.json
└─ api/                        Azure Functions (Node 20)
   ├─ src/functions/roulette.js   POST /api/roulette  참가·추첨·쿠폰 생성·메일
   ├─ src/functions/staff.js      POST /api/staff     PIN 확인·현황·조회·사용 처리·추첨 종료/재개
   ├─ src/lib/                    SharePoint(Graph)·추첨·메일 로직
   ├─ test/                       모의 SharePoint로 돌리는 테스트 (npm test)
   └─ local.settings.sample.json  환경 변수 예시
```

## 데이터 구조

| 목록 | 내용 |
|---|---|
| `GSTARWinners` | 쿠폰 1장 = 1행. `Title`=쿠폰 코드, `Redeemed`(사용), `CouponMailed`(메일), `CouponCheckedAt/By`(사용 처리 시각·처리자) |

**손님 입력값 저장 (`GSTARWinners`)** – 앞뒤 공백만 지우고 입력한 그대로 저장합니다.

| 입력 | 열 | 비고 |
|---|---|---|
| 이름 | `FullName` | 최대 30자 |
| 닉네임 | `Nickname` | 최대 20자 |
| 회사/소속 | `Company` | 최대 40자 |
| 휴대폰 번호 | `Phone` (`010-1234-5678` 형식), `Phone4` (뒤 4자리) | 하이픈 유무와 관계없이 같은 번호로 인식 |
| 이메일 | `Email` | 대소문자 포함 입력한 그대로, 최대 100자 |
| 직군 | `JobRole` | |
| 개인정보 동의 | `Consent` (예/아니요) | 동의해야만 참여 가능하므로 항상 '예' |
| 게임 결과 | `Score`, `Bugs` | |
| 당첨 시각 | `WonAt` | 동의 시각으로도 사용 |

같은 번호로 다시 참여하면 새 정보로 덮어쓰지 않고 처음 기록과 쿠폰을 그대로 유지합니다.
| `GSTARSettings` | `Title`=키, `NumValue`=값 |

`GSTARSettings` 키
- 설정(운영자가 바꿈): `beer5` `nachos` `quesa` `beer1`(한정 수량), `expected`(예상 참가자), `open`(1 진행 / 0 종료), `pin`(스태프 PIN, `Label` 열)
- 상태(API가 바꿈): `played`, `issued_beer5|nachos|quesa|beer1|total`, `redeemed_beer5|nachos|quesa|beer1|total`, `mailed_total`

`issued_*` 카운터가 재고의 기준값입니다. API는 카운터를 eTag(If-Match)로 잠그고 올린 뒤에만 쿠폰을 만들기 때문에, 여러 손님이 동시에 돌려도 한정 수량을 넘지 않습니다.

## API 응답

| 상황 | HTTP | 본문 |
|---|---|---|
| 신규 당첨 | 200 | `status:"awarded"`, code, prizeKey, nickname, company, wonAt, mailed, redeemed, emailMasked |
| 같은 번호 재참여 | 200 | `status:"duplicate"` + 같은 필드 (실제 메일·사용 상태) |
| 추첨 종료 | 409 | `{"error":"closed"}` |
| 전량 소진 | 409 | `{"error":"sold_out"}` |
| 입력 오류 | 400 | `{"error":"invalid_input"}` |
| 설정 누락·인증 실패 | 500 | `{"error":"not_configured"}` → 함수 로그에 누락 키 표시 |
| SharePoint 일시 오류 | 503 | `{"error":"store_unavailable"}` 또는 `busy` |

---

## 배포 (처음 한 번)

### 1. 앱 등록 (Entra ID) – 테넌트 관리자 동의 필요
1. Entra 관리 센터 → 앱 등록 → 새 등록 (예: `GSTAR Coupon API`)
2. **인증서 및 비밀** → 새 클라이언트 비밀 → 값을 복사해 둡니다 (다시 볼 수 없음)
3. **API 권한** → Microsoft Graph → **애플리케이션 권한**
   - `Sites.Selected` (이 사이트에만 접근하도록 제한)
   - `Mail.Send`
   → **관리자 동의 허용**
4. `Sites.Selected`는 사이트별로 허용해야 합니다. 관리자가 Graph 탐색기에서 실행:
   ```http
   POST https://graph.microsoft.com/v1.0/sites/megazone0.sharepoint.com,e0b04a54-3d04-4baf-b0ef-e729ee09ab8e,1f604958-10ee-4401-a568-2dc5d1c32506/permissions
   Content-Type: application/json

   { "roles": ["write"],
     "grantedToIdentities": [{ "application": { "id": "<CLIENT_ID>", "displayName": "GSTAR Coupon API" } }] }
   ```
5. `Mail.Send` 앱 권한은 기본적으로 **모든 사서함**에서 보낼 수 있습니다. Exchange 관리자가 메일 보낼 사서함 하나로 제한하세요
   (Exchange Online PowerShell `New-ApplicationAccessPolicy -AccessRight RestrictAccess -AppId <CLIENT_ID> -PolicyScopeGroupId <MAIL_FROM 사서함 또는 보안 그룹>`).

### 2. SharePoint 준비
- `GSTARWinners` → 목록 설정 → **인덱싱된 열**에서 `Phone`, `Phone4` 인덱스 추가 (중복 확인·조회 속도)
- `GSTARSettings` → `pin` 행의 `Label`을 **6자리 이상**으로 변경 (4자리는 추측이 쉬움)

### 3. Static Web App 만들기
Azure Portal → Static Web Apps → 만들기 (Free 요금제 가능)
- 배포 원본: GitHub(이 폴더를 저장소로) 또는 **기타**(CLI 배포)
- 앱 위치 `/`, API 위치 `api`, 출력 위치 비움

### 4. 환경 변수
Static Web App → **환경 변수(구성)** 에 추가. `CLIENT_SECRET`은 코드·저장소에 넣지 마세요.

| 이름 | 값 |
|---|---|
| `TENANT_ID` | 테넌트 ID |
| `CLIENT_ID` | 1단계 앱의 클라이언트 ID |
| `CLIENT_SECRET` | 1단계 비밀 값 |
| `SITE_ID` | `megazone0.sharepoint.com,e0b04a54-3d04-4baf-b0ef-e729ee09ab8e,1f604958-10ee-4401-a568-2dc5d1c32506` |
| `WINNERS_LIST_ID` | `7d805e7f-3cab-472a-bb38-52149074d3fe` |
| `SETTINGS_LIST_ID` | `76c96854-f21c-4345-9a12-e94437dc28af` |
| `MAIL_FROM` | 쿠폰 메일을 보낼 사서함 주소 (비우면 메일 없이 쿠폰만 발급) |

### 5. 배포 (CLI)
```bash
npm install -g @azure/static-web-apps-cli
cd gstar-swa
swa deploy . --api-location api --api-language node --api-version 20 --env production --deployment-token <SWA 배포 토큰>
```

### 6. 리허설 (행사 전 꼭)
1. 실제 아이폰·안드로이드로 `https://<사이트>/` 참여 → 쿠폰 화면·메일 수신 확인
2. 같은 번호로 다시 참여 → "이미 참여하셨어요"와 같은 쿠폰
3. `https://<사이트>/staff` → PIN → 코드 조회 → 사용 처리 → 손님 폰에서 다시 참여하면 **사용 완료** 도장
4. `GSTARSettings`의 `issued_*`, `redeemed_*`, `played`, `mailed_total` 값 확인
5. 리허설 쿠폰 행 삭제 + 상태 값 0으로 초기화

## 로컬 테스트
```bash
cd api
npm test        # 모의 SharePoint(실제 목록 열 구성 적용)로 18개 시나리오 (동시 40명 재고 초과 방지 포함)
```
실제 연결로 돌리려면 `local.settings.sample.json`을 `local.settings.json`으로 복사해 값을 채우고 `swa start . --api-location api`.

## 운영
- 추첨 끝내기: 스태프 페이지 **추첨 종료하기** (또는 `GSTARSettings` `open` = 0)
- 행사 후: Static Web App 삭제 또는 중지, 앱 등록 비밀 삭제, 개인정보 보관 기간이 지나면 `GSTARWinners` 정리
- 기존 스태프 앱("GSTAR Copilot Bug Roulette")에서 `Redeemed`를 직접 바꾸면 `redeemed_*` 집계는 올라가지 않습니다. 사용 처리는 `/staff` 페이지로 통일하세요.
