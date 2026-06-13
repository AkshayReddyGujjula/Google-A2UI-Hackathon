"use client";

import { CopilotKit } from "@copilotkit/react-core/v2";
import { createMirrorActivityRenderer } from "@/a2ui/MirrorRenderer";

/* Both PeerReview agents emit A2UI surfaces via activity messages. We intercept
 * them with the mirror renderer and forward them to the page-level
 * SurfaceCanvas, so the marking cockpit renders at full canvas size instead of
 * as a chat bubble. The pill left in chat is the "surface → rendered" handoff. */
const RENDERERS = [
  createMirrorActivityRenderer("setup_agent"),
  createMirrorActivityRenderer("review_agent"),
  createMirrorActivityRenderer("default"),
];

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit-agents"
      renderActivityMessages={RENDERERS}
      showDevConsole={false}
    >
      {children}
    </CopilotKit>
  );
}
