"use client";

import { use, useEffect, useState } from "react";
import { AppShell } from "@/components/peerreview/AppShell";
import { MarkingView } from "@/components/peerreview/MarkingView";
import { api } from "@/lib/peerreview-api";

export default function MarkingPage({ params }: { params: Promise<{ id: string; sid: string }> }) {
  const { id, sid } = use(params);
  const [name, setName] = useState(sid);

  useEffect(() => {
    setName(sid);
    api
      .listSubmissions(id)
      .then((list) => {
        const s = list.find((x) => x.id === sid);
        if (s) setName(s.name);
      })
      .catch(() => {});
  }, [id, sid]);

  return (
    <AppShell activeId={id}>
      <MarkingView workspaceId={id} submissionId={sid} submissionName={name} />
    </AppShell>
  );
}
