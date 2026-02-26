import { useState, useEffect, useCallback } from "react";
import { ChevronRight, Plus, Pencil, Trash2 } from "lucide-react";
import { useChatStore } from "@/stores/chat/index.js";
import {
  getRoadmapItems,
  createRoadmapItem,
  updateRoadmapItem,
  deleteRoadmapItem,
} from "@/lib/api/index.js";
import type { RoadmapItem } from "@/types/shared.js";

type Filter = "all" | "in-progress" | "planned" | "bug" | "done";

const FILTERS: { label: string; value: Filter }[] = [
  { label: "All", value: "all" },
  { label: "In Progress", value: "in-progress" },
  { label: "Planned", value: "planned" },
  { label: "Bugs", value: "bug" },
  { label: "Done", value: "done" },
];

const STATUS_ORDER: Record<string, number> = {
  "in-progress": 0,
  bug: 1,
  planned: 2,
  done: 3,
};

const STATUS_LABELS: Record<string, string> = {
  "in-progress": "In Progress",
  planned: "Planned",
  done: "Done",
  bug: "Known Bugs",
};

const STATUS_OPTIONS: { label: string; value: RoadmapItem["status"] }[] = [
  { label: "Planned", value: "planned" },
  { label: "In Progress", value: "in-progress" },
  { label: "Done", value: "done" },
  { label: "Bug", value: "bug" },
];

function groupByStatus(items: RoadmapItem[]) {
  const groups: Record<string, RoadmapItem[]> = {};
  for (const item of items) {
    (groups[item.status] ??= []).push(item);
  }
  return Object.entries(groups).sort(
    ([a], [b]) => (STATUS_ORDER[a] ?? 99) - (STATUS_ORDER[b] ?? 99),
  );
}

