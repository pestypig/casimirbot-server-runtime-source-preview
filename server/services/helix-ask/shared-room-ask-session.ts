import type { HelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import { readSharedRealtimeRoomMembership } from "./realtime-room/room-store";

export const HELIX_SHARED_ROOM_ASK_SESSION_PREFIX = "helix-ask:room:";

export type HelixSharedRoomAskSessionAccess =
  | {
      scoped: false;
      admitted: true;
      roomId: null;
      participantId: null;
      reason: "not_shared_room_session";
    }
  | {
      scoped: true;
      admitted: true;
      roomId: string;
      participantId: string;
      reason: "active_room_member";
    }
  | {
      scoped: true;
      admitted: false;
      roomId: string;
      participantId: null;
      reason:
        | "account_session_required"
        | "shared_room_policy_unavailable"
        | "room_membership_required";
    };

export const readHelixSharedRoomIdFromAskSession = (
  sessionId: string | null | undefined,
): string | null => {
  const normalized = sessionId?.trim() ?? "";
  if (!normalized.startsWith(HELIX_SHARED_ROOM_ASK_SESSION_PREFIX)) {
    return null;
  }
  const roomId = normalized
    .slice(HELIX_SHARED_ROOM_ASK_SESSION_PREFIX.length)
    .trim();
  return roomId && roomId.length <= 240 ? roomId : null;
};

const sharedRoomPolicyAvailable = (
  policy: HelixAccountCapabilityPolicy | null | undefined,
): boolean =>
  Boolean(
    policy?.feature_flags.includes("shared_realtime_rooms") &&
      !policy.locked_features.includes("shared_realtime_rooms"),
  );

export const resolveHelixSharedRoomAskSessionAccess = async (input: {
  sessionId: string | null | undefined;
  profileId: string | null | undefined;
  accountPolicy?: HelixAccountCapabilityPolicy | null;
  readMembership?: typeof readSharedRealtimeRoomMembership;
}): Promise<HelixSharedRoomAskSessionAccess> => {
  const roomId = readHelixSharedRoomIdFromAskSession(input.sessionId);
  if (!roomId) {
    return {
      scoped: false,
      admitted: true,
      roomId: null,
      participantId: null,
      reason: "not_shared_room_session",
    };
  }
  const profileId = input.profileId?.trim() ?? "";
  if (!profileId) {
    return {
      scoped: true,
      admitted: false,
      roomId,
      participantId: null,
      reason: "account_session_required",
    };
  }
  if (!sharedRoomPolicyAvailable(input.accountPolicy)) {
    return {
      scoped: true,
      admitted: false,
      roomId,
      participantId: null,
      reason: "shared_room_policy_unavailable",
    };
  }
  const membership = await (
    input.readMembership ?? readSharedRealtimeRoomMembership
  )({
    roomId,
    profileId,
  });
  if (!membership) {
    return {
      scoped: true,
      admitted: false,
      roomId,
      participantId: null,
      reason: "room_membership_required",
    };
  }
  return {
    scoped: true,
    admitted: true,
    roomId,
    participantId: membership.participantId,
    reason: "active_room_member",
  };
};
