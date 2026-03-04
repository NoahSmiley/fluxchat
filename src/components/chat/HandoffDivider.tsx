import { AGENT_COLORS } from "@/stores/orchestrationStore.js";

interface HandoffDividerProps {
  fromAgentId: string;
  toAgentId: string;
}

export function HandoffDivider({ fromAgentId, toAgentId }: HandoffDividerProps) {
  return (
    <div className="orchestration-handoff">
      <span className="orchestration-handoff-line" />
      <span className="orchestration-handoff-label">
        handoff{" "}
        <span style={{ color: AGENT_COLORS[fromAgentId] ?? "var(--text-secondary)" }}>{fromAgentId}</span>
        {" → "}
        <span style={{ color: AGENT_COLORS[toAgentId] ?? "var(--text-secondary)" }}>{toAgentId}</span>
      </span>
      <span className="orchestration-handoff-line" />
    </div>
  );
}
