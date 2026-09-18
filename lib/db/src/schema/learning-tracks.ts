import { pgTable, text } from "drizzle-orm/pg-core";

export const learningTracksTable = pgTable("learning_tracks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  modality: text("modality").notNull(),
  task: text("task").notNull(),
  model: text("model").notNull(),
  primaryMetric: text("primary_metric").notNull(),
  secondaryMetrics: text("secondary_metrics").array().notNull(),
  description: text("description").notNull(),
});

export type LearningTrackRow = typeof learningTracksTable.$inferSelect;
export type NewLearningTrackRow = typeof learningTracksTable.$inferInsert;
