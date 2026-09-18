import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const activityEventsTable = pgTable("activity_events", {
  id: text("id").primaryKey(),
  trackId: text("track_id").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true, mode: "date" }).notNull(),
  actor: text("actor").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  severity: text("severity").notNull(),
  round: integer("round").notNull(),
  nodeId: text("node_id"),
});

export type ActivityEventRow = typeof activityEventsTable.$inferSelect;
export type NewActivityEventRow = typeof activityEventsTable.$inferInsert;
