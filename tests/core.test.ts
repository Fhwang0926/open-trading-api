import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decryptAesCbcBase64,
  ensurePrice,
  KisAccessToken,
  KisAccountNumber,
  KisAuth,
  KisKey,
  loadKisConfig,
  orderCondition,
  parseRealtimeResponse,
  pyKisOptionsFromConfig,
  PyKis
} from "../src/index.js";
import { createCipheriv, randomBytes } from "node:crypto";

const APPKEY = "a".repeat(36);
const SECRET = "s".repeat(180);
const VIRTUAL_APPKEY = "b".repeat(36);
const VIRTUAL_SECRET = "t".repeat(180);

describe("core models", () => {
  it("parses KIS account numbers", () => {
    expect(new KisAccountNumber("12345678").toString()).toBe("12345678-01");
    expect(new KisAccountNumber("1234567802").toString()).toBe("12345678-02");
    expect(new KisAccountNumber("12345678-03").build()).toEqual({ CANO: "12345678", ACNT_PRDT_CD: "03" });
    expect(() => new KisAccountNumber("123")).toThrow(/Invalid account/);
  });

  it("validates app keys", () => {
    expect(new KisKey("user", APPKEY, SECRET).build()).toEqual({ appkey: APPKEY, appsecret: SECRET });
    expect(() => new KisKey("user", "short", SECRET)).toThrow(/appkey length/);
  });

  it("saves and loads auth files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kis-auth-"));
    const file = join(dir, "auth.json");
    const auth = new KisAuth({ id: "user", appkey: APPKEY, secretkey: SECRET, account: "12345678-01", virtual: false });
    await auth.save(file);
    expect((await KisAuth.load(file)).accountNumber.toString()).toBe("12345678-01");
    await rm(dir, { recursive: true, force: true });
  });

  it("handles access token persistence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kis-token-"));
    const file = join(dir, "token.json");
    const token = new KisAccessToken({
      access_token: "abc",
      token_type: "Bearer",
      access_token_token_expired: "2999-01-01 00:00:00",
      expires_in: 86400
    });
    await token.save(file);
    expect(await readFile(file, "utf8")).toContain("access_token");
    expect((await KisAccessToken.load(file)).toString()).toBe("Bearer abc");
    await rm(dir, { recursive: true, force: true });
  });

  it("loads official kis_devlp.yaml style config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kis-config-"));
    const file = join(dir, "kis_devlp.yaml");
    await writeFile(
      file,
      [
        `my_app: "${APPKEY}"`,
        `my_sec: "${SECRET}"`,
        `paper_app: "${VIRTUAL_APPKEY}"`,
        `paper_sec: "${VIRTUAL_SECRET}"`,
        `my_htsid: "hts-user"`,
        `my_acct_stock: "12345678"`,
        `my_paper_stock: "87654321"`,
        `my_prod: "01"`,
        `prod: "https://real.example.test:9443"`,
        `vps: "https://virtual.example.test:29443"`,
        `ops: "ws://real-ws.example.test:21000"`,
        `vops: "ws://virtual-ws.example.test:31000"`,
        `my_agent: "official-agent"`,
        `custtype: "B"`
      ].join("\n"),
      "utf8"
    );

    const config = await loadKisConfig(file);
    const options = pyKisOptionsFromConfig(config, { mode: "vps", keepToken: ".kis", useWebsocket: false });

    expect(options.id).toBe("hts-user");
    expect(options.account).toBe("87654321-01");
    expect(options.appkey).toBe(VIRTUAL_APPKEY);
    expect(options.secretkey).toBe(VIRTUAL_SECRET);
    expect(options.virtual).toBe(true);
    expect(options.userAgent).toBe("official-agent");
    expect(options.custType).toBe("B");
    expect(options.realDomain).toBe("https://real.example.test:9443");
    expect(options.virtualWebsocketDomain).toBe("ws://virtual-ws.example.test:31000");
    await rm(dir, { recursive: true, force: true });
  });
});

describe("order conditions", () => {
  it("maps domestic and foreign order conditions", () => {
    expect(orderCondition({ virtual: false, market: "KRX", order: "buy", price: ensurePrice(100, 0) })[0]).toBe("00");
    expect(orderCondition({ virtual: false, market: "KRX", order: "sell", price: null })[0]).toBe("01");
    expect(orderCondition({ virtual: false, market: "NASDAQ", order: "buy", price: null, condition: "MOO" })[0]).toBe("32");
  });
});

