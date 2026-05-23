import { Decimal } from "decimal.js";
import { KisAccountNumber } from "./account-number.js";
import type { PyKis } from "./client.js";
import { KisMarketNotOpenedError, KisNotFoundError } from "./errors.js";
import { KisPage } from "./page.js";
import {
  DAYTIME_MARKET_SHORT_TYPE_MAP,
  MARKET_CODE_MAP,
  MARKET_COUNTRY_MAP,
  MARKET_SHORT_TYPE_MAP,
  MARKET_TIMEZONE_MAP,
  REVERSE_MARKET_CODE_MAP,
  STOCK_RISK_TYPE_MAP,
  type ChartPeriod,
  type CountryType,
  type CurrencyType,
  type KisBalance,
  type KisBalanceStock,
  type KisChart,
  type KisChartBar,
  type KisDailyOrder,
  type KisDailyOrders,
  type KisDeposit,
  type KisIndicator,
  type KisOrder,
  type KisOrderProfit,
  type KisOrderProfits,
  type KisOrderbook,
  type KisOrderbookItem,
  type KisOrderableAmount,
  type KisPendingOrder,
  type KisPendingOrders,
  type KisQuote,
  type KisStockInfo,
  type MarketInfoType,
  type MarketType,
  type OrderCondition,
  type OrderExecution,
  type OrderPriceInput,
  type OrderQuantityInput,
  type OrderType
} from "./types.js";
import {
  DOMESTIC_ORDER_API_CODES,
  FOREIGN_ORDER_API_CODES,
  FOREIGN_ORDER_MODIFY_API_CODES,
  ensurePrice,
  ensureQuantity,
  orderCondition
} from "./orders.js";
import {
  apiMeta,
  asBool,
  asDecimal,
  asInt,
  asOptionalDecimal,
  formatDate,
  formatTime,
  mergeDecimal,
  normalizeDateInput,
  output,
  outputArray,
  safeDivide,
  signFromCode,
  toKstDate,
  type AnyRecord
} from "./utils.js";

const MARKET_INFO_CODES: Record<string, string[]> = {
  KR: ["300"],
  KRX: ["300"],
  NASDAQ: ["512"],
  NYSE: ["513"],
  AMEX: ["529"],
  US: ["512", "513", "529"],
  TYO: ["515"],
  JP: ["515"],
  HKEX: ["501"],
  HK: ["501", "543", "558"],
  HNX: ["507"],
  HSX: ["508"],
  VN: ["507", "508"],
  SSE: ["551"],
  SZSE: ["552"],
  CN: ["551", "552"],
  ALL: ["300", "512", "513", "529", "515", "501", "543", "558", "551", "552", "507", "508"]
};

const MARKET_CODE_TO_TYPE: Record<string, MarketType> = {
  "300": "KRX",
  "301": "KRX",
  "302": "KRX",
  "512": "NASDAQ",
  "513": "NYSE",
  "529": "AMEX",
  "515": "TYO",
  "501": "HKEX",
  "543": "HKEX",
  "558": "HKEX",
  "507": "HNX",
  "508": "HSX",
  "551": "SSE",
  "552": "SZSE"
};

const MARKET_CODE_NAME: Record<string, string> = {
  "300": "주식",
  "301": "선물옵션",
  "302": "채권",
  "512": "나스닥",
  "513": "뉴욕",
  "529": "아멕스",
  "515": "일본",
  "501": "홍콩",
  "543": "홍콩CNY",
  "558": "홍콩USD",
  "507": "하노이",
  "508": "호치민",
  "551": "상하이",
  "552": "심천"
};

export async function resolveMarket(kis: PyKis, symbol: string, market?: MarketInfoType): Promise<MarketType> {
  if (!symbol) throw new Error("symbol is required.");
  if (market && isMarketType(market)) return market;
  if (market === "KR") return "KRX";
  if (/^\d{6}$/.test(symbol) && market == null) return "KRX";

  const cacheKey = `resolve-market:${market ?? "all"}:${symbol}`;
  const cached = kis.cache.get<MarketType>(cacheKey);
  if (cached) return cached;

  const candidates = (market ? MARKET_INFO_CODES[String(market)] ?? MARKET_INFO_CODES.ALL : MARKET_INFO_CODES.ALL) ?? [];
  for (const productCode of candidates) {
    const candidate = MARKET_CODE_TO_TYPE[productCode];
    if (!candidate) continue;
    try {
      if (candidate === "KRX") {
        const data = await kis.fetch<AnyRecord>("/uapi/domestic-stock/v1/quotations/inquire-price", {
          api: "FHKST01010100",
          domain: "real",
          params: { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: symbol }
        });
        if (asInt(output(data).stck_prpr) > 0) {
          kis.cache.set(cacheKey, candidate, 24 * 60 * 60 * 1000);
          return candidate;
        }
      } else {
        const data = await kis.fetch<AnyRecord>("/uapi/overseas-price/v1/quotations/price", {
          api: "HHDFS00000300",
          domain: "real",
          params: { AUTH: "", EXCD: MARKET_SHORT_TYPE_MAP[candidate as Exclude<MarketType, "KRX">], SYMB: symbol }
        });
        if (String(output(data).last ?? "") !== "") {
          kis.cache.set(cacheKey, candidate, 24 * 60 * 60 * 1000);
          return candidate;
        }
      }
    } catch {
      // Continue probing candidates, matching python-kis behavior.
    }
  }
  throw new KisNotFoundError({ rt_cd: "7", msg_cd: "NOT_FOUND", msg1: "Stock market could not be resolved." });
}

export async function stockInfo(kis: PyKis, symbol: string, market?: MarketInfoType): Promise<KisStockInfo> {
  const cacheKey = `stock-info:${market ?? "all"}:${symbol}`;
  const cached = kis.cache.get<KisStockInfo>(cacheKey);
  if (cached) return cached;

  const resolved = market && isMarketType(market) ? market : await resolveMarket(kis, symbol, market);
  const codes = (MARKET_INFO_CODES[resolved] ?? MARKET_INFO_CODES.ALL) ?? [];
  let lastData: AnyRecord | undefined;
  for (const code of codes) {
    try {
      const result = await kis.fetch<KisStockInfo>("/uapi/domestic-stock/v1/quotations/search-info", {
        api: "CTPF1604R",
        domain: "real",
        params: { PDNO: symbol, PRDT_TYPE_CD: code },
        mapper: (data, response) => mapStockInfo(data, response)
      });
      kis.cache.set(cacheKey, result, 24 * 60 * 60 * 1000);
      return result;
    } catch (error) {
      lastData = error instanceof KisNotFoundError ? error.data : lastData;
    }
  }
  throw new KisNotFoundError(lastData ?? {}, undefined, "Stock information was not found.");
}

