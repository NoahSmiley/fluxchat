interface ToolUseAnnotationProps {
  toolName: string;
  input: Record<string, unknown>;
}

function formatToolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "create_task": {
      const title = (input.title as string) ?? (input.name as string) ?? "";
      const status = (input.status as string) ?? "backlog";
      return title ? `"${title}" → ${status}` : "";
    }
    case "move_task":
    case "update_task": {
      const title = (input.title as string) ?? (input.name as string) ?? (input.taskId as string) ?? "";
      const status = (input.status as string) ?? (input.column as string) ?? "";
      const label = title ? `"${title}"` : "";
      return status ? `${label} → ${status}`.trim() : label;
    }
    case "delete_task": {
      const title = (input.title as string) ?? (input.taskId as string) ?? "";
      return title ? `"${title}"` : "";
    }
    default: {
      // For unknown tools, show first string value as context
      const firstVal = Object.values(input).find((v) => typeof v === "string" && v.length > 0 && v.length < 80);
      return firstVal ? `"${firstVal}"` : "";
    }
  }
}

export function ToolUseAnnotation({ toolName, input }: ToolUseAnnotationProps) {
  const summary = formatToolSummary(toolName, input);

  return (
    <div className="orchestration-tool-use">
      <span className="orchestration-tool-tree">├──</span>
      <span className="orchestration-tool-name">[{toolName}]</span>
      {summary && <span className="orchestration-tool-summary">{summary}</span>}
    </div>
  );
}
