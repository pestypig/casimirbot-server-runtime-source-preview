import { parentPort } from "node:worker_threads";
import { buildGrEvolveBrick } from "../gr-evolve-brick.ts";
import { buildGrInitialBrick } from "../gr-initial-brick.ts";
import type {
  GrWorkerRequest,
  GrWorkerResponse,
} from "./gr-worker-types";

const collectTransferableBuffers = (
  brick: { channels: Record<string, { data: Float32Array }> },
): ArrayBuffer[] => {
  const buffers: ArrayBuffer[] = [];
  const seen = new Set<ArrayBuffer>();
  for (const channel of Object.values(brick.channels)) {
    const buffer = channel.data.buffer;
    if (buffer instanceof ArrayBuffer && !seen.has(buffer)) {
      seen.add(buffer);
      buffers.push(buffer);
    }
  }
  return buffers;
};

const port = parentPort;
if (!port) {
  throw new Error("GR worker started without parentPort");
}

port.on("message", (message: GrWorkerRequest) => {
  try {
    if (message.kind === "initial") {
      const brick = buildGrInitialBrick(message.params);
      const response: GrWorkerResponse = {
        id: message.id,
        kind: "initial",
        ok: true,
        brick,
      };
      port.postMessage(response, collectTransferableBuffers(brick));
      return;
    }

    if (message.kind === "evolve") {
      const brick = buildGrEvolveBrick(message.params);
      const response: GrWorkerResponse = {
        id: message.id,
        kind: "evolve",
        ok: true,
        brick,
      };
      port.postMessage(response, collectTransferableBuffers(brick));
      return;
    }
  } catch (err) {
    const response: GrWorkerResponse = {
      id: message.id,
      kind: message.kind,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    };
    port.postMessage(response);
  }
});
