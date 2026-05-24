import { createDecipheriv } from "node:crypto";
import WebSocket from "ws";
import { KisEventHandler, type EventCallback, type EventFilter, KisEventTicket } from "./events.js";
import type { PyKis } from "./client.js";
import {
  WEBSOCKET_MAX_SUBSCRIPTIONS,
  type DomainType,
  type KisSubscriptionEvent,
  type KisWebsocketTR
} from "./types.js";

const TR_SUBSCRIBE_TYPE = "1";
const TR_UNSUBSCRIBE_TYPE = "2";
const DOMESTIC_EXECUTION_TR_IDS = new Set(["H0STCNI0", "H0STCNI9"]);
const FOREIGN_EXECUTION_TR_IDS = new Set(["H0GSCNI0", "H0GSCNI9"]);

export interface KisSubscribedEvent {
  tr: KisWebsocketTR;
}

export interface KisRealtimeResponse {
  trId: string;
  raw: string[];
  kind: "price" | "orderbook" | "execution" | "unknown";
  [key: string]: unknown;
}

export class KisWebsocketClient {
  readonly subscribedEvent = new KisEventHandler<KisWebsocketClient, KisSubscribedEvent>();
  readonly unsubscribedEvent = new KisEventHandler<KisWebsocketClient, KisSubscribedEvent>();
  readonly event = new KisEventHandler<KisWebsocketClient, KisSubscriptionEvent<KisRealtimeResponse>>();
  reconnect = true;
  reconnectIntervalMs = 5000;

  private socket?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private readonly subscriptions = new Map<string, KisWebsocketTR>();
  private readonly registeredSubscriptions = new Set<string>();
  private readonly keychain = new Map<string, { key: Buffer; iv: Buffer }>();
  private connecting?: Promise<void>;

  constructor(
    readonly kis: PyKis,
    readonly domain: DomainType = kis.virtual ? "virtual" : "real"
  ) {}

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  isSubscribed(id: string, key = ""): boolean {
    return this.subscriptions.has(trKey({ id, key }));
  }

  connect(): void {
    void this.ensureConnected();
  }

  async ensureConnected(): Promise<void> {
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolve, reject) => {
      const url = `${this.kis.websocketDomain(this.domain)}/tryitout`;
      const socket = new WebSocket(url);
      this.socket = socket;

      socket.once("open", () => {
        this.registeredSubscriptions.clear();
        for (const tr of this.subscriptions.values()) void this.request(TR_SUBSCRIBE_TYPE, tr, true);
        resolve();
      });
      socket.on("message", (message) => this.handleMessage(String(message)));
      socket.on("close", () => this.handleClose());
      socket.on("error", (error) => {
        if (!this.connected) reject(error);
      });
    }).finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
  }

  async subscribe(id: string, key: string, primary = false): Promise<void> {
    void primary;
    if (this.subscriptions.size >= WEBSOCKET_MAX_SUBSCRIPTIONS) throw new Error("Maximum number of websocket subscriptions reached.");
    const tr = { id, key };
    this.subscriptions.set(trKey(tr), tr);
    await this.ensureConnected();
    await this.request(TR_SUBSCRIBE_TYPE, tr);
  }

  async unsubscribe(id: string, key: string, primary = false): Promise<void> {
    void primary;
    const tr = { id, key };
    this.subscriptions.delete(trKey(tr));
    await this.request(TR_UNSUBSCRIBE_TYPE, tr);
  }

  unsubscribeAll(): void {
    for (const tr of [...this.subscriptions.values()]) void this.unsubscribe(tr.id, tr.key);
  }

  on(
    id: string,
    key: string,
    callback: EventCallback<KisWebsocketClient, KisSubscriptionEvent<KisRealtimeResponse>>,
    options: { where?: EventFilter<KisWebsocketClient, KisSubscriptionEvent<KisRealtimeResponse>>; once?: boolean; primary?: boolean } = {}
  ): KisEventTicket<KisWebsocketClient, KisSubscriptionEvent<KisRealtimeResponse>> {
    void this.subscribe(id, key, options.primary);
    return this.event.on(callback, {
      once: options.once,
      where: (sender, args) => args.tr.id !== id || (options.where ? options.where(sender, args) : false)
    });
  }

  once(
    id: string,
    key: string,
    callback: EventCallback<KisWebsocketClient, KisSubscriptionEvent<KisRealtimeResponse>>,
    options: { where?: EventFilter<KisWebsocketClient, KisSubscriptionEvent<KisRealtimeResponse>>; primary?: boolean } = {}
  ): KisEventTicket<KisWebsocketClient, KisSubscriptionEvent<KisRealtimeResponse>> {
    return this.on(id, key, callback, { ...options, once: true });
  }

  private async request(type: string, body: KisWebsocketTR, force = false): Promise<boolean> {
    if (!this.socket || (!force && !this.connected)) return false;
    const approvalKey = await this.kis.websocketApprovalKey(this.domain);
    this.socket.send(
      JSON.stringify({
        header: {
          approval_key: approvalKey,
          custtype: this.kis.custType,
          tr_type: type,
          "content-type": "utf-8"
        },
        body: {
          input: {
            tr_id: body.id,
            tr_key: body.key
          }
        }
      })
    );
    return true;
  }

  private handleClose(): void {
    this.registeredSubscriptions.clear();
    if (!this.reconnect) return;
    this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectIntervalMs);
  }

  private handleMessage(message: string): void {
    try {
      if (message.startsWith("0") || message.startsWith("1")) {
        this.handleEvent(message);
      } else {
        this.handleControl(JSON.parse(message));
      }
    } catch {
      // Event handlers should not bring the socket down.
    }
  }

  private handleControl(data: any): void {
    const header = data.header ?? {};
    const id = String(header.tr_id ?? "");
    if (id === "PINGPONG") {
      this.socket?.send(JSON.stringify(data));
      return;
    }
    const body = data.body;
    if (!body) return;
    const tr = { id, key: String(header.tr_key ?? "") };
    if (body.output?.key && body.output?.iv) {
      const encryptionTr = ["H0STCNI0", "H0STCNI9", "H0GSCNI0", "H0GSCNI9"].includes(id) ? { id, key: "" } : tr;
      this.keychain.set(trKey(encryptionTr), {
        key: Buffer.from(String(body.output.key), "utf8"),
        iv: Buffer.from(String(body.output.iv), "utf8")
      });
    }
    if (body.msg_cd === "OPSP0000" || body.msg_cd === "OPSP0002") {
      this.registeredSubscriptions.add(trKey(tr));
      this.subscribedEvent.invoke(this, { tr });
    } else if (body.msg_cd === "OPSP0001" || body.msg_cd === "OPSP0003") {
      this.registeredSubscriptions.delete(trKey(tr));
      this.keychain.delete(trKey(tr));
      this.unsubscribedEvent.invoke(this, { tr });
    }
  }

  private handleEvent(message: string): void {
    const [encryptedFlag, id, countText, bodyRaw] = message.split("|", 4);
    const count = Number(countText);
    const encrypted = encryptedFlag === "1";
    let body = bodyRaw ?? "";
    const tr = { id: id ?? "", key: "" };

    if (encrypted) {
      const key = this.keychain.get(trKey(tr));
      if (!key) return;
      body = decryptAesCbcBase64(body, key.key, key.iv);
    }

    const fields = body.split("^");
    const width = count > 0 ? Math.floor(fields.length / count) : fields.length;
    for (let i = 0; i < Math.max(count, 1); i += 1) {
      const raw = fields.slice(i * width, (i + 1) * width);
      this.event.invoke(this, {
        tr,
        response: parseRealtimeResponse(id ?? "", raw)
      });
    }
  }
}

