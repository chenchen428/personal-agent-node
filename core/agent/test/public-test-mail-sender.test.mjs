import assert from "node:assert/strict";
import test from "node:test";
import { PublicTestMailSender } from "../src/connections/mail/public-test-sender.js";

test("public test sender submits only the assigned recipient and returns correlation evidence", async () => {
  const requests = [];
  const sender = new PublicTestMailSender({
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return requests.length === 1
        ? Response.json({ id: "019f7498-da77-7000-a123-456789abcdef", token: "private-result-token", status: "Queued" }, { status: 202 })
        : Response.json({ id: "019f7498-da77-7000-a123-456789abcdef", status: "Delivered", outcome: "Delivered", smtpCode: 250 }, { status: 200 });
    },
    resolveMxImpl: async () => [{ exchange: "mx.example.com", priority: 10 }],
    sleep: async () => {},
  });
  const result = await sender.send({ recipient: "agent@owner.personal-agent.cn", marker: "must-not-be-sent" });
  assert.equal(requests[0].url, "https://testemailsender.com/api/tools/test-email/sends");
  assert.match(requests[1].url, /\/019f7498-da77-7000-a123-456789abcdef\?token=/);
  assert.deepEqual(JSON.parse(requests[0].options.body), { recipientEmail: "agent@owner.personal-agent.cn" });
  assert.equal(requests[0].options.body.includes("must-not-be-sent"), false);
  assert.deepEqual(result, { accepted: true, provider: "TestEmailSender", senderDomain: "sendtest.joltmx.com" });
  assert.equal(JSON.stringify(result).includes("private-result-token"), false);
});

test("public test sender reports rate limits without exposing provider response", async () => {
  const sender = new PublicTestMailSender({ fetchImpl: async () => Response.json({ error: "raw provider detail" }, { status: 429 }), resolveMxImpl: async () => [{ exchange: "mx.example.com" }] });
  await assert.rejects(() => sender.send({ recipient: "agent@owner.personal-agent.cn" }), (error) => {
    assert.equal(error.code, "PUBLIC_TEST_MAIL_RATE_LIMITED");
    assert.doesNotMatch(error.message, /raw provider detail/);
    return true;
  });
});

test("public test sender fails before submission when the assigned domain has no MX", async () => {
  let submitted = false;
  const sender = new PublicTestMailSender({
    fetchImpl: async () => { submitted = true; return Response.json({}); },
    resolveMxImpl: async () => [],
  });
  await assert.rejects(() => sender.send({ recipient: "agent@owner.personal-agent.cn" }), (error) => {
    assert.equal(error.code, "PUBLIC_TEST_MAIL_MX_MISSING");
    assert.match(error.message, /MX/);
    return true;
  });
  assert.equal(submitted, false);
});
