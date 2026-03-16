import { lazy, type ComponentType } from "react";
import minecraftLogo from "@/assets/games/minecraft-logo.png";
import csLogo from "@/assets/games/cs-logo.png";
import deadlockLogo from "@/assets/games/deadlock-logo.png";

export interface GameChannelDef {
  id: string;              // e.g. "game:minecraft"
  name: string;            // Display name in sidebar
  iconImage: string;       // Path to logo image
  iconInvert?: boolean;    // true to invert black logos to white
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
  {
    id: "game:cs",
    name: "Counter-Strike",
    iconImage: csLogo,
    iconInvert: true,
    component: lazy(() => import("@/components/games/cs/CSChannel.js")),
  },
  {
    id: "game:deadlock",
    name: "Deadlock",
    iconImage: deadlockLogo,
    component: lazy(() => import("@/components/games/deadlock/DeadlockChannel.js")),
  },
];

/** Quick lookup by ID */
export const GAME_CHANNEL_MAP = new Map(GAME_CHANNELS.map((g) => [g.id, g]));

/** Check if a channel ID is a game channel */
export function isGameChannel(channelId: string): boolean {
  return GAME_CHANNEL_MAP.has(channelId);
}
