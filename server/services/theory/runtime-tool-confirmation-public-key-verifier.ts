import {
  createPublicKey,
  verify as verifySignature,
  type KeyObject,
} from "node:crypto";

import { buildHelixRuntimeToolConfirmationSignatureMessageV1 } from "../../../shared/contracts/helix-runtime-tool-confirmation.v1";
import type { TrustedRuntimeToolConfirmationVerifierV1 } from "./runtime-tool-confirmation-receipt-verifier";

export type TrustedRuntimeToolConfirmationPublicKeyV1 = {
  issuer: string;
  keyId: string;
  algorithm: "ed25519";
  publicKeyPem: string;
};

type ParsedTrustedKey = {
  entry: TrustedRuntimeToolConfirmationPublicKeyV1;
  publicKey: KeyObject | null;
  issue: string | null;
};

const CANONICAL_SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CANONICAL_ED25519_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/;
const PUBLIC_KEY_PEM_PATTERN =
  /^-----BEGIN PUBLIC KEY-----\r?\n[\s\S]+\r?\n-----END PUBLIC KEY-----\r?\n?$/;

const exactNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value === value.trim();

const registryKey = (issuer: string, keyId: string): string =>
  JSON.stringify([issuer, keyId]);

const parseTrustedKey = (
  value: TrustedRuntimeToolConfirmationPublicKeyV1,
): ParsedTrustedKey => {
  if (!exactNonEmptyString(value.issuer) || !exactNonEmptyString(value.keyId)) {
    return {
      entry: value,
      publicKey: null,
      issue: "runtime_approval_receipt_public_key_identity_invalid",
    };
  }
  if (value.algorithm !== "ed25519") {
    return {
      entry: value,
      publicKey: null,
      issue: "runtime_approval_receipt_signature_algorithm_unsupported",
    };
  }
  if (
    typeof value.publicKeyPem !== "string" ||
    !PUBLIC_KEY_PEM_PATTERN.test(value.publicKeyPem)
  ) {
    return {
      entry: value,
      publicKey: null,
      issue: "runtime_approval_receipt_public_key_required",
    };
  }
  try {
    const publicKey = createPublicKey(value.publicKeyPem);
    if (
      publicKey.type !== "public" ||
      publicKey.asymmetricKeyType !== "ed25519"
    ) {
      return {
        entry: value,
        publicKey: null,
        issue: "runtime_approval_receipt_public_key_type_invalid",
      };
    }
    return { entry: value, publicKey, issue: null };
  } catch {
    return {
      entry: value,
      publicKey: null,
      issue: "runtime_approval_receipt_public_key_invalid",
    };
  }
};

const decodeCanonicalEd25519Signature = (value: string): Buffer | null => {
  if (!CANONICAL_ED25519_SIGNATURE_PATTERN.test(value)) return null;
  const signature = Buffer.from(value, "base64url");
  if (
    signature.byteLength !== 64 ||
    signature.toString("base64url") !== value
  ) {
    return null;
  }
  return signature;
};

/**
 * Builds an authenticity verifier from an exact issuer + key-ID registry.
 *
 * The registry contains public SPKI PEM keys only. This module verifies
 * receipts but never issues or signs them.
 */
export function createTrustedRuntimeToolConfirmationEd25519VerifierV1(input: {
  trustedPublicKeys: readonly TrustedRuntimeToolConfirmationPublicKeyV1[];
}): TrustedRuntimeToolConfirmationVerifierV1 {
  const keysByIdentity = new Map<string, ParsedTrustedKey[]>();
  const trustedIssuers = new Set<string>();
  for (const rawEntry of input.trustedPublicKeys) {
    const entry = parseTrustedKey(rawEntry);
    if (exactNonEmptyString(rawEntry.issuer)) {
      trustedIssuers.add(rawEntry.issuer);
    }
    const identity = registryKey(rawEntry.issuer, rawEntry.keyId);
    const existing = keysByIdentity.get(identity) ?? [];
    existing.push(entry);
    keysByIdentity.set(identity, existing);
  }

  return async ({ receipt, signedPayloadSha256 }) => {
    if (!trustedIssuers.has(receipt.issuer)) {
      return {
        ok: false,
        issues: ["runtime_approval_receipt_issuer_untrusted"],
      };
    }
    const candidates = keysByIdentity.get(
      registryKey(receipt.issuer, receipt.keyId),
    );
    if (!candidates?.length) {
      return {
        ok: false,
        issues: ["runtime_approval_receipt_key_untrusted"],
      };
    }
    if (candidates.length !== 1) {
      return {
        ok: false,
        issues: ["runtime_approval_receipt_key_registry_ambiguous"],
      };
    }
    const trustedKey = candidates[0];
    if (trustedKey.issue || !trustedKey.publicKey) {
      return {
        ok: false,
        issues: [
          trustedKey.issue ?? "runtime_approval_receipt_public_key_invalid",
        ],
      };
    }
    if (
      signedPayloadSha256 !== receipt.signedPayloadSha256 ||
      !CANONICAL_SHA256_PATTERN.test(signedPayloadSha256)
    ) {
      return {
        ok: false,
        issues: ["runtime_approval_receipt_signed_payload_invalid"],
      };
    }
    const signature = decodeCanonicalEd25519Signature(receipt.signature);
    if (!signature) {
      return {
        ok: false,
        issues: ["runtime_approval_receipt_signature_encoding_invalid"],
      };
    }
    let authentic = false;
    try {
      authentic = verifySignature(
        null,
        buildHelixRuntimeToolConfirmationSignatureMessageV1(
          signedPayloadSha256,
        ),
        trustedKey.publicKey,
        signature,
      );
    } catch {
      authentic = false;
    }
    return authentic
      ? { ok: true }
      : {
          ok: false,
          issues: ["runtime_approval_receipt_signature_invalid"],
        };
  };
}
