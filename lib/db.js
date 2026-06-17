// Prisma client — lazily instantiated so importing this module during the
// Next.js build (route collection) does not require DATABASE_URL at build time.
import { PrismaClient } from "@prisma/client";

const g = globalThis;
function client() {
    if (!g.__prisma) g.__prisma = new PrismaClient();
    return g.__prisma;
}

export const prisma = new Proxy({}, {
    get(_t, prop) {
          const c = client();
          const v = c[prop];
          return typeof v === "function" ? v.bind(c) : v;
    },
});
