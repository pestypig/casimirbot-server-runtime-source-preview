import {
  validateHelixRuntimeToolConfirmationReceiptIntegrityV1,
  type HelixRuntimeToolConfirmationBindingV1,
  type HelixRuntimeToolConfirmationReceiptV1,
} from "../../../shared/contracts/helix-runtime-tool-confirmation.v1";

export type TrustedRuntimeToolConfirmationVerificationV1 = {
  ok: boolean;
  issues?: string[];
};

export type TrustedRuntimeToolConfirmationVerifierV1 = (input: {
  receipt: HelixRuntimeToolConfirmationReceiptV1;
  signedPayloadSha256: string;
}) =>
  | TrustedRuntimeToolConfirmationVerificationV1
  | Promise<TrustedRuntimeToolConfirmationVerificationV1>;

export type TrustedRuntimeToolConfirmationReplayClaimV1 = {
  receiptId: string;
  requestId: string;
  issuer: string;
  keyId: string;
  bindingSha256: string;
  artifactSha256: string;
  signedPayloadSha256: string;
  approvedAt: string;
  expiresAt: string;
};

export type TrustedRuntimeToolConfirmationReplayConsumeResultV1 =
  | { status: "consumed" }
  | { status: "already_consumed" }
  | { status: "unavailable" };

/**
 * Trusted server-owned replay ledger. Implementations must atomically enforce
 * uniqueness for both receiptId and requestId across every process that may
 * start a governed runtime job. It is an admission primitive, not a signer or
 * approval lifecycle.
 */
export type TrustedRuntimeToolConfirmationReplayLedgerV1 = {
  consumeOnce: (
    claim: TrustedRuntimeToolConfirmationReplayClaimV1,
  ) =>
    | TrustedRuntimeToolConfirmationReplayConsumeResultV1
    | Promise<TrustedRuntimeToolConfirmationReplayConsumeResultV1>;
};

export type RuntimeToolConfirmationConsumeResultV1 =
  | {
      ok: true;
      status: "verified";
      receiptId: string;
      requestId: string;
      issues: [];
    }
  | {
      ok: false;
      status: "needs_confirmation" | "blocked";
      receiptId: string | null;
      requestId: string | null;
      issues: string[];
    };

const DEFAULT_MAX_RECEIPT_LIFETIME_MS = 10 * 60 * 1_000;
const DEFAULT_FUTURE_CLOCK_SKEW_MS = 30 * 1_000;

const readRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const sameBinding = (
  actual: HelixRuntimeToolConfirmationBindingV1,
  expected: HelixRuntimeToolConfirmationBindingV1,
): string[] => {
  const issues: string[] = [];
  for (const field of [
    "capabilityId",
    "planId",
    "accountType",
    "profileId",
    "sessionId",
    "turnId",
    "sealedInputSha256",
  ] as const) {
    if (actual[field] !== expected[field]) {
      issues.push(`runtime_approval_receipt_binding_mismatch:${field}`);
    }
  }
  return issues;
};

