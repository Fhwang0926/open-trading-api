import { Decimal } from "decimal.js";

export type DomainType = "real" | "virtual";

export type MarketType =
  | "KRX"
  | "NASDAQ"
  | "NYSE"
  | "AMEX"
  | "TYO"
  | "HKEX"
  | "HNX"
  | "HSX"
  | "SSE"
  | "SZSE";

export type CountryType = "KR" | "US" | "HK" | "JP" | "VN" | "CN";
export type MarketInfoType = MarketType | CountryType | null | undefined;
export type CurrencyType = "KRW" | "USD" | "JPY" | "HKD" | "VND" | "CNY";

export type StockSignType = "upper" | "rise" | "steady" | "decline" | "lower";
export type StockRiskType = "none" | "caution" | "warning" | "risk";
export type OrderType = "buy" | "sell";
export type OrderExecution = "IOC" | "FOK";
export type DomesticOrderCondition = "condition" | "best" | "priority" | "extended" | "before" | "after";
export type ForeignOrderCondition = "LOO" | "LOC" | "MOO" | "MOC" | "extended";
export type OrderCondition = DomesticOrderCondition | ForeignOrderCondition;
export type ChartPeriod = "day" | "week" | "month" | "year";
export type KisRankingMarketCode = "J" | "Q" | "K";
export type KisRankingType = "marketCap" | "volume" | "fluctuation";
export type OrderPriceInput = Decimal.Value;
export type OrderQuantityInput = Decimal.Value;

export const REAL_DOMAIN = "https://openapi.koreainvestment.com:9443";
export const VIRTUAL_DOMAIN = "https://openapivts.koreainvestment.com:29443";
export const WEBSOCKET_REAL_DOMAIN = "ws://ops.koreainvestment.com:21000";
export const WEBSOCKET_VIRTUAL_DOMAIN = "ws://ops.koreainvestment.com:31000";
export const WEBSOCKET_MAX_SUBSCRIPTIONS = 40;
export const REAL_API_REQUEST_PER_SECOND = 19;
export const VIRTUAL_API_REQUEST_PER_SECOND = 2;
export const APPKEY_LENGTH = 36;
export const SECRETKEY_LENGTH = 180;
export const DEFAULT_CUST_TYPE = "P";
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36";

export const MARKET_CODE_MAP: Record<Exclude<MarketType, "KRX">, string> = {
  NASDAQ: "NASD",
  NYSE: "NYSE",
  AMEX: "AMEX",
  TYO: "TKSE",
  HKEX: "SEHK",
  HNX: "HASE",
  HSX: "VNSE",
  SSE: "SHAA",
  SZSE: "SZAA"
};

export const MARKET_SHORT_TYPE_MAP: Record<Exclude<MarketType, "KRX">, string> = {
  NASDAQ: "NAS",
  NYSE: "NYS",
  AMEX: "AMS",
  TYO: "TSE",
  HKEX: "HKS",
  HNX: "HNX",
  HSX: "HSX",
  SSE: "SHS",
  SZSE: "SZS"
};

export const DAYTIME_MARKET_SHORT_TYPE_MAP: Partial<Record<MarketType, string>> = {
  NASDAQ: "BAQ",
  NYSE: "BAY",
  AMEX: "BAA"
};

export const REVERSE_MARKET_CODE_MAP: Record<string, MarketType> = Object.fromEntries(
  Object.entries(MARKET_CODE_MAP).map(([key, value]) => [value, key])
) as Record<string, MarketType>;

export const REVERSE_MARKET_SHORT_TYPE_MAP: Record<string, MarketType> = Object.fromEntries(
  Object.entries(MARKET_SHORT_TYPE_MAP).map(([key, value]) => [value, key])
) as Record<string, MarketType>;

export const MARKET_CURRENCY_MAP: Record<MarketType, CurrencyType> = {
  KRX: "KRW",
  NASDAQ: "USD",
  NYSE: "USD",
  AMEX: "USD",
  TYO: "JPY",
  HKEX: "HKD",
  HNX: "VND",
  HSX: "VND",
  SSE: "CNY",
  SZSE: "CNY"
};