export function RoadmapView() {
  const activeServerId = useChatStore((s) => s.activeServerId);
  const servers = useChatStore((s) => s.servers);
  const server = servers.find((s) => s.id === activeServerId);
  const isOwnerOrAdmin = !!(
    server && (server.role === "owner" || server.role === "admin")
  );

  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Fetch items on mount / server change
  const fetchItems = useCallback(async () => {
    if (!activeServerId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getRoadmapItems(activeServerId);
      setItems(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load roadmap");
    } finally {
      setLoading(false);
    }
  }, [activeServerId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // Delete handler
  const handleDelete = async (itemId: string) => {
    if (!activeServerId) return;
    try {
      await deleteRoadmapItem(activeServerId, itemId);
      setItems((prev) => prev.filter((i) => i.id !== itemId));
      if (expandedId === itemId) setExpandedId(null);
      if (editingId === itemId) setEditingId(null);
    } catch {
      // silently fail
    }
  };

  const filtered =
    filter === "all" ? items : items.filter((item) => item.status === filter);

  const grouped = groupByStatus(filtered);

  if (loading) {
    return (
      <div className="roadmap-view">
        <div className="roadmap-empty">Loading roadmap...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="roadmap-view">
        <div className="roadmap-empty">{error}</div>
      </div>
    );
  }

  return (
    <div className="roadmap-view">
      <div className="roadmap-banner">
        <div className="roadmap-banner-row">
          <div>
            <div className="roadmap-banner-title">flux roadmap</div>
            <div className="roadmap-banner-subtitle">
              See what we're working on, what's planned, and known issues
            </div>
          </div>
          {isOwnerOrAdmin && (
            <div className="roadmap-banner-actions">
              <button
                className="btn-primary btn-small"
                onClick={() => setShowCreateModal(true)}
              >
                <Plus size={14} />
                Add Item
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="roadmap-filters">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            className={`roadmap-filter-tab${filter === f.value ? " active" : ""}`}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="roadmap-items">
        {grouped.length === 0 && (
          <div className="roadmap-empty">No items match this filter.</div>
        )}
        {grouped.map(([status, groupItems]) => (
          <div key={status}>
            {filter === "all" && (
              <div className="roadmap-status-group-label">
                {STATUS_LABELS[status] ?? status}
              </div>
            )}
            {groupItems.map((item) => {
              const isExpanded = expandedId === item.id;
              const isEditing = editingId === item.id;
              return (
                <RoadmapCard
                  key={item.id}
                  item={item}
                  isExpanded={isExpanded}
                  isEditing={isEditing}
                  isOwnerOrAdmin={isOwnerOrAdmin}
                  onToggle={() =>
                    setExpandedId(isExpanded ? null : item.id)
                  }
                  onEdit={() => setEditingId(item.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onSave={async (data) => {
                    if (!activeServerId) return;
                    const updated = await updateRoadmapItem(
                      activeServerId,
                      item.id,
                      data,
                    );
                    setItems((prev) =>
                      prev.map((i) => (i.id === updated.id ? updated : i)),
                    );
                    setEditingId(null);
                  }}
                  onDelete={() => handleDelete(item.id)}
                />
              );
            })}
          </div>
        ))}
      </div>

      {showCreateModal && activeServerId && (
        <CreateRoadmapModal
          serverId={activeServerId}
          onClose={() => setShowCreateModal(false)}
          onCreate={(newItem) => {
            setItems((prev) => [...prev, newItem]);
            setShowCreateModal(false);
          }}
        />
      )}
    </div>
  );
}

// ── Card component ──

interface RoadmapCardProps {
  item: RoadmapItem;
  isExpanded: boolean;
  isEditing: boolean;
  isOwnerOrAdmin: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (data: {
    title?: string;
    description?: string;
    status?: string;
    category?: string;
  }) => Promise<void>;
  onDelete: () => void;
}

function RoadmapCard({
  item,
  isExpanded,
  isEditing,
  isOwnerOrAdmin,
  onToggle,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
}: RoadmapCardProps) {
  const [editTitle, setEditTitle] = useState(item.title);
  const [editDescription, setEditDescription] = useState(item.description);
  const [editStatus, setEditStatus] = useState(item.status);
  const [editCategory, setEditCategory] = useState(item.category ?? "");
  const [saving, setSaving] = useState(false);

  // Reset edit fields when entering edit mode
  useEffect(() => {
    if (isEditing) {
      setEditTitle(item.title);
      setEditDescription(item.description);
      setEditStatus(item.status);
      setEditCategory(item.category ?? "");
    }
  }, [isEditing, item]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        title: editTitle,
        description: editDescription,
        status: editStatus,
        category: editCategory || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  if (isEditing && isExpanded) {
    return (
      <div className="roadmap-card expanded roadmap-card-editing">
        <div className="field">
          <span>Title</span>
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
          />
        </div>
        <div className="field">
          <span>Description</span>
          <textarea
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            rows={3}
          />
        </div>
        <div className="field">
          <span>Status</span>
          <select
            value={editStatus}
            onChange={(e) =>
              setEditStatus(e.target.value as RoadmapItem["status"])
            }
            className="settings-select"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span>Category</span>
          <input
            type="text"
            value={editCategory}
            onChange={(e) => setEditCategory(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className="modal-actions">
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={saving || !editTitle.trim()}
            style={{ width: "auto", padding: "8px 24px" }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button className="btn-small" onClick={onCancelEdit}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`roadmap-card${isExpanded ? " expanded" : ""}`}
      onClick={onToggle}
    >
      <div className="roadmap-card-header">
        <span className="roadmap-card-title">{item.title}</span>
        <ChevronRight size={14} className="roadmap-card-chevron" />
      </div>
      <div className="roadmap-card-meta">
        <span className="roadmap-status-badge" data-status={item.status}>
          {STATUS_LABELS[item.status] ?? item.status}
        </span>
        {item.category && (
          <span className="roadmap-category-tag">{item.category}</span>
        )}
      </div>
      {isExpanded && (
        <>
          <div className="roadmap-card-description">{item.description}</div>
          {isOwnerOrAdmin && (
            <div className="roadmap-card-actions">
              <button
                className="btn-small"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
              >
                <Pencil size={12} />
                Edit
              </button>
              <button
                className="btn-small btn-danger"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                <Trash2 size={12} />
                Delete
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Create modal ──

interface CreateRoadmapModalProps {
  serverId: string;
  onClose: () => void;
  onCreate: (item: RoadmapItem) => void;
}

function CreateRoadmapModal({
  serverId,
  onClose,
  onCreate,
}: CreateRoadmapModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<RoadmapItem["status"]>("planned");
  const [category, setCategory] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const item = await createRoadmapItem(serverId, {
        title: title.trim(),
        description,
        status,
        category: category.trim() || undefined,
      });
      onCreate(item);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create item");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add Roadmap Item</h3>

        {error && <div className="auth-error">{error}</div>}

        <div className="field">
          <span>Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What are you working on?"
            autoFocus
          />
        </div>
        <div className="field">
          <span>Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Describe this item..."
          />
        </div>
        <div className="field">
          <span>Status</span>
          <select
            value={status}
            onChange={(e) =>
              setStatus(e.target.value as RoadmapItem["status"])
            }
            className="settings-select"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span>Category</span>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. Chat, Voice, UI (optional)"
          />
        </div>

        <div className="modal-actions">
          <button className="btn-small" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleCreate}
            disabled={creating || !title.trim()}
            style={{ width: "auto", padding: "8px 24px" }}
          >
            {creating ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
