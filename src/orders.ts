import { Decimal } from "decimal.js";
import type { MarketType, OrderCondition, OrderExecution, OrderPriceInput, OrderQuantityInput, OrderType } from "./types.js";

export type PriceSetting = "lower" | "upper" | null;

export function ensurePrice(price: OrderPriceInput, digit = 4): Decimal {
  return new Decimal(price).toDecimalPlaces(digit, Decimal.ROUND_DOWN);
}

export function ensureQuantity(quantity: OrderQuantityInput, digit = 0): Decimal {
  return new Decimal(quantity).toDecimalPlaces(digit, Decimal.ROUND_DOWN);
}

const ORDER_CONDITION_MAP = new Map<string, [string, PriceSetting, string]>();

function key(
  real: boolean | null,
  market: MarketType | null,
  order: OrderType,
  priced: boolean,
  condition: OrderCondition | null,
  execution: OrderExecution | null
): string {
  return JSON.stringify([real, market, order, priced, condition, execution]);
}

function add(
  real: boolean | null,
  market: MarketType | null,
  order: OrderType,
  priced: boolean,
  condition: OrderCondition | null,
  execution: OrderExecution | null,
  code: string,
  priceSetting: PriceSetting,
  label: string
): void {
  ORDER_CONDITION_MAP.set(key(real, market, order, priced, condition, execution), [code, priceSetting, label]);
}

for (const order of ["buy", "sell"] as const) {
  add(null, null, order, true, null, null, "00", null, "지정가");
  add(null, null, order, false, null, null, "00", order === "buy" ? "upper" : "lower", "시장가");
  add(null, "KRX", order, true, null, null, "00", null, "지정가");
  add(null, "KRX", order, false, null, null, "01", null, "시장가");
  add(null, "KRX", order, true, "condition", null, "02", null, "조건부지정가");
  add(null, "KRX", order, true, "best", null, "03", null, "최유리지정가");
  add(null, "KRX", order, true, "priority", null, "04", null, "최우선지정가");
  add(true, "KRX", order, true, "extended", null, "07", null, "시간외단일가");
  add(true, "KRX", order, false, "before", null, "05", null, "장전시간외");
  add(true, "KRX", order, false, "after", null, "06", null, "장후시간외");
  add(true, "KRX", order, true, null, "IOC", "11", null, "IOC지정가");
  add(true, "KRX", order, true, null, "FOK", "12", null, "FOK지정가");
  add(true, "KRX", order, false, null, "IOC", "13", null, "IOC시장가");
  add(true, "KRX", order, false, null, "FOK", "14", null, "FOK시장가");
  add(true, "KRX", order, true, "best", "IOC", "15", null, "IOC최유리");
  add(true, "KRX", order, true, "best", "FOK", "16", null, "FOK최유리");
}

for (const market of ["NASDAQ", "NYSE", "AMEX"] as const) {
  add(true, market, "buy", true, "LOO", null, "32", null, "장개시지정가");
  add(true, market, "buy", true, "LOC", null, "34", null, "장마감지정가");
  add(true, market, "buy", false, "MOO", null, "32", "upper", "장개시시장가");
  add(true, market, "buy", false, "MOC", null, "34", "upper", "장마감시장가");
  add(true, market, "sell", true, "LOO", null, "32", null, "장개시지정가");
  add(true, market, "sell", true, "LOC", null, "34", null, "장마감지정가");
  add(true, market, "sell", false, "MOO", null, "31", null, "장개시시장가");
  add(true, market, "sell", false, "MOC", null, "33", null, "장마감시장가");
}

