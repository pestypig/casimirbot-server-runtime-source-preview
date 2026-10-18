import type { GrEvolveBrick, GrEvolveBrickParams } from "../gr-evolve-brick";
import type { GrInitialBrick, GrInitialBrickParams } from "../gr-initial-brick";

export type GrWorkerInitialRequest = {
  id: string;
  kind: "initial";
  params: Partial<GrInitialBrickParams>;
};

export type GrWorkerEvolveRequest = {
  id: string;
  kind: "evolve";
  params: Partial<GrEvolveBrickParams>;
};

export type GrWorkerRequest = GrWorkerInitialRequest | GrWorkerEvolveRequest;

export type GrWorkerInitialResponse =
  | {
      id: string;
      kind: "initial";
      ok: true;
      brick: GrInitialBrick;
    }
  | {
      id: string;
      kind: "initial";
      ok: false;
      error: string;
      stack?: string;
    };

export type GrWorkerEvolveResponse =
  | {
      id: string;
      kind: "evolve";
      ok: true;
      brick: GrEvolveBrick;
    }
  | {
      id: string;
      kind: "evolve";
      ok: false;
      error: string;
      stack?: string;
    };

export type GrWorkerResponse = GrWorkerInitialResponse | GrWorkerEvolveResponse;
