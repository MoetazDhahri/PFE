import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  activityEventsTable,
  clientNodesTable,
  db,
  learningTracksTable,
  networkOverviewTable,
  type AgentAssessmentRow,
  type NewAgentAssessmentRow,
} from "@workspace/db";
import { logger } from "./logger";

// Runs against Groq's OpenAI-compatible chat completions API. Swapping to a
// different OpenAI-compatible provider (or Azure OpenAI in production) is a
// matter of changing GROQ_BASE_URL/GROQ_API_KEY/AGENT_MODEL, not this file.
const BASE_URL = process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1";
const MODEL = process.env.AGENT_MODEL ?? "openai/gpt-oss-120b";
const MAX_TURNS = 6;

let client: OpenAI | undefined;

function getClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY must be set to generate a real agent assessment.",
    );
  }
  client = new OpenAI({ apiKey, baseURL: BASE_URL });
  return client;
}

const SYSTEM_PROMPT = `You are the Federation Agent for a federated medical-imaging research network.

Your role and boundaries:
- You observe aggregate, non-patient telemetry for exactly one learning track. You never see raw imaging or patient-level data — only round status, per-site metrics, and an event log.
- You may only RECOMMEND an action, such as holding a site's update for review before the next aggregation. You cannot execute anything yourself; a human always makes the final approve/dismiss decision, and your recommendation has no effect until they do.
- Every item in your evidence list must be directly traceable to a tool result you actually received in this conversation. Never invent a site name, a metric value, or an event that no tool returned to you.
- This is a research and operations console, not a clinical or diagnostic tool. Never phrase anything as a diagnosis, a treatment recommendation, or a claim about patient outcomes.
- If the current telemetry looks normal, say so plainly: produce a low-impact, low-risk assessment recommending no action, rather than manufacturing a concern to seem useful. A confident "nothing needs attention right now" backed by evidence is a good outcome.
- Gather whatever evidence you need with the available tools, then call submit_assessment exactly once with your final result. Do not call submit_assessment more than once, and do not call it before you have looked at the current overview and node status at least once.`;

const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_network_overview",
      description:
        "Get the current round number, round status, global metric, and privacy budget for this track.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_client_nodes",
      description:
        "List every participating hospital node for this track, with its status (online/attention/syncing), local metric value, data volume, and privacy status.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_events",
      description: "Get the most recent activity log events for this track, newest first.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            description: "How many recent events to return (default 10).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_assessment",
      description:
        "Submit your final Action Value Card for this track. Call this exactly once, after you have gathered enough evidence to support it.",
      parameters: {
        type: "object",
        required: [
          "headline",
          "summary",
          "purpose",
          "recommendation",
          "expectedValue",
          "confidence",
          "impact",
          "risk",
          "evidence",
        ],
        properties: {
          headline: { type: "string", description: "One short sentence summarizing the finding." },
          summary: { type: "string", description: "A few sentences explaining what you found and why it matters." },
          purpose: { type: "string", description: "Why this recommendation is being made, in one sentence." },
          recommendation: { type: "string", description: "The specific action you recommend a human take." },
          expectedValue: { type: "string", description: "What improvement or protection following this recommendation is expected to produce." },
          confidence: { type: "number", minimum: 0, maximum: 1, description: "Your confidence in this assessment, 0 to 1." },
          impact: { type: "string", enum: ["Low", "Moderate", "High"] },
          risk: { type: "string", enum: ["Low", "Moderate", "High"] },
          evidence: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            description: "Specific, tool-sourced facts that support the recommendation.",
          },
        },
      },
    },
  },
];

const QA_TOOLS = TOOLS.filter((tool) => tool.type === "function" && tool.function.name !== "submit_assessment");
const QA_MAX_TURNS = 3;

const EVENT_QA_SYSTEM_PROMPT = `You are the Federation Agent for a federated medical-imaging research network, answering a human operator's question about one specific logged event.

Your boundaries:
- You only see aggregate, non-patient telemetry — round status, per-site metrics, and the event log. Never invent a site name, metric value, or event that no tool returned to you.
- This is a research and operations console, not a clinical tool. Never phrase anything as a diagnosis, a treatment recommendation, or a claim about patient outcomes.
- If the available data genuinely doesn't answer the question, say so plainly instead of guessing.
- You may call the read-only lookup tools if they would help answer the question, but you don't have to — for a simple question, answering directly from the event record you were given is fine.
- Answer in a few sentences of plain text. Do not call any tool as your final action — your final response must be a plain-text answer, not a tool call.`;

