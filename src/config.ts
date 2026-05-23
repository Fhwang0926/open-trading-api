import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PyKisOptions } from "./client.js";
import type { DomainType } from "./types.js";

export interface KisConfig extends Record<string, string | undefined> {
  my_app?: string;
  my_sec?: string;
  paper_app?: string;
  paper_sec?: string;
  my_htsid?: string;
  my_acct_stock?: string;
  my_acct_future?: string;
  my_paper_stock?: string;
  my_paper_future?: string;
  my_prod?: string;
  prod?: string;
  vps?: string;
  ops?: string;
  vops?: string;
  my_agent?: string;
  custtype?: string;
}

export type KisConfigMode = DomainType | "prod" | "vps" | "demo";

export interface KisConfigOptions {
  mode?: KisConfigMode;
  product?: string;
  id?: string;
  account?: string;
  keepToken?: boolean | string;
  useWebsocket?: boolean;
  fetcher?: typeof fetch;
}

export function defaultKisConfigPath(): string {
  return join(homedir(), "KIS", "config", "kis_devlp.yaml");
}

export async function loadKisConfig(path = defaultKisConfigPath()): Promise<KisConfig> {
  return parseKisConfig(await readFile(path, "utf8"));
}

export function parseKisConfig(source: string): KisConfig {
  const config: KisConfig = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = stripYamlComment(rawLine).trim();
    if (!line) continue;
    const match = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    if (!key) continue;
    config[key] = parseYamlScalar(match[2] ?? "");
  }
  return config;
}

export function pyKisOptionsFromConfig(config: KisConfig, options: KisConfigOptions = {}): PyKisOptions {
  const mode = normalizeMode(options.mode ?? "real");
  const product = options.product ?? config.my_prod ?? "01";
  const id = options.id ?? config.my_htsid;
  const account = options.account ?? accountFromConfig(config, mode, product);

  if (mode === "real") {
    return withOfficialOptions(config, {
      id,
      account,
      appkey: requireConfig(config.my_app, "my_app"),
      secretkey: requireConfig(config.my_sec, "my_sec"),
      virtual: false,
      keepToken: options.keepToken,
      useWebsocket: options.useWebsocket,
      fetcher: options.fetcher
    });
  }

  return withOfficialOptions(config, {
    id,
    account,
    appkey: requireConfig(config.paper_app, "paper_app"),
    secretkey: requireConfig(config.paper_sec, "paper_sec"),
    virtual: true,
    keepToken: options.keepToken,
    useWebsocket: options.useWebsocket,
    fetcher: options.fetcher
  });
}

function withOfficialOptions(config: KisConfig, options: PyKisOptions): PyKisOptions {
  return {
    ...options,
    userAgent: config.my_agent,
    custType: config.custtype ?? "P",
    realDomain: config.prod,
    virtualDomain: config.vps,
    realWebsocketDomain: config.ops,
    virtualWebsocketDomain: config.vops
  };
}

function normalizeMode(mode: KisConfigMode): DomainType {
  if (mode === "prod") return "real";
  if (mode === "vps" || mode === "demo") return "virtual";
  return mode;
}

function accountFromConfig(config: KisConfig, mode: DomainType, product: string): string | undefined {
  const stock = mode === "real" ? config.my_acct_stock : config.my_paper_stock;
  const future = mode === "real" ? config.my_acct_future : config.my_paper_future;
  const account = product === "03" || product === "08" ? future ?? stock : stock;
  return account ? `${account}-${product}` : undefined;
}

function requireConfig(value: string | undefined, key: string): string {
  if (!value) throw new Error(`kis_devlp.yaml is missing ${key}.`);
  return value;
}

function stripYamlComment(value: string): string {
  let quote: string | null = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "#") return value.slice(0, index);
  }
  return value;
}

function parseYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const quote = trimmed[0];
  if ((quote === "'" || quote === '"') && trimmed.endsWith(quote)) {
    const unquoted = trimmed.slice(1, -1);
    return quote === '"' ? unquoted.replace(/\\"/g, '"').replace(/\\\\/g, "\\") : unquoted.replace(/''/g, "'");
  }
  return trimmed;
}
