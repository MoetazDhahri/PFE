import { Router, type IRouter } from "express";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import {
  activityEventsTable,
  agentAssessmentsTable,
  clientNodesTable,
  db,
  learningTracksTable,
  networkOverviewTable,
  trainingRoundsTable,
  verifyNodeApiKey,
  type AgentAssessmentRow,
} from "@workspace/db";
import {
  AskAboutEventBody,
  AskAboutEventParams,
  AskAboutEventResponse,
  ClassifyChestXrayBody,
  ClassifyChestXrayResponse,
  GenerateAgentAssessmentBody,
  GenerateAgentAssessmentResponse,
  GetAgentActionHistoryQueryParams,
  GetAgentActionHistoryResponse,
  GetAgentAssessmentQueryParams,
  GetAgentAssessmentResponse,
  GetLearningTracksResponse,
  GetNetworkEventsQueryParams,
  GetNetworkEventsResponse,
  GetNetworkNodesQueryParams,
  GetNetworkNodesResponse,
  GetNetworkOverviewQueryParams,
  GetNetworkOverviewResponse,
  GetTrainingRoundsQueryParams,
  GetTrainingRoundsResponse,
  ResolveAgentActionBody,
  ResolveAgentActionParams,
  ResolveAgentActionResponse,
} from "@workspace/api-zod";
import { answerEventQuestion, generateAssessment, reviewOutcome } from "../lib/agent";
import { classifyChestXray, InvalidImageError, ModelNotAvailableError } from "../lib/inference";
import { logger } from "../lib/logger";
import { broadcastNetworkUpdate } from "../lib/realtime";

const router: IRouter = Router();

const DEFAULT_TRACK_ID = "chest-xray";

async function resolveTrackId(rawTrack: unknown): Promise<string> {
  const requested = typeof rawTrack === "string" ? rawTrack : DEFAULT_TRACK_ID;
  const [match] = await db
    .select({ id: learningTracksTable.id })
    .from(learningTracksTable)
    .where(eq(learningTracksTable.id, requested))
    .limit(1);
  if (match) return match.id;

  const [fallback] = await db.select({ id: learningTracksTable.id }).from(learningTracksTable).limit(1);
  return fallback?.id ?? DEFAULT_TRACK_ID;
}

