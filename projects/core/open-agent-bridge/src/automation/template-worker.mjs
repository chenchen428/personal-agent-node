import fs from "node:fs";
import { pathToFileURL } from "node:url";

const [templatePath, inputPath, outputPath] = process.argv.slice(2);
if (!templatePath || !inputPath || !outputPath) throw new Error("template worker arguments are incomplete");
const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
globalThis.fetch = undefined;
globalThis.WebSocket = undefined;
globalThis.XMLHttpRequest = undefined;
globalThis.process = undefined;
globalThis.Buffer = undefined;
const module = await import(pathToFileURL(templatePath).href);
if (typeof module.default !== "function") throw new Error("template default export must be a function");
const output = await module.default(structuredClone(input));
fs.writeFileSync(outputPath, `${JSON.stringify(output ?? null)}\n`, { mode: 0o600 });
