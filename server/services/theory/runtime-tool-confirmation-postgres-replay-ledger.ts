import type { Pool } from "pg";
import { ensureDatabase, getPool } from "../../db/client";
import type {
  TrustedRuntimeToolConfirmationReplayClaimV1,
  TrustedRuntimeToolConfirmationReplayConsumeResultV1,
  TrustedRuntimeToolConfirmationReplayLedgerV1,
} from "./runtime-tool-confirmation-receipt-verifier";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;

const boundedText = (value: unknown, maxLength: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maxLength &&
  value === value.trim() &&
  !CONTROL_CHARACTER_PATTERN.test(value);

const canonicalSha256 = (value: unknown): value is string =>
  typeof value === "string" && SHA256_PATTERN.test(value);

const canonicalTimestamp = (value: unknown): value is string => {
  if (!boundedText(value, 32)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

const validClaim = (
  value: unknown,
): value is TrustedRuntimeToolConfirmationReplayClaimV1 => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const claim = value as Record<
    keyof TrustedRuntimeToolConfirmationReplayClaimV1,
    unknown
  >;
  if (
    !boundedText(claim.receiptId, 256) ||
    !boundedText(claim.requestId, 256) ||
    !boundedText(claim.issuer, 2048) ||
    !boundedText(claim.keyId, 256) ||
    !canonicalSha256(claim.bindingSha256) ||
    !canonicalSha256(claim.artifactSha256) ||
    !canonicalSha256(claim.signedPayloadSha256) ||
    !canonicalTimestamp(claim.approvedAt) ||
    !canonicalTimestamp(claim.expiresAt)
  ) {
    return false;
  }
  return Date.parse(claim.expiresAt) >= Date.parse(claim.approvedAt);
};

/**
 * PostgreSQL-backed one-time consumption ledger.
 *
 * The single INSERT is the authority boundary: primary-key and unique
 * constraints atomically reject reuse of either receiptId or requestId across
 * processes. Callers receive only the bounded ledger status; database errors
 * and details never cross this interface. Cross-process authority requires a
 * shared PostgreSQL database; the local pg-mem snapshot is restart recovery
 * for one local process, not a distributed lock.
 */
export class PostgresTrustedRuntimeToolConfirmationReplayLedgerV1 implements TrustedRuntimeToolConfirmationReplayLedgerV1 {
  constructor(private readonly injectedPool?: Pool) {}

  private async pool(): Promise<Pool> {
    if (this.injectedPool) return this.injectedPool;
    await ensureDatabase();
    return getPool();
  }

  async consumeOnce(
    claim: TrustedRuntimeToolConfirmationReplayClaimV1,
  ): Promise<TrustedRuntimeToolConfirmationReplayConsumeResultV1> {
    if (!validClaim(claim)) {
      return { status: "unavailable" };
    }

    try {
      const pool = await this.pool();
      const result = await pool.query<{ receipt_id: string }>(
        `
          INSERT INTO helix_runtime_tool_confirmation_replay_claims (
            receipt_id,
            request_id,
            issuer,
            key_id,
            binding_sha256,
            artifact_sha256,
            signed_payload_sha256,
            approved_at,
            expires_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8::timestamptz, $9::timestamptz
          )
          ON CONFLICT DO NOTHING
          RETURNING receipt_id;
        `,
        [
          claim.receiptId,
          claim.requestId,
          claim.issuer,
          claim.keyId,
          claim.bindingSha256,
          claim.artifactSha256,
          claim.signedPayloadSha256,
          claim.approvedAt,
          claim.expiresAt,
        ],
      );

      if (result.rows.length === 1) {
        return { status: "consumed" };
      }
      if (result.rows.length === 0) {
        return { status: "already_consumed" };
      }
      return { status: "unavailable" };
    } catch {
      return { status: "unavailable" };
    }
  }
}

export const createPostgresTrustedRuntimeToolConfirmationReplayLedgerV1 = (
  pool?: Pool,
): TrustedRuntimeToolConfirmationReplayLedgerV1 =>
  new PostgresTrustedRuntimeToolConfirmationReplayLedgerV1(pool);
