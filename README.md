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

로컬에서 직접 배포하려면 npm 로그인이 필요합니다.

```bash
npm login
npm publish --access public --provenance
```

한 번 배포된 `name@version` 조합은 다시 배포할 수 없습니다. 수정 배포가 필요하면 `package.json`의 `version`을 올린 뒤 다시 publish 해야 합니다.

### GitHub Actions 배포

이 저장소에는 두 개의 workflow가 있습니다.

- `.github/workflows/ci.yml`: push, pull request, 수동 실행에서 typecheck/test/build/pack 검증
- `.github/workflows/publish-npm.yml`: GitHub Release 발행 또는 수동 실행 시 npm 공개 배포

토큰 기반 배포를 쓰려면 GitHub 저장소에 secret을 추가합니다.

1. npm 계정에서 publish 권한이 있는 automation/granular token을 생성합니다.
2. GitHub 저장소의 `Settings > Secrets and variables > Actions`에서 `NPM_TOKEN` secret을 추가합니다.
3. `package.json`의 `version`을 올리고 커밋합니다.
4. `v0.1.0`처럼 `package.json` 버전과 같은 태그로 GitHub Release를 발행합니다.
5. `Publish npm Package` workflow가 `npm publish --access public --provenance`를 실행합니다.

provenance를 사용하려면 GitHub 저장소가 공개 저장소여야 합니다. 비공개 저장소에서 배포해야 한다면 workflow의 publish 명령에서 `--provenance`를 제거하세요.

## 주요 export

- `PyKis`
- `KisAuth`, `KisKey`, `KisAccountNumber`
- `KisAccessToken`
- `KisWebsocketClient`, `KisEventTicket`
- `loadKisConfig`, `parseKisConfig`, `pyKisOptionsFromConfig`
- 시장/주문/응답 타입과 주요 응답 인터페이스

## 출처

이 프로젝트는 MIT 라이선스의 [`python-kis`](https://github.com/Soju06/python-kis)를 기준 구현으로 참고합니다. 한국투자증권 공식 샘플 저장소 [`koreainvestment/open-trading-api`](https://github.com/koreainvestment/open-trading-api)의 설정 및 요청 관례도 반영합니다. 자세한 고지는 `NOTICE`를 확인하세요.
