import { db, pool } from "./index";
import {
  activityEventsTable,
  agentAssessmentsTable,
  clientNodesTable,
  learningTracksTable,
  networkOverviewTable,
  type NewActivityEventRow,
  type NewAgentAssessmentRow,
  type NewClientNodeRow,
  type NewLearningTrackRow,
  type NewNetworkOverviewRow,
} from "./schema";

const tracks: NewLearningTrackRow[] = [
  {
    id: "chest-xray",
    name: "Chest X-ray classification",
    modality: "Chest radiography",
    task: "Binary classification",
    model: "DenseNet-121 with FedAvg",
    primaryMetric: "AUROC",
    secondaryMetrics: ["AUPRC", "Sensitivity", "Specificity"],
    description:
      "Detect a target finding across heterogeneous chest X-ray collections while keeping image data at each hospital.",
  },
  {
    id: "brain-mri",
    name: "Brain MRI segmentation",
    modality: "Magnetic resonance imaging",
    task: "Semantic segmentation",
    model: "3D U-Net with FedProx",
    primaryMetric: "Dice score",
    secondaryMetrics: ["IoU", "Hausdorff 95", "Sensitivity"],
    description:
      "Learn voxel-level tumor boundaries across scanners and acquisition protocols without centralizing MRI volumes.",
  },
  {
    id: "ct-lesion",
    name: "CT lesion detection",
    modality: "Computed tomography",
    task: "Object detection",
    model: "RetinaNet with FedOpt",
    primaryMetric: "mAP@0.5",
    secondaryMetrics: ["Sensitivity", "False positives/scan", "Recall"],
    description:
      "Find and localize suspicious lesions across distributed CT cohorts with site-aware evaluation.",
  },
];

const siteDefinitions = [
  ["St. Mary's Imaging", "SMI", "London", "Radiology", 12480],
  ["Northstar Medical", "NMR", "Toronto", "Radiology", 10920],
  ["Helix University", "HUX", "Boston", "Academic", 8760],
  ["Koru Health Network", "KOR", "Auckland", "Hospital", 7340],
  ["Sundial Research", "SUN", "Copenhagen", "Research", 6420],
  ["MediNova Institute", "MNI", "Berlin", "Academic", 11880],
  ["Pacific Clinical Lab", "PCL", "Seattle", "Research", 9560],
  ["Atlas Care Group", "ATC", "Nairobi", "Hospital", 5280],
  ["Sakura Diagnostics", "SDK", "Tokyo", "Radiology", 13420],
  ["Meridian Health", "MER", "São Paulo", "Hospital", 8120],
] as const;

function nodesForTrack(trackId: string, now: Date): NewClientNodeRow[] {
  const aucOffset = trackId === "brain-mri" ? -0.05 : trackId === "ct-lesion" ? -0.09 : 0;
  return siteDefinitions.map(([name, shortName, region, modality, dataVolume], index) => {
    const status = index === 3 ? "attention" : index === 7 ? "syncing" : "online";
    const localAuc = Number((0.86 + (index % 4) * 0.018 + aucOffset).toFixed(3));
    return {
      id: `site-${index + 1}`,
      trackId,
      name,
      shortName,
      region,
      modality,
      status,
      dataVolume,
      localAuc,
      privacyStatus: index === 3 ? "review" : "protected",
      lastSeen: new Date(now.getTime() - index * 71000),
      x: 14 + ((index * 19) % 75),
      y: 17 + ((index * 31) % 66),
    };
  });
}

function overviewForTrack(track: NewLearningTrackRow, now: Date): NewNetworkOverviewRow {
  const metric =
    track.id === "brain-mri"
      ? { auc: 0.781, accuracy: 0.746 }
      : track.id === "ct-lesion"
        ? { auc: 0.714, accuracy: 0.693 }
        : { auc: 0.912, accuracy: 0.884 };
  return {
    trackId: track.id,
    networkName: "Atlas Federated Imaging Network",
    round: 12,
    roundStatus: "Awaiting review",
    connectedSites: 8,
    totalSites: 10,
    globalAuc: metric.auc,
    globalAccuracy: metric.accuracy,
    privacyBudget: 2.4,
    privacyStatus: "Within budget",
    modelVersion: track.id === "chest-xray" ? "cxr-v0.12" : `${track.id}-v0.12`,
    lastUpdated: new Date(now.getTime() - 42000),
  };
}

function eventsForTrack(track: NewLearningTrackRow, now: Date): NewActivityEventRow[] {
  return [
    {
      id: `${track.id}-event-1`,
      trackId: track.id,
      timestamp: new Date(now.getTime() - 42000),
      actor: "Coordinator",
      type: "aggregation",
      title: `Round 12 update aggregated for ${track.name}`,
      detail: "8 of 10 encrypted client updates passed validation and were included in the global model.",
      severity: "success",
      round: 12,
      nodeId: null,
    },
    {
      id: `${track.id}-event-2`,
      trackId: track.id,
      timestamp: new Date(now.getTime() - 136000),
      actor: "Federation Agent",
      type: "assessment",
      title: "Site 04 shows elevated validation loss",
      detail: "Validation loss is 18.4% above the site baseline. The agent recommends holding this update for review.",
      severity: "warning",
      round: 12,
      nodeId: "site-4",
    },
    {
      id: `${track.id}-event-3`,
      trackId: track.id,
      timestamp: new Date(now.getTime() - 278000),
      actor: "Site 08",
      type: "client",
      title: "Local update received from Atlas Care Group",
      detail: "Local training completed with gradient clipping applied. Raw imaging data remained on site.",
      severity: "info",
      round: 12,
      nodeId: "site-8",
    },
    {
      id: `${track.id}-event-4`,
      trackId: track.id,
      timestamp: new Date(now.getTime() - 412000),
      actor: "Privacy Guard",
      type: "privacy",
      title: "Secure aggregation threshold verified",
      detail: "Minimum participation threshold met. Individual client updates cannot be reconstructed from the aggregate.",
      severity: "success",
      round: 12,
      nodeId: null,
    },
    {
      id: `${track.id}-event-5`,
      trackId: track.id,
      timestamp: new Date(now.getTime() - 598000),
      actor: "Coordinator",
      type: "round",
      title: "Round 12 opened for client contributions",
      detail: `The ${track.task.toLowerCase()} experiment is using ${track.model}.`,
      severity: "info",
      round: 12,
      nodeId: null,
    },
  ];
}

