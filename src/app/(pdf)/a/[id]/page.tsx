"use client";

import { use } from "react";
import { AppShell } from "@/components/peerreview/AppShell";
import { WorkspaceView } from "@/components/peerreview/WorkspaceView";

export default function AssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <AppShell activeId={id}>
      <WorkspaceView id={id} />
    </AppShell>
  );
}