export async function quote(kis: PyKis, symbol: string, market: MarketType, extended = false): Promise<KisQuote> {
  if (market === "KRX") return domesticQuote(kis, symbol);
  return foreignQuote(kis, symbol, market, extended);
}

export function domesticQuote(kis: PyKis, symbol: string): Promise<KisQuote> {
  return kis.fetch("/uapi/domestic-stock/v1/quotations/inquire-price", {
    api: "FHKST01010100",
    domain: "real",
    params: { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: symbol },
    mapper: (data, response) => mapDomesticQuote(symbol, data, response)
  });
}

export function foreignQuote(kis: PyKis, symbol: string, market: MarketType, extended = false): Promise<KisQuote> {
  if (market === "KRX") return domesticQuote(kis, symbol);
  const marketCode = extended ? DAYTIME_MARKET_SHORT_TYPE_MAP[market] : MARKET_SHORT_TYPE_MAP[market as Exclude<MarketType, "KRX">];
  if (!marketCode) throw new Error(`Extended quote is not supported for ${market}.`);
  return kis.fetch("/uapi/overseas-price/v1/quotations/price-detail", {
    api: "HHDFS76200200",
    domain: "real",
    params: { AUTH: "", EXCD: marketCode, SYMB: symbol },
    mapper: (data, response) => mapForeignQuote(symbol, market, data, response)
  });
}

export async function orderbook(
  kis: PyKis,
  symbol: string,
  market: MarketType,
  condition?: OrderCondition | null
): Promise<KisOrderbook> {
  if (market === "KRX") {
    return kis.fetch("/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn", {
      api: "FHKST01010200",
      params: { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: symbol },
      mapper: (data, response) => mapDomesticOrderbook(symbol, data, response)
    });
  }
  const code =
    condition === "extended" ? DAYTIME_MARKET_SHORT_TYPE_MAP[market] : MARKET_SHORT_TYPE_MAP[market as Exclude<MarketType, "KRX">];
  if (!code) throw new Error(`Orderbook is not supported for ${market}.`);
  return kis.fetch("/uapi/overseas-price/v1/quotations/inquire-asking-price", {
    api: "HHDFS76200100",
    params: { EXCD: code, SYMB: symbol },
    mapper: (data, response) => mapForeignOrderbook(symbol, market, data, response)
  });
}

export async function dailyChart(
  kis: PyKis,
  symbol: string,
  market: MarketType,
  options: { start?: Date | string; end?: Date | string; period?: ChartPeriod; adjust?: boolean } = {}
): Promise<KisChart> {
  const end = normalizeDateInput(options.end);
  const start = options.start ? normalizeDateInput(options.start) : new Date(0);
  const period = options.period ?? "day";
  if (market === "KRX") {
    return kis.fetch("/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice", {
      api: "FHKST03010100",
      domain: "real",
      params: {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: symbol,
        FID_INPUT_DATE_1: formatDate(start),
        FID_INPUT_DATE_2: formatDate(end),
        FID_PERIOD_DIV_CODE: period === "day" ? "D" : period === "week" ? "W" : period === "month" ? "M" : "Y",
        FID_ORG_ADJ_PRC: options.adjust ? "0" : "1"
      },
      mapper: (data, response) => mapDomesticDailyChart(symbol, data, response)
    });
  }
  return kis.fetch("/uapi/overseas-price/v1/quotations/dailyprice", {
    api: "HHDFS76240000",
    domain: "real",
    params: {
      AUTH: "",
      EXCD: MARKET_SHORT_TYPE_MAP[market as Exclude<MarketType, "KRX">],
      SYMB: symbol,
      GUBN: period === "day" ? "0" : period === "week" ? "1" : "2",
      BYMD: formatDate(end),
      MODP: options.adjust ? "1" : "0"
    },
    mapper: (data, response) => mapForeignDailyChart(symbol, market, data, response)
  });
}

export async function dayChart(
  kis: PyKis,
  symbol: string,
  market: MarketType,
  options: { start?: Date; end?: Date; period?: number } = {}
): Promise<KisChart> {
  if (market === "KRX") {
    return kis.fetch("/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice", {
      api: "FHKST03010200",
      domain: "real",
      params: {
        FID_ETC_CLS_CODE: "",
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: symbol,
        FID_INPUT_HOUR_1: formatTime(options.end ?? new Date(0)),
        FID_PW_DATA_INCU_YN: "N"
      },
      mapper: (data, response) => mapDomesticDayChart(symbol, data, response, options.period ?? 1)
    });
  }
  const prev = await quote(kis, symbol, market);
  return kis.fetch("/uapi/overseas-price/v1/quotations/inquire-time-itemchartprice", {
    api: "HHDFS76950200",
    domain: "real",
    params: {
      AUTH: "",
      EXCD: MARKET_SHORT_TYPE_MAP[market as Exclude<MarketType, "KRX">],
      SYMB: symbol,
      NMIN: "1",
      PINC: "1",
      NEXT: "",
      NREC: "120",
      FILL: "",
      KEYB: ""
    },
    mapper: (data, response) => mapForeignDayChart(symbol, market, prev.prevPrice, data, response, options.period ?? 1)
  });
}

export async function balance(kis: PyKis, account: string | KisAccountNumber, country?: CountryType | null): Promise<KisBalance> {
  const accountNumber = toAccount(account);
  if (country === "KR") return domesticBalance(kis, accountNumber);
  if (country) return foreignBalance(kis, accountNumber, country);
  const [domestic, foreign] = await Promise.all([domesticBalance(kis, accountNumber), foreignBalance(kis, accountNumber, null)]);
  return mergeBalances(accountNumber, [domestic, foreign]);
}

export function domesticBalance(kis: PyKis, account: KisAccountNumber): Promise<KisBalance> {
  const page = KisPage.first(100);
  return kis.fetch("/uapi/domestic-stock/v1/trading/inquire-balance", {
    api: kis.virtual ? "VTTC8434R" : "TTTC8434R",
    form: [account, page],
    params: {
      AFHR_FLPR_YN: "N",
      OFL_YN: "",
      INQR_DVSN: "02",
      UNPR_DVSN: "01",
      FUND_STTL_ICLD_YN: "Y",
      FNCG_AMT_AUTO_RDPT_YN: "N",
      PRCS_DVSN: "00"
    },
    mapper: (data, response) => mapDomesticBalance(account, data, response)
  });
}

