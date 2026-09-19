import { integer, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";

// Per-round global evaluation metrics from a completed real FedAvg training
// run (ml/federation-engine/run.py's round_history). Persisted so the
// training page can chart real metric trajectories instead of a static
// illustration.
export const trainingRoundsTable = pgTable("training_rounds", {
  id: text("id").primaryKey(),
  trackId: text("track_id").notNull(),
  round: integer("round").notNull(),
  globalLoss: real("global_loss").notNull(),
  globalAccuracy: real("global_accuracy").notNull(),
  globalSensitivity: real("global_sensitivity").notNull(),
  globalSpecificity: real("global_specificity").notNull(),
  // Real (epsilon, delta)-DP guarantee at this round, computed by Opacus's
  // RDP accountant over real DP-SGD training (see
  // ml/federation-engine/train_utils.py's train_with_dp) — the weakest
  // (largest) epsilon across clients, since a federation's privacy
  // guarantee is only as strong as its least private participant. Null
  // for rounds imported before DP-SGD existed.
  privacyEpsilon: real("privacy_epsilon"),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" }).notNull(),
});

export type TrainingRoundRow = typeof trainingRoundsTable.$inferSelect;
export type NewTrainingRoundRow = typeof trainingRoundsTable.$inferInsert;