export const MARKET_COUNTRY_MAP: Record<MarketType, CountryType> = {
  KRX: "KR",
  NASDAQ: "US",
  NYSE: "US",
  AMEX: "US",
  HKEX: "HK",
  TYO: "JP",
  HNX: "VN",
  HSX: "VN",
  SSE: "CN",
  SZSE: "CN"
};

export const MARKET_TIMEZONE_MAP: Record<MarketType, string> = {
  KRX: "Asia/Seoul",
  NASDAQ: "America/New_York",
  NYSE: "America/New_York",
  AMEX: "America/New_York",
  TYO: "Asia/Tokyo",
  HKEX: "Asia/Hong_Kong",
  HNX: "Asia/Ho_Chi_Minh",
  HSX: "Asia/Ho_Chi_Minh",
  SSE: "Asia/Shanghai",
  SZSE: "Asia/Shanghai"
};

export const STOCK_SIGN_TYPE_MAP: Record<string, StockSignType> = {
  "0": "steady",
  "1": "upper",
  "2": "rise",
  "3": "steady",
  "4": "lower",
  "5": "decline"
};

export const STOCK_RISK_TYPE_MAP: Record<string, StockRiskType> = {
  "00": "none",
  "01": "caution",
  "02": "warning",
  "03": "risk"
};

export interface KisApiMetadata {
  rtCd?: string;
  msgCd?: string;
  message?: string;
  trId?: string | null;
  raw: Record<string, unknown>;
}

export interface RawBacked {
  raw: Record<string, unknown> | string[];
  meta?: KisApiMetadata;
}

export interface KisStockInfo extends RawBacked {
  symbol: string;
  stdCode: string;
  nameKor: string;
  fullNameKor: string;
  nameEng: string;
  fullNameEng: string;
  name: string;
  market: MarketType;
  marketName: string;
  foreign: boolean;
  domestic: boolean;
}

export interface KisIndicator {
  eps: Decimal;
  bps: Decimal;
  per: Decimal;
  pbr: Decimal;
  week52High: Decimal;
  week52Low: Decimal;
  week52HighDate?: Date;
  week52LowDate?: Date;
}

export interface KisQuote extends RawBacked {
  symbol: string;
  market: MarketType;
  name?: string;
  sectorName?: string | null;
  price: Decimal;
  close: Decimal;
  volume: number;
  amount: Decimal;
  marketCap: Decimal;
  sign: StockSignType;
  risk: StockRiskType;
  halt: boolean;
  overbought: boolean;
  prevPrice: Decimal;
  prevVolume: Decimal;
  change: Decimal;
  rate: Decimal;
  indicator?: KisIndicator;
  open: Decimal;
  high: Decimal;
  low: Decimal;
  highLimit: Decimal;
  lowLimit: Decimal;
  unit: Decimal;
  tick: Decimal;
  decimalPlaces: number;
  exchangeRate: Decimal;
}

export interface KisOrderbookItem {
  price: Decimal;
  volume: number;
}

export interface KisOrderbook extends RawBacked {
  symbol: string;
  market: MarketType;
  decimalPlaces: number;
  asks: KisOrderbookItem[];
  bids: KisOrderbookItem[];
  count: number;
  askPrice?: KisOrderbookItem;
  bidPrice?: KisOrderbookItem;
}

export interface KisChartBar {
  time: Date;
  timeKst: Date;
  open: Decimal;
  close: Decimal;
  high: Decimal;
  low: Decimal;
  volume: number;
  amount: Decimal;
  change: Decimal;
  sign: StockSignType;
  price: Decimal;
  prevPrice: Decimal;
  rate: Decimal;
  raw: Record<string, unknown>;
}

export interface KisChart extends RawBacked {
  symbol: string;
  market: MarketType;
  timezone: string;
  bars: KisChartBar[];
}

export interface KisCurrencyChart extends RawBacked {
  symbol: string;
  timezone: string;
  bars: KisChartBar[];
}

export interface KisInvestorTrendItem extends RawBacked {
  date: Date;
  dateKst: Date;
  close: Decimal;
  change: Decimal;
  rate: Decimal;
  foreignNet: number;
  institutionNet: number;
  individualNet: number;
  foreignNetQuantity: number;
  institutionNetQuantity: number;
  individualNetQuantity: number;
}