export function foreignBalance(kis: PyKis, account: KisAccountNumber, country?: CountryType | null): Promise<KisBalance> {
  const countryCode: Record<string, string> = { US: "840", HK: "344", CN: "156", JP: "392", VN: "704" };
  return kis.fetch("/uapi/overseas-stock/v1/trading/inquire-present-balance", {
    api: kis.virtual ? "VTRP6504R" : "CTRP6504R",
    form: [account],
    params: {
      WCRC_FRCR_DVSN_CD: "02",
      NATN_CD: country ? countryCode[country] ?? "000" : "000",
      TR_MKET_CD: "00",
      INQR_DVSN_CD: "00"
    },
    mapper: (data, response) => mapForeignPresentBalance(account, country ?? null, data, response)
  });
}

export async function orderableAmount(
  kis: PyKis,
  account: string | KisAccountNumber,
  market: MarketType,
  symbol: string,
  options: { price?: OrderPriceInput | null; condition?: OrderCondition | null; execution?: OrderExecution | null } = {}
): Promise<KisOrderableAmount> {
  const accountNumber = toAccount(account);
  const price = options.price == null ? null : ensurePrice(options.price, market === "KRX" ? 0 : 4);
  if (market === "KRX") {
    const [code, , label] = orderCondition({
      virtual: kis.virtual,
      market,
      order: "buy",
      price,
      condition: options.condition ?? null,
      execution: options.execution ?? null
    });
    return kis.fetch("/uapi/domestic-stock/v1/trading/inquire-psbl-order", {
      api: kis.virtual ? "VTTC8908R" : "TTTC8908R",
      form: [accountNumber],
      params: {
        PDNO: symbol,
        ORD_UNPR: price?.toString() ?? "0",
        ORD_DVSN: code,
        CMA_EVLU_AMT_ICLD_YN: "N",
        OVRS_ICLD_YN: "N"
      },
      mapper: (data, response) => mapDomesticOrderableAmount(accountNumber, symbol, price, options, label, data, response)
    });
  }
  const unitPrice = price ?? (await quote(kis, symbol, market, options.condition === "extended")).close;
  const [, , label] =
    options.condition === "extended"
      ? ["00", null, "주간거래"]
      : orderCondition({
          virtual: kis.virtual,
          market,
          order: "buy",
          price,
          condition: options.condition ?? null,
          execution: options.execution ?? null
        });
  return kis.fetch("/uapi/overseas-stock/v1/trading/inquire-psamount", {
    api: kis.virtual ? "VTTS3007R" : "TTTS3007R",
    form: [accountNumber],
    params: {
      OVRS_EXCG_CD: MARKET_CODE_MAP[market as Exclude<MarketType, "KRX">],
      OVRS_ORD_UNPR: unitPrice.toString(),
      ITEM_CD: symbol
    },
    mapper: (data, response) => mapForeignOrderableAmount(accountNumber, market, symbol, price, unitPrice, options, label, data, response)
  });
}

export async function order(
  kis: PyKis,
  account: string | KisAccountNumber,
  market: MarketType,
  symbol: string,
  options: {
    order: OrderType;
    price?: OrderPriceInput | null;
    qty?: OrderQuantityInput | null;
    condition?: OrderCondition | null;
    execution?: OrderExecution | null;
    includeForeign?: boolean;
  }
): Promise<KisOrder> {
  const accountNumber = toAccount(account);
  const price = options.price == null ? null : ensurePrice(options.price, market === "KRX" ? 0 : 4);
  const qty =
    options.qty == null
      ? (await orderableAmount(kis, accountNumber, market, symbol, options)).qty
      : ensureQuantity(options.qty, 0);
  const [conditionCode, priceSetting] = orderCondition({
    virtual: kis.virtual,
    market,
    order: options.order,
    price,
    condition: options.condition ?? null,
    execution: options.execution ?? null
  });
  const orderPrice =
    price ??
    (priceSetting
      ? priceSetting === "upper"
        ? (await quote(kis, symbol, market, options.condition === "extended")).highLimit
        : (await quote(kis, symbol, market, options.condition === "extended")).lowLimit
      : new Decimal(0));

  if (market === "KRX") {
    return kis.fetch("/uapi/domestic-stock/v1/trading/order-cash", {
      api: DOMESTIC_ORDER_API_CODES[`${!kis.virtual}:${options.order}`],
      method: "POST",
      form: [accountNumber],
      body: { PDNO: symbol, ORD_DVSN: conditionCode, ORD_QTY: qty.trunc().toString(), ORD_UNPR: orderPrice.toString() },
      mapper: (data, response) => mapOrder(accountNumber, symbol, market, data, response)
    });
  }

  if (options.condition === "extended") {
    if (kis.virtual) throw new Error("Daytime order is not supported for virtual domain.");
    const api = options.order === "buy" ? "TTTS6036U" : "TTTS6037U";
    return kis.fetch("/uapi/overseas-stock/v1/trading/daytime-order", {
      api,
      method: "POST",
      domain: "real",
      form: [accountNumber],
      body: {
        OVRS_EXCG_CD: MARKET_CODE_MAP[market as Exclude<MarketType, "KRX">],
        PDNO: symbol,
        ORD_QTY: qty.trunc().toString(),
        OVRS_ORD_UNPR: orderPrice.toString(),
        ORD_SVR_DVSN_CD: "0",
        ORD_DVSN: "00"
      },
      mapper: (data, response) => mapOrder(accountNumber, symbol, market, data, response)
    });
  }

  return kis.fetch("/uapi/overseas-stock/v1/trading/order", {
    api: FOREIGN_ORDER_API_CODES[`${!kis.virtual}:${market}:${options.order}`],
    method: "POST",
    form: [accountNumber],
    body: {
      OVRS_EXCG_CD: MARKET_CODE_MAP[market as Exclude<MarketType, "KRX">],
      PDNO: symbol,
      ORD_QTY: qty.trunc().toString(),
      OVRS_ORD_UNPR: orderPrice.toString(),
      SLL_TYPE: options.order === "sell" ? "00" : "",
      ORD_SVR_DVSN_CD: "0",
      ORD_DVSN: conditionCode
    },
    mapper: (data, response) => mapOrder(accountNumber, symbol, market, data, response)
  });
}

