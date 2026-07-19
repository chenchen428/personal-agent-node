import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createSpace,
  deleteSpace,
  getSpace,
  initializeInstallation,
  listSpaces,
  setSpaceDesiredState,
  updateSpaceBinding,
  updateSpaceRuntimeState,
  validateSpaceSlug,
  validateUserSlug,
} from "../src/space-registry.ts";

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-spaces-"));
}

test("installation creates exactly one opaque personal Space with the complete isolated tree", () => {
  const root = temporaryRoot();
  try {
    const { installation, personal, paths } = initializeInstallation({ dataRoot: root, now: new Date("2026-07-18T00:00:00.000Z") });
    assert.match(installation.installationId, /^ins_/);
    assert.equal(personal.kind, "personal");
    assert.equal(personal.displayName, "个人隔离空间");
    assert.equal(personal.slug, "personal");
    assert.match(path.basename(personal.root), /^sp_/);
    assert.equal(personal.root.startsWith(`${paths.spacesRoot}${path.sep}`), true);
    assert.equal(listSpaces(root).length, 1);
    for (const relative of [
      "agent-workspace/files",
      "databases/agent",
      "databases/bridge",
      "databases/activity",
      "databases/apps",
      "databases/usage",
      "secrets/applications",
      "secrets/connections",
      "connections/browser-profiles",
      "mail/spool/new",
      "pages/drafts",
      "publications/pages",
      "publications/resources",
      "apps/data",
      "logs",
      "backups",
    ]) assert.equal(fs.statSync(path.join(personal.root, relative)).isDirectory(), true, relative);
    assert.equal(fs.lstatSync(personal.root).isSymbolicLink(), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("custom Spaces have independent roots, workspaces, runtime generations and ports", () => {
  const root = temporaryRoot();
  try {
    const { personal } = initializeInstallation({ dataRoot: root });
    const work = createSpace({ dataRoot: root, slug: "work", displayName: "工作" });
    const family = createSpace({ dataRoot: root, slug: "family", displayName: "家庭" });
    assert.notEqual(work.root, personal.root);
    assert.notEqual(work.root, family.root);
    assert.notDeepEqual(work.ports, family.ports);
    fs.writeFileSync(path.join(work.root, "agent-workspace", "files", "private.txt"), "work only");
    assert.equal(fs.existsSync(path.join(family.root, "agent-workspace", "files", "private.txt")), false);
    for (const relative of [
      "databases/bridge/conversation-private.txt",
      "databases/usage/token-private.txt",
      "mail/archive/mail-private.txt",
      "pages/drafts/page-private.txt",
      "connections/provider-state/connection-private.txt",
      "apps/data/app-private.txt",
      "publications/private/site-private.txt",
      "secrets/providers/provider-private.txt",
    ]) {
      fs.writeFileSync(path.join(work.root, relative), "work only");
      assert.equal(fs.existsSync(path.join(family.root, relative)), false, relative);
    }
    const stopped = setSpaceDesiredState(root, work.id, "stopped");
    assert.equal(stopped.desiredState, "stopped");
    assert.equal(stopped.state, "stopped");
    assert.equal(stopped.runtimeGeneration, work.runtimeGeneration + 1);
    const requested = setSpaceDesiredState(root, work.id, "running");
    assert.equal(requested.desiredState, "running");
    assert.equal(requested.state, "stopped", "requesting a start must not report a process as running");
    assert.equal(updateSpaceRuntimeState(root, work.id, "running").state, "running");
    assert.equal(getSpace(root, "family")?.id, family.id);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("managed identity uses an unambiguous single-label host and matching Agent mail", () => {
  const root = temporaryRoot();
  try {
    const { personal } = initializeInstallation({ dataRoot: root });
    const custom = createSpace({ dataRoot: root, slug: "content-studio", displayName: "内容工作室" });
    const personalBinding = updateSpaceBinding({ dataRoot: root, selector: personal.id, userSlug: "alice" });
    const customBinding = updateSpaceBinding({ dataRoot: root, selector: custom.id, userSlug: "alice" });
    assert.equal(personalBinding.managedHost, "alice.personal-agent.cn");
    assert.equal(personalBinding.agentMail, "agent@alice.personal-agent.cn");
    assert.equal(customBinding.managedHost, "content-studio--alice.personal-agent.cn");
    assert.equal(customBinding.agentMail, "agent@content-studio--alice.personal-agent.cn");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("slug validation reserves double hyphen and tombstones deleted custom Spaces", () => {
  const root = temporaryRoot();
  try {
    initializeInstallation({ dataRoot: root });
    assert.throws(() => validateSpaceSlug("a--b"), /不能包含/);
    assert.throws(() => validateSpaceSlug("personal"), /保留/);
    assert.throws(() => validateUserSlug("alice--work"), /不能包含/);
    const custom = createSpace({ dataRoot: root, slug: "family", displayName: "家庭" });
    const deleted = deleteSpace(root, custom.id, { now: new Date("2026-07-18T01:00:00.000Z") });
    assert.equal(deleted.state, "deleted");
    assert.equal(fs.existsSync(custom.root), false);
    assert.equal(listSpaces(root).some((space) => space.id === custom.id), false);
    assert.equal(listSpaces(root, { includeDeleted: true }).some((space) => space.id === custom.id), true);
    assert.throws(() => createSpace({ dataRoot: root, slug: "family", displayName: "重新创建" }), /不会重新分配/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("personal Space cannot be deleted", () => {
  const root = temporaryRoot();
  try {
    const { personal } = initializeInstallation({ dataRoot: root });
    assert.throws(() => deleteSpace(root, personal.id), /不能删除/);
    assert.equal(listSpaces(root).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
