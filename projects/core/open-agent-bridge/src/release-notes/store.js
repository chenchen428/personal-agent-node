import fs from "node:fs";
import path from "node:path";

const releaseIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const commitPattern = /^[0-9a-f]{7,40}$/i;

export class ReleaseNotesStore {
  constructor({ rootDir }) {
    this.rootDir = path.resolve(rootDir);
    this.indexPath = path.join(this.rootDir, "index.json");
    this.releasesDir = path.join(this.rootDir, "releases");
  }

  list() {
    if (!fs.existsSync(this.indexPath)) return [];
    let value;
    try {
      value = JSON.parse(fs.readFileSync(this.indexPath, "utf8"));
    } catch {
      throw new Error("Release Notes index is invalid");
    }
    if (value?.schemaVersion !== 1 || !Array.isArray(value.releases)) {
      throw new Error("Release Notes index is invalid");
    }
    return value.releases.map(normalizeSummary).sort((left, right) => right.releasedAt.localeCompare(left.releasedAt));
  }

  get(releaseId) {
    if (!releaseIdPattern.test(String(releaseId || ""))) return null;
    const filePath = path.join(this.releasesDir, `${releaseId}.json`);
    if (!fs.existsSync(filePath)) return null;
    let value;
    try {
      value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      throw new Error("Release Notes detail is invalid");
    }
    return normalizeRelease(value);
  }
}

function normalizeSummary(value) {
  return {
    releaseId: cleanReleaseId(value?.releaseId),
    releasedAt: cleanDate(value?.releasedAt, "releasedAt"),
    summary: cleanText(value?.summary, 500, "summary"),
    commit: cleanCommit(value?.commit),
    status: value?.status === "success" ? "success" : invalid("status"),
  };
}

function normalizeRelease(value) {
  if (value?.schemaVersion !== 1 || value?.project !== "personal-agent.local" || value?.status !== "success") {
    throw new Error("Release Notes detail is invalid");
  }
  return {
    schemaVersion: 1,
    project: "personal-agent.local",
    status: "success",
    releaseId: cleanReleaseId(value.releaseId),
    previousReleaseId: value.previousReleaseId ? cleanReleaseId(value.previousReleaseId) : "",
    commit: cleanCommit(value.commit),
    previousCommit: value.previousCommit ? cleanCommit(value.previousCommit) : "",
    versionChanged: value.versionChanged === true,
    builtAt: cleanDate(value.builtAt, "builtAt"),
    releasedAt: cleanDate(value.releasedAt, "releasedAt"),
    summary: cleanText(value.summary, 500, "summary"),
    changes: cleanList(value.changes, (change) => ({
      commit: cleanCommit(change?.commit),
      subject: cleanText(change?.subject, 240, "change subject"),
    }), "changes"),
    checks: cleanList(value.checks, (check) => cleanText(check, 240, "check"), "checks"),
    services: cleanList(value.services, (service) => cleanText(service, 120, "service"), "services"),
  };
}

function cleanList(value, normalize, label) {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error(`Release Notes ${label} is invalid`);
  return value.map(normalize);
}

function cleanReleaseId(value) {
  const text = String(value || "");
  if (!releaseIdPattern.test(text)) throw new Error("Release Notes release ID is invalid");
  return text;
}

function cleanCommit(value) {
  const text = String(value || "");
  if (!commitPattern.test(text)) throw new Error("Release Notes commit is invalid");
  return text.toLowerCase();
}

function cleanText(value, maxLength, label) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text.length > maxLength) throw new Error(`Release Notes ${label} is invalid`);
  return text;
}

function cleanDate(value, label) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw new Error(`Release Notes ${label} is invalid`);
  return date.toISOString();
}

function invalid(label) {
  throw new Error(`Release Notes ${label} is invalid`);
}