export async function modifyOrder(
  kis: PyKis,
  target: KisOrder,
  options: { price?: OrderPriceInput | null; qty?: OrderQuantityInput | null; condition?: OrderCondition | null; execution?: OrderExecution | null }
): Promise<KisOrder> {
  const price = options.price == null ? null : ensurePrice(options.price, target.market === "KRX" ? 0 : 4);
  const qty = options.qty == null ? new Decimal(0) : ensureQuantity(options.qty, 0);
  if (target.market === "KRX") {
    const [conditionCode] = orderCondition({
      virtual: kis.virtual,
      market: "KRX",
      order: "buy",
      price,
      condition: options.condition ?? null,
      execution: options.execution ?? null
    });
    return kis.fetch("/uapi/domestic-stock/v1/trading/order-rvsecncl", {
      api: kis.virtual ? "VTTC0803U" : "TTTC0803U",
      method: "POST",
      form: [toAccount(target.accountNumber)],
      body: {
        KRX_FWDG_ORD_ORGNO: target.branch,
        ORGN_ODNO: target.number,
        ORD_DVSN: conditionCode,
        RVSE_CNCL_DVSN_CD: "01",
        ORD_QTY: qty.trunc().toString(),
        ORD_UNPR: price?.toString() ?? "0",
        QTY_ALL_ORD_YN: options.qty == null ? "Y" : "N"
      },
      mapper: (data, response) => mapOrder(toAccount(target.accountNumber), target.symbol, target.market, data, response)
    });
  }
  const api = FOREIGN_ORDER_MODIFY_API_CODES[`${!kis.virtual}:${target.market}:modify`];
  if (!api) throw new Error(`Modify order is not supported for ${target.market}.`);
  return kis.fetch("/uapi/overseas-stock/v1/trading/order-rvsecncl", {
    api,
    method: "POST",
    form: [toAccount(target.accountNumber)],
    body: {
      OVRS_EXCG_CD: MARKET_CODE_MAP[target.market as Exclude<MarketType, "KRX">],
      PDNO: target.symbol,
      ORGN_ODNO: target.number,
      RVSE_CNCL_DVSN_CD: "01",
      ORD_QTY: qty.trunc().toString(),
      OVRS_ORD_UNPR: price?.toString() ?? "0"
    },
    mapper: (data, response) => mapOrder(toAccount(target.accountNumber), target.symbol, target.market, data, response)
  });
}

export async function cancelOrder(kis: PyKis, target: KisOrder): Promise<KisOrder> {
  if (target.market === "KRX") {
    return kis.fetch("/uapi/domestic-stock/v1/trading/order-rvsecncl", {
      api: kis.virtual ? "VTTC0803U" : "TTTC0803U",
      method: "POST",
      form: [toAccount(target.accountNumber)],
      body: {
        KRX_FWDG_ORD_ORGNO: target.branch,
        ORGN_ODNO: target.number,
        ORD_DVSN: "00",
        RVSE_CNCL_DVSN_CD: "02",
        ORD_QTY: "0",
        ORD_UNPR: "0",
        QTY_ALL_ORD_YN: "Y"
      },
      mapper: (data, response) => mapOrder(toAccount(target.accountNumber), target.symbol, target.market, data, response)
    });
  }
  const api = FOREIGN_ORDER_MODIFY_API_CODES[`${!kis.virtual}:${target.market}:cancel`];
  if (!api) throw new Error(`Cancel order is not supported for ${target.market}.`);
  return kis.fetch("/uapi/overseas-stock/v1/trading/order-rvsecncl", {
    api,
    method: "POST",
    form: [toAccount(target.accountNumber)],
    body: {
      OVRS_EXCG_CD: MARKET_CODE_MAP[target.market as Exclude<MarketType, "KRX">],
      PDNO: target.symbol,
      ORGN_ODNO: target.number,
      RVSE_CNCL_DVSN_CD: "02",
      ORD_QTY: "0",
      OVRS_ORD_UNPR: "0"
    },
    mapper: (data, response) => mapOrder(toAccount(target.accountNumber), target.symbol, target.market, data, response)
  });
}

export function pendingOrders(kis: PyKis, account: string | KisAccountNumber, market?: MarketType | null): Promise<KisPendingOrders> {
  const accountNumber = toAccount(account);
  if (!market || market === "KRX") {
    return kis.fetch("/uapi/domestic-stock/v1/trading/inquire-psbl-rvsecncl", {
      api: "TTTC8036R",
      form: [accountNumber, KisPage.first(100)],
      params: { INQR_DVSN_1: "1", INQR_DVSN_2: "0" },
      mapper: (data, response) => mapPendingOrders(accountNumber, "KRX", outputArray(data, "output"), data, response)
    });
  }
  return kis.fetch("/uapi/overseas-stock/v1/trading/inquire-nccs", {
    api: kis.virtual ? "VTTS3018R" : "TTTS3018R",
    form: [accountNumber, KisPage.first(200)],
    params: { OVRS_EXCG_CD: MARKET_CODE_MAP[market as Exclude<MarketType, "KRX">], SORT_SQN: kis.virtual ? "DS" : "" },
    mapper: (data, response) => mapPendingOrders(accountNumber, market, outputArray(data, "output"), data, response)
  });
}

export async function dailyOrders(
  kis: PyKis,
  account: string | KisAccountNumber,
  options: { start?: Date | string; end?: Date | string; type?: OrderType | null } = {}
): Promise<KisDailyOrders> {
  const accountNumber = toAccount(account);
  const end = normalizeDateInput(options.end);
  const start = normalizeDateInput(options.start, new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000));
  const data = await kis.fetch<AnyRecord>("/uapi/domestic-stock/v1/trading/inquire-daily-ccld", {
    api: kis.virtual ? "VTTC8001R" : "TTTC8001R",
    form: [accountNumber, KisPage.first(100)],
    params: {
      INQR_STRT_DT: formatDate(start),
      INQR_END_DT: formatDate(end),
      SLL_BUY_DVSN_CD: options.type == null ? "00" : options.type === "buy" ? "02" : "01",
      INQR_DVSN: "00",
      PDNO: "",
      CCLD_DVSN: "00",
      ORD_GNO_BRNO: "",
      ODNO: "",
      INQR_DVSN_3: "00",
      INQR_DVSN_1: "",
      CTX_AREA_FK100: "",
      CTX_AREA_NK100: ""
    }
  });
  return {
    accountNumber: accountNumber.toString(),
    orders: outputArray(data, "output1").map((row) => mapDailyOrder(accountNumber, "KRX", row)),
    raw: data,
    meta: apiMeta(data)
  };
}

