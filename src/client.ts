import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { KisAccountNumber } from "./account-number.js";
import { KisAuth, KisKey } from "./auth.js";
import { KisCacheStorage } from "./cache.js";
import { loadKisConfig, pyKisOptionsFromConfig, type KisConfigOptions } from "./config.js";
import { KisAPIError, KisHTTPError } from "./errors.js";
import { RateLimiter } from "./rate-limiter.js";
import { currencyDailyChart, ranking } from "./rest.js";
import { AccountScope, StockScope } from "./scopes.js";
import { KisAccessToken } from "./token.js";
import {
  type ChartPeriod,
  DEFAULT_CUST_TYPE,
  REAL_API_REQUEST_PER_SECOND,
  REAL_DOMAIN,
  type DomainType,
  type KisCurrencyChart,
  type KisRanking,
  type KisRankingMarketCode,
  USER_AGENT,
  VIRTUAL_API_REQUEST_PER_SECOND,
  VIRTUAL_DOMAIN,
  WEBSOCKET_REAL_DOMAIN,
  WEBSOCKET_VIRTUAL_DOMAIN
} from "./types.js";
import { compactRecord, sleep, type AnyRecord } from "./utils.js";
import { KisWebsocketClient } from "./websocket.js";

export interface FormLike {
  build(target?: Record<string, string>): Record<string, string>;
}

export interface PyKisOptions {
  auth?: string | KisAuth;
  virtualAuth?: string | KisAuth;
  id?: string;
  account?: string | KisAccountNumber;
  appkey?: string | KisKey;
  secretkey?: string;
  token?: KisAccessToken | string;
  virtualId?: string;
  virtualAppkey?: string | KisKey;
  virtualSecretkey?: string;
  virtualToken?: KisAccessToken | string;
  keepToken?: boolean | string;
  virtual?: boolean;
  useWebsocket?: boolean;
  fetcher?: typeof fetch;
  userAgent?: string;
  custType?: string;
  realDomain?: string;
  virtualDomain?: string;
  realWebsocketDomain?: string;
  virtualWebsocketDomain?: string;
}

export interface RequestOptions {
  method?: "GET" | "POST";
  params?: Record<string, string>;
  body?: Record<string, string>;
  form?: Array<FormLike | null | undefined>;
  headers?: Record<string, string>;
  domain?: DomainType;
  appkeyLocation?: "header" | "body" | null;
  formLocation?: "header" | "params" | "body" | null;
  auth?: boolean;
  hashkey?: boolean | "auto";
}

export interface FetchOptions<T> extends RequestOptions {
  api?: string;
  continuous?: boolean;
  mapper?: (data: AnyRecord, response: Response) => T | Promise<T>;
}

export class PyKis {
  primaryAccount?: KisAccountNumber;
  readonly cache = new KisCacheStorage();
  readonly fetcher: typeof fetch;
  readonly websocket?: KisWebsocketClient;
  readonly defaultDomain: DomainType;
  readonly userAgent: string;
  readonly custType: string;
  readonly domains: Record<DomainType, string>;
  readonly websocketDomains: Record<DomainType, string>;

