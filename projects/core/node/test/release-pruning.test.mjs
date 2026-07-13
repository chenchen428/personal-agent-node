import assert from "node:assert/strict";
import test from "node:test";
import { pruneInactiveRelease } from "../src/release-pruning.mjs";

test("defers only Windows in-use release pruning failures", () => {
  const busy = Object.assign(new Error("in use"), { code: "EBUSY" });
  const result = pruneInactiveRelease("C:\\release", { platform: "win32", remove: () => { throw busy; } });
  assert.deepEqual(result, { removed: false, deferred: true, code: "EBUSY" });
  assert.throws(() => pruneInactiveRelease("/release", { platform: "linux", remove: () => { throw busy; } }), /in use/);
});

test("reports successful inactive release pruning", () => {
  let removed = "";
  const result = pruneInactiveRelease("/release", { remove: (value) => { removed = value; } });
  assert.equal(removed, "/release");
  assert.deepEqual(result, { removed: true, deferred: false });
});