export async function orderProfits(
  kis: PyKis,
  account: string | KisAccountNumber,
  options: { start?: Date | string; end?: Date | string; country?: CountryType | null } = {}
): Promise<KisOrderProfits> {
  const accountNumber = toAccount(account);
  const end = normalizeDateInput(options.end);
  const start = normalizeDateInput(options.start, new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000));
  const data = await kis.fetch<AnyRecord>("/uapi/domestic-stock/v1/trading/inquire-period-trade-profit", {
    api: "TTTC8715R",
    form: [accountNumber, KisPage.first(100)],
    params: {
      SORT_DVSN: "00",
      PDNO: "",
      INQR_STRT_DT: formatDate(start),
      INQR_END_DT: formatDate(end),
      CBLC_DVSN: "00",
      CTX_AREA_FK100: "",
      CTX_AREA_NK100: ""
    }
  });
  const orders = outputArray(data, "output1").map((row) => mapOrderProfit(accountNumber, "KRX", row));
  return {
    accountNumber: accountNumber.toString(),
    orders,
    fees: asDecimal(output<AnyRecord[]>(data, "output2")?.[0]?.tot_fee),
    profit: mergeDecimal(orders.map((item) => item.profit)),
    raw: data,
    meta: apiMeta(data)
  };
}

function mapStockInfo(data: AnyRecord, response: Response): KisStockInfo {
  const o = output(data);
  const market = MARKET_CODE_TO_TYPE[String(o.prdt_type_cd)] ?? "KRX";
  return {
    symbol: String(o.shtn_pdno ?? ""),
    stdCode: String(o.std_pdno ?? ""),
    nameKor: String(o.prdt_abrv_name ?? ""),
    fullNameKor: String(o.prdt_name120 ?? ""),
    nameEng: String(o.prdt_eng_abrv_name ?? ""),
    fullNameEng: String(o.prdt_eng_name120 ?? ""),
    name: String(o.prdt_abrv_name ?? ""),
    market,
    marketName: MARKET_CODE_NAME[String(o.prdt_type_cd)] ?? String(o.prdt_type_cd ?? ""),
    foreign: market !== "KRX",
    domestic: market === "KRX",
    raw: data,
    meta: apiMeta(data, response)
  };
}

function mapDomesticQuote(symbol: string, data: AnyRecord, response: Response): KisQuote {
  const o = output(data);
  if (String(o.stck_prpr ?? "0") === "0") throw new KisNotFoundError(data, response, "Quote was not found.");
  const price = asDecimal(o.stck_prpr);
  const change = asDecimal(o.prdy_vrss);
  const prevPrice = price.minus(change);
  return withQuoteCommon({
    symbol: String(o.stck_shrn_iscd ?? symbol),
    market: "KRX",
    sectorName: o.bstp_kor_isnm == null ? null : String(o.bstp_kor_isnm),
    price,
    close: price,
    volume: asInt(o.acml_vol),
    amount: asDecimal(o.acml_tr_pbmn),
    marketCap: asDecimal(o.hts_avls),
    sign: signFromCode(o.prdy_vrss_sign),
    risk: STOCK_RISK_TYPE_MAP[String(o.mrkt_warn_cls_code)] ?? "none",
    halt: asBool(o.temp_stop_yn),
    overbought: asBool(o.short_over_yn),
    prevPrice,
    prevVolume: safeDivide(asDecimal(o.acml_vol), new Decimal(1).plus(safeDivide(asDecimal(o.prdy_vrss_vol_rate), 100))),
    change,
    indicator: mapDomesticIndicator(o),
    open: asDecimal(o.stck_oprc),
    high: asDecimal(o.stck_hgpr),
    low: asDecimal(o.stck_lwpr),
    highLimit: asDecimal(o.stck_mxpr),
    lowLimit: asDecimal(o.stck_llam),
    unit: new Decimal(1),
    tick: asDecimal(o.aspr_unit),
    decimalPlaces: 0,
    exchangeRate: new Decimal(1),
    raw: data,
    meta: apiMeta(data, response)
  });
}

function mapForeignQuote(symbol: string, market: MarketType, data: AnyRecord, response: Response): KisQuote {
  const o = output(data);
  if (!o.last) throw new KisNotFoundError(data, response, "Quote was not found.");
  const price = asDecimal(o.last);
  const prevPrice = asDecimal(o.base);
  return withQuoteCommon({
    symbol,
    market,
    sectorName: o.e_icod == null ? null : String(o.e_icod),
    price,
    close: price,
    volume: asInt(o.tvol),
    amount: asDecimal(o.tamt),
    marketCap: asDecimal(o.tomv),
    sign: signFromCode(o.t_xsgn),
    risk: "none",
    halt: String(o.e_ordyn ?? "") !== "매매 가능",
    overbought: false,
    prevPrice,
    prevVolume: asDecimal(o.pvol),
    change: price.minus(prevPrice),
    indicator: mapForeignIndicator(o),
    open: asDecimal(o.open),
    high: asDecimal(o.high),
    low: asDecimal(o.low),
    highLimit: asDecimal(o.uplp),
    lowLimit: asDecimal(o.dnlp),
    unit: asDecimal(o.vnit, 1),
    tick: asDecimal(o.e_hogau),
    decimalPlaces: asInt(o.zdiv),
    exchangeRate: asDecimal(o.t_rate, 1),
    raw: data,
    meta: apiMeta(data, response)
  });
}

function withQuoteCommon(quote: Omit<KisQuote, "rate">): KisQuote {
  return { ...quote, rate: safeDivide(quote.change, quote.prevPrice).mul(100) };
}

function mapDomesticIndicator(o: AnyRecord): KisIndicator {
  return {
    eps: asDecimal(o.eps),
    bps: asDecimal(o.bps),
    per: asDecimal(o.per),
    pbr: asDecimal(o.pbr),
    week52High: asDecimal(o.w52_hgpr),
    week52Low: asDecimal(o.w52_lwpr),
    week52HighDate: o.w52_hgpr_date ? toKstDate(String(o.w52_hgpr_date), "date") : undefined,
    week52LowDate: o.w52_lwpr_date ? toKstDate(String(o.w52_lwpr_date), "date") : undefined
  };
}

