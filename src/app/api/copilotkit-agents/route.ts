import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";

// PeerReview.ai talks to two AG-UI agents served by the FastAPI process on
// :8123 — the Phase 1 setup agent and the Phase 2 review agent. Each is a
// LangGraph agent that emits A2UI surfaces; the a2ui middleware turns the
// tool results into rendered surfaces on the canvas.
const SETUP_AGENT_URL =
  process.env.SETUP_AGENT_URL ?? "http://localhost:8123/setup";
const REVIEW_AGENT_URL =
  process.env.REVIEW_AGENT_URL ?? "http://localhost:8123/review";

const setupAgent = new HttpAgent({ url: SETUP_AGENT_URL });
const reviewAgent = new HttpAgent({ url: REVIEW_AGENT_URL });

const runtime = new CopilotRuntime({
  agents: {
    // "default" is required for hooks that don't pass an explicit agentId
    // (e.g. the root provider on pages without a chat). Alias it to setup.
    default: setupAgent,
    setup_agent: setupAgent,
    review_agent: reviewAgent,
  },
  // The agents return A2UI operations as normal tool results; the runtime's
  // a2ui middleware paints them. We do NOT inject render_a2ui as a frontend
  // tool (it would leave orphan tool calls in agent state).
  a2ui: {
    injectA2UITool: false,
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit-agents",
  mode: "single-route",
});

export { handler as POST };
