import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const routesRoot = join(root, "app", "routes");
const appLayout = readFileSync(join(routesRoot, "app.tsx"), "utf8");
const routeSources = [
  "app._index.tsx",
  "app.content.tsx",
  "app.affiliates.tsx",
  "app.affiliate-dashboard.tsx",
  "app.campaigns.tsx",
  "app.loyalty.tsx",
  "app.commission-rules.tsx",
  "app.fraud.tsx",
  "app.commissions.tsx",
].map((file) => ({ file, source: readFileSync(join(routesRoot, file), "utf8") }));

const internalTargets = new Set();
for (const match of appLayout.matchAll(/<s-link\s+href="(\/app[^"]*)"/g)) internalTargets.add(match[1]);
for (const { source } of routeSources) {
  for (const match of source.matchAll(/<Link[^>]+to="(\/app[^"]*)"/g)) internalTargets.add(match[1].split("?")[0]);
  assert.equal(/<a[^>]+href="\/app(?:[/?#]|\")/.test(source), false, "Internal app navigation must use React Router Link, not an anchor.");
}

function routeFile(target) {
  if (target === "/app") return "app._index.tsx";
  const suffix = target.slice("/app/".length).replaceAll("/", ".");
  return `app.${suffix}.tsx`;
}

for (const target of internalTargets) {
  const file = routeFile(target);
  assert.equal(existsSync(join(routesRoot, file)), true, `${target} does not resolve to ${file}.`);
}

assert.deepEqual(
  [...internalTargets].sort(),
  ["/app", "/app/affiliate-dashboard", "/app/affiliates", "/app/campaigns", "/app/commission-rules", "/app/commissions", "/app/content", "/app/fraud", "/app/loyalty"].sort(),
  "Embedded navigation is missing or contains an unexpected route.",
);

console.log(`Embedded navigation tests passed for ${internalTargets.size} routes.`);
