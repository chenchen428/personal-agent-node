import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** A complete release file set is evidence for discovery exclusion, never for deletion. */
export function matchesLegacySkill(directory, baseline) {
  if (!baseline?.files || !fs.lstatSync(directory, { throwIfNoEntry: false })?.isDirectory()) return false;
  const actual = new Map();
  try {
    function visit(current, prefix = "") {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const file = path.join(current, entry.name);
        if (entry.isSymbolicLink()) throw new Error("unowned link");
        if (entry.isDirectory()) visit(file, relative);
        else if (entry.isFile()) {
          const bytes = fs.readFileSync(file);
          actual.set(relative, { bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
        } else throw new Error("unsupported file");
      }
    }
    visit(directory);
    const expected = Object.entries(baseline.files);
    return actual.size === expected.length && expected.every(([name, value]) => {
      const record = actual.get(name);
      return record?.bytes === value.bytes && record.sha256 === value.sha256;
    });
  } catch { return false; }
}

export function readLegacyBaselines(releaseRoot) {
  if (!releaseRoot) return new Map();
  const file = path.join(releaseRoot, "registry", "legacy-builtin-skills.json");
  if (!fs.existsSync(file)) return new Map();
  const document = JSON.parse(fs.readFileSync(file, "utf8"));
  if (document.schemaVersion !== 1 || !Array.isArray(document.skills)) throw new Error("Unsupported legacy skill baseline");
  return new Map(document.skills.map((entry) => [entry.directory, entry]));
}
