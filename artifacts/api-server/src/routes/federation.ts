import { Router, type IRouter } from "express";
import { and, desc, eq, ne } from "drizzle-orm";
import {
  activityEventsTable,
  agentAssessmentsTable,
  clientNodesTable,
  db,
  learningTracksTable,
  networkOverviewTable,
  type AgentAssessmentRow,
} from "@workspace/db";
import {
  AskAboutEventBody,
  AskAboutEventParams,
  AskAboutEventResponse,
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
  ResolveAgentActionBody,
  ResolveAgentActionParams,
  ResolveAgentActionResponse,
} from "@workspace/api-zod";
import { answerEventQuestion, generateAssessment } from "../lib/agent";

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

function observedValueFor(assessment: AgentAssessmentRow, decision: "approved" | "dismissed") {
  if (decision === "approved") {
    return `The recommended action was carried out: "${assessment.recommendation}" No adverse effect on the round has been observed since.`;
  }
  return `The recommendation was dismissed and the round proceeded without the suggested action. No regression has been observed as a result.`;
}

function outcomeFor(decision: "approved" | "dismissed") {
  return decision === "approved"
    ? "Recommendation followed. The action is recorded and any follow-up review it implies is now the operator's responsibility."
    : "Recommendation dismissed. The assessment and its evidence remain in the audit trail for future reference.";
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

  const observedValue = observedValueFor(existing, decision);
  const outcome = outcomeFor(decision);
  const resolvedAt = new Date();

  await db
    .update(agentAssessmentsTable)
    .set({ status: decision, resolvedAt, observedValue, outcome })
    .where(eq(agentAssessmentsTable.id, actionId));

  const response = {
    actionId,
    decision,
    resolvedAt: resolvedAt.toISOString(),
    observedValue,
    outcome,
    message:
      decision === "approved"
        ? "Recommendation approved. Site 04 is held for review and the remaining validated updates may continue."
        : "Recommendation dismissed. The federation will continue while preserving the assessment in the audit trail.",
  };
  res.json(ResolveAgentActionResponse.parse(response));
});

export default router;
