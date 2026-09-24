import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function databasePlan(env) {
  const url = env.DATABASE_URL || "";
  if (url.startsWith("file:")) return { provider: "sqlite", schema: "prisma/schema.prisma" };
  if (/^postgres(?:ql)?:\/\//.test(url)) {
    if (!/^postgres(?:ql)?:\/\//.test(env.DIRECT_URL || "")) throw new Error("Neon setup requires DIRECT_URL (the unpooled PostgreSQL connection string).");
    return { provider: "postgresql", schema: "prisma/neon/schema.prisma" };
  }
  throw new Error("Set DATABASE_URL to a file: SQLite URL or PostgreSQL connection string. Do not share database passwords.");
}

function runNode(args) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit", env: process.env });
  if (result.error) throw new Error("Database command could not start.");
  if (result.status !== 0) process.exit(result.status || 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const plan = databasePlan(process.env);
    const mode = process.argv[2] || "setup";
    if (!["setup", "generate", "init", "validate"].includes(mode)) throw new Error("Unknown database setup command.");
    const prismaCli = fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url));
    console.info(`Database mode: ${plan.provider}`);
    if (mode === "validate") runNode([prismaCli, "validate", "--schema", plan.schema]);
    if (mode === "setup" || mode === "generate") runNode([prismaCli, "generate", "--schema", plan.schema]);
    if (mode === "setup" || mode === "init") {
      if (plan.provider === "sqlite") runNode(["scripts/init-dev-db.mjs"]);
      else runNode([prismaCli, "migrate", "deploy", "--schema", plan.schema]);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Database setup failed.");
    process.exitCode = 1;
  }
}
