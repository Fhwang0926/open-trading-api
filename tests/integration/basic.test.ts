import { describe, expect, it } from "vitest";
import { PyKis } from "../../src/index.js";

const enabled = process.env.RUN_KIS_INTEGRATION === "1";

describe.skipIf(!enabled)("KIS integration", () => {
  it("loads a quote and balance with real credentials", async () => {
    const kis = await PyKis.create({
      id: process.env.KIS_ID!,
      account: process.env.KIS_ACCOUNT!,
      appkey: process.env.KIS_APPKEY!,
      secretkey: process.env.KIS_SECRETKEY!,
      keepToken: true,
      useWebsocket: false,
      userAgent: process.env.KIS_USER_AGENT,
      custType: process.env.KIS_CUSTTYPE,
      realDomain: process.env.KIS_REAL_DOMAIN,
      virtualDomain: process.env.KIS_VIRTUAL_DOMAIN,
      realWebsocketDomain: process.env.KIS_WEBSOCKET_REAL_DOMAIN,
      virtualWebsocketDomain: process.env.KIS_WEBSOCKET_VIRTUAL_DOMAIN
    });

    const quote = await kis.stock("005930", "KRX").quote();
    expect(quote.price.gt(0)).toBe(true);

    const balance = await kis.account().balance();
    expect(balance.accountNumber).toBe(process.env.KIS_ACCOUNT);
  });
});
