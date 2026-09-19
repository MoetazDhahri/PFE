import { integer, pgTable, real, serial, text, timestamp, unique } from "drizzle-orm/pg-core";

export const clientNodesTable = pgTable(
  "client_nodes",
  {
    dbId: serial("db_id").primaryKey(),
    id: text("id").notNull(),
    trackId: text("track_id").notNull(),
    name: text("name").notNull(),
    shortName: text("short_name").notNull(),
    region: text("region").notNull(),
    modality: text("modality").notNull(),
    status: text("status").notNull(),
    dataVolume: integer("data_volume").notNull(),
    localAuc: real("local_auc").notNull(),
    privacyStatus: text("privacy_status").notNull(),
    lastSeen: timestamp("last_seen", { withTimezone: true, mode: "date" }).notNull(),
    x: real("x").notNull(),
    y: real("y").notNull(),
    // SHA-256 hash of this node's real credential, checked by
    // POST /network/inference before an upload can be attributed to this
    // hospital — the raw key is never stored, only ever shown once (see
    // seed.ts / issue-node-keys.ts). Null means no key has been issued yet,
    // which the route treats as "this node can never be attributed to"
    // rather than skipping the check. Never selected into a public-facing
    // API response.
    apiKeyHash: text("api_key_hash"),
  },
  (table) => [unique().on(table.id, table.trackId)],
);

export type ClientNodeRow = typeof clientNodesTable.$inferSelect;
export type NewClientNodeRow = typeof clientNodesTable.$inferInsert;