const REVIEW_OUTCOME_SYSTEM_PROMPT = `You are the Federation Agent for a federated medical-imaging research network, reviewing what happened after a human operator approved or dismissed one of your earlier recommendations.

Your boundaries:
- You only see aggregate, non-patient telemetry — round status, per-site metrics, and the event log. Never invent a site name, metric value, or event that no tool returned to you.
- This is a research and operations console, not a clinical tool. Never phrase anything as a diagnosis, a treatment recommendation, or a claim about patient outcomes.
- Ground your review in the current telemetry: use the tools to check whether the site or metric your original recommendation was about has changed state since. If nothing has changed yet (e.g. the next round hasn't run), say so plainly instead of inventing an effect.
- Call review_outcome exactly once with your final result, after checking current state with at least one tool call.`;

const REVIEW_OUTCOME_TOOLS: ChatCompletionTool[] = [
  ...QA_TOOLS,
  {
    type: "function",
    function: {
      name: "review_outcome",
      description: "Submit your final review of what has been observed since the operator's decision. Call this exactly once.",
      parameters: {
        type: "object",
        required: ["observedValue", "outcome"],
        properties: {
          observedValue: {
            type: "string",
            description: "What has actually been observed in the telemetry since the decision — grounded in real tool results, not assumed.",
          },
          outcome: {
            type: "string",
            description: "A short statement of the net result of the operator's decision and what it means going forward.",
          },
        },
      },
    },
  },
];

const ReviewOutcomeSchema = z.object({
  observedValue: z.string().min(1),
  outcome: z.string().min(1),
});

// Higher than QA_MAX_TURNS: a review typically needs several lookup calls
// (overview, nodes, events) *plus* one further turn to actually submit
// review_outcome — 3 turns can be fully consumed by lookups alone, leaving
// none for the final call.
const REVIEW_MAX_TURNS = 5;

export async function reviewOutcome(
  assessment: AgentAssessmentRow,
  decision: "approved" | "dismissed",
): Promise<{ observedValue: string; outcome: string }> {
  const openai = getClient();

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: REVIEW_OUTCOME_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Here is the assessment you previously submitted for track "${assessment.trackId}":\n${JSON.stringify(
        {
          headline: assessment.headline,
          summary: assessment.summary,
          recommendation: assessment.recommendation,
          expectedValue: assessment.expectedValue,
          evidence: assessment.evidence,
        },
        null,
        2,
      )}\n\nThe human operator just ${decision === "approved" ? "approved and carried out" : "dismissed"} this recommendation. Check current telemetry and report what has actually been observed since.`,
    },
  ];

  for (let turn = 0; turn < REVIEW_MAX_TURNS; turn++) {
    const response = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 800,
      tools: REVIEW_OUTCOME_TOOLS,
      messages,
    });

    const message = response.choices[0]?.message;
    if (!message) {
      throw new Error("Agent returned no message.");
    }
    messages.push(message);

    const toolCalls = (message.tool_calls ?? []).filter(
      (call): call is Extract<typeof call, { type: "function" }> => call.type === "function",
    );
    const submission = toolCalls.find((call) => call.function.name === "review_outcome");
    if (submission) {
      return ReviewOutcomeSchema.parse(parseToolArguments(submission.function.arguments));
    }

    if (toolCalls.length === 0) {
      throw new Error(
        `Agent stopped (finish_reason=${response.choices[0]?.finish_reason}) without calling review_outcome.`,
      );
    }

    for (const call of toolCalls) {
      const input = parseToolArguments(call.function.arguments);
      logger.info({ trackId: assessment.trackId, tool: call.function.name, input }, "Agent review tool call");
      const result = await executeTool(assessment.trackId, call.function.name, input);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  throw new Error(`Agent exceeded ${REVIEW_MAX_TURNS} turns without calling review_outcome.`);
}

const SubmittedAssessmentSchema = z.object({
  headline: z.string().min(1),
  summary: z.string().min(1),
  purpose: z.string().min(1),
  recommendation: z.string().min(1),
  expectedValue: z.string().min(1),
  confidence: z.number().min(0).max(1),
  impact: z.enum(["Low", "Moderate", "High"]),
  risk: z.enum(["Low", "Moderate", "High"]),
  evidence: z.array(z.string().min(1)).min(1),
});

async function executeTool(trackId: string, name: string, input: unknown): Promise<unknown> {
  switch (name) {
    case "get_network_overview": {
      const [row] = await db
        .select()
        .from(networkOverviewTable)
        .where(eq(networkOverviewTable.trackId, trackId))
        .limit(1);
      if (!row) return { error: "No overview recorded for this track yet." };
      return { ...row, lastUpdated: row.lastUpdated.toISOString() };
    }
    case "get_client_nodes": {
      const rows = await db.select().from(clientNodesTable).where(eq(clientNodesTable.trackId, trackId));
      return rows.map((row) => ({ ...row, dbId: undefined, lastSeen: row.lastSeen.toISOString() }));
    }
    case "get_recent_events": {
      const requestedLimit = (input as { limit?: unknown } | null)?.limit;
      const limit = typeof requestedLimit === "number" && Number.isFinite(requestedLimit) ? requestedLimit : 10;
      const rows = await db
        .select()
        .from(activityEventsTable)
        .where(eq(activityEventsTable.trackId, trackId))
        .orderBy(desc(activityEventsTable.timestamp))
        .limit(Math.min(Math.max(Math.trunc(limit), 1), 50));
      return rows.map((row) => ({ ...row, timestamp: row.timestamp.toISOString() }));
    }
    default:
      return { error: `Unknown tool "${name}"` };
  }
}

function parseToolArguments(rawArguments: string): unknown {
  try {
    return JSON.parse(rawArguments);
  } catch {
    return {};
  }
}

export async function generateAssessment(trackId: string): Promise<NewAgentAssessmentRow> {
  const openai = getClient();

  const [track] = await db.select().from(learningTracksTable).where(eq(learningTracksTable.id, trackId)).limit(1);
  if (!track) {
    throw new Error(`Unknown track "${trackId}"`);
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Analyze the current state of the "${track.name}" (${track.id}) learning track. Decide whether the coordinator should hold any site's update before the next aggregation, or whether the round is safe to proceed as-is. Use the available tools to gather real evidence before deciding.`,
    },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 1500,
      tools: TOOLS,
      messages,
    });

    const message = response.choices[0]?.message;
    if (!message) {
      throw new Error("Agent returned no message.");
    }
    messages.push(message);

    const toolCalls = (message.tool_calls ?? []).filter(
      (call): call is Extract<typeof call, { type: "function" }> => call.type === "function",
    );
    const submission = toolCalls.find((call) => call.function.name === "submit_assessment");
    if (submission) {
      const parsed = SubmittedAssessmentSchema.parse(parseToolArguments(submission.function.arguments));
      const now = new Date();
      return {
        id: `assessment-${trackId}-${now.getTime()}`,
        trackId,
        headline: parsed.headline,
        summary: parsed.summary,
        purpose: parsed.purpose,
        recommendation: parsed.recommendation,
        expectedValue: parsed.expectedValue,
        observedValue: null,
        confidence: parsed.confidence,
        impact: parsed.impact,
        risk: parsed.risk,
        evidence: parsed.evidence,
        status: "pending",
        outcome: null,
        createdAt: now,
        resolvedAt: null,
      };
    }

    if (toolCalls.length === 0) {
      throw new Error(
        `Agent stopped (finish_reason=${response.choices[0]?.finish_reason}) without calling submit_assessment.`,
      );
    }

    for (const call of toolCalls) {
      const input = parseToolArguments(call.function.arguments);
      logger.info({ trackId, tool: call.function.name, input }, "Agent tool call");
      const result = await executeTool(trackId, call.function.name, input);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  throw new Error(`Agent exceeded ${MAX_TURNS} turns without submitting an assessment.`);
}