  readonly #appkey: KisKey;
  readonly #virtualAppkey?: KisKey;
  #tokenValue?: KisAccessToken;
  #virtualTokenValue?: KisAccessToken;
  #keepTokenDir?: string;
  readonly #rateLimiters = {
    real: new RateLimiter(REAL_API_REQUEST_PER_SECOND, 1000),
    virtual: new RateLimiter(VIRTUAL_API_REQUEST_PER_SECOND, 1000)
  };

  constructor(options: PyKisOptions) {
    let id = options.id;
    let account = options.account;
    let appkey = options.appkey;
    let secretkey = options.secretkey;
    let virtualId = options.virtualId;
    let virtualAppkey = options.virtualAppkey;
    let virtualSecretkey = options.virtualSecretkey;

    if (options.auth instanceof KisAuth) {
      if (options.auth.virtual) throw new Error("auth must be real-domain auth.");
      appkey = options.auth.key;
      account = options.auth.accountNumber;
    }
    if (options.virtualAuth instanceof KisAuth) {
      if (!options.virtualAuth.virtual) throw new Error("virtualAuth must be virtual-domain auth.");
      virtualAppkey = options.virtualAuth.key;
      account = options.virtualAuth.accountNumber;
    }

    if (!id && !(appkey instanceof KisKey)) throw new Error("id is required.");
    if (!appkey) throw new Error("appkey is required.");
    this.#appkey = typeof appkey === "string" ? new KisKey(id!, appkey, must(secretkey, "secretkey is required.")) : appkey;

    if (typeof virtualAppkey === "string") {
      this.#virtualAppkey = new KisKey(virtualId ?? id!, virtualAppkey, must(virtualSecretkey, "virtualSecretkey is required."));
    } else if (virtualAppkey instanceof KisKey) {
      this.#virtualAppkey = virtualAppkey;
    }

    this.primaryAccount = typeof account === "string" ? new KisAccountNumber(account) : account;
    this.#tokenValue = options.token instanceof KisAccessToken ? options.token : undefined;
    this.#virtualTokenValue = options.virtualToken instanceof KisAccessToken ? options.virtualToken : undefined;
    this.fetcher = options.fetcher ?? fetch;
    this.defaultDomain = (options.virtual ?? this.#virtualAppkey !== undefined) ? "virtual" : "real";
    this.userAgent = options.userAgent ?? USER_AGENT;
    this.custType = options.custType ?? DEFAULT_CUST_TYPE;
    this.domains = {
      real: options.realDomain ?? REAL_DOMAIN,
      virtual: options.virtualDomain ?? VIRTUAL_DOMAIN
    };
    this.websocketDomains = {
      real: options.realWebsocketDomain ?? WEBSOCKET_REAL_DOMAIN,
      virtual: options.virtualWebsocketDomain ?? WEBSOCKET_VIRTUAL_DOMAIN
    };
    if (options.keepToken) this.#keepTokenDir = resolve(options.keepToken === true ? join(homedir(), ".open-trading-api") : options.keepToken);
    if (options.useWebsocket ?? true) this.websocket = new KisWebsocketClient(this);
  }

  static async create(options: PyKisOptions): Promise<PyKis> {
    const resolved: PyKisOptions = { ...options };
    if (typeof options.auth === "string") resolved.auth = await KisAuth.load(options.auth);
    if (typeof options.virtualAuth === "string") resolved.virtualAuth = await KisAuth.load(options.virtualAuth);
    if (typeof options.token === "string") resolved.token = await KisAccessToken.load(options.token);
    if (typeof options.virtualToken === "string") resolved.virtualToken = await KisAccessToken.load(options.virtualToken);
    const kis = new PyKis(resolved);
    await kis.loadCachedTokens();
    return kis;
  }

  static async fromConfig(path?: string, options: KisConfigOptions = {}): Promise<PyKis> {
    const config = await loadKisConfig(path);
    return PyKis.create(pyKisOptionsFromConfig(config, options));
  }

  get virtual(): boolean {
    return this.defaultDomain === "virtual";
  }

  get primary(): KisAccountNumber {
    if (!this.primaryAccount) throw new Error("Primary account is not configured.");
    return this.primaryAccount;
  }

  account(account?: string | KisAccountNumber, primary = false): AccountScope {
    const accountNumber = typeof account === "string" ? new KisAccountNumber(account) : account ?? this.primary;
    if (primary) this.primaryAccount = accountNumber;
    return new AccountScope(this, accountNumber);
  }

  stock(symbol: string, market?: Parameters<typeof StockScope.prototype.withMarket>[0], account?: string | KisAccountNumber): StockScope {
    const accountNumber = typeof account === "string" ? new KisAccountNumber(account) : account ?? this.primary;
    return new StockScope(this, symbol, accountNumber, market ?? null);
  }

  currencyDailyChart(
    symbol = "FX@KRWKFTC",
    options: { start?: Date | string; end?: Date | string; period?: ChartPeriod } = {}
  ): Promise<KisCurrencyChart> {
    return currencyDailyChart(this, symbol, options);
  }

  rankingMarketCap(
    options: { market?: KisRankingMarketCode; targetClassCode?: string; excludeClassCode?: string } = {}
  ): Promise<KisRanking> {
    return ranking(this, "marketCap", options);
  }

  rankingVolume(
    options: { market?: KisRankingMarketCode; targetClassCode?: string; excludeClassCode?: string } = {}
  ): Promise<KisRanking> {
    return ranking(this, "volume", options);
  }

  rankingFluctuation(
    options: { market?: KisRankingMarketCode; targetClassCode?: string; excludeClassCode?: string } = {}
  ): Promise<KisRanking> {
    return ranking(this, "fluctuation", options);
  }

  async request(path: string, options: RequestOptions = {}): Promise<Response> {
    const method = options.method ?? "GET";
    const domain = options.domain ?? this.defaultDomain;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/plain",
      charset: "UTF-8",
      "User-Agent": this.userAgent,
      ...(options.headers ?? {})
    };
    const params = { ...(options.params ?? {}) };
    const body = method === "POST" ? { ...(options.body ?? {}) } : undefined;
    let hashkeyApplied = false;

    if (method === "GET" && options.body) throw new Error("GET requests cannot contain body.");
    if (options.appkeyLocation !== null) {
      const location = options.appkeyLocation ?? "header";
      this.keyFor(domain).build(location === "header" ? headers : must(body, "POST body was not initialized."));
    }

    if (options.form) {
      const location = options.formLocation ?? (method === "GET" ? "params" : "body");
      const target = location === "header" ? headers : location === "params" ? params : must(body, "POST body was not initialized.");
      for (const form of options.form) form?.build(target);
    }

    while (true) {
      await this.#rateLimiters[domain].acquire();
      if (options.auth ?? true) {
        (await this.accessToken(domain)).build(headers);
        if (this.custType) headers.custtype = this.custType;
      }
      if (!hashkeyApplied && shouldUseHashkey(path, method, body, options.hashkey)) {
        headers.hashkey = await this.hashkey(body ?? {}, domain);
        hashkeyApplied = true;
      }

      const url = new URL(path, this.apiDomain(domain));
      for (const [key, value] of Object.entries(compactRecord(params))) url.searchParams.set(key, value);

      const response = await this.fetcher(url, {
        method,
        headers,
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined
      });

      if (response.ok) return response;

      const data = await tryJson(response);
      const code = data?.msg_cd;
      if (code === "EGW00201") {
        await sleep(100);
        continue;
      }
      if (code === "EGW00123") {
        if (domain === "real") this.#tokenValue = undefined;
        else this.#virtualTokenValue = undefined;
        continue;
      }
      throw new KisHTTPError(response, data);
    }
  }

  async fetch<T = AnyRecord>(path: string, options: FetchOptions<T> = {}): Promise<T> {
    const headers = { ...(options.headers ?? {}) };
    if (options.api) headers.tr_id = options.api;
    if (options.continuous) headers.tr_cont = "N";
    const response = await this.request(path, { ...options, headers });
    const data = (await response.json()) as AnyRecord;
    if (data.rt_cd !== undefined && Number(data.rt_cd) !== 0) {
      throw new KisAPIError(data, response);
    }
    return options.mapper ? options.mapper(data, response) : (data as T);
  }

  /** @internal */
  async accessToken(domain: DomainType = this.defaultDomain): Promise<KisAccessToken> {
    if (domain === "virtual" && !this.#virtualAppkey && this.defaultDomain !== "virtual") return this.accessToken("real");
    const current = domain === "real" ? this.#tokenValue : this.#virtualTokenValue;
    if (current && current.remainingMs > 10 * 60 * 1000) return current;
    const issued = await this.issueToken(domain);
    if (domain === "real") this.#tokenValue = issued;
    else this.#virtualTokenValue = issued;
    await this.saveCachedToken(domain);
    return issued;
  }

  /** @internal */
  async issueToken(domain: DomainType = this.defaultDomain): Promise<KisAccessToken> {
    return this.fetch("/oauth2/tokenP", {
      method: "POST",
      body: { grant_type: "client_credentials" },
      appkeyLocation: "body",
      domain,
      auth: false,
      mapper: (data) => new KisAccessToken(data as any)
    });
  }

  /** @internal */
  async revokeToken(token: string): Promise<void> {
    const response = await this.request("/oauth2/revokeP", {
      method: "POST",
      body: { token },
      appkeyLocation: "body",
      auth: false
    });
    if (!response.ok) throw new KisHTTPError(response);
  }

  /** @internal */
  async hashkey(body: Record<string, string>, domain: DomainType = this.defaultDomain): Promise<string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/plain",
      charset: "UTF-8",
      "User-Agent": this.userAgent
    };
    this.keyFor(domain).build(headers);
    await this.#rateLimiters[domain].acquire();
    const response = await this.fetcher(new URL("/uapi/hashkey", this.apiDomain(domain)), {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    const data = await tryJson(response);
    if (!response.ok) throw new KisHTTPError(response, data);
    if (data?.rt_cd !== undefined && Number(data.rt_cd) !== 0) throw new KisAPIError(data, response);
    const hash = data?.HASH ?? data?.hashkey ?? data?.hash;
    if (!hash) {
      throw new KisAPIError({ rt_cd: "1", msg_cd: "HASHKEY_EMPTY", msg1: "hashkey response did not contain HASH" }, response);
    }
    return String(hash);
  }

  async discard(domain?: DomainType): Promise<void> {
    if (this.#tokenValue && (!domain || domain === "real")) {
      await this.revokeTokenFromAccessToken(this.#tokenValue);
      this.#tokenValue = undefined;
    }
    if (this.#virtualTokenValue && (!domain || domain === "virtual")) {
      await this.revokeTokenFromAccessToken(this.#virtualTokenValue);
      this.#virtualTokenValue = undefined;
    }
  }

  /** @internal */
  async websocketApprovalKey(domain: DomainType = this.defaultDomain): Promise<string> {
    const key = this.keyFor(domain);
    const data = await this.fetch<{ approval_key: string }>("/oauth2/Approval", {
      method: "POST",
      body: key.buildApprovalBody({ grant_type: "client_credentials" }),
      appkeyLocation: null,
      auth: false,
      domain
    });
    return data.approval_key;
  }

  async close(): Promise<void> {
    this.websocket?.disconnect();
  }

  private keyFor(domain: DomainType): KisKey {
    if (domain === "real") return this.#appkey;
    if (this.#virtualAppkey) return this.#virtualAppkey;
    if (this.defaultDomain === "virtual") return this.#appkey;
    throw new Error("Virtual appkey is not configured.");
  }

  apiDomain(domain: DomainType): string {
    return this.domains[domain];
  }

  websocketDomain(domain: DomainType): string {
    return this.websocketDomains[domain];
  }

  private async loadCachedTokens(): Promise<void> {
    if (!this.#keepTokenDir) return;
    try {
      this.#tokenValue = await KisAccessToken.load(join(this.#keepTokenDir, this.tokenFileName("real")));
    } catch {
      // Missing or stale cache is fine.
    }
    if (this.virtual || this.#virtualAppkey) {
      try {
        this.#virtualTokenValue = await KisAccessToken.load(join(this.#keepTokenDir, this.tokenFileName("virtual")));
      } catch {
        // Missing or stale cache is fine.
      }
    }
  }

  private async saveCachedToken(domain: DomainType): Promise<void> {
    if (!this.#keepTokenDir) return;
    await mkdir(this.#keepTokenDir, { recursive: true });
    const token = domain === "real" ? this.#tokenValue : this.#virtualTokenValue;
    if (token) await token.save(join(this.#keepTokenDir, this.tokenFileName(domain)));
  }

  private tokenFileName(domain: DomainType): string {
    const key = this.keyFor(domain);
    return `token_${domain}_${key.cacheKey("token")}.json`;
  }

  private async revokeTokenFromAccessToken(token: KisAccessToken): Promise<void> {
    const response = await this.request("/oauth2/revokeP", {
      method: "POST",
      body: token.buildRevokeBody(),
      appkeyLocation: "body",
      auth: false
    });
    if (!response.ok) throw new KisHTTPError(response);
  }
}

function shouldUseHashkey(path: string, method: string, body: Record<string, string> | undefined, option: boolean | "auto" | undefined): boolean {
  if (option === false) return false;
  if (method !== "POST" || !body || Object.keys(body).length === 0) return false;
  if (option === true) return true;
  return path.startsWith("/uapi/") && path !== "/uapi/hashkey";
}

function must<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null) throw new Error(message);
  return value;
}

async function tryJson(response: Response): Promise<AnyRecord | undefined> {
  try {
    return (await response.json()) as AnyRecord;
  } catch {
    return undefined;
  }
}
