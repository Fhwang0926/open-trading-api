import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { inspect } from "node:util";
import { APPKEY_LENGTH, SECRETKEY_LENGTH } from "./types.js";
import { KisAccountNumber } from "./account-number.js";

export class KisKey {
  readonly #id: string;
  readonly #appkey: string;
  readonly #secretkey: string;

  constructor(id: string, appkey: string, secretkey: string) {
    if (!id) throw new ValueError("id is required.");
    if (appkey.length !== APPKEY_LENGTH) throw new ValueError(`appkey length must be ${APPKEY_LENGTH}.`);
    if (secretkey.length !== SECRETKEY_LENGTH) throw new ValueError(`secretkey length must be ${SECRETKEY_LENGTH}.`);
    this.#id = id;
    this.#appkey = appkey;
    this.#secretkey = secretkey;
  }

  /** @internal */
  build(target: Record<string, string> = {}): Record<string, string> {
    target.appkey = this.#appkey;
    target.appsecret = this.#secretkey;
    return target;
  }

  /** @internal */
  buildApprovalBody(target: Record<string, string> = {}): Record<string, string> {
    target.appkey = this.#appkey;
    target.secretkey = this.#secretkey;
    return target;
  }

  /** @internal */
  cacheKey(domain: string): string {
    return createHash("sha256").update(`open-trading-api:${domain}:${this.#id}:${this.#appkey}:${this.#secretkey}`).digest("hex");
  }

  toJSON(): Record<string, string> {
    return {
      id: redact(this.#id),
      appkey: redact(this.#appkey),
      secretkey: redact(this.#secretkey)
    };
  }

  toString(): string {
    return `KisKey(id=${redact(this.#id)}, appkey=${redact(this.#appkey)}, secretkey=${redact(this.#secretkey)})`;
  }

  [inspect.custom](): string {
    return this.toString();
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
  readonly #id: string;
  readonly #appkey: string;
  readonly #secretkey: string;
  readonly #account: string;
  readonly #virtual: boolean;

  constructor(auth: KisAuthJson) {
    this.#id = auth.id;
    this.#appkey = auth.appkey;
    this.#secretkey = auth.secretkey;
    this.#account = auth.account;
    this.#virtual = auth.virtual;
  }

  get virtual(): boolean {
    return this.#virtual;
  }

  /** @internal */
  get key(): KisKey {
    return new KisKey(this.#id, this.#appkey, this.#secretkey);
  }

  /** @internal */
  get accountNumber(): KisAccountNumber {
    return new KisAccountNumber(this.#account);
  }

  toJSON(): Record<string, string | boolean> {
    return {
      id: redact(this.#id),
      appkey: redact(this.#appkey),
      secretkey: redact(this.#secretkey),
      account: redactAccount(this.#account),
      virtual: this.#virtual
    };
  }

  toString(): string {
    return `KisAuth(id=${redact(this.#id)}, account=${redactAccount(this.#account)}, virtual=${this.#virtual})`;
  }

  [inspect.custom](): string {
    return this.toString();
  }

  async save(path: string): Promise<void> {
    await writeFile(path, JSON.stringify(this.secretJSON(), null, 2), "utf8");
  }

  static async load(path: string): Promise<KisAuth> {
    return new KisAuth(JSON.parse(await readFile(path, "utf8")) as KisAuthJson);
  }

  /** @internal */
  private secretJSON(): KisAuthJson {
    return {
      id: this.#id,
      appkey: this.#appkey,
      secretkey: this.#secretkey,
      account: this.#account,
      virtual: this.#virtual
    };
  }
}

export class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueError";
  }
}

function redact(value: string, visible = 4): string {
  if (!value) return "";
  if (value.length <= visible * 2) return "*".repeat(value.length);
  return `${value.slice(0, visible)}...${value.slice(-visible)}`;
}

function redactAccount(value: string): string {
  const normalized = value.replace("-", "");
  if (normalized.length < 4) return redact(value, 2);
  const product = value.includes("-") ? `-${value.split("-").at(-1)}` : "";
  return `${normalized.slice(0, 2)}****${normalized.slice(-2)}${product}`;
}
