import { readFile, writeFile } from "node:fs/promises";
import { parseKisTokenDate } from "./utils.js";

export interface KisAccessTokenJson {
  access_token: string;
  token_type: string;
  access_token_token_expired: string;
  expires_in: string | number;
}

export class KisAccessToken {
  readonly token: string;
  readonly type: string;
  readonly expiredAt: Date;
  readonly validityPeriod: number;
  readonly raw: KisAccessTokenJson;

  constructor(data: KisAccessTokenJson) {
    this.raw = data;
    this.token = data.access_token;
    this.type = data.token_type;
    this.expiredAt = parseKisTokenDate(data.access_token_token_expired);
    this.validityPeriod = Number(data.expires_in);
  }

  get expired(): boolean {
    return this.expiredAt.getTime() <= Date.now();
  }

  get remainingMs(): number {
    return this.expiredAt.getTime() - Date.now();
  }

  build(target: Record<string, string> = {}): Record<string, string> {
    target.Authorization = `${this.type} ${this.token}`;
    return target;
  }

  toString(): string {
    return `${this.type} ${this.token}`;
  }

  async save(path: string): Promise<void> {
    await writeFile(path, JSON.stringify(this.raw, null, 2), "utf8");
  }

  static async load(path: string): Promise<KisAccessToken> {
    return new KisAccessToken(JSON.parse(await readFile(path, "utf8")) as KisAccessTokenJson);
  }
}