function serializeAssessment(row: AgentAssessmentRow) {
  return {
    id: row.id,
    trackId: row.trackId,
    headline: row.headline,
    summary: row.summary,
    purpose: row.purpose,
    recommendation: row.recommendation,
    expectedValue: row.expectedValue,
    observedValue: row.observedValue,
    confidence: row.confidence,
    impact: row.impact,
    risk: row.risk,
    evidence: row.evidence,
    status: row.status,
    outcome: row.outcome,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}

router.get("/network/tracks", async (_req, res) => {
  const rows = await db.select().from(learningTracksTable);
  res.json(GetLearningTracksResponse.parse(rows));
});

router.get("/network/overview", async (req, res) => {
  const params = GetNetworkOverviewQueryParams.parse(req.query);
  const trackId = await resolveTrackId(params.track);
  const [row] = await db.select().from(networkOverviewTable).where(eq(networkOverviewTable.trackId, trackId)).limit(1);
  res.json(
    GetNetworkOverviewResponse.parse({
      ...row,
      lastUpdated: row.lastUpdated.toISOString(),
    }),
  );
});

router.get("/network/nodes", async (req, res) => {
  const params = GetNetworkNodesQueryParams.parse(req.query);
  const trackId = await resolveTrackId(params.track);
  const rows = await db.select().from(clientNodesTable).where(eq(clientNodesTable.trackId, trackId));
  res.json(
    GetNetworkNodesResponse.parse(
      rows.map((row) => ({
        ...row,
        lastSeen: row.lastSeen.toISOString(),
      })),
    ),
  );
});

router.get("/network/events", async (req, res) => {
  const params = GetNetworkEventsQueryParams.parse(req.query);
  const trackId = await resolveTrackId(params.track);
  const rows = await db
    .select()
    .from(activityEventsTable)
    .where(eq(activityEventsTable.trackId, trackId))
    .orderBy(desc(activityEventsTable.timestamp))
    .limit(params.limit);
  res.json(
    GetNetworkEventsResponse.parse(
      rows.map((row) => ({
        ...row,
        timestamp: row.timestamp.toISOString(),
      })),
    ),
  );
});

router.get("/network/training-rounds", async (req, res) => {
  const params = GetTrainingRoundsQueryParams.parse(req.query);
  const trackId = await resolveTrackId(params.track);
  const rows = await db
    .select()
    .from(trainingRoundsTable)
    .where(eq(trainingRoundsTable.trackId, trackId))
    .orderBy(trainingRoundsTable.round);
  res.json(
    GetTrainingRoundsResponse.parse(
      rows.map((row) => ({
        ...row,
        recordedAt: row.recordedAt.toISOString(),
      })),
    ),
  );
});

router.post("/network/inference", async (req, res) => {
  const { imageBase64, nodeId, nodeApiKey } = ClassifyChestXrayBody.parse(req.body);

  let buffer: Buffer;
  try {
    buffer = Buffer.from(imageBase64, "base64");
    if (buffer.length === 0) throw new Error("empty buffer");
  } catch {
    res.status(400).json({ message: "imageBase64 is not valid base64 image data." });
    return;
  }

  let node: { id: string; name: string; trackId: string } | undefined;
  if (nodeId) {
    const [match] = await db
      .select({
        id: clientNodesTable.id,
        name: clientNodesTable.name,
        trackId: clientNodesTable.trackId,
        apiKeyHash: clientNodesTable.apiKeyHash,
      })
      .from(clientNodesTable)
      .where(eq(clientNodesTable.id, nodeId))
      .limit(1);
    if (!match) {
      res.status(404).json({ message: `No hospital node found with id "${nodeId}"` });
      return;
    }
    if (!match.apiKeyHash || !nodeApiKey || !verifyNodeApiKey(nodeApiKey, match.apiKeyHash)) {
      res.status(403).json({
        message: `Missing or invalid API key for hospital node "${nodeId}". This upload cannot be attributed to that site without its real credential.`,
      });
      return;
    }
    node = { id: match.id, name: match.name, trackId: match.trackId };
  }

  let result;
  try {
    result = await classifyChestXray(buffer);
  } catch (err) {
    if (err instanceof ModelNotAvailableError) {
      res.status(503).json({ message: err.message });
      return;
    }
    if (err instanceof InvalidImageError) {
      res.status(400).json({ message: err.message });
      return;
    }
    throw err;
  }

  const [overview] = await db
    .select({ modelVersion: networkOverviewTable.modelVersion, round: networkOverviewTable.round })
    .from(networkOverviewTable)
    .where(eq(networkOverviewTable.trackId, "chest-xray"))
    .limit(1);

  if (node) {
    const now = new Date();
    await db
      .update(clientNodesTable)
      .set({ dataVolume: sql`${clientNodesTable.dataVolume} + 1`, lastSeen: now })
      .where(eq(clientNodesTable.id, node.id));

    await db.insert(activityEventsTable).values({
      id: `${node.trackId}-upload-${now.getTime()}`,
      trackId: node.trackId,
      timestamp: now,
      actor: node.name,
      type: "client",
      title: `New chest X-ray assigned to ${node.name}`,
      detail: `An uploaded image was classified (${result.prediction}, ${Math.round(result.confidence * 100)}% confidence) and added to this site's local data. The image itself was not stored — only this record.`,
      severity: "info",
      round: overview?.round ?? 0,
      nodeId: node.id,
    });

    broadcastNetworkUpdate(node.trackId);
  }

  res.json(
    ClassifyChestXrayResponse.parse({
      ...result,
      modelVersion: overview?.modelVersion ?? "unknown",
      assignedNodeId: node?.id ?? null,
      assignedNodeName: node?.name ?? null,
    }),
  );
});

router.post("/network/events/:eventId/ask", async (req, res) => {
  const { eventId } = AskAboutEventParams.parse(req.params);
  const { question } = AskAboutEventBody.parse(req.body);

  const [event] = await db.select().from(activityEventsTable).where(eq(activityEventsTable.id, eventId)).limit(1);
  if (!event) {
    res.status(404).json({ message: `No event found with id "${eventId}"` });
    return;
  }

  const answer = await answerEventQuestion(event, question);
  res.json(
    AskAboutEventResponse.parse({
      eventId,
      question,
      answer,
      answeredAt: new Date().toISOString(),
    }),
  );
});

router.get("/network/agent/assessment", async (req, res) => {
  const params = GetAgentAssessmentQueryParams.parse(req.query);
  const trackId = await resolveTrackId(params.track);
  const [row] = await db
    .select()
    .from(agentAssessmentsTable)
    .where(eq(agentAssessmentsTable.trackId, trackId))
    .orderBy(desc(agentAssessmentsTable.createdAt))
    .limit(1);
  res.json(GetAgentAssessmentResponse.parse(serializeAssessment(row)));
});

router.post("/network/agent/assessments", async (req, res) => {
  const { track } = GenerateAgentAssessmentBody.parse(req.body);
  const trackId = await resolveTrackId(track);

  const [latest] = await db
    .select()
    .from(agentAssessmentsTable)
    .where(eq(agentAssessmentsTable.trackId, trackId))
    .orderBy(desc(agentAssessmentsTable.createdAt))
    .limit(1);

  if (latest && latest.status === "pending") {
    res.json(GenerateAgentAssessmentResponse.parse(serializeAssessment(latest)));
    return;
  }

  const generated = await generateAssessment(trackId);
  await db.insert(agentAssessmentsTable).values(generated);
  broadcastNetworkUpdate(trackId);
  res.json(GenerateAgentAssessmentResponse.parse(serializeAssessment(generated as AgentAssessmentRow)));
});

router.get("/network/agent/history", async (req, res) => {
  const params = GetAgentActionHistoryQueryParams.parse(req.query);
  const trackId = await resolveTrackId(params.track);
  const rows = await db
    .select()
    .from(agentAssessmentsTable)
    .where(and(eq(agentAssessmentsTable.trackId, trackId), ne(agentAssessmentsTable.status, "pending")))
    .orderBy(desc(agentAssessmentsTable.resolvedAt));
  res.json(GetAgentActionHistoryResponse.parse(rows.map(serializeAssessment)));
});

router.post("/network/actions/:actionId/resolve", async (req, res) => {
  const { actionId } = ResolveAgentActionParams.parse(req.params);
  const { decision } = ResolveAgentActionBody.parse(req.body);

  const [existing] = await db.select().from(agentAssessmentsTable).where(eq(agentAssessmentsTable.id, actionId)).limit(1);
  if (!existing) {
    res.status(404).json({ message: `No agent action found with id "${actionId}"` });
    return;
  }

  let observedValue: string;
  let outcome: string;
  try {
    ({ observedValue, outcome } = await reviewOutcome(existing, decision));
  } catch (err) {
    logger.error({ actionId, err }, "Agent review call failed");
    res.status(502).json({ message: "The Federation Agent could not complete its review of this decision. Try again shortly." });
    return;
  }
  const resolvedAt = new Date();

  await db
    .update(agentAssessmentsTable)
    .set({ status: decision, resolvedAt, observedValue, outcome })
    .where(eq(agentAssessmentsTable.id, actionId));

  broadcastNetworkUpdate(existing.trackId);

  const response = {
    actionId,
    decision,
    resolvedAt: resolvedAt.toISOString(),
    observedValue,
    outcome,
    message:
      decision === "approved"
        ? "Recommendation approved and recorded. The agent's review of the outcome is above."
        : "Recommendation dismissed. The assessment and its evidence remain in the audit trail.",
  };
  res.json(ResolveAgentActionResponse.parse(response));
});

export default router;
