import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { pyKisOptionsFromConfig } from "../src/config.js";
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

  it("redacts key and auth values in public serialization", () => {
    const key = new KisKey("user", APPKEY, SECRET);
    const auth = new KisAuth({ id: "user", appkey: APPKEY, secretkey: SECRET, account: "12345678-01", virtual: false });

    expect(Object.keys(key)).toEqual([]);
    expect(JSON.stringify(key)).not.toContain(APPKEY);
    expect(JSON.stringify(key)).not.toContain(SECRET);
    expect(inspect(key)).not.toContain(APPKEY);
    expect(inspect(auth)).not.toContain(SECRET);
    expect(JSON.stringify(auth)).not.toContain("12345678-01");
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
    expect((await KisAccessToken.load(file)).toString()).toBe("Bearer ***");
    await rm(dir, { recursive: true, force: true });
  });

  it("redacts access tokens in string and json output", () => {
    const token = new KisAccessToken({
      access_token: "abc123456789",
      token_type: "Bearer",
      access_token_token_expired: "2999-01-01 00:00:00",
      expires_in: 86400
    });

    expect(token.toString()).toBe("Bearer abc1...6789");
    expect(JSON.stringify(token)).not.toContain("abc123456789");
    expect(inspect(token)).not.toContain("abc123456789");
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

  it("maps domestic investor trend responses", async () => {
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
      fetcher: async (input, init) => {
        const url = new URL(String(input));
        expect(url.pathname).toBe("/uapi/domestic-stock/v1/quotations/inquire-investor");
        expect(url.searchParams.get("FID_COND_MRKT_DIV_CODE")).toBe("J");
        expect(url.searchParams.get("FID_INPUT_ISCD")).toBe("005930");
        expect((init?.headers as Record<string, string>).tr_id).toBe("FHKST01010900");
        return new Response(
          JSON.stringify({
            rt_cd: "0",
            msg_cd: "MCA00000",
            msg1: "OK",
            output: [
              {
                stck_bsop_date: "20250103",
                stck_clpr: "80,000",
                prdy_vrss: "1000",
                prdy_ctrt: "1.25",
                frgn_ntby_qty: "1,000",
                orgn_ntby_qty: "-200",
                prsn_ntby_qty: "-800"
              },
              {
                stck_bsop_date: "20250102",
                stck_clpr: "79000",
                prdy_vrss: "-500",
                prdy_ctrt: "-0.63",
                frgn_ntby_qty: "300",
                orgn_ntby_qty: "100",
                prsn_ntby_qty: "-400"
              }
            ]
          })
        );
      }
    });

    const investors = await kis.stock("005930", "KRX").investors();
    expect(investors.items).toHaveLength(2);
    expect(investors.items[0]?.close.toString()).toBe("80000");
    expect(investors.foreignTotalQuantity).toBe(1300);
    expect(investors.institutionTotalQuantity).toBe(-100);
    expect(investors.individualTotalQuantity).toBe(-1200);
  });

  it("maps currency daily chart responses", async () => {
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
      fetcher: async (input, init) => {
        const url = new URL(String(input));
        expect(url.pathname).toBe("/uapi/overseas-price/v1/quotations/inquire-daily-chartprice");
        expect(url.searchParams.get("FID_COND_MRKT_DIV_CODE")).toBe("X");
        expect(url.searchParams.get("FID_INPUT_ISCD")).toBe("FX@KRWKFTC");
        expect(url.searchParams.get("FID_INPUT_DATE_1")).toBe("20250101");
        expect(url.searchParams.get("FID_INPUT_DATE_2")).toBe("20250103");
        expect(url.searchParams.get("FID_PERIOD_DIV_CODE")).toBe("D");
        expect((init?.headers as Record<string, string>).tr_id).toBe("FHKST03030100");
        return new Response(
          JSON.stringify({
            rt_cd: "0",
            msg_cd: "MCA00000",
            msg1: "OK",
            output2: [
              {
                stck_bsop_date: "20250103",
                ovrs_nmix_prpr: "1468.0000",
                ovrs_nmix_oprc: "1467.0000",
                ovrs_nmix_hgpr: "1471.1000",
                ovrs_nmix_lwpr: "1464.2000",
                acml_vol: "0"
              },
              {
                stck_bsop_date: "20250102",
                ovrs_nmix_prpr: "1465.9000",
                ovrs_nmix_oprc: "1460.0000",
                ovrs_nmix_hgpr: "1466.0000",
                ovrs_nmix_lwpr: "1455.0000",
                acml_vol: "0"
              }
            ]
          })
        );
      }
    });

    const chart = await kis.currencyDailyChart("FX@KRWKFTC", {
      start: new Date(2025, 0, 1),
      end: new Date(2025, 0, 3)
    });
    expect(chart.timezone).toBe("Asia/Seoul");
    expect(chart.bars).toHaveLength(2);
    expect(chart.bars[0]?.close.toString()).toBe("1465.9");
    expect(chart.bars[1]?.close.toString()).toBe("1468");
  });

  it("maps domestic ranking responses", async () => {
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
      fetcher: async (input, init) => {
        const url = new URL(String(input));
        expect(url.pathname).toBe("/uapi/domestic-stock/v1/ranking/market-cap");
        expect(url.searchParams.get("FID_COND_MRKT_DIV_CODE")).toBe("Q");
        expect(url.searchParams.get("FID_COND_SCR_DIV_CODE")).toBe("20174");
        expect(url.searchParams.get("FID_TRGT_CLS_CODE")).toBe("111111111");
        expect(url.searchParams.get("FID_TRGT_EXLS_CLS_CODE")).toBe("000000");
        expect((init?.headers as Record<string, string>).tr_id).toBe("FHPST01710000");
        return new Response(
          JSON.stringify({
            rt_cd: "0",
            msg_cd: "MCA00000",
            msg1: "OK",
            output: [
              {
                data_rank: "1",
                mksc_shrn_iscd: "005930",
                hts_kor_isnm: "Samsung",
                stck_prpr: "80,000",
                prdy_vrss: "1000",
                prdy_vrss_sign: "2",
                prdy_ctrt: "1.25",
                acml_vol: "1,000",
                prdy_vol: "900",
                acml_tr_pbmn: "80000000",
                lstn_stcn: "5969782550",
                vol_inrt: "11.11",
                vol_tnrt: "0.01"
              }
            ]
          })
        );
      }
    });

    const ranking = await kis.rankingMarketCap({ market: "Q" });
    expect(ranking.market).toBe("Q");
    expect(ranking.type).toBe("marketCap");
    expect(ranking.items[0]?.symbol).toBe("005930");
    expect(ranking.items[0]?.price.toString()).toBe("80000");
    expect(ranking.items[0]?.sign).toBe("rise");
    expect(ranking.items[0]?.volume).toBe(1000);
  });

  it("keeps zero-purchase domestic balances from dividing by zero", async () => {
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
            output1: [
              {
                pdno: "005930",
                prdt_name: "Samsung",
                prpr: "0",
                hldg_qty: "0",
                pchs_amt: "0",
                evlu_amt: "0",
                evlu_pfls_amt: "0",
                evlu_pfls_rt: "",
                ord_psbl_qty: "0"
              }
            ],
            output2: [{ dnca_tot_amt: "0" }]
          })
        )
    });

    const balance = await kis.account().balance("KR");
    expect(balance.profitRate.toString()).toBe("0");
    expect(balance.stocks[0]?.profitRate.toString()).toBe("0");
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

  it("parses updated domestic execution frames", () => {
    const parsed = parseRealtimeResponse("H0STCNI0", [
      "cust",
      "12345678-01",
      "000001",
      "",
      "02",
      "",
      "00",
      "",
      "005930",
      "3",
      "80000",
      "093000",
      "0",
      "",
      "1",
      "001",
      "5",
      "",
      "79000",
      "KRX",
      "01",
      "",
      "",
      "",
      "Samsung",
      "81000"
    ]);

    expect(parsed.kind).toBe("execution");
    expect(parsed.account).toBe("12345678-01");
    expect(parsed.type).toBe("buy");
    expect(parsed.symbol).toBe("005930");
    expect(parsed.orderExchangeCode).toBe("KRX");
    expect(parsed.unitPrice).toBe("81000");
  });

  it("decrypts AES-CBC payloads", () => {
    const key = randomBytes(32);
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-cbc", key, iv);
    const encrypted = Buffer.concat([cipher.update("hello"), cipher.final()]).toString("base64");
    expect(decryptAesCbcBase64(encrypted, key, iv)).toBe("hello");
  });
});