interface EventForQa {
  id: string;
  trackId: string;
  timestamp: Date;
  actor: string;
  type: string;
  title: string;
  detail: string;
  severity: string;
  round: number;
  nodeId: string | null;
}

export async function answerEventQuestion(event: EventForQa, question: string): Promise<string> {
  const openai = getClient();

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: EVENT_QA_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Here is the logged event the operator is asking about:\n${JSON.stringify(
        {
          id: event.id,
          trackId: event.trackId,
          timestamp: event.timestamp.toISOString(),
          actor: event.actor,
          type: event.type,
          title: event.title,
          detail: event.detail,
          severity: event.severity,
          round: event.round,
          nodeId: event.nodeId,
        },
        null,
        2,
      )}\n\nOperator's question: ${question}`,
    },
  ];

  for (let turn = 0; turn < QA_MAX_TURNS; turn++) {
    const response = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 800,
      tools: QA_TOOLS,
      messages,
    });

    const message = response.choices[0]?.message;
    if (!message) {
      throw new Error("Agent returned no message.");
    }
    messages.push(message);

    const toolCalls = (message.tool_calls ?? []).filter(
      (call): call is Extract<typeof call, { type: "function" }> => call.type === "function",
    );

    if (toolCalls.length === 0) {
      if (!message.content) {
        throw new Error("Agent returned an empty answer.");
      }
      return message.content;
    }

    for (const call of toolCalls) {
      const input = parseToolArguments(call.function.arguments);
      logger.info({ eventId: event.id, tool: call.function.name, input }, "Agent Q&A tool call");
      const result = await executeTool(event.trackId, call.function.name, input);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  throw new Error(`Agent exceeded ${QA_MAX_TURNS} turns without answering.`);
}