export function createRuntimeToolConfirmationReceiptVerifierV1(
  input: {
    verifyTrustedRuntimeReceipt?: TrustedRuntimeToolConfirmationVerifierV1;
    now?: () => number;
    maxReceiptLifetimeMs?: number;
    futureClockSkewMs?: number;
    replayLedger?: TrustedRuntimeToolConfirmationReplayLedgerV1;
    requireDurableReplayProtection?: boolean;
  } = {},
) {
  const consumedReceiptIds = new Set<string>();
  const consumedRequestIds = new Set<string>();
  const now = input.now ?? Date.now;
  const maxReceiptLifetimeMs =
    input.maxReceiptLifetimeMs ?? DEFAULT_MAX_RECEIPT_LIFETIME_MS;
  const futureClockSkewMs =
    input.futureClockSkewMs ?? DEFAULT_FUTURE_CLOCK_SKEW_MS;

  const consume = async (args: {
    receipt?: unknown;
    legacyApprovalToken?: string | null;
    expectedBinding: HelixRuntimeToolConfirmationBindingV1;
  }): Promise<RuntimeToolConfirmationConsumeResultV1> => {
    if (readString(args.legacyApprovalToken)) {
      return {
        ok: false,
        status: "blocked",
        receiptId: null,
        requestId: null,
        issues: ["runtime_approval_legacy_token_rejected"],
      };
    }
    const rawReceipt = readRecord(args.receipt);
    if (!rawReceipt) {
      if (args.receipt !== undefined && args.receipt !== null) {
        return {
          ok: false,
          status: "blocked",
          receiptId: null,
          requestId: null,
          issues: ["confirmation_receipt_invalid:$:object_required"],
        };
      }
      return {
        ok: false,
        status: "needs_confirmation",
        receiptId: null,
        requestId: null,
        issues: ["runtime_approval_receipt_required"],
      };
    }

    const receiptId = readString(rawReceipt.receiptId);
    const requestId = readString(readRecord(rawReceipt.request)?.requestId);
    if (!input.verifyTrustedRuntimeReceipt) {
      return {
        ok: false,
        status: "blocked",
        receiptId,
        requestId,
        issues: ["runtime_approval_receipt_issuer_unconfigured"],
      };
    }

    const integrityIssues =
      await validateHelixRuntimeToolConfirmationReceiptIntegrityV1(rawReceipt);
    if (integrityIssues.length > 0) {
      return {
        ok: false,
        status: "blocked",
        receiptId,
        requestId,
        issues: integrityIssues,
      };
    }
    const receipt = rawReceipt as HelixRuntimeToolConfirmationReceiptV1;
    const bindingIssues = sameBinding(
      receipt.request.binding,
      args.expectedBinding,
    );
    if (bindingIssues.length > 0) {
      return {
        ok: false,
        status: "blocked",
        receiptId: receipt.receiptId,
        requestId: receipt.request.requestId,
        issues: bindingIssues,
      };
    }

    const issuedAt = Date.parse(receipt.request.issuedAt);
    const approvedAt = Date.parse(receipt.approvedAt);
    const expiresAt = Date.parse(receipt.request.expiresAt);
    const currentTime = now();
    const timingIssues: string[] = [];
    if (expiresAt <= issuedAt) {
      timingIssues.push("runtime_approval_receipt_invalid_lifetime");
    }
    if (expiresAt - issuedAt > maxReceiptLifetimeMs) {
      timingIssues.push("runtime_approval_receipt_lifetime_exceeds_policy");
    }
    if (issuedAt > currentTime + futureClockSkewMs) {
      timingIssues.push("runtime_approval_receipt_issued_in_future");
    }
    if (approvedAt > currentTime + futureClockSkewMs) {
      timingIssues.push("runtime_approval_receipt_approved_in_future");
    }
    if (approvedAt < issuedAt || approvedAt > expiresAt) {
      timingIssues.push("runtime_approval_receipt_approval_time_out_of_range");
    }
    if (currentTime >= expiresAt) {
      timingIssues.push("runtime_approval_receipt_expired");
    }
    if (timingIssues.length > 0) {
      return {
        ok: false,
        status: "blocked",
        receiptId: receipt.receiptId,
        requestId: receipt.request.requestId,
        issues: timingIssues,
      };
    }

    if (
      consumedReceiptIds.has(receipt.receiptId) ||
      consumedRequestIds.has(receipt.request.requestId)
    ) {
      return {
        ok: false,
        status: "blocked",
        receiptId: receipt.receiptId,
        requestId: receipt.request.requestId,
        issues: ["runtime_approval_receipt_already_consumed"],
      };
    }

    let authenticity: TrustedRuntimeToolConfirmationVerificationV1;
    try {
      authenticity = await input.verifyTrustedRuntimeReceipt({
        receipt,
        signedPayloadSha256: receipt.signedPayloadSha256,
      });
    } catch {
      authenticity = {
        ok: false,
        issues: ["runtime_approval_receipt_verifier_failed"],
      };
    }
    if (!authenticity.ok) {
      return {
        ok: false,
        status: "blocked",
        receiptId: receipt.receiptId,
        requestId: receipt.request.requestId,
        issues: authenticity.issues?.length
          ? [...new Set(authenticity.issues)]
          : ["runtime_approval_receipt_signature_invalid"],
      };
    }

    if (input.replayLedger) {
      let replayResult: TrustedRuntimeToolConfirmationReplayConsumeResultV1 = {
        status: "unavailable",
      };
      try {
        const candidate = await input.replayLedger.consumeOnce({
          receiptId: receipt.receiptId,
          requestId: receipt.request.requestId,
          issuer: receipt.issuer,
          keyId: receipt.keyId,
          bindingSha256: receipt.request.bindingSha256,
          artifactSha256: receipt.artifactSha256,
          signedPayloadSha256: receipt.signedPayloadSha256,
          approvedAt: receipt.approvedAt,
          expiresAt: receipt.request.expiresAt,
        });
        if (
          candidate?.status === "consumed" ||
          candidate?.status === "already_consumed" ||
          candidate?.status === "unavailable"
        ) {
          replayResult = candidate;
        }
      } catch {
        replayResult = { status: "unavailable" };
      }
      if (replayResult.status === "already_consumed") {
        return {
          ok: false,
          status: "blocked",
          receiptId: receipt.receiptId,
          requestId: receipt.request.requestId,
          issues: ["runtime_approval_receipt_already_consumed"],
        };
      }
      if (replayResult.status !== "consumed") {
        return {
          ok: false,
          status: "blocked",
          receiptId: receipt.receiptId,
          requestId: receipt.request.requestId,
          issues: ["runtime_approval_receipt_replay_ledger_unavailable"],
        };
      }
      consumedReceiptIds.add(receipt.receiptId);
      consumedRequestIds.add(receipt.request.requestId);
      return {
        ok: true,
        status: "verified",
        receiptId: receipt.receiptId,
        requestId: receipt.request.requestId,
        issues: [],
      };
    }
    if (input.requireDurableReplayProtection === true) {
      return {
        ok: false,
        status: "blocked",
        receiptId: receipt.receiptId,
        requestId: receipt.request.requestId,
        issues: ["runtime_approval_receipt_replay_ledger_unconfigured"],
      };
    }

    // Recheck immediately before consumption so concurrent verification of one
    // receipt/request cannot authorize two starts in the same process. This
    // fallback is deliberately process-local and is not sufficient for a
    // multi-process production approval host.
    if (
      consumedReceiptIds.has(receipt.receiptId) ||
      consumedRequestIds.has(receipt.request.requestId)
    ) {
      return {
        ok: false,
        status: "blocked",
        receiptId: receipt.receiptId,
        requestId: receipt.request.requestId,
        issues: ["runtime_approval_receipt_already_consumed"],
      };
    }
    consumedReceiptIds.add(receipt.receiptId);
    consumedRequestIds.add(receipt.request.requestId);
    return {
      ok: true,
      status: "verified",
      receiptId: receipt.receiptId,
      requestId: receipt.request.requestId,
      issues: [],
    };
  };

  const reset = (): void => {
    consumedReceiptIds.clear();
    consumedRequestIds.clear();
  };

  return { consume, reset };
}
