// Builds dist/ for embed.altvivo.bio:
//   bar.js            mutable alias (Cache-Control: 5 min, set by Caddy)
//   bar.v<semver>.js  immutable, cache forever
//   bar.v<semver>.js.sri  Subresource-Integrity value for pinned embeds
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// The AltVivo logos (src/logos/*.webp, 56 px tall) are inlined as data: URLs so
// they load under every app's CSP (img-src allows data:) without another request.
const logos = Object.fromEntries(
  ["wordmark-light", "wordmark-dark"].map((n) => [
    n, `data:image/webp;base64,${readFileSync(path.join(here, "src", "logos", `${n}.webp`)).toString("base64")}`,
  ]),
);
const raw = readFileSync(path.join(here, "src", "bar.js"), "utf8");
if (!raw.includes("/*__LOGOS__*/ {}")) throw new Error("logo placeholder missing in src/bar.js");
const src = raw.replace("/*__LOGOS__*/ {}", JSON.stringify(logos));
const version = /v(\d+\.\d+\.\d+)/.exec(src)?.[1];
if (!version) throw new Error("version banner missing in src/bar.js");

const dist = path.join(here, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
writeFileSync(path.join(dist, "bar.js"), src);
writeFileSync(path.join(dist, `bar.v${version}.js`), src);
const sri = `sha384-${createHash("sha384").update(src).digest("base64")}`;
writeFileSync(path.join(dist, `bar.v${version}.js.sri`), `${sri}\n`);
console.log(`built bar.js + bar.v${version}.js (${Buffer.byteLength(src)} bytes) ${sri}`);
