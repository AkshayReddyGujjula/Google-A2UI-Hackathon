import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";

// The marking agent (CopilotKit + AG-UI + A2UI). Setup/generation is plain REST
// on the same FastAPI process; only review/feedback runs through CopilotKit.
const REVIEW_AGENT_URL =
  process.env.REVIEW_AGENT_URL ?? "http://localhost:8123/review";

const reviewAgent = new HttpAgent({ url: REVIEW_AGENT_URL });

const runtime = new CopilotRuntime({
  agents: {
    default: reviewAgent,
    review_agent: reviewAgent,
  },
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
