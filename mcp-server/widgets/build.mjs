/**
 * Widget build script — copies widgets to assets/ directory.
 * In production you'd compile React+FluentUI here.
 * For now, widgets are self-contained HTML files.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname);
const DEST = path.resolve(__dirname, "..", "assets");

if (!fs.existsSync(DEST)) fs.mkdirSync(DEST, { recursive: true });

const htmlFiles = fs.readdirSync(SRC).filter((f) => f.endsWith(".html"));
for (const file of htmlFiles) {
  fs.copyFileSync(path.join(SRC, file), path.join(DEST, file));
  console.log(`  OK ${file} -> assets/${file}`);
}
console.log(`\n  ${htmlFiles.length} widget(s) built to assets/\n`);