function mapForeignIndicator(o: AnyRecord): KisIndicator {
  return {
    eps: asDecimal(o.epsx),
    bps: asDecimal(o.bpsx),
    per: asDecimal(o.perx),
    pbr: asDecimal(o.pbrx),
    week52High: asDecimal(o.h52p),
    week52Low: asDecimal(o.l52p),
    week52HighDate: o.h52d ? toKstDate(String(o.h52d), "date") : undefined,
    week52LowDate: o.l52d ? toKstDate(String(o.l52d), "date") : undefined
  };
}

function mapDomesticOrderbook(symbol: string, data: AnyRecord, response: Response): KisOrderbook {
  const o = output(data, "output1");
  const asks = range(1, 10).map((i) => ({ price: asDecimal(o[`askp${i}`]), volume: asInt(o[`askp_rsqn${i}`]) }));
  const bids = range(1, 10).map((i) => ({ price: asDecimal(o[`bidp${i}`]), volume: asInt(o[`bidp_rsqn${i}`]) }));
  return withOrderbookCommon({ symbol, market: "KRX", decimalPlaces: 0, asks, bids, raw: data, meta: apiMeta(data, response) });
}

function mapForeignOrderbook(symbol: string, market: MarketType, data: AnyRecord, response: Response): KisOrderbook {
  const o1 = output(data, "output1");
  const o2 = output(data, "output2");
  if (!o1.rsym) throw new KisNotFoundError(data, response, "Orderbook was not found.");
  const count = market === "NASDAQ" || market === "NYSE" ? 10 : 1;
  const asks = range(1, count).map((i) => ({ price: asDecimal(o2[`pask${i}`]), volume: asInt(o2[`vask${i}`]) }));
  const bids = range(1, count).map((i) => ({ price: asDecimal(o2[`pbid${i}`]), volume: asInt(o2[`vbid${i}`]) }));
  return withOrderbookCommon({ symbol, market, decimalPlaces: asInt(o1.zdiv), asks, bids, raw: data, meta: apiMeta(data, response) });
}

function withOrderbookCommon(orderbook: Omit<KisOrderbook, "count" | "askPrice" | "bidPrice">): KisOrderbook {
  return {
    ...orderbook,
    count: Math.min(orderbook.asks.length, orderbook.bids.length),
    askPrice: orderbook.asks[0],
    bidPrice: orderbook.bids[0]
  };
}

function mapDomesticDailyChart(symbol: string, data: AnyRecord, response: Response): KisChart {
  const bars = outputArray(data, "output2").map((row) => {
    const close = asDecimal(row.stck_clpr);
    const change = asDecimal(row.prdy_vrss);
    return chartBar(row, toKstDate(String(row.stck_bsop_date), "date"), close, change, {
      open: row.stck_oprc,
      high: row.stck_hgpr,
      low: row.stck_lwpr,
      volume: row.acml_vol,
      amount: row.acml_tr_pbmn,
      sign: row.prdy_vrss_sign
    });
  });
  bars.reverse();
  return { symbol, market: "KRX", timezone: MARKET_TIMEZONE_MAP.KRX, bars, raw: data, meta: apiMeta(data, response) };
}

function mapForeignDailyChart(symbol: string, market: MarketType, data: AnyRecord, response: Response): KisChart {
  const bars = outputArray(data, "output2").map((row) => {
    const close = asDecimal(row.clos);
    const change = asDecimal(row.diff);
    return chartBar(row, toKstDate(String(row.xymd), "date"), close, change, {
      open: row.open,
      high: row.high,
      low: row.low,
      volume: row.tvol,
      amount: row.tamt,
      sign: row.sign
    });
  });
  bars.reverse();
  return { symbol, market, timezone: MARKET_TIMEZONE_MAP[market], bars, raw: data, meta: apiMeta(data, response) };
}

function mapDomesticDayChart(symbol: string, data: AnyRecord, response: Response, period: number): KisChart {
  const prevPrice = asDecimal(output(data, "output1").stck_prdy_clpr);
  const bars = outputArray(data, "output2")
    .map((row) => {
      const time = toKstDate(String(row.stck_bsop_date) + String(row.stck_cntg_hour));
      const close = asDecimal(row.stck_prpr);
      return chartBar(row, time, close, close.minus(prevPrice), {
        open: row.stck_oprc,
        high: row.stck_hgpr,
        low: row.stck_lwpr,
        volume: row.cntg_vol,
        amount: row.acml_tr_pbmn
      });
    })
    .filter((_, i) => i % period === 0);
  bars.reverse();
  return { symbol, market: "KRX", timezone: MARKET_TIMEZONE_MAP.KRX, bars, raw: data, meta: apiMeta(data, response) };
}

function mapForeignDayChart(symbol: string, market: MarketType, prevPrice: Decimal, data: AnyRecord, response: Response, period: number): KisChart {
  const bars = outputArray(data, "output2")
    .map((row) => {
      const time = toKstDate(String(row.kymd) + String(row.khms));
      const close = asDecimal(row.last);
      return chartBar(row, time, close, close.minus(prevPrice), {
        open: row.open,
        high: row.high,
        low: row.low,
        volume: row.evol,
        amount: row.eamt
      });
    })
    .filter((_, i) => i % period === 0);
  bars.reverse();
  return { symbol, market, timezone: MARKET_TIMEZONE_MAP[market], bars, raw: data, meta: apiMeta(data, response) };
}

function chartBar(row: AnyRecord, time: Date, close: Decimal, change: Decimal, values: AnyRecord): KisChartBar {
  const prevPrice = close.minus(change);
  return {
    time,
    timeKst: time,
    open: asDecimal(values.open),
    close,
    high: asDecimal(values.high),
    low: asDecimal(values.low),
    volume: asInt(values.volume),
    amount: asDecimal(values.amount),
    change,
    sign: values.sign == null ? (change.gt(0) ? "rise" : change.lt(0) ? "decline" : "steady") : signFromCode(values.sign),
    price: close,
    prevPrice,
    rate: safeDivide(change, prevPrice).mul(100),
    raw: row
  };
}

