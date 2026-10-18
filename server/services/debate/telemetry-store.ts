import fs from "node:fs/promises";
import path from "node:path";
import type { TTelemetrySnapshot } from "@shared/star-telemetry";
import type { CoherenceAction, CoherenceGovernorDecision } from "../../../modules/policies/coherence-governor";

export type CoherenceSessionType = "debate" | "lab" | "planner" | "agent" | (string & {});

export type CoherenceTelemetrySnapshot = {
  sessionId: string;
  sessionType: CoherenceSessionType;
  telemetry?: TTelemetrySnapshot;
  action?: CoherenceAction;
  confidence?: number;
  updatedAt?: string;
  governor?: CoherenceGovernorDecision;
  // Compatibility: debates still expose debateId even though sessionId already matches.
  debateId?: string;
};

export type DebateTelemetrySnapshot = CoherenceTelemetrySnapshot & { debateId: string; sessionType: "debate" };

const SNAPSHOT_PATH = path.join(process.cwd(), "server/_generated/debate-telemetry.json");

type CoherenceTelemetryFile = {
  sessions: CoherenceTelemetrySnapshot[];
  capturedAt: string;
};

const normalizeFile = (raw: any): CoherenceTelemetryFile | null => {
  if (!raw || typeof raw !== "object") return null;
  if (Array.isArray(raw.sessions)) {
    return { sessions: raw.sessions as CoherenceTelemetrySnapshot[], capturedAt: raw.capturedAt ?? new Date().toISOString() };
  }
  if (Array.isArray(raw.debates)) {
    // Legacy shape: { debates: DebateTelemetrySnapshot[] }
    const sessions = (raw.debates as DebateTelemetrySnapshot[]).map((entry) => ({
      ...entry,
      sessionId: entry.debateId,
      sessionType: entry.sessionType ?? "debate",
    }));
    return { sessions, capturedAt: raw.capturedAt ?? new Date().toISOString() };
  }
  return null;
};

async function readJsonIfExists(filePath: string): Promise<CoherenceTelemetryFile | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return normalizeFile(JSON.parse(raw));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    console.warn("[debate:telemetry] failed to read snapshot file", error);
    return null;
  }
}

export async function persistCoherenceTelemetrySnapshot(entry: CoherenceTelemetrySnapshot): Promise<void> {
  const existing = (await readJsonIfExists(SNAPSHOT_PATH)) ?? {
    sessions: [],
    capturedAt: new Date().toISOString(),
  };
  const now = new Date().toISOString();
  const others = existing.sessions.filter(
    (item) => !(item.sessionId === entry.sessionId && item.sessionType === entry.sessionType),
  );
  const merged: CoherenceTelemetryFile = {
    sessions: [...others, { ...entry, updatedAt: entry.updatedAt ?? now }],
    capturedAt: now,
  };
  await fs.mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
  await fs.writeFile(SNAPSHOT_PATH, JSON.stringify(merged, null, 2), "utf8");
}

export async function persistDebateTelemetrySnapshot(entry: DebateTelemetrySnapshot): Promise<void> {
  return persistCoherenceTelemetrySnapshot({
    ...entry,
    sessionId: entry.sessionId ?? entry.debateId,
    sessionType: "debate",
    debateId: entry.debateId,
  });
}