export interface KisInvestors extends RawBacked {
  symbol: string;
  items: KisInvestorTrendItem[];
  foreignTotal: number;
  institutionTotal: number;
  individualTotal: number;
  foreignTotalQuantity: number;
  institutionTotalQuantity: number;
  individualTotalQuantity: number;
}

export interface KisRankingItem extends RawBacked {
  rank: number;
  symbol: string;
  name: string;
  price: Decimal;
  change: Decimal;
  sign: StockSignType;
  changeSign: StockSignType;
  changeRate: Decimal;
  rate: Decimal;
  volume: number;
  prevVolume: number;
  tradingValue: Decimal;
  listedShares: number;
  volumeRate: Decimal;
  turnoverRate: Decimal;
}

export interface KisRanking extends RawBacked {
  market: KisRankingMarketCode;
  type: KisRankingType;
  rankingType: KisRankingType;
  items: KisRankingItem[];
}

export interface KisDeposit extends RawBacked {
  accountNumber: string;
  currency: CurrencyType;
  amount: Decimal;
  withdrawableAmount: Decimal;
  exchangeRate: Decimal;
}

export interface KisBalanceStock extends RawBacked {
  accountNumber: string;
  symbol: string;
  market: MarketType;
  name: string;
  currentPrice: Decimal;
  quantity: Decimal;
  qty: Decimal;
  orderable: Decimal;
  purchaseAmount: Decimal;
  purchaseAmountKrw: Decimal;
  currentAmount: Decimal;
  amount: Decimal;
  profit: Decimal;
  profitRate: Decimal;
  exchangeRate: Decimal;
  currency: CurrencyType;
}

export interface KisBalance extends RawBacked {
  accountNumber: string;
  country?: CountryType | null;
  stocks: KisBalanceStock[];
  deposits: Partial<Record<CurrencyType, KisDeposit>>;
  purchaseAmount: Decimal;
  currentAmount: Decimal;
  profit: Decimal;
  profitRate: Decimal;
  amount: Decimal;
  total: Decimal;
}

export interface KisOrderableAmount extends RawBacked {
  accountNumber: string;
  symbol: string;
  market: MarketType;
  price: Decimal | null;
  condition?: OrderCondition | null;
  execution?: OrderExecution | null;
  unitPrice: Decimal;
  amount: Decimal;
  quantity: Decimal;
  qty: Decimal;
  foreignAmount: Decimal;
  foreignQuantity: Decimal;
  foreignQty: Decimal;
  exchangeRate: Decimal;
  conditionKor: string;
}

export interface KisOrder extends RawBacked {
  accountNumber: string;
  symbol: string;
  market: MarketType;
  branch: string;
  number: string;
  time: Date;
  timeKst: Date;
}

export interface KisPendingOrder extends KisOrder {
  type: OrderType;
  price: Decimal;
  unitPrice: Decimal | null;
  quantity: Decimal;
  qty: Decimal;
  executedQuantity: Decimal;
  pendingQuantity: Decimal;
  orderableQuantity: Decimal;
  condition?: OrderCondition | null;
  execution?: OrderExecution | null;
  rejected: boolean;
  rejectedReason?: string | null;
}

export interface KisPendingOrders extends RawBacked {
  accountNumber: string;
  orders: KisPendingOrder[];
}

export interface KisDailyOrder extends KisPendingOrder {
  name: string;
}

export interface KisDailyOrders extends RawBacked {
  accountNumber: string;
  orders: KisDailyOrder[];
}

export interface KisOrderProfit extends RawBacked {
  accountNumber: string;
  symbol: string;
  market: MarketType;
  name: string;
  time: Date;
  buyPrice: Decimal;
  sellPrice: Decimal;
  buyAmount: Decimal;
  sellAmount: Decimal;
  quantity: Decimal;
  profit: Decimal;
  profitRate: Decimal;
  exchangeRate: Decimal;
}

export interface KisOrderProfits extends RawBacked {
  accountNumber: string;
  orders: KisOrderProfit[];
  fees: Decimal;
  profit: Decimal;
}

export interface KisWebsocketTR {
  id: string;
  key: string;
}

export interface KisSubscriptionEvent<T = unknown> {
  tr: KisWebsocketTR;
  response: T;
}