function mapDomesticBalance(account: KisAccountNumber, data: AnyRecord, response: Response): KisBalance {
  const stocks = outputArray(data, "output1").map((row) => mapDomesticBalanceStock(account, row));
  const depositRow = outputArray(data, "output2")[0] ?? {};
  const deposit: KisDeposit = {
    accountNumber: account.toString(),
    currency: "KRW",
    amount: asDecimal(depositRow.dnca_tot_amt),
    withdrawableAmount: asDecimal(depositRow.dnca_tot_amt),
    exchangeRate: new Decimal(1),
    raw: depositRow
  };
  return balanceCommon(account, "KR", stocks, { KRW: deposit }, data, response);
}

function mapForeignPresentBalance(account: KisAccountNumber, country: CountryType | null, data: AnyRecord, response: Response): KisBalance {
  const deposits: Partial<Record<CurrencyType, KisDeposit>> = {};
  for (const row of outputArray(data, "output2")) {
    const currency = String(row.crcy_cd || "USD") as CurrencyType;
    deposits[currency] = {
      accountNumber: account.toString(),
      currency,
      amount: asDecimal(row.frcr_dncl_amt_2),
      withdrawableAmount: asDecimal(row.frcr_drwg_psbl_amt_1),
      exchangeRate: asDecimal(row.frst_bltn_exrt, 1),
      raw: row
    };
  }
  const stocks = outputArray(data, "output1").map((row) => mapForeignPresentBalanceStock(account, row, deposits));
  return balanceCommon(account, country, stocks, deposits, data, response);
}

function balanceCommon(
  account: KisAccountNumber,
  country: CountryType | null,
  stocks: KisBalanceStock[],
  deposits: Partial<Record<CurrencyType, KisDeposit>>,
  data: AnyRecord,
  response?: Response
): KisBalance {
  const purchaseAmount = mergeDecimal(stocks.map((stock) => stock.purchaseAmountKrw));
  const currentAmount = mergeDecimal(stocks.map((stock) => stock.currentAmount));
  const profit = currentAmount.minus(purchaseAmount);
  return {
    accountNumber: account.toString(),
    country,
    stocks,
    deposits,
    purchaseAmount,
    currentAmount,
    profit,
    profitRate: safeDivide(profit, purchaseAmount).mul(100),
    amount: currentAmount,
    total: currentAmount.plus(mergeDecimal(Object.values(deposits).map((deposit) => deposit?.amount ?? 0))),
    raw: data,
    meta: apiMeta(data, response)
  };
}

function mergeBalances(account: KisAccountNumber, balances: KisBalance[]): KisBalance {
  const stocks = balances.flatMap((item) => item.stocks);
  const deposits = Object.assign({}, ...balances.map((item) => item.deposits)) as Partial<Record<CurrencyType, KisDeposit>>;
  return balanceCommon(account, null, stocks, deposits, { balances });
}

function mapDomesticBalanceStock(account: KisAccountNumber, row: AnyRecord): KisBalanceStock {
  const currentPrice = asDecimal(row.prpr);
  const quantity = asDecimal(row.hldg_qty);
  const purchaseAmount = asDecimal(row.pchs_amt);
  const currentAmount = asDecimal(row.evlu_amt, currentPrice.mul(quantity));
  const profit = asDecimal(row.evlu_pfls_amt, currentAmount.minus(purchaseAmount));
  return {
    accountNumber: account.toString(),
    symbol: String(row.pdno ?? ""),
    market: "KRX",
    name: String(row.prdt_name ?? ""),
    currentPrice,
    quantity,
    qty: quantity,
    orderable: asDecimal(row.ord_psbl_qty),
    purchaseAmount,
    purchaseAmountKrw: purchaseAmount,
    currentAmount,
    amount: currentAmount,
    profit,
    profitRate: asDecimal(row.evlu_pfls_rt, safeDivide(profit, purchaseAmount).mul(100)),
    exchangeRate: new Decimal(1),
    currency: "KRW",
    raw: row
  };
}

function mapForeignPresentBalanceStock(
  account: KisAccountNumber,
  row: AnyRecord,
  deposits: Partial<Record<CurrencyType, KisDeposit>>
): KisBalanceStock {
  const market = inferMarket(row);
  const currency = (market ? MARKET_COUNTRY_MAP[market] === "US" ? "USD" : undefined : undefined) ?? (String(row.tr_mket_name ?? "").includes("홍콩") ? "HKD" : "USD");
  const exchangeRate = asDecimal(row.bass_exrt, deposits[currency as CurrencyType]?.exchangeRate ?? 1);
  const currentPrice = asDecimal(row.ovrs_now_pric1);
  const quantity = asDecimal(row.ccld_qty_smtl1);
  const purchaseAmount = asDecimal(row.frcr_pchs_amt);
  const purchaseAmountKrw = asDecimal(row.pchs_rmnd_wcrc_amt, purchaseAmount.mul(exchangeRate));
  const currentAmount = currentPrice.mul(quantity).mul(exchangeRate);
  const profit = currentAmount.minus(purchaseAmountKrw);
  return {
    accountNumber: account.toString(),
    symbol: String(row.pdno ?? ""),
    market: market ?? "NASDAQ",
    name: String(row.prdt_name ?? ""),
    currentPrice,
    quantity,
    qty: quantity,
    orderable: asDecimal(row.ord_psbl_qty1),
    purchaseAmount,
    purchaseAmountKrw,
    currentAmount,
    amount: currentAmount,
    profit,
    profitRate: safeDivide(profit, purchaseAmountKrw).mul(100),
    exchangeRate,
    currency: currency as CurrencyType,
    raw: row
  };
}

function mapDomesticOrderableAmount(
  account: KisAccountNumber,
  symbol: string,
  price: Decimal | null,
  options: { condition?: OrderCondition | null; execution?: OrderExecution | null },
  label: string,
  data: AnyRecord,
  response: Response
): KisOrderableAmount {
  const o = output(data);
  const unitPrice = asDecimal(o.psbl_qty_calc_unpr);
  const amount = asDecimal(o.ord_psbl_cash);
  const quantity = asDecimal(o.max_buy_qty);
  const foreignAmount = amount.plus(asDecimal(o.ord_psbl_frcr_amt_wcrc));
  return {
    accountNumber: account.toString(),
    symbol,
    market: "KRX",
    price,
    condition: options.condition ?? null,
    execution: options.execution ?? null,
    unitPrice,
    amount,
    quantity,
    qty: quantity,
    foreignAmount,
    foreignQuantity: quantity,
    foreignQty: quantity,
    exchangeRate: new Decimal(1),
    conditionKor: label,
    raw: data,
    meta: apiMeta(data, response)
  };
}

