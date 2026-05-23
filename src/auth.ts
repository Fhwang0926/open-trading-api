import { readFile, writeFile } from "node:fs/promises";
import { APPKEY_LENGTH, SECRETKEY_LENGTH } from "./types.js";
import { KisAccountNumber } from "./account-number.js";

export class KisKey {
  readonly id: string;
  readonly appkey: string;
  readonly secretkey: string;

  constructor(id: string, appkey: string, secretkey: string) {
    if (!id) throw new ValueError("id is required.");
    if (appkey.length !== APPKEY_LENGTH) throw new ValueError(`appkey length must be ${APPKEY_LENGTH}.`);
    if (secretkey.length !== SECRETKEY_LENGTH) throw new ValueError(`secretkey length must be ${SECRETKEY_LENGTH}.`);
    this.id = id;
    this.appkey = appkey;
    this.secretkey = secretkey;
  }

  build(target: Record<string, string> = {}): Record<string, string> {
    target.appkey = this.appkey;
    target.appsecret = this.secretkey;
    return target;
  }
}

export interface KisAuthJson {
  id: string;
  appkey: string;
  secretkey: string;
  account: string;
  virtual: boolean;
}

export class KisAuth {
  readonly id: string;
  readonly appkey: string;
  readonly secretkey: string;
  readonly account: string;
  readonly virtual: boolean;

  constructor(auth: KisAuthJson) {
    this.id = auth.id;
    this.appkey = auth.appkey;
    this.secretkey = auth.secretkey;
    this.account = auth.account;
    this.virtual = auth.virtual;
  }

  get key(): KisKey {
    return new KisKey(this.id, this.appkey, this.secretkey);
  }

  get accountNumber(): KisAccountNumber {
    return new KisAccountNumber(this.account);
  }

  toJSON(): KisAuthJson {
    return {
      id: this.id,
      appkey: this.appkey,
      secretkey: this.secretkey,
      account: this.account,
      virtual: this.virtual
    };
  }

  async save(path: string): Promise<void> {
    await writeFile(path, JSON.stringify(this.toJSON(), null, 2), "utf8");
  }

  static async load(path: string): Promise<KisAuth> {
    return new KisAuth(JSON.parse(await readFile(path, "utf8")) as KisAuthJson);
  }
}

export class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueError";
  }
}
