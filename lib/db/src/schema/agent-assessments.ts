import { pgTable, real, text, timestamp } from "drizzle-orm/pg-core";

// A row is one Action Value Card. "Current" for a track is its most recent
// row by createdAt; "history" is every row for a track whose status is no
// longer "pending". A row moves from pending to approved/dismissed exactly
// once, via the resolve endpoint — it is never deleted or re-opened.
export const agentAssessmentsTable = pgTable("agent_assessments", {
  id: text("id").primaryKey(),
  trackId: text("track_id").notNull(),
  headline: text("headline").notNull(),
  summary: text("summary").notNull(),
  purpose: text("purpose").notNull(),
  recommendation: text("recommendation").notNull(),
  expectedValue: text("expected_value").notNull(),
  observedValue: text("observed_value"),
  confidence: real("confidence").notNull(),
  impact: text("impact").notNull(),
  risk: text("risk").notNull(),
  evidence: text("evidence").array().notNull(),
  status: text("status").notNull(),
  outcome: text("outcome"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
});

export type AgentAssessmentRow = typeof agentAssessmentsTable.$inferSelect;
export type NewAgentAssessmentRow = typeof agentAssessmentsTable.$inferInsert;