describe("REST mappers through PyKis", () => {
  it("maps a domestic quote response", async () => {
    const kis = new PyKis({
      id: "user",
      account: "12345678-01",
      appkey: APPKEY,
      secretkey: SECRET,
      token: new KisAccessToken({
        access_token: "abc",
        token_type: "Bearer",
        access_token_token_expired: "2999-01-01 00:00:00",
        expires_in: 86400
      }),
      useWebsocket: false,
      fetcher: async () =>
        new Response(
          JSON.stringify({
            rt_cd: "0",
            msg_cd: "MCA00000",
            msg1: "OK",
            output: {
              stck_shrn_iscd: "005930",
              stck_prpr: "80000",
              acml_vol: "10",
              acml_tr_pbmn: "800000",
              hts_avls: "1000000",
              prdy_vrss_sign: "2",
              mrkt_warn_cls_code: "00",
              temp_stop_yn: "N",
              short_over_yn: "N",
              prdy_vrss: "1000",
              prdy_vrss_vol_rate: "0",
              stck_oprc: "79000",
              stck_hgpr: "81000",
              stck_lwpr: "78000",
              stck_mxpr: "100000",
              stck_llam: "60000",
              aspr_unit: "100",
              eps: "1",
              bps: "2",
              per: "3",
              pbr: "4",
              w52_hgpr: "90000",
              w52_lwpr: "60000",
              w52_hgpr_date: "20250101",
              w52_lwpr_date: "20240101"
            }
          })
        )
    });

    const quote = await kis.stock("005930", "KRX").quote();
    expect(quote.symbol).toBe("005930");
    expect(quote.price.toString()).toBe("80000");
    expect(quote.rate.toString()).toBe("1.2658227848101265823");
  });

  it("adds official headers and hashkey for UAPI POST requests", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const kis = new PyKis({
      id: "user",
      account: "12345678-01",
      appkey: APPKEY,
      secretkey: SECRET,
      token: new KisAccessToken({
        access_token: "abc",
        token_type: "Bearer",
        access_token_token_expired: "2999-01-01 00:00:00",
        expires_in: 86400
      }),
      userAgent: "official-agent",
      custType: "B",
      useWebsocket: false,
      fetcher: async (input, init) => {
        calls.push({ url: String(input), init });
        if (String(input).endsWith("/uapi/hashkey")) return new Response(JSON.stringify({ HASH: "HASHED" }));
        return new Response(JSON.stringify({ rt_cd: "0", msg_cd: "MCA00000", msg1: "OK" }));
      }
    });

    await kis.request("/uapi/domestic-stock/v1/trading/order-cash", {
      method: "POST",
      headers: { tr_id: "TTTC0012U" },
      body: { PDNO: "005930", ORD_QTY: "1", ORD_UNPR: "70000" }
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe("https://openapi.koreainvestment.com:9443/uapi/hashkey");
    expect((calls[0]?.init?.headers as Record<string, string>).appkey).toBe(APPKEY);
    expect((calls[0]?.init?.headers as Record<string, string>)["User-Agent"]).toBe("official-agent");
    const orderHeaders = calls[1]?.init?.headers as Record<string, string>;
    expect(orderHeaders.hashkey).toBe("HASHED");
    expect(orderHeaders.custtype).toBe("B");
    expect(orderHeaders.Authorization).toBe("Bearer abc");
    expect(orderHeaders.tr_id).toBe("TTTC0012U");
  });
});

describe("websocket helpers", () => {
  it("parses realtime price frames", () => {
    const parsed = parseRealtimeResponse("H0STCNT0", ["005930", "093000", "80000", "2", "1000", "1.25"]);
    expect(parsed.kind).toBe("price");
    expect(parsed.symbol).toBe("005930");
  });

  it("decrypts AES-CBC payloads", () => {
    const key = randomBytes(32);
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-cbc", key, iv);
    const encrypted = Buffer.concat([cipher.update("hello"), cipher.final()]).toString("base64");
    expect(decryptAesCbcBase64(encrypted, key, iv)).toBe("hello");
  });
});
