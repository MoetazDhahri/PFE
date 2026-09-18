import { integer, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";

export const networkOverviewTable = pgTable("network_overview", {
  trackId: text("track_id").primaryKey(),
  networkName: text("network_name").notNull(),
  round: integer("round").notNull(),
  roundStatus: text("round_status").notNull(),
  connectedSites: integer("connected_sites").notNull(),
  totalSites: integer("total_sites").notNull(),
  globalAuc: real("global_auc").notNull(),
  globalAccuracy: real("global_accuracy").notNull(),
  privacyBudget: real("privacy_budget").notNull(),
  privacyStatus: text("privacy_status").notNull(),
  modelVersion: text("model_version").notNull(),
  lastUpdated: timestamp("last_updated", { withTimezone: true, mode: "date" }).notNull(),
});

export type NetworkOverviewRow = typeof networkOverviewTable.$inferSelect;
export type NewNetworkOverviewRow = typeof networkOverviewTable.$inferInsert;
