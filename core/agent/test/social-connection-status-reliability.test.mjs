import assert from "node:assert/strict";
import test from "node:test";
import { OpenCliTwitterProvider } from "../src/channels/twitter/opencli-provider.js";
import { OpenCliXiaohongshuProvider } from "../src/channels/xiaohongshu/opencli-provider.js";

for (const [name, Provider] of [["Twitter", OpenCliTwitterProvider], ["Xiaohongshu", OpenCliXiaohongshuProvider]]) {
  for (const target of ["probe", "browserBridgeStatus"]) {
    for (const code of ["OPENCLI_TIMEOUT", "OPENCLI_EXECUTION_FAILED"]) {
      test(`${name} ${target} ${code} is unconfirmed and recovers on the next successful check`, async () => {
        let failure = false;
        let opens = 0;
        const runner = {
          probe: async () => ({ available: true, version: "1.8.6" }),
          browserBridgeStatus: async () => ({ ready: true, needsSetup: false, browserBridge: "connected" }),
          openBrowserSession: async () => opens++,
        };
        const success = runner[target];
        runner[target] = async () => { if (failure) throw Object.assign(new Error("private diagnostic"), { code }); return success(); };
        const provider = new Provider({ runner });
        assert.equal((await provider.status()).state, "ready");
        failure = true;
        const status = await provider.status();
        assert.equal(status.state, "degraded");
        assert.equal(status.statusLabel, "状态暂时无法确认");
        assert.equal(status.runtime[0].value, "状态待确认");
        assert.equal(status.setup, undefined);
        assert.doesNotMatch(JSON.stringify(status), /private diagnostic/);
        await assert.rejects(provider.open(), { code: "OPENCLI_NOT_READY" });
        assert.equal(opens, 0);
        failure = false;
        assert.equal((await provider.status()).state, "ready");
        assert.equal(provider.catalogStatus().state, "ready");
      });
    }
  }

  test(`${name} reports a confirmed missing browser or invalid configuration as requiring repair`, async () => {
    for (const code of ["OPENCLI_BROWSER_UNAVAILABLE", "OPENCLI_CONFIG_INVALID"]) {
      const provider = new Provider({ runner: {
        probe: async () => ({ available: true }),
        browserBridgeStatus: async () => { throw Object.assign(new Error("unavailable"), { code }); },
      } });
      const status = await provider.status();
      assert.equal(status.state, "needs_setup");
      assert.ok(status.setup.browserBridgeInstallUrl);
      await assert.rejects(provider.open(), { code: "OPENCLI_NOT_READY" });
    }
  });

  test(`${name} keeps an uninstalled runtime unavailable`, async () => {
    const provider = new Provider({ runner: { probe: async () => { throw Object.assign(new Error("missing"), { code: "OPENCLI_NOT_INSTALLED" }); } } });
    assert.equal((await provider.status()).state, "error");
    await assert.rejects(provider.open(), { code: "OPENCLI_NOT_READY" });
  });
}
