import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
try {
  const migrations = await prisma.$queryRawUnsafe(`
    SELECT migration_name, started_at, finished_at, rolled_back_at, logs
    FROM "_prisma_migrations"
    ORDER BY started_at DESC
    LIMIT 5
  `);
  const tables = await prisma.$queryRawUnsafe(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  console.log(JSON.stringify({ migrations, tables: tables.map((row) => row.table_name) }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Migration inspection failed.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
