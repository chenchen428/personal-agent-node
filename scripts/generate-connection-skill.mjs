#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = path.join(root, "registry", "connections.json");
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const target = path.join(root, registry.skill.reference);
const output = render(registry);
const connectorOutputs = new Map(registry.connections.map((connection) => [
  path.join(root, connection.skillReference),
  renderConnector(connection),
]));

if (process.argv.includes("--check")) {
  const stale = [[target, output], ...connectorOutputs].filter(([file, content]) => !fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content);
  if (stale.length) {
    console.error(`Connection Skill reference is stale: ${stale.map(([file]) => path.relative(root, file)).join(", ")}`);
    process.exit(1);
  }
  validateCliSurface(registry);
  console.log(`PASS: ${registry.connections.length} connection definitions match the Skill reference`);
} else {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, output, "utf8");
  for (const [file, content] of connectorOutputs) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
  }
  console.log(`Wrote ${path.relative(root, target)} and ${connectorOutputs.size} connector references`);
}

function render(value) {
  const links = value.connections.map((connection) => `- [${connection.name}](connectors/${connection.id}.md)：${connection.summary}`).join("\n");
  return `# Connection operations\n\nConnection-specific instructions live in one reference file per connector. The authenticated Connections page reads and displays those files directly. Dynamic status comes from the runtime and never changes the declared capability surface.\n\n${links}\n`;
}

function renderConnector(connection) {
  const capabilities = connection.capabilities.map((item) => `- ${item}`).join("\n");
  const operations = connection.cli.operations.map((operation) => `| \`${operation.name}\` | ${operation.risk} | ${operation.description} |`).join("\n");
  return `# ${connection.name}\n\n${connection.skillDescription}\n\n## 能做什么\n\n${capabilities}\n\n## CLI 交互\n\n命令入口：\`${connection.cli.command}\`\n\n${connection.cli.description}\n\n| 操作 | 风险 | 说明 |\n| --- | --- | --- |\n${operations}\n`;
}

function validateCliSurface(value) {
  const cliSource = fs.readFileSync(path.join(root, "core", "agent", "bin", "pa-cli.mjs"), "utf8");
  const missing = [];
  for (const connection of value.connections.filter((item) => item.cli.command.startsWith("pa-cli "))) {
    for (const operation of connection.cli.operations) {
      for (const name of operation.name.split("|").map((item) => item.trim()).filter(Boolean)) {
        if (!cliSource.includes(`operation === "${name}"`) && !cliSource.includes(`"${name}"].includes(operation)`)) missing.push(`${connection.id}:${name}`);
      }
    }
  }
  if (missing.length > 0) {
    console.error(`Connection CLI implementation is stale: ${missing.join(", ")}`);
    process.exit(1);
  }
}