function mapForeignOrderableAmount(
  account: KisAccountNumber,
  market: MarketType,
  symbol: string,
  price: Decimal | null,
  unitPrice: Decimal,
  options: { condition?: OrderCondition | null; execution?: OrderExecution | null },
  label: string,
  data: AnyRecord,
  response: Response
): KisOrderableAmount {
  const o = output(data);
  const amount = asDecimal(o.ovrs_ord_psbl_amt);
  const quantity = asDecimal(o.max_ord_psbl_qty);
  const foreignAmount = asDecimal(o.frcr_ord_psbl_amt1, amount);
  const foreignQuantity = asDecimal(o.ovrs_max_ord_psbl_qty, quantity);
  return {
    accountNumber: account.toString(),
    symbol,
    market,
    price,
    condition: options.condition ?? null,
    execution: options.execution ?? null,
    unitPrice,
    amount,
    quantity,
    qty: quantity,
    foreignAmount,
    foreignQuantity,
    foreignQty: foreignQuantity,
    exchangeRate: asDecimal(o.exrt, 1),
    conditionKor: label,
    raw: data,
    meta: apiMeta(data, response)
  };
}

function mapOrder(account: KisAccountNumber, symbol: string, market: MarketType, data: AnyRecord, response: Response): KisOrder {
  if (data.msg_cd === "APBK0919" || data.msg_cd === "APBK1664") throw new KisMarketNotOpenedError(data, response);
  const o = output(data);
  const time = o.ORD_TMD ? toKstDate(formatDate(new Date()) + String(o.ORD_TMD)) : new Date();
  return {
    accountNumber: account.toString(),
    symbol,
    market,
    branch: String(o.KRX_FWDG_ORD_ORGNO ?? ""),
    number: String(o.ODNO ?? ""),
    time,
    timeKst: time,
    raw: data,
    meta: apiMeta(data, response)
  };
}

function mapPendingOrders(
  account: KisAccountNumber,
  market: MarketType,
  rows: AnyRecord[],
  data: AnyRecord,
  response: Response
): KisPendingOrders {
  return {
    accountNumber: account.toString(),
    orders: rows.map((row) => mapPendingOrder(account, market, row)),
    raw: data,
    meta: apiMeta(data, response)
  };
}

function mapPendingOrder(account: KisAccountNumber, market: MarketType, row: AnyRecord): KisPendingOrder {
  const time = row.ord_tmd ? toKstDate(formatDate(new Date()) + String(row.ord_tmd)) : new Date();
  const quantity = asDecimal(row.ord_qty ?? row.ft_ord_qty);
  const executedQuantity = asDecimal(row.tot_ccld_qty ?? row.ft_ccld_qty);
  const pendingQuantity = asDecimal(row.psbl_qty ?? row.nccs_qty);
  return {
    accountNumber: account.toString(),
    symbol: String(row.pdno ?? ""),
    market: market === "KRX" ? "KRX" : REVERSE_MARKET_CODE_MAP[String(row.ovrs_excg_cd)] ?? market,
    branch: String(row.ord_gno_brno ?? ""),
    number: String(row.odno ?? ""),
    time,
    timeKst: time,
    type: String(row.sll_buy_dvsn_cd) === "02" ? "buy" : "sell",
    price: asDecimal(row.ord_unpr ?? row.ft_ccld_unpr3),
    unitPrice: asOptionalDecimal(row.ord_unpr ?? row.ft_ord_unpr3),
    quantity,
    qty: quantity,
    executedQuantity,
    pendingQuantity,
    orderableQuantity: pendingQuantity,
    rejected: Boolean(row.rjct_rson || (row.rjct_qty && row.rjct_qty !== "0")),
    rejectedReason: row.rjct_rson_name ? String(row.rjct_rson_name) : null,
    raw: row
  };
}

function mapDailyOrder(account: KisAccountNumber, market: MarketType, row: AnyRecord): KisDailyOrder {
  const pending = mapPendingOrder(account, market, row);
  return { ...pending, name: String(row.prdt_name ?? "") };
}

function mapOrderProfit(account: KisAccountNumber, market: MarketType, row: AnyRecord): KisOrderProfit {
  const quantity = asDecimal(row.sll_qty);
  const buyPrice = asDecimal(row.pchs_unpr);
  const sellPrice = asDecimal(row.sll_pric);
  const sellAmount = asDecimal(row.sll_amt);
  const buyAmount = buyPrice.mul(quantity);
  const profit = sellAmount.minus(buyAmount);
  return {
    accountNumber: account.toString(),
    symbol: String(row.pdno ?? ""),
    market,
    name: String(row.prdt_name ?? ""),
    time: row.trad_dt ? toKstDate(String(row.trad_dt), "date") : new Date(),
    buyPrice,
    sellPrice,
    buyAmount,
    sellAmount,
    quantity,
    profit,
    profitRate: safeDivide(profit, buyAmount).mul(100),
    exchangeRate: new Decimal(1),
    raw: row
  };
}

function inferMarket(row: AnyRecord): MarketType | undefined {
  const code = row.ovrs_excg_cd ?? row.tr_mket_cd ?? row.tr_mket_name;
  if (code && REVERSE_MARKET_CODE_MAP[String(code)]) return REVERSE_MARKET_CODE_MAP[String(code)];
  const text = String(code ?? "");
  if (text.includes("나스닥")) return "NASDAQ";
  if (text.includes("뉴욕")) return "NYSE";
  if (text.includes("아멕스")) return "AMEX";
  if (text.includes("홍콩")) return "HKEX";
  if (text.includes("일본")) return "TYO";
  return undefined;
}

function toAccount(account: string | KisAccountNumber): KisAccountNumber {
  return typeof account === "string" ? new KisAccountNumber(account) : account;
}

function isMarketType(value: unknown): value is MarketType {
  return (
    value === "KRX" ||
    value === "NASDAQ" ||
    value === "NYSE" ||
    value === "AMEX" ||
    value === "TYO" ||
    value === "HKEX" ||
    value === "HNX" ||
    value === "HSX" ||
    value === "SSE" ||
    value === "SZSE"
  );
}

function range(start: number, endInclusive: number): number[] {
  return Array.from({ length: endInclusive - start + 1 }, (_, index) => start + index);
}