function assessmentsForTrack(track: NewLearningTrackRow, now: Date): NewAgentAssessmentRow[] {
  const metric =
    track.id === "brain-mri"
      ? "Dice score fell 6.2 points at Site 04"
      : track.id === "ct-lesion"
        ? "false positives increased by 11% at Site 04"
        : "validation loss increased 18.4% at Site 04";
  return [
    {
      id: `assessment-${track.id}-r10`,
      trackId: track.id,
      headline: "Site 08 flagged for a stale update, recommendation dismissed",
      summary: "Site 08's update arrived after the round window closed. The agent recommended excluding it from round 10.",
      purpose: "Avoid aggregating a stale update computed against an outdated global model version.",
      recommendation: "Exclude Site 08's late update from round 10 and let it rejoin at round 11.",
      expectedValue: "Excluding the stale update was expected to avoid a small negative pull on the aggregate from staleness bias.",
      observedValue: "The human reviewer included Site 08's update anyway after confirming the delay was a monitoring artifact, not real staleness. No measurable impact on the aggregate was observed.",
      confidence: 0.71,
      impact: "Low",
      risk: "Low",
      evidence: [
        "Site 08's update timestamp was 4 minutes past the round window",
        "Site 08 contributes 6.4% of typical update volume",
      ],
      status: "dismissed",
      outcome: "Recommendation dismissed. Site 08's update was included after manual verification; the assessment remains in the audit trail.",
      createdAt: new Date(now.getTime() - 172_800_000),
      resolvedAt: new Date(now.getTime() - 172_750_000),
    },
    {
      id: `assessment-${track.id}-r11`,
      trackId: track.id,
      headline: "Round 11 aggregation cleared without exceptions",
      summary: `All 10 sites contributed within their expected variance band for ${track.name}; no outlier evidence was found.`,
      purpose: "Confirm the round was safe to aggregate without holding any site's update.",
      recommendation: "Proceed with FedAvg-weighted aggregation across all 10 sites.",
      expectedValue: `Global ${track.primaryMetric} should continue its round-over-round improvement with no site held back.`,
      observedValue: `Global ${track.primaryMetric} improved as expected and every site's local metric stayed within one standard deviation of the mean.`,
      confidence: 0.97,
      impact: "Low",
      risk: "Low",
      evidence: [
        "No site exceeded the validation-loss outlier threshold",
        "10 of 10 sites reported within the round window",
        "Secure aggregation threshold satisfied with full participation",
      ],
      status: "approved",
      outcome: "Recommendation followed. Round 11 aggregated on schedule with no held sites.",
      createdAt: new Date(now.getTime() - 86_400_000),
      resolvedAt: new Date(now.getTime() - 86_350_000),
    },
    {
      id: `assessment-${track.id}`,
      trackId: track.id,
      headline: "One site needs review before the next aggregation",
      summary: `The agent found a track-specific outlier: ${metric}. Other sites remain within their expected variance band.`,
      purpose: "Prevent a degraded local update from being folded into the shared model before a human reviews the underlying cause.",
      recommendation: "Hold Site 04's update, continue with the remaining validated clients, and request a local data-quality review.",
      expectedValue: `Following this recommendation is expected to keep global ${track.primaryMetric} within its current trend line and avoid re-training if Site 04's data quality issue turns out to be real.`,
      observedValue: null,
      confidence: 0.93,
      impact: "High",
      risk: "Moderate",
      evidence: [
        `${metric} compared with the previous two rounds`,
        "Site 04 contributes 8.1% of the current update volume",
        "Secure aggregation threshold remains satisfied with 8 active sites",
      ],
      status: "pending",
      outcome: null,
      createdAt: new Date(now.getTime() - 91000),
      resolvedAt: null,
    },
  ];
}

async function seed() {
  const existing = await db.select().from(learningTracksTable).limit(1);
  if (existing.length > 0) {
    console.log("Database already seeded (learning_tracks is non-empty) — skipping.");
    return;
  }

  const now = new Date();
  await db.insert(learningTracksTable).values(tracks);
  for (const track of tracks) {
    await db.insert(clientNodesTable).values(nodesForTrack(track.id, now));
    await db.insert(networkOverviewTable).values(overviewForTrack(track, now));
    await db.insert(activityEventsTable).values(eventsForTrack(track, now));
    await db.insert(agentAssessmentsTable).values(assessmentsForTrack(track, now));
  }
  console.log(`Seeded ${tracks.length} tracks with nodes, overview, events, and agent assessments.`);
}

seed()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
