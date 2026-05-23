import { readFile, writeFile } from "node:fs/promises";
import { inspect } from "node:util";
import { parseKisTokenDate } from "./utils.js";

export interface KisAccessTokenJson {
  access_token: string;
  token_type: string;
  access_token_token_expired: string;
  expires_in: string | number;
}

export class KisAccessToken {
  readonly #token: string;
  readonly #type: string;
  readonly #raw: KisAccessTokenJson;
  readonly expiredAt: Date;
  readonly validityPeriod: number;

  constructor(data: KisAccessTokenJson) {
    this.#raw = { ...data };
    this.#token = data.access_token;
    this.#type = data.token_type;
    this.expiredAt = parseKisTokenDate(data.access_token_token_expired);
    this.validityPeriod = Number(data.expires_in);
  }

  get expired(): boolean {
    return this.expiredAt.getTime() <= Date.now();
  }

  get remainingMs(): number {
    return this.expiredAt.getTime() - Date.now();
  }

  /** @internal */
  build(target: Record<string, string> = {}): Record<string, string> {
    target.Authorization = this.authorizationHeader();
    return target;
  }

  /** @internal */
  buildRevokeBody(target: Record<string, string> = {}): Record<string, string> {
    target.token = this.#token;
    return target;
  }

  toString(): string {
    return `${this.#type} ${redact(this.#token)}`;
  }

  toJSON(): Record<string, string | number> {
    return {
      access_token: redact(this.#token),
      token_type: this.#type,
      access_token_token_expired: this.#raw.access_token_token_expired,
      expires_in: this.validityPeriod
    };
  }

  [inspect.custom](): string {
    return `KisAccessToken(${this.toString()}, expiredAt=${this.expiredAt.toISOString()})`;
  }

  async save(path: string): Promise<void> {
    await writeFile(path, JSON.stringify(this.#raw, null, 2), "utf8");
  }

  static async load(path: string): Promise<KisAccessToken> {
    return new KisAccessToken(JSON.parse(await readFile(path, "utf8")) as KisAccessTokenJson);
  }

  /** @internal */
  private authorizationHeader(): string {
    return `${this.#type} ${this.#token}`;
  }
}

function redact(value: string, visible = 4): string {
  if (!value) return "";
  if (value.length <= visible * 2) return "*".repeat(value.length);
  return `${value.slice(0, visible)}...${value.slice(-visible)}`;
}
