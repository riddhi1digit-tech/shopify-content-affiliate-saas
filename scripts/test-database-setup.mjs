import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { databasePlan } from "./database-setup.mjs";

assert.equal(databasePlan({ DATABASE_URL: "file:test.sqlite" }).provider, "sqlite");
assert.equal(databasePlan({ DATABASE_URL: "postgresql://test:test@host/db", DIRECT_URL: "postgresql://test:test@direct/db" }).schema, "prisma/neon/schema.prisma");
assert.throws(() => databasePlan({ DATABASE_URL: "postgresql://test:test@host/db" }), /DIRECT_URL/);
assert.throws(() => databasePlan({ DATABASE_URL: "unknown" }), /Set DATABASE_URL/);
const sqlite = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const neon = await readFile(new URL("../prisma/neon/schema.prisma", import.meta.url), "utf8");
const normalize = (value) => value.replace(/datasource db \{[\s\S]*?\}/, "").replace(/\r/g, "").trim();
assert.equal(normalize(sqlite), normalize(neon), "Database model definitions must remain aligned");
const sql = await readFile(new URL("../prisma/neon/migrations/20260917000000_initial_postgresql/migration.sql", import.meta.url), "utf8");
for (const table of [...sqlite.matchAll(/^model (\w+) \{/gm)].map((match) => match[1])) {
  assert.ok(sql.includes(`CREATE TABLE "${table}"`), `Missing PostgreSQL table ${table}`);
}
assert.ok(!sql.includes("DATETIME"));
assert.ok(sql.includes("TIMESTAMP"));
console.info("Passed: provider selection, missing/invalid configuration, schema parity, PostgreSQL migration table coverage. No database connection used.");
