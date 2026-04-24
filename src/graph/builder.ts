import {
  END,
  START,
  StateGraph,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import type { ChatOpenAI } from "@langchain/openai";

import { runBudgetAgent } from "../agents/budget.agent.js";
import { runDestinationAgent } from "../agents/destination.agent.js";
import { runFormCompleter } from "../agents/form-completer.agent.js";
import {
  runItineraryAgent,
  type ItineraryAgentDependencies,
} from "../agents/itinerary.agent.js";
import { runPackingAgent } from "../agents/packing.agent.js";
import { runPlanSynthesizerAgent } from "../agents/plan-synthesizer.agent.js";
import { runPreferenceAgent } from "../agents/preference.agent.js";
import { runRequirementParser } from "../agents/requirement-parser.agent.js";
import { runRiskGuardAgent } from "../agents/risk-guard.agent.js";
import { createPlanningModel } from "../config/models.js";
import { createPostgresCheckpointer } from "../persistence/checkpointer.js";
import {
  routeFromFormCompleter,
  routeFromRiskGuard,
  routeFromStart,
  routeFromSupervisor,
  runSupervisorNode,
} from "./routes.js";
import { PlannerStateAnnotation } from "./state.js";

export type PlannerGraphDependencies = {
  model?: ChatOpenAI;
  checkpointer?: BaseCheckpointSaver;
  itineraryAgentDependencies?: ItineraryAgentDependencies;
};

export const buildPlannerGraph = async (
  deps: PlannerGraphDependencies = {},
) => {
  const model = deps.model ?? createPlanningModel();
  const checkpointer = deps.checkpointer ?? (await createPostgresCheckpointer());

  const graphBuilder = new StateGraph(PlannerStateAnnotation)
    .addNode("risk_guard", runRiskGuardAgent)
    .addNode("supervisor", runSupervisorNode)
    .addNode("preference_agent", (state) => runPreferenceAgent(state, { model }))
    .addNode("destination_agent", (state) => runDestinationAgent(state, { model }))
    .addNode("itinerary_agent", (state) =>
      runItineraryAgent(state, deps.itineraryAgentDependencies),
    )
    .addNode("budget_agent", runBudgetAgent)
    .addNode("packing_agent", runPackingAgent)
    .addNode("plan_synthesizer", runPlanSynthesizerAgent)
    .addNode("requirement_parser", (state) => runRequirementParser(state, { model }))
    .addNode("form_completer", runFormCompleter)
    .addConditionalEdges(START, routeFromStart)
    .addEdge("requirement_parser", "form_completer")
    .addConditionalEdges("form_completer", routeFromFormCompleter)
    .addConditionalEdges("risk_guard", routeFromRiskGuard)
    .addConditionalEdges("supervisor", routeFromSupervisor)
    .addEdge("preference_agent", "risk_guard")
    .addEdge("destination_agent", "risk_guard")
    .addEdge("itinerary_agent", "risk_guard")
    .addEdge("budget_agent", "risk_guard")
    .addEdge("packing_agent", "risk_guard")
    .addEdge("plan_synthesizer", END);

  return graphBuilder.compile({
    checkpointer,
    name: "navi-go-planner",
  });
};

export type PlannerCompiledGraph = Awaited<ReturnType<typeof buildPlannerGraph>>;
