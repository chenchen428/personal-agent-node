import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assembleOpenCliRuntime, readOpenCliRuntimeDescriptor, verifyOpenCliRuntime } from "../scripts/lib/opencli-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("OpenCLI runtime descriptor pins a user-confirmed, non-global browser executor", () => {
  const descriptor = readOpenCliRuntimeDescriptor(root);
  assert.equal(descriptor.package, "@jackwener/opencli");
  assert.equal(descriptor.version, "1.8.6");
  assert.equal(descriptor.installScripts, false);
  assert.deepEqual(descriptor.browserBridge, {
    name: "OpenCLI Browser Bridge",
    bundled: false,
    extensionId: "ildkmabpimmkaediidaifkhjpohdnifk",
    installUrl: "https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk",
    userConfirmationRequired: true,
  });
});

test("release assembly installs the locked OpenCLI graph with lifecycle scripts disabled", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-opencli-runtime-"));
  try {
    let invocation;
    const runtime = assembleOpenCliRuntime({
      workspaceRoot: root,
      releaseRoot: temporary,
      npmInvocation: { command: "npm", prefixArgs: [] },
      stdio: "ignore",
      execute(command, args, options) {
        invocation = { command, args, options };
        const packageRoot = path.join(options.cwd, "node_modules", "@jackwener", "opencli");
        fs.mkdirSync(path.join(packageRoot, "dist", "src"), { recursive: true });
        fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ name: "@jackwener/opencli", version: "1.8.6", license: "Apache-2.0" }));
        fs.writeFileSync(path.join(packageRoot, "LICENSE"), "Apache-2.0 fixture");
        fs.writeFileSync(path.join(packageRoot, "dist", "src", "main.js"), "process.stdout.write('1.8.6\\n');\n");
      },
    });
    assert.equal(runtime.bundled, true);
    assert.deepEqual(invocation.args, ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"]);
    assert.equal(invocation.options.cwd, path.join(temporary, "core", "agent", "vendor", "opencli-runtime"));
    assert.doesNotThrow(() => verifyOpenCliRuntime({ releaseRoot: temporary }));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
