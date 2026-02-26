import type { ArtSet } from "@/stores/gallery.js";

export const ART_SETS: ArtSet[] = [
  {
    id: "void",
    name: "Void",
    images: [
      {
        id: "void-1",
        name: "Abyss",
        css: "linear-gradient(135deg, #0a0a0a 0%, #1a0a2e 40%, #16213e 70%, #0a0a0a 100%)",
      },
      {
        id: "void-2",
        name: "Umbra",
        css: "linear-gradient(160deg, #0d0d0d 0%, #2d1b4e 30%, #0d0d0d 60%, #1a1a2e 100%)",
      },
      {
        id: "void-3",
        name: "Singularity",
        css: "radial-gradient(ellipse at 30% 50%, #1a0a2e 0%, #0a0a0a 50%, #0d1117 100%)",
      },
      {
        id: "void-4",
        name: "Event Horizon",
        css: "radial-gradient(ellipse at 70% 40%, #16213e 0%, #0a0a0a 45%, #1a0a2e 100%)",
      },
    ],
  },
  {
    id: "signal",
    name: "Signal",
    images: [
      {
        id: "signal-1",
        name: "Grid",
        css: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
      },
      {
        id: "signal-2",
        name: "Pulse",
        css: "linear-gradient(90deg, #0f172a 0%, #312e81 50%, #0f172a 100%)",
      },
      {
        id: "signal-3",
        name: "Beacon",
        css: "radial-gradient(circle at 50% 50%, #312e81 0%, #1e1b4b 30%, #0f172a 70%)",
      },
    ],
  },
  {
    id: "drift",
    name: "Drift",
    images: [
      {
        id: "drift-1",
        name: "Dusk",
        css: "linear-gradient(135deg, #1a1a2e 0%, #3d2c5e 30%, #6b3a6e 60%, #2d1b4e 100%)",
      },
      {
        id: "drift-2",
        name: "Tide",
        css: "linear-gradient(160deg, #0d1b2a 0%, #1b3a4b 40%, #2a5a6b 70%, #0d1b2a 100%)",
      },
      {
        id: "drift-3",
        name: "Aurora",
        css: "linear-gradient(135deg, #0d1b2a 0%, #1b4332 30%, #2d6a4f 50%, #1a1a2e 80%, #3d2c5e 100%)",
      },
      {
        id: "drift-4",
        name: "Bloom",
        css: "linear-gradient(150deg, #1a1a2e 0%, #4a2040 35%, #6b3a5e 55%, #2d1b4e 100%)",
      },
    ],
  },
];
