import type { RoadmapItem } from "@/types/shared.js";

import { request } from "./base.js";

// ── Roadmap ──

export async function getRoadmapItems(serverId: string) {
  return request<RoadmapItem[]>(`/servers/${serverId}/roadmap`);
}

export async function createRoadmapItem(
  serverId: string,
  data: {
    title: string;
    description?: string;
    status?: string;
    category?: string;
  },
) {
  return request<RoadmapItem>(`/servers/${serverId}/roadmap`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateRoadmapItem(
  serverId: string,
  itemId: string,
  data: {
    title?: string;
    description?: string;
    status?: string;
    category?: string;
  },
) {
  return request<RoadmapItem>(`/servers/${serverId}/roadmap/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteRoadmapItem(serverId: string, itemId: string) {
  return request<void>(`/servers/${serverId}/roadmap/${itemId}`, {
    method: "DELETE",
  });
}
