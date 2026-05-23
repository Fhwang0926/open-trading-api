# open-trading-api

Korea Investment & Securities Open API를 위한 TypeScript ESM Node.js SDK입니다. `python-kis`를 기준 구현으로 삼고, 공식 [`koreainvestment/open-trading-api`](https://github.com/koreainvestment/open-trading-api)의 `kis_devlp.yaml`, `prod/vps/ops/vops` 도메인, `custtype`, POST `hashkey` 관례를 반영합니다.

## 설치

```bash
npm install open-trading-api
```

이 저장소에서 직접 개발할 때는 다음 명령을 사용합니다.

```bash
npm install
npm run build
npm test
```

## 실행 환경

이 패키지는 Node.js 백엔드에서 실행하는 SDK입니다.

- Node.js 20 이상이 필요합니다.
- ESM 패키지이므로 `import { PyKis } from "open-trading-api"` 형태로 사용합니다.
- REST는 Node 내장 `fetch`를 사용합니다.
- WebSocket은 Node용 `ws` 패키지를 사용합니다.
- 브라우저 프론트엔드에서 직접 실행하는 용도가 아닙니다. 앱 서버, 배치 작업, 트레이딩 봇, NestJS/Express/Fastify 같은 백엔드에서 사용하는 형태를 권장합니다.

## 인증 설정

### 환경변수 방식

`.env.example`을 참고해 앱 실행 환경에 값을 넣습니다.

```bash
KIS_ID=YOUR_HTS_ID
KIS_ACCOUNT=00000000-01
KIS_APPKEY=YOUR_36_CHARACTER_APP_KEY
KIS_SECRETKEY=YOUR_180_CHARACTER_APP_SECRET
KIS_KEEP_TOKEN_DIR=.kis
```

SDK는 `.env` 파일을 자동 로드하지 않습니다. 앱에서 `process.env`를 사용할 수 있게 직접 로드하거나, 배포 환경의 시크릿/환경변수 설정을 사용하세요.

```ts
import { PyKis } from "open-trading-api";

const kis = await PyKis.create({
  id: process.env.KIS_ID!,
  account: process.env.KIS_ACCOUNT!,
  appkey: process.env.KIS_APPKEY!,
  secretkey: process.env.KIS_SECRETKEY!,
  keepToken: process.env.KIS_KEEP_TOKEN_DIR ?? true
});
```

모의투자 키만 사용할 때는 `virtual: true`를 지정합니다.

```ts
const kis = await PyKis.create({
  id: process.env.KIS_VIRTUAL_ID ?? process.env.KIS_ID!,
  account: process.env.KIS_VIRTUAL_ACCOUNT!,
  appkey: process.env.KIS_VIRTUAL_APPKEY!,
  secretkey: process.env.KIS_VIRTUAL_SECRETKEY!,
  virtual: true,
  keepToken: ".kis"
});
```

실전과 모의를 함께 설정할 수도 있습니다.

```ts
const kis = await PyKis.create({
  id: process.env.KIS_ID!,
  account: process.env.KIS_ACCOUNT!,
  appkey: process.env.KIS_APPKEY!,
  secretkey: process.env.KIS_SECRETKEY!,
  virtualId: process.env.KIS_VIRTUAL_ID,
  virtualAppkey: process.env.KIS_VIRTUAL_APPKEY,
  virtualSecretkey: process.env.KIS_VIRTUAL_SECRETKEY,
  keepToken: true
});
```

## 보안 주의

인증 정보는 서버 환경변수, 시크릿 매니저, 또는 접근 권한이 제한된 설정 파일에만 보관하세요.

- `.env`, `.kis`, `node_modules`, `dist`는 기본 `.gitignore`에 포함되어 있습니다.
- `KisKey`, `KisAuth`, `KisAccessToken`은 공개 속성으로 app secret/access token을 노출하지 않습니다.
- `JSON.stringify()`와 `console.log()` 계열 출력에서는 키, 계좌번호, 토큰이 마스킹됩니다.
- `KisAuth.save()`와 토큰 캐시는 실제 인증 정보를 파일에 저장합니다. 이 파일들은 저장소에 커밋하지 말고, 운영 환경에서는 파일 권한과 보관 위치를 제한하세요.
- `kis.fetch()`의 요청 `headers`, `body`, `params`를 직접 로깅하면 인증 헤더나 계좌번호가 찍힐 수 있습니다. 디버그 로그에는 마스킹 필터를 적용하세요.

### kis_devlp.yaml 방식

공식 샘플처럼 `~/KIS/config/kis_devlp.yaml`을 사용하려면 `PyKis.fromConfig()`를 호출합니다.

```ts
import { PyKis } from "open-trading-api";

const kis = await PyKis.fromConfig(undefined, {
  mode: "vps", // "prod" | "real" = 실전, "vps" | "virtual" = 모의
  product: "01",
  keepToken: true
});
```

파일 경로를 직접 지정할 수도 있습니다.

```ts
const kis = await PyKis.fromConfig("G:/git/open-trading-api/kis_devlp.yaml", {
  mode: "prod",
  product: "01"
});
```

## 기본 사용

국내 종목은 `"KRX"`를 함께 넘기면 시장 탐색 요청을 줄일 수 있습니다.

```ts
const samsung = kis.stock("005930", "KRX");

const quote = await samsung.quote();
console.log(quote.price.toString(), quote.rate.toString());

const orderbook = await samsung.orderbook();
console.log(orderbook.askPrice?.price.toString(), orderbook.bidPrice?.price.toString());

const chart = await samsung.dailyChart({
  start: "20250101",
  period: "day",
  adjust: true
});
console.log(chart.bars.at(-1));
```

해외 종목은 거래소를 지정합니다.

```ts
const apple = kis.stock("AAPL", "NASDAQ");
const quote = await apple.quote();
console.log(quote.price.toString(), quote.exchangeRate.toString());
```

## 계좌 조회

```ts
const account = kis.account();

const balance = await account.balance();
console.log(balance.total.toString(), balance.profit.toString());

const orderable = await account.orderableAmount("KRX", "005930", {
  price: 70000
});
console.log(orderable.qty.toString(), orderable.amount.toString());

const pending = await account.pendingOrders("KRX");
console.log(pending.orders);
```

## 주문

주문 API는 KIS UAPI POST 요청이므로 SDK가 `/uapi/hashkey`를 먼저 호출하고 `hashkey` 헤더를 자동으로 붙입니다.

```ts
const stock = kis.stock("005930", "KRX");

const buyOrder = await stock.buy({
  price: 70000,
  qty: 1
});

const modified = await stock.modify(buyOrder, {
  price: 69900,
  qty: 1
});

await stock.cancel(modified);
```

시장가 주문은 `price`를 생략하거나 `null`로 둡니다.

```ts
await kis.stock("005930", "KRX").sell({
  price: null,
  qty: 1
});
```

## WebSocket

`useWebsocket`을 끄지 않으면 `kis.websocket`이 생성됩니다. 이벤트 구독은 `ticket.unsubscribe()`로 명시적으로 해지합니다.

```ts
const ticket = kis.stock("005930", "KRX").on("price", (_client, event) => {
  console.log(event.tr.id, event.response);
});

// 필요할 때 해지
ticket.unsubscribe();
await kis.close();
```

호가 구독도 같은 방식입니다.

```ts
const ticket = kis.stock("005930", "KRX").on("orderbook", (_client, event) => {
  console.log(event.response.raw);
});
```

## 저수준 요청

아직 스코프 메서드로 감싸지 않은 KIS API는 `kis.fetch()`로 호출할 수 있습니다.

```ts
const data = await kis.fetch("/uapi/domestic-stock/v1/quotations/inquire-price", {
  api: "FHKST01010100",
  domain: "real",
  params: {
    FID_COND_MRKT_DIV_CODE: "J",
    FID_INPUT_ISCD: "005930"
  }
});

console.log(data.output);
```

POST UAPI는 기본적으로 hashkey가 자동 적용됩니다. 특수한 API에서 끄고 싶다면 `hashkey: false`를 지정합니다.

```ts
await kis.fetch("/uapi/some/post-api", {
  method: "POST",
  api: "TTTC0000U",
  body: { FIELD: "VALUE" },
  hashkey: false
});
```

## 통합 테스트

실제 KIS API를 호출하는 통합 테스트는 명시적으로 켜야 합니다.

```bash
RUN_KIS_INTEGRATION=1 KIS_ID=... KIS_ACCOUNT=... KIS_APPKEY=... KIS_SECRETKEY=... npm run test:integration
```

PowerShell에서는 다음처럼 실행합니다.

```powershell
$env:RUN_KIS_INTEGRATION="1"
$env:KIS_ID="YOUR_HTS_ID"
$env:KIS_ACCOUNT="00000000-01"
$env:KIS_APPKEY="YOUR_APP_KEY"
$env:KIS_SECRETKEY="YOUR_APP_SECRET"
npm run test:integration
```

## npm 공개 배포

현재 패키지 이름은 `open-trading-api`입니다. 배포 전에 npm에서 이름이 비어 있는지 한 번 확인하세요.

```bash
npm view open-trading-api version
```

`E404`가 나오면 아직 등록되지 않은 이름입니다. 이미 버전이 나오면 `package.json`의 `name`을 바꾸거나 npm organization scope를 사용해야 합니다.

배포 전 체크:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

로컬에서 직접 배포하려면 npm 로그인이 필요합니다. npm 계정에 2FA가 켜져 있으면 publish 시 OTP를 입력해야 합니다.

```bash
npm login
npm publish --access public
```

한 번 배포된 `name@version` 조합은 다시 배포할 수 없습니다. 수정 배포가 필요하면 `package.json`의 `version`을 올린 뒤 다시 publish 해야 합니다.

### GitHub Actions 배포

이 저장소에는 두 개의 workflow가 있습니다.

- `.github/workflows/ci.yml`: push, pull request, 수동 실행에서 typecheck/test/build/pack 검증
- `.github/workflows/publish-npm.yml`: 버전 태그 push, GitHub Release 발행, 또는 수동 실행 시 npm 공개 배포

GitHub Actions 배포는 npm Trusted Publisher를 사용합니다. npm 패키지 설정의 Trusted Publisher 값은 다음과 같이 맞춥니다.

1. Publisher: `GitHub Actions`
2. Organization or user: `Fhwang0926`
3. Repository: `open-trading-api`
4. Workflow filename: `publish-npm.yml`
5. Environment name: 비워 둠
6. Allowed actions: `Allow npm publish`

배포 순서:

1. `package.json`의 `version`을 올리고 커밋합니다.
2. `v1.0.1`처럼 `v` 접두사가 있는 `vMAJOR.MINOR.PATCH` 태그를 만들고 push합니다.
3. `Publish npm Package` workflow가 태그에서 `1.0.1`을 파싱하고 `package.json` 버전과 일치하는지 확인합니다.
4. 태그 push로 실행된 경우 GitHub Release를 자동 생성합니다.
5. workflow가 OIDC로 npm에 인증하고 `npm publish --access public`을 실행합니다.

Trusted publishing에서는 npm token secret이 필요하지 않습니다. 공개 GitHub 저장소에서 publish하면 npm provenance도 자동으로 생성됩니다.

```bash
git tag v1.0.1
git push origin v1.0.1
```

## 주요 export

- `PyKis`
- `KisAuth`, `KisKey`, `KisAccountNumber`
- `KisAccessToken`
- `KisWebsocketClient`, `KisEventTicket`
- `loadKisConfig`, `parseKisConfig`
- 시장/주문/응답 타입과 주요 응답 인터페이스

## 출처

이 프로젝트는 MIT 라이선스의 [`python-kis`](https://github.com/Soju06/python-kis)를 기준 구현으로 참고합니다. 한국투자증권 공식 샘플 저장소 [`koreainvestment/open-trading-api`](https://github.com/koreainvestment/open-trading-api)의 설정 및 요청 관례도 반영합니다. 자세한 고지는 `NOTICE`를 확인하세요.
