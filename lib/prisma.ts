import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

function createPrismaClient() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  // Local dev fallback — use file-based SQLite
  if (!url) {
    const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");
    const path = require("path");
    const dbPath = path.join(process.cwd(), "prisma", "dev.db");
    const adapter = new PrismaBetterSqlite3({ url: dbPath });
    return new PrismaClient({ adapter });
  }

  const client = createClient({ url, authToken });
  const adapter = new PrismaLibSQL(client);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