export function decryptAesCbcBase64(data: string, key: Buffer, iv: Buffer): string {
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

export function parseRealtimeResponse(trId: string, raw: string[]): KisRealtimeResponse {
  if (trId === "H0STCNT0" || trId === "HDFSCNT0") {
    return {
      trId,
      raw,
      kind: "price",
      symbol: raw[0],
      time: raw[1],
      price: raw[2],
      sign: raw[3],
      change: raw[4],
      rate: raw[5],
      volume: raw[13]
    };
  }
  if (trId === "H0STASP0" || trId === "HDFSASP0" || trId === "HDFSASP1") {
    return { trId, raw, kind: "orderbook", symbol: raw[0] };
  }
  if (DOMESTIC_EXECUTION_TR_IDS.has(trId)) return parseDomesticExecutionResponse(trId, raw);
  if (FOREIGN_EXECUTION_TR_IDS.has(trId)) return parseForeignExecutionResponse(trId, raw);
  return { trId, raw, kind: "unknown" };
}

function parseDomesticExecutionResponse(trId: string, raw: string[]): KisRealtimeResponse {
  return {
    trId,
    raw,
    kind: "execution",
    customerId: raw[0],
    account: raw[1] ?? raw[0],
    orderNumber: raw[2],
    originalOrderNumber: raw[3],
    type: orderTypeFromExecutionCode(raw[4]),
    orderKind: raw[6],
    symbol: raw[8],
    executedQuantity: raw[9],
    price: raw[10],
    time: raw[11],
    rejected: raw[12] === "1",
    accepted: raw[14] === "1",
    canceled: raw[14] === "3",
    branch: raw[15],
    quantity: raw[16],
    orderConditionPrice: raw[18],
    orderExchangeCode: raw[19],
    realtimeDisplay: raw[20],
    creditType: raw[22],
    creditLoanDate: raw[23],
    name: raw[24],
    unitPrice: raw[25]
  };
}

function parseForeignExecutionResponse(trId: string, raw: string[]): KisRealtimeResponse {
  return {
    trId,
    raw,
    kind: "execution",
    customerId: raw[0],
    account: raw[1] ?? raw[0],
    orderNumber: raw[2],
    originalOrderNumber: raw[3],
    type: orderTypeFromExecutionCode(raw[4]),
    orderKind: raw[6],
    symbol: raw[7],
    executedQuantity: raw[8],
    price: raw[9],
    time: raw[10],
    rejected: raw[11] === "1",
    accepted: raw[13] === "1",
    canceled: raw[13] === "3",
    branch: raw[14],
    quantity: raw[15],
    orderConditionPrice: raw[17],
    marketCode: raw[18],
    orderExchangeCode: raw[18],
    name: raw[19],
    unitPrice: raw[20]
  };
}

function orderTypeFromExecutionCode(code: string | undefined): string | undefined {
  if (code === "01") return "sell";
  if (code === "02") return "buy";
  return code;
}

function trKey(tr: KisWebsocketTR): string {
  return `${tr.id}:${tr.key}`;
}
