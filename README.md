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
`/`와 `/index.html` 외의 경로는 404를 반환하며 저장소 파일을 공개하지 않습니다.

현재 `index.html`의 `API_URL`은 비어 있습니다. 화면 및 게임 배포와 별개로,
경품 추첨/쿠폰 발급/메일 발송에는 실제 API 주소와 해당 API의 CORS 설정이 필요합니다.

---

<img src="https://octodex.github.com/images/Professortocat_v2.png" align="right" height="200px" />

Hey wietraum0301!

Mona here. I'm done preparing your exercise. Hope you enjoy! 💚

Remember, it's self-paced so feel free to take a break! ☕️

[![](https://img.shields.io/badge/Go%20to%20Exercise-%E2%86%92-1f883d?style=for-the-badge&logo=github&labelColor=197935)](https://github.com/wietraum0301/dreamania-skills-ai-in-actions/issues/3)

---

&copy; 2025 GitHub &bull; [Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/code_of_conduct.md) &bull; [MIT License](https://gh.io/mit)