export function orderCondition(args: {
  virtual: boolean;
  market: MarketType;
  order: OrderType;
  price?: Decimal | null;
  condition?: OrderCondition | null;
  execution?: OrderExecution | null;
}): [string, PriceSetting, string] {
  const price = args.price ?? null;
  if (price && price.lte(0)) throw new Error("Price must be greater than 0.");

  const candidates: Array<[boolean | null, MarketType | null, boolean]> = [
    [!args.virtual, args.market, price !== null],
    [null, args.market, price !== null],
    [null, null, price !== null]
  ];

  if (price !== null) {
    candidates.push([!args.virtual, args.market, false], [null, args.market, false], [null, null, false]);
  }

  for (const [real, market, priced] of candidates) {
    const item = ORDER_CONDITION_MAP.get(
      key(real, market, args.order, priced, args.condition ?? null, args.execution ?? null)
    );
    if (item) return item;
  }

  throw new Error(
    `Invalid order condition: market=${args.market}, order=${args.order}, price=${price}, condition=${args.condition}, execution=${args.execution}`
  );
}

export const DOMESTIC_ORDER_API_CODES: Record<`${boolean}:${OrderType}`, string> = {
  "true:buy": "TTTC0802U",
  "true:sell": "TTTC0801U",
  "false:buy": "VTTC0802U",
  "false:sell": "VTTC0801U"
};

export const FOREIGN_ORDER_API_CODES: Record<string, string> = {
  "true:NASDAQ:buy": "TTTT1002U",
  "true:NYSE:buy": "TTTT1002U",
  "true:AMEX:buy": "TTTT1002U",
  "true:NASDAQ:sell": "TTTT1006U",
  "true:NYSE:sell": "TTTT1006U",
  "true:AMEX:sell": "TTTT1006U",
  "true:TYO:buy": "TTTS0308U",
  "true:TYO:sell": "TTTS0307U",
  "true:SSE:buy": "TTTS0202U",
  "true:SSE:sell": "TTTS1005U",
  "true:HKEX:buy": "TTTS1002U",
  "true:HKEX:sell": "TTTS1001U",
  "true:SZSE:buy": "TTTS0305U",
  "true:SZSE:sell": "TTTS0304U",
  "true:HNX:buy": "TTTS0311U",
  "true:HSX:buy": "TTTS0311U",
  "true:HNX:sell": "TTTS0310U",
  "true:HSX:sell": "TTTS0310U",
  "false:NASDAQ:buy": "VTTT1002U",
  "false:NYSE:buy": "VTTT1002U",
  "false:AMEX:buy": "VTTT1002U",
  "false:NASDAQ:sell": "VTTT1001U",
  "false:NYSE:sell": "VTTT1001U",
  "false:AMEX:sell": "VTTT1001U",
  "false:TYO:buy": "VTTS0308U",
  "false:TYO:sell": "VTTS0307U",
  "false:SSE:buy": "VTTS0202U",
  "false:SSE:sell": "VTTS1005U",
  "false:HKEX:buy": "VTTS1002U",
  "false:HKEX:sell": "VTTS1001U",
  "false:SZSE:buy": "VTTS0305U",
  "false:SZSE:sell": "VTTS0304U",
  "false:HNX:buy": "VTTS0311U",
  "false:HSX:buy": "VTTS0311U",
  "false:HNX:sell": "VTTS0310U",
  "false:HSX:sell": "VTTS0310U"
};

export const FOREIGN_ORDER_MODIFY_API_CODES: Record<string, string> = {
  "true:NASDAQ:modify": "TTTT1004U",
  "true:NYSE:modify": "TTTT1004U",
  "true:AMEX:modify": "TTTT1004U",
  "true:NASDAQ:cancel": "TTTT1003U",
  "true:NYSE:cancel": "TTTT1003U",
  "true:AMEX:cancel": "TTTT1003U",
  "false:NASDAQ:modify": "VTTT1004U",
  "false:NYSE:modify": "VTTT1004U",
  "false:AMEX:modify": "VTTT1004U",
  "false:NASDAQ:cancel": "VTTT1003U",
  "false:NYSE:cancel": "VTTT1003U",
  "false:AMEX:cancel": "VTTT1003U"
};
