import { lazy, type ComponentType } from "react";
import minecraftLogo from "@/assets/games/minecraft-logo.png";

export interface GameChannelDef {
  id: string;              // e.g. "game:minecraft"
  name: string;            // Display name in sidebar
  iconImage: string;       // Path to logo image
  component: React.LazyExoticComponent<ComponentType>;
}

/** Registry of all bespoke game channels. Add new games here. */
export const GAME_CHANNELS: GameChannelDef[] = [
  {
    id: "game:minecraft",
    name: "Minecraft",
    iconImage: minecraftLogo,
    component: lazy(() => import("@/components/games/minecraft/MinecraftChannel.js")),
  },
];

/** Quick lookup by ID */
export const GAME_CHANNEL_MAP = new Map(GAME_CHANNELS.map((g) => [g.id, g]));

/** Check if a channel ID is a game channel */
export function isGameChannel(channelId: string): boolean {
  return GAME_CHANNEL_MAP.has(channelId);
}
