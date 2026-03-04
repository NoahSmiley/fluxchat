import { useShallow } from "zustand/react/shallow";
import { useOrchestrationStore, AGENT_COLORS } from "@/stores/orchestrationStore.js";
import type { AgentStatus } from "@/stores/orchestrationStore.js";

function statusLabel(status: AgentStatus): string {
  switch (status) {
    case "working": return "WORKING";
    case "done": return "DONE";
    default: return "WAITING";
  }
}

export function OrchestrationPipeline() {
  const { pipelineAgents, agentStatuses } = useOrchestrationStore(
    useShallow((s) => ({ pipelineAgents: s.pipelineAgents, agentStatuses: s.agentStatuses })),
  );

  if (pipelineAgents.length === 0) return null;

  return (
    <div className="orchestration-pipeline">
      <div className="orchestration-pipeline-top">┌─ pipeline ─</div>
      <div className="orchestration-pipeline-body">
        │{"  "}
        {pipelineAgents.map((agent, i) => {
          const status = agentStatuses[agent] ?? "waiting";
          const color = AGENT_COLORS[agent] ?? "var(--text-secondary)";
          return (
            <span key={agent}>
              <span className="orchestration-agent-name" style={{ color }}>{agent}</span>
              {" "}
              <span className={`orchestration-status orchestration-status-${status}`}>
                [{statusLabel(status)}]
              </span>
              {i < pipelineAgents.length - 1 && <span className="orchestration-arrow"> → </span>}
            </span>
          );
        })}
      </div>
      <div className="orchestration-pipeline-bottom">└─</div>
    </div>
  );
}

interface OrchestrationCompleteFooterProps {
  summary: string;
}

export function OrchestrationCompleteFooter({ summary }: OrchestrationCompleteFooterProps) {
  return (
    <div className="orchestration-complete">
      <span className="orchestration-complete-line" />
      <span className="orchestration-complete-label">orchestration complete — {summary}</span>
      <span className="orchestration-complete-line" />
    </div>
  );
}
