import type { PublicApp } from "./types";

/**
 * Built-in copy of the seeded app registry (altvivo-core/db/seed/seed.sql).
 * Used only when the registry API is unreachable, so the marketing site still
 * renders; live status always comes from app_registry.
 */
export const FALLBACK_APPS: PublicApp[] = [
  {
    appId: "xprism", name: "XPRISM", tagline: "Virtual Pharmacology & CAL In-Vivo Rodent Simulation",
    description: "A virtual pharmacology laboratory with 40+ simulated experiments that replace live-animal demonstrations in teaching and pre-study design, aligned with CCSEA guidelines and the PCI curriculum.",
    url: "https://xprism.altvivo.bio", status: "LIVE", version: "1.0.0", requiresCredits: false, phase: 1, sortOrder: 10, iconKey: "flask-conical",
    highlights: ["40+ virtual experiments", "100% CCSEA & PCI compliant", "Isolated organ bath", "Ocular pupillometer", "MES / PTZ seizure models", "Thermal nociception (hot plate, tail flick)"],
  },
  {
    appId: "amaze", name: "aMaze", tagline: "Rodent Neurobehavioral Video Tracking & Heatmaps",
    description: "aMaze is a modern, high-precision rodent behavioral tracking and analysis suite for laboratory neuroscience and behavioral pharmacology. It combines computer vision tracking, customizable arena/zone geometry, real-time posture alignment, trial management, multi-paradigm analytics, and interactive data visualization with exportable reports.",
    url: "https://amaze.altvivo.bio", status: "LIVE", version: "1.0.0", requiresCredits: true, phase: 1, sortOrder: 20, iconKey: "scan-eye",
    highlights: ["Automatic arena / ROI detection", "Markerless tracking", "Behavioural assay heatmaps", "Open field, EPM, Y-maze, MWM", "CSV / JSON export to the AltVivo vault"],
  },
];

export const isAvailable = (a: Pick<PublicApp, "status">) => a.status === "LIVE" || a.status === "BETA" || a.status === "MAINTENANCE";
