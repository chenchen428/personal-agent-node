import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("desktop and mobile chat render image previews and downloadable file cards with delivery state", () => {
  const desktop = read("core/app/src/components/desktop-v627/conversation-message-list.tsx");
  const desktopTypes = read("core/app/src/components/desktop-v627/types.ts");
  const mobile = read("core/app/src/components/mobile-current/workers.tsx");
  const mobileTypes = read("core/app/src/components/mobile-current/types.ts");
  const server = read("core/agent/src/server/server.ts");
  const transport = read("core/agent/src/channels/wechat/runtime/wechat-transport.ts");
  assert.match(desktop, /attachment\.kind === "image"/);
  assert.match(desktop, /attachment\.downloadUrl \|\| attachment\.previewUrl/);
  assert.match(desktop, /message-file-type/);
  assert.match(desktop, /formatAttachmentBytes/);
  assert.match(desktopTypes, /downloadUrl\?: string/);
  assert.match(mobile, /attachment\.kind === "image"/);
  assert.match(mobile, /attachment\.downloadUrl \|\| attachment\.previewUrl/);
  assert.match(mobile, /mobileAttachmentDeliveryLabel/);
  assert.match(mobileTypes, /downloadUrl\?: string/);
  assert.match(server, /\/api\\\/attachments\\\//);
  assert.match(server, /inspectSendableFile/);
  assert.match(server, /!image \|\| url\.searchParams\.get\("download"\) === "1"/);
  assert.doesNotMatch(transport, /Uploading \$\{label\}: \$\{filePath\}/);
  assert.doesNotMatch(transport, /Uploading[^\n]*md5=/);
});
