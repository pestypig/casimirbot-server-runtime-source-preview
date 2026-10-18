import {
  installCasimirFormalRuntimeCanaryDependenciesForServerV1,
  type CasimirFormalRuntimeCanaryDependenciesV1,
} from "./casimir-formal-runtime-canary-service";
import {
  installCasimirFormalVerifierDependenciesForServerV2,
  type CasimirFormalVerifierJobServiceDependenciesV2,
} from "./casimir-formal-verifier-job-service.v2";
import {
  installCasimirIndependentNumericalVerifierDependenciesForServerV1,
  type CasimirIndependentNumericalVerifierJobServiceDependenciesV1,
} from "./casimir-independent-numerical-verifier-job-service";
import type {
  TrustedRuntimeToolConfirmationReplayLedgerV1,
  TrustedRuntimeToolConfirmationVerifierV1,
} from "./runtime-tool-confirmation-receipt-verifier";
import type { CasimirTheoryExecutionStateStoreV1 } from "./casimir-theory-execution-state-store";

export type CasimirTheoryExecutionRuntimeApprovalDependenciesV1 = {
  verifyTrustedRuntimeReceipt?: TrustedRuntimeToolConfirmationVerifierV1;
  confirmationReplayLedger?: TrustedRuntimeToolConfirmationReplayLedgerV1;
};

export type CasimirFormalExecutionServerDependenciesV2 = Omit<
  CasimirFormalVerifierJobServiceDependenciesV2,
  | "verifyTrustedRuntimeReceipt"
  | "confirmationReplayLedger"
  | "stateStore"
>;

export type CasimirIndependentNumericalExecutionServerDependenciesV1 =
  Omit<
    CasimirIndependentNumericalVerifierJobServiceDependenciesV1,
    | "verifyTrustedRuntimeReceipt"
    | "confirmationReplayLedger"
    | "stateStore"
  >;

export type CasimirTheoryExecutionStateDependenciesV1 = {
  formalStateStore?: CasimirTheoryExecutionStateStoreV1;
  independentNumericalStateStore?: CasimirTheoryExecutionStateStoreV1;
};

export type CasimirFormalRuntimeCanaryServerDependenciesV1 = Omit<
  CasimirFormalRuntimeCanaryDependenciesV1,
  "verifyTrustedRuntimeReceipt" | "confirmationReplayLedger"
>;

let approvalDependencies: CasimirTheoryExecutionRuntimeApprovalDependenciesV1 =
  {};
let formalExecutionDependencies: CasimirFormalExecutionServerDependenciesV2 =
  {};
let numericalExecutionDependencies: CasimirIndependentNumericalExecutionServerDependenciesV1 =
  {};
let formalRuntimeCanaryDependencies: CasimirFormalRuntimeCanaryServerDependenciesV1 =
  {};
let stateDependencies: CasimirTheoryExecutionStateDependenciesV1 = {};

const recomposeFormalVerifier = (): void => {
  installCasimirFormalVerifierDependenciesForServerV2({
    ...formalExecutionDependencies,
    ...approvalDependencies,
    stateStore: stateDependencies.formalStateStore,
  });
};

const recomposeIndependentNumericalVerifier = (): void => {
  installCasimirIndependentNumericalVerifierDependenciesForServerV1({
    ...numericalExecutionDependencies,
    ...approvalDependencies,
    stateStore: stateDependencies.independentNumericalStateStore,
  });
};

const recomposeFormalRuntimeCanary = (): void => {
  installCasimirFormalRuntimeCanaryDependenciesForServerV1({
    ...formalRuntimeCanaryDependencies,
    ...approvalDependencies,
  });
};

/**
 * Trusted server-composition seam shared by every confirmation-gated theory
 * execution rail. It preserves lane-specific catalog/executor dependencies
 * when approval trust is installed, and preserves approval trust when a lane
 * is installed later. Recomposition is a bootstrap operation and resets
 * in-memory jobs; it must not be invoked from an agent route or tool call.
 */
export const installCasimirTheoryExecutionRuntimeApprovalDependenciesForServerV1 =
  (
    dependencies: CasimirTheoryExecutionRuntimeApprovalDependenciesV1,
  ): void => {
    approvalDependencies = { ...dependencies };
    recomposeFormalVerifier();
    recomposeIndependentNumericalVerifier();
    recomposeFormalRuntimeCanary();
  };

export const installCasimirTheoryExecutionStateDependenciesForServerV1 = (
  dependencies: CasimirTheoryExecutionStateDependenciesV1,
): void => {
  stateDependencies = { ...dependencies };
  recomposeFormalVerifier();
  recomposeIndependentNumericalVerifier();
};

export const installCasimirFormalExecutionDependenciesForServerV2 = (
  dependencies: CasimirFormalExecutionServerDependenciesV2,
): void => {
  formalExecutionDependencies = { ...dependencies };
  recomposeFormalVerifier();
};

export const installCasimirIndependentNumericalExecutionDependenciesForServerV1 =
  (
    dependencies: CasimirIndependentNumericalExecutionServerDependenciesV1,
  ): void => {
    numericalExecutionDependencies = { ...dependencies };
    recomposeIndependentNumericalVerifier();
  };

export const installCasimirFormalRuntimeCanaryServerDependenciesV1 = (
  dependencies: CasimirFormalRuntimeCanaryServerDependenciesV1,
): void => {
  formalRuntimeCanaryDependencies = { ...dependencies };
  recomposeFormalRuntimeCanary();
};

export const resetCasimirTheoryExecutionServerCompositionForTestsV1 =
  (): void => {
    approvalDependencies = {};
    formalExecutionDependencies = {};
    numericalExecutionDependencies = {};
    formalRuntimeCanaryDependencies = {};
    stateDependencies = {};
    recomposeFormalVerifier();
    recomposeIndependentNumericalVerifier();
    recomposeFormalRuntimeCanary();
  };
