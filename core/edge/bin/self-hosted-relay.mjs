#!/usr/bin/env node
import { createSelfHostedRelay, loadSelfHostedRelayConfig } from "../src/self-hosted-relay.ts";

const config = loadSelfHostedRelayConfig();
const relay = createSelfHostedRelay({ config });
await relay.listen();
console.log(`[self-hosted-relay] listening on ${config.listenHost}:${config.listenPort} for ${config.domain}`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await relay.close();
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
await new Promise(() => {});
