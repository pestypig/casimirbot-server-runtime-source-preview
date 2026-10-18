import { randomUUID } from "crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type { GrEvolveBrick, GrEvolveBrickParams } from "../gr-evolve-brick";
import type { GrInitialBrick, GrInitialBrickParams } from "../gr-initial-brick";
import type {
  GrWorkerRequest,
  GrWorkerResponse,
} from "./gr-worker-types";

type PendingTask = {
  resolve: (value: GrEvolveBrick | GrInitialBrick) => void;
  reject: (err: Error) => void;
  timeout?: NodeJS.Timeout;
};

const GR_WORKER_ENABLED = process.env.GR_WORKER_ENABLED !== "0";
const GR_WORKER_TIMEOUT_MS = (() => {
  const value = Number(process.env.GR_WORKER_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 0;
})();

let grWorker: Worker | null = null;
const pending = new Map<string, PendingTask>();

const resolveTsExecArgv = () => {
  const major = Number(process.versions.node.split(".")[0]);
  return major >= 20 ? ["--import", "tsx"] : ["--loader", "tsx"];
};

const resolveWorkerEntry = () => {
  const root = process.cwd();
  const preferSource =
    process.env.GR_WORKER_PREFER_SOURCE === "1" ||
    process.env.GR_WORKER_PREFER_SOURCE == null;
  const sourceFirst = [
    { path: path.join(root, "server", "gr", "gr-worker-bootstrap.mjs"), isTs: true },
    { path: path.join(root, "server", "gr", "gr-worker.ts"), isTs: true },
    { path: path.join(root, "server", "gr", "gr-worker.ts"), isTs: false },
    { path: path.join(root, "dist", "gr", "gr-worker.ts"), isTs: false },
  ];
  const distFirst = [
    { path: path.join(root, "dist", "gr", "gr-worker.ts"), isTs: false },
    { path: path.join(root, "server", "gr", "gr-worker.ts"), isTs: false },
    { path: path.join(root, "server", "gr", "gr-worker-bootstrap.mjs"), isTs: true },
    { path: path.join(root, "server", "gr", "gr-worker.ts"), isTs: true },
  ];
  const candidates = preferSource ? sourceFirst : distFirst;
  for (const candidate of candidates) {
    if (fs.existsSync(candidate.path)) {
      return {
        url: pathToFileURL(candidate.path),
        isTs: candidate.isTs,
      };
    }
  }
  return {
    url: new URL("./gr-worker-bootstrap.mjs", import.meta.url),
    isTs: true,
  };
};

const rejectAllPending = (err: Error) => {
  for (const [id, task] of pending.entries()) {
    pending.delete(id);
    if (task.timeout) clearTimeout(task.timeout);
    task.reject(err);
  }
};

const handleWorkerMessage = (message: GrWorkerResponse) => {
  const task = pending.get(message.id);
  if (!task) return;
  pending.delete(message.id);
  if (task.timeout) clearTimeout(task.timeout);
  if (message.ok) {
    task.resolve(message.brick);
    return;
  }
  const err = new Error(message.error);
  if (message.stack) err.stack = message.stack;
  task.reject(err);
};

const createWorker = () => {
  const entry = resolveWorkerEntry();
  const worker = new Worker(entry.url, {
    execArgv: entry.isTs ? resolveTsExecArgv() : [],
    type: "module",
  });
  worker.on("message", handleWorkerMessage);
  worker.on("error", (err) => {
    rejectAllPending(err instanceof Error ? err : new Error(String(err)));
    grWorker = null;
  });
  worker.on("exit", (code) => {
    if (code !== 0) {
      rejectAllPending(new Error(`GR worker exited with code ${code}`));
    }
    grWorker = null;
  });
  return worker;
};

const ensureWorker = () => {
  if (!grWorker) {
    grWorker = createWorker();
  }
  return grWorker;
};

const submitTask = <T extends GrInitialBrick | GrEvolveBrick>(
  request: GrWorkerRequest,
): Promise<T> => {
  if (!GR_WORKER_ENABLED) {
    return Promise.reject(new Error("GR worker disabled"));
  }
  const worker = ensureWorker();
  return new Promise<T>((resolve, reject) => {
    const task: PendingTask = {
      resolve: (value) => resolve(value as T),
      reject,
    };
    if (GR_WORKER_TIMEOUT_MS > 0) {
      task.timeout = setTimeout(() => {
        pending.delete(request.id);
        reject(new Error("GR worker timed out"));
      }, GR_WORKER_TIMEOUT_MS);
    }
    pending.set(request.id, task);
    worker.postMessage(request);
  });
};

export const runGrInitialBrickInWorker = (
  params: Partial<GrInitialBrickParams>,
) =>
  submitTask<GrInitialBrick>({
    id: randomUUID(),
    kind: "initial",
    params,
  });

export const runGrEvolveBrickInWorker = (
  params: Partial<GrEvolveBrickParams>,
) =>
  submitTask<GrEvolveBrick>({
    id: randomUUID(),
    kind: "evolve",
    params,
  });

export const isGrWorkerEnabled = () => GR_WORKER_ENABLED;
