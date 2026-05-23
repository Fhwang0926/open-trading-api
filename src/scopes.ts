import type { KisAccountNumber } from "./account-number.js";
import type { PyKis } from "./client.js";
import type {
  ChartPeriod,
  CountryType,
  KisBalance,
  KisChart,
  KisDailyOrders,
  KisOrder,
  KisOrderbook,
  KisOrderableAmount,
  KisOrderProfits,
  KisPendingOrders,
  KisQuote,
  KisStockInfo,
  MarketInfoType,
  MarketType,
  OrderCondition,
  OrderExecution,
  OrderPriceInput,
  OrderQuantityInput,
  OrderType
} from "./types.js";
import { KisEventTicket } from "./events.js";
import {
  balance,
  dailyOrders,
  dayChart,
  dailyChart,
  modifyOrder,
  cancelOrder,
  order,
  orderProfits,
  orderbook,
  orderableAmount,
  pendingOrders,
  quote,
  resolveMarket,
  stockInfo
} from "./rest.js";
import type { KisSubscriptionEvent } from "./types.js";
import type { KisRealtimeResponse, KisWebsocketClient } from "./websocket.js";

export interface OrderOptions {
  order?: OrderType;
  price?: OrderPriceInput | null;
  qty?: OrderQuantityInput | null;
  condition?: OrderCondition | null;
  execution?: OrderExecution | null;
  includeForeign?: boolean;
}

export class AccountScope {
  constructor(
    readonly kis: PyKis,
    readonly accountNumber: KisAccountNumber
  ) {}

  balance(country?: CountryType | null): Promise<KisBalance> {
    return balance(this.kis, this.accountNumber, country ?? null);
  }

  orderableAmount(
    market: MarketType,
    symbol: string,
    options: Omit<OrderOptions, "order" | "qty" | "includeForeign"> = {}
  ): Promise<KisOrderableAmount> {
    return orderableAmount(this.kis, this.accountNumber, market, symbol, options);
  }

  order(market: MarketType, symbol: string, options: OrderOptions & { order: OrderType }): Promise<KisOrder> {
    return order(this.kis, this.accountNumber, market, symbol, options);
  }

  buy(market: MarketType, symbol: string, options: Omit<OrderOptions, "order"> = {}): Promise<KisOrder> {
    return this.order(market, symbol, { ...options, order: "buy" });
  }

  sell(market: MarketType, symbol: string, options: Omit<OrderOptions, "order"> = {}): Promise<KisOrder> {
    return this.order(market, symbol, { ...options, order: "sell" });
  }

  pendingOrders(market?: MarketType | null): Promise<KisPendingOrders> {
    return pendingOrders(this.kis, this.accountNumber, market ?? null);
  }

  dailyOrders(options: { start?: Date | string; end?: Date | string; type?: OrderType | null } = {}): Promise<KisDailyOrders> {
    return dailyOrders(this.kis, this.accountNumber, options);
  }

  profits(options: { start?: Date | string; end?: Date | string; country?: CountryType | null } = {}): Promise<KisOrderProfits> {
    return orderProfits(this.kis, this.accountNumber, options);
  }
}

export class StockScope {
  constructor(
    readonly kis: PyKis,
    readonly symbol: string,
    readonly accountNumber: KisAccountNumber,
    private marketHint: MarketInfoType = null
  ) {}

  withMarket(market: MarketInfoType): this {
    this.marketHint = market;
    return this;
  }

  async market(): Promise<MarketType> {
    return resolveMarket(this.kis, this.symbol, this.marketHint);
  }

  info(): Promise<KisStockInfo> {
    return stockInfo(this.kis, this.symbol, this.marketHint);
  }

  async quote(extended = false): Promise<KisQuote> {
    return quote(this.kis, this.symbol, await this.market(), extended);
  }

  async orderbook(condition?: OrderCondition | null): Promise<KisOrderbook> {
    return orderbook(this.kis, this.symbol, await this.market(), condition ?? null);
  }

  async dailyChart(options: { start?: Date | string; end?: Date | string; period?: ChartPeriod; adjust?: boolean } = {}): Promise<KisChart> {
    return dailyChart(this.kis, this.symbol, await this.market(), options);
  }

  async dayChart(options: { start?: Date; end?: Date; period?: number } = {}): Promise<KisChart> {
    return dayChart(this.kis, this.symbol, await this.market(), options);
  }

  chart(range: string, options: { period?: ChartPeriod; adjust?: boolean } = {}): Promise<KisChart> {
    const amount = Number.parseInt(range, 10);
    const unit = range.replace(String(amount), "");
    const days = unit === "y" ? amount * 365 : unit === "m" ? amount * 30 : amount;
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.dailyChart({ start, period: options.period ?? "day", adjust: options.adjust });
  }

  async orderableAmount(options: Omit<OrderOptions, "order" | "qty" | "includeForeign"> = {}): Promise<KisOrderableAmount> {
    return orderableAmount(this.kis, this.accountNumber, await this.market(), this.symbol, options);
  }

  async order(options: OrderOptions & { order: OrderType }): Promise<KisOrder> {
    return order(this.kis, this.accountNumber, await this.market(), this.symbol, options);
  }

  buy(options: Omit<OrderOptions, "order"> = {}): Promise<KisOrder> {
    return this.order({ ...options, order: "buy" });
  }

  sell(options: Omit<OrderOptions, "order"> = {}): Promise<KisOrder> {
    return this.order({ ...options, order: "sell" });
  }

  async modify(orderNumber: KisOrder, options: Omit<OrderOptions, "order" | "includeForeign"> = {}): Promise<KisOrder> {
    return modifyOrder(this.kis, orderNumber, options);
  }

  cancel(orderNumber: KisOrder): Promise<KisOrder> {
    return cancelOrder(this.kis, orderNumber);
  }

  on(
    type: "price" | "orderbook",
    callback: (client: KisWebsocketClient, event: KisSubscriptionEvent<KisRealtimeResponse>) => void,
    once = false
  ): KisEventTicket<KisWebsocketClient, KisSubscriptionEvent<KisRealtimeResponse>> {
    if (!this.kis.websocket) throw new Error("Websocket client is disabled.");
    const key = this.symbol;
    const id = type === "price" ? (this.marketHint === "KRX" ? "H0STCNT0" : "HDFSCNT0") : this.marketHint === "KRX" ? "H0STASP0" : "HDFSASP0";
    return this.kis.websocket.on(id, key, callback, { once });
  }
}
