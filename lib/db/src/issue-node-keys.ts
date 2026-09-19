import { eq, isNull } from "drizzle-orm";
import { db, pool } from "./index";
import { generateNodeApiKey, hashNodeApiKey } from "./node-auth";
import { clientNodesTable } from "./schema";

// One-off backfill for databases seeded before per-hospital API keys
// existed (see schema/client-nodes.ts's apiKeyHash column). Safe to
// re-run: only issues a key to a site id that doesn't already have one.
// Fresh databases don't need this — lib/db/src/seed.ts issues keys at
// seed time.

async function issueMissingNodeKeys() {
  const rows = await db
    .select({ id: clientNodesTable.id })
    .from(clientNodesTable)
    .where(isNull(clientNodesTable.apiKeyHash));

  const siteIds = [...new Set(rows.map((row) => row.id))];
  if (siteIds.length === 0) {
    console.log("Every site already has an API key. Nothing to do.");
    return;
  }

  console.log("Hospital API keys (shown once — store these now):");
  for (const siteId of siteIds) {
    const rawKey = generateNodeApiKey();
    const apiKeyHash = hashNodeApiKey(rawKey);
    await db.update(clientNodesTable).set({ apiKeyHash }).where(eq(clientNodesTable.id, siteId));
    console.log(`  ${siteId}: ${rawKey}`);
  }
}

issueMissingNodeKeys()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
