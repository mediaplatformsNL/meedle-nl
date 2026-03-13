import { nanoid } from "nanoid";
import { MAX_VOTE_COMMENT_LENGTH } from "./meeting-session";
import type {
  AddMeetingVoteInput,
  MeetingLocationVote,
  MeetingSessionCreateInput,
  MeetingSessionData,
} from "./meeting-session";

const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

interface StoredMeetingSession {
  data: MeetingSessionData;
  expiresAtMs: number;
}

const meetingSessions = new Map<string, StoredMeetingSession>();

function cleanupExpiredSessions(nowMs: number): void {
  for (const [meetingId, session] of meetingSessions.entries()) {
    if (session.expiresAtMs <= nowMs) {
      meetingSessions.delete(meetingId);
    }
  }
}

export function createMeetingSession(input: MeetingSessionCreateInput): {
  session: MeetingSessionData;
  expiresAt: string;
} {
  const nowMs = Date.now();
  cleanupExpiredSessions(nowMs);

  const meetingId = nanoid(24);
  const expiresAtMs = nowMs + SESSION_TTL_MS;

  const uniqueSuggestedPlaces = new Map<string, MeetingSessionData["selectedPlace"]>();
  for (const place of input.suggestedPlaces ?? []) {
    uniqueSuggestedPlaces.set(place.id, place);
  }
  uniqueSuggestedPlaces.set(input.selectedPlace.id, input.selectedPlace);

  const session: MeetingSessionData = {
    participants: input.participants,
    geographicCenter: input.geographicCenter,
    selectedPlace: input.selectedPlace,
    participantRoutes: input.participantRoutes,
    meetingId,
    approvedAt: new Date(nowMs).toISOString(),
    suggestedPlaces: Array.from(uniqueSuggestedPlaces.values()),
    votes: [],
  };

  meetingSessions.set(meetingId, { data: session, expiresAtMs });

  return {
    session,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export function getMeetingSession(meetingId: string): MeetingSessionData | null {
  const nowMs = Date.now();
  cleanupExpiredSessions(nowMs);

  const session = meetingSessions.get(meetingId);
  if (!session || session.expiresAtMs <= nowMs) {
    meetingSessions.delete(meetingId);
    return null;
  }

  return session.data;
}

export function addMeetingVote(
  meetingId: string,
  input: AddMeetingVoteInput,
): { session: MeetingSessionData; vote: MeetingLocationVote } | null {
  const nowMs = Date.now();
  cleanupExpiredSessions(nowMs);

  const storedSession = meetingSessions.get(meetingId);
  if (!storedSession || storedSession.expiresAtMs <= nowMs) {
    meetingSessions.delete(meetingId);
    return null;
  }

  const session = storedSession.data;
  const votedPlace = session.suggestedPlaces.find((place) => place.id === input.placeId);
  if (!votedPlace) {
    return null;
  }

  const vote: MeetingLocationVote = {
    id: nanoid(14),
    participantName: input.participantName.trim(),
    placeId: votedPlace.id,
    placeName: votedPlace.name,
    comment: input.comment ? input.comment.trim().slice(0, MAX_VOTE_COMMENT_LENGTH) : null,
    createdAt: new Date(nowMs).toISOString(),
  };

  session.votes = [...session.votes, vote];
  return { session, vote };
}
