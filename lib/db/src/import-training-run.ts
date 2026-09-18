import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { activityEventsTable, clientNodesTable, db, networkOverviewTable, pool } from "./index";

// Imports a completed real federated training run (produced by
// ml/federation-engine/run.py) and replaces this repo's seeded chest-xray
// numbers with genuinely trained ones. Site order (partition_id 0..9 ->
// site-1..site-10) matches ml/federation-engine/dataset.py's Dirichlet
// partition order and lib/db/src/seed.ts's siteDefinitions order.

const TRACK_ID = "chest-xray";

interface FinalClientResult {
  partition_id: number;
  num_examples: number;
  loss: number;
  accuracy: number;
  sensitivity: number;
  specificity: number;
}

interface ClientLabelCount {
  total: number;
  class_0_normal: number;
  class_1_pneumonia: number;
}

interface RoundHistoryEntry {
  round: number;
  global_loss: number;
  global_accuracy: number;
  global_sensitivity: number;
  global_specificity: number;
}

interface TrainingRunResults {
  generated_at: string;
  duration_seconds: number;
  device: string;
  num_clients: number;
  num_rounds: number;
  dirichlet_alpha: number;
  client_label_counts: ClientLabelCount[];
  round_history: RoundHistoryEntry[];
  final_client_results: FinalClientResult[];
  global_test_metrics: { accuracy: number; auroc: number; auprc: number; test_samples: number };
}

function loadResults(path: string): TrainingRunResults {
  return JSON.parse(readFileSync(path, "utf-8"));
}

async function importTrainingRun(resultsPath: string) {
  const results = loadResults(resultsPath);
  const now = new Date(results.generated_at);

  const accuracies = results.final_client_results.map((c) => c.accuracy);
  const mean = accuracies.reduce((a, b) => a + b, 0) / accuracies.length;
  const std = Math.sqrt(accuracies.reduce((a, b) => a + (b - mean) ** 2, 0) / accuracies.length);

  for (const client of results.final_client_results) {
    const siteId = `site-${client.partition_id + 1}`;
    const labelCounts = results.client_label_counts[client.partition_id];
    const status = client.accuracy < mean - std ? "attention" : "online";

    await db
      .update(clientNodesTable)
      .set({
        localAuc: Number(client.accuracy.toFixed(4)),
        dataVolume: labelCounts.total,
        status,
        lastSeen: now,
      })
      .where(eq(clientNodesTable.id, siteId));
  }

  await db
    .update(networkOverviewTable)
    .set({
      round: results.num_rounds,
      roundStatus: "Completed (real FedAvg run)",
      connectedSites: results.num_clients,
      totalSites: results.num_clients,
      globalAuc: Number(results.global_test_metrics.auroc.toFixed(4)),
      globalAccuracy: Number(results.global_test_metrics.accuracy.toFixed(4)),
      modelVersion: `cxr-fl-real-${results.generated_at.slice(0, 10)}`,
      lastUpdated: now,
    })
    .where(eq(networkOverviewTable.trackId, TRACK_ID));

  const lastRound = results.round_history[results.round_history.length - 1];
  await db.insert(activityEventsTable).values({
    id: `${TRACK_ID}-real-fl-run-${now.getTime()}`,
    trackId: TRACK_ID,
    timestamp: now,
    actor: "Coordinator",
    type: "aggregation",
    title: `Real FedAvg training run completed: ${results.num_rounds} rounds, ${results.num_clients} clients`,
    detail: `PyTorch + Flower on ${results.device}. Global test AUROC ${results.global_test_metrics.auroc.toFixed(3)}, AUPRC ${results.global_test_metrics.auprc.toFixed(3)} on ${results.global_test_metrics.test_samples} held-out PneumoniaMNIST test images. Final round global validation accuracy ${lastRound.global_accuracy.toFixed(3)}.`,
    severity: "success",
    round: results.num_rounds,
    nodeId: null,
  });

  console.log(`Imported real training run into track "${TRACK_ID}": AUROC ${results.global_test_metrics.auroc.toFixed(4)}, accuracy ${results.global_test_metrics.accuracy.toFixed(4)}`);
}

const resultsPath = process.argv[2];
if (!resultsPath) {
  console.error("Usage: tsx src/import-training-run.ts <path-to-results.json>");
  process.exitCode = 1;
} else {
  importTrainingRun(resultsPath)
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
