import { create } from "zustand";

export const AGENT_COLORS: Record<string, string> = {
  sage: "#a78bfa",
  pixel: "#ec4899",
  atlas: "#60a5fa",
  forge: "#f97316",
  scout: "#22d3ee",
  beacon: "#facc15",
};

export type AgentStatus = "waiting" | "working" | "done";

export interface ToolUseEntry {
  name: string;
  input: Record<string, unknown>;
}

export type PipelineEvent = {
  /** Index into the message array after which this event should render */
  afterMessageIndex: number;
} & (
  | { kind: "pipeline_start" }
  | { kind: "handoff"; fromAgentId: string; toAgentId: string }
  | { kind: "tool_use"; agentId: string; name: string; input: Record<string, unknown> }
  | { kind: "complete"; summary: string }
);

interface OrchestrationState {
  active: boolean;
  pipelineAgents: string[];
  agentStatuses: Record<string, AgentStatus>;
  currentAgent: string | null;
  previousAgent: string | null;
  toolUses: ToolUseEntry[];
  summary: string;
  /** Ordered list of visual events for rendering in the message stream */
  pipelineEvents: PipelineEvent[];

  startPipeline: (agents: string[], messageCount: number) => void;
  setAgentWorking: (id: string, messageCount: number) => void;
  setAgentDone: (id: string) => void;
  addToolUse: (name: string, input: Record<string, unknown>, messageCount: number) => void;
  complete: (messageCount: number, summary?: string) => void;
  reset: () => void;
}

const initialState = {
  active: false,
  pipelineAgents: [] as string[],
  agentStatuses: {} as Record<string, AgentStatus>,
  currentAgent: null as string | null,
  previousAgent: null as string | null,
  toolUses: [] as ToolUseEntry[],
  summary: "",
  pipelineEvents: [] as PipelineEvent[],
};

export const useOrchestrationStore = create<OrchestrationState>((set) => ({
  ...initialState,

  startPipeline: (agents, messageCount) =>
    set({
      active: true,
      pipelineAgents: agents,
      agentStatuses: Object.fromEntries(agents.map((a) => [a, "waiting" as AgentStatus])),
      currentAgent: null,
      previousAgent: null,
      toolUses: [],
      summary: "",
      pipelineEvents: [{ kind: "pipeline_start", afterMessageIndex: messageCount - 1 }],
    }),

  setAgentWorking: (id, messageCount) =>
    set((s) => {
      const isHandoff = s.currentAgent !== null && s.currentAgent !== id;
      return {
        currentAgent: id,
        previousAgent: s.currentAgent,
        agentStatuses: { ...s.agentStatuses, [id]: "working" },
        pipelineEvents: isHandoff
          ? [...s.pipelineEvents, { kind: "handoff" as const, fromAgentId: s.currentAgent!, toAgentId: id, afterMessageIndex: messageCount - 1 }]
          : s.pipelineEvents,
      };
    }),

  setAgentDone: (id) =>
    set((s) => ({
      agentStatuses: { ...s.agentStatuses, [id]: "done" },
    })),

  addToolUse: (name, input, messageCount) =>
    set((s) => ({
      toolUses: [...s.toolUses, { name, input }],
      pipelineEvents: [...s.pipelineEvents, { kind: "tool_use" as const, agentId: s.currentAgent ?? "", name, input, afterMessageIndex: messageCount - 1 }],
    })),

  complete: (messageCount, summary) =>
    set((s) => {
      const completeSummary = summary ?? `${s.pipelineAgents.length} agents · ${s.toolUses.length} tool${s.toolUses.length === 1 ? "" : "s"} used`;
      return {
        active: false,
        summary: completeSummary,
        pipelineEvents: [...s.pipelineEvents, { kind: "complete" as const, summary: completeSummary, afterMessageIndex: messageCount - 1 }],
      };
    }),

  reset: () => set(initialState),
}));
