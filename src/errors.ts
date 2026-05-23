import type { AnyRecord } from "./utils.js";

export class KisException extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class KisHTTPError extends KisException {
  readonly response: Response;
  readonly data?: AnyRecord;

  constructor(response: Response, data?: AnyRecord) {
    super(`KIS HTTP error: ${response.status} ${response.statusText}`);
    this.response = response;
    this.data = data;
  }
}

export class KisAPIError extends KisException {
  readonly data: AnyRecord;
  readonly response?: Response;
  readonly rtCd?: string;
  readonly msgCd?: string;
  readonly trId?: string | null;

  constructor(data: AnyRecord, response?: Response) {
    const rtCd = data.rt_cd == null ? "UNKNOWN" : String(data.rt_cd);
    const msgCd = data.msg_cd == null ? "UNKNOWN" : String(data.msg_cd);
    const message = data.msg1 == null ? "KIS API request failed" : String(data.msg1).trim();
    const trId = response?.headers.get("tr_id") ?? null;
    super(`KIS API error (RT_CD: ${rtCd}, MSG_CD: ${msgCd}) ${trId ?? "UNKNOWN"} ${message}`);
    this.data = data;
    this.response = response;
    this.rtCd = rtCd;
    this.msgCd = msgCd;
    this.trId = trId;
  }
}

export class KisNotFoundError extends KisAPIError {
  constructor(data: AnyRecord, response?: Response, message = "KIS data was not found") {
    super({ ...data, msg1: message, msg_cd: data.msg_cd ?? "NOT_FOUND", rt_cd: data.rt_cd ?? "7" }, response);
  }
}

export class KisMarketNotOpenedError extends KisAPIError {}
