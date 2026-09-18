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
  },
  (table) => [unique().on(table.id, table.trackId)],
);

export type ClientNodeRow = typeof clientNodesTable.$inferSelect;
export type NewClientNodeRow = typeof clientNodesTable.$inferInsert;
