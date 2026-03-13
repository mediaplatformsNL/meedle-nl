import { nanoid } from "nanoid";
import { MAX_VOTE_COMMENT_LENGTH } from "./meeting-session";
import type {
  AddMeetingVoteInput,
  MeetingLatLngLiteral,
  MeetingLocationVote,
  MeetingSessionCreateInput,
  MeetingSessionData,
  MeetingSessionParticipant,
  MeetingSessionParticipantRouteSet,
  SavedMeetingSummary,
} from "./meeting-session";
import type { SuitablePlace } from "./places";

const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

interface StoredMeetingSession {
  data: MeetingSessionData;
  expiresAtMs: number;
  ownerUserId: string;
}

interface SavedMeetingRecord {
  meetingId: string;
  ownerUserId: string;
  approvedAt: string;
  participants: MeetingSessionParticipant[];
  geographicCenter: MeetingLatLngLiteral | null;
  selectedPlace: SuitablePlace;
  suggestedPlaces: SuitablePlace[];
  participantRoutes: Record<number, MeetingSessionParticipantRouteSet>;
}

const meetingSessions = new Map<string, StoredMeetingSession>();
const savedMeetingsByMeetingId = new Map<string, SavedMeetingRecord>();
const savedMeetingIdsByOwner = new Map<string, string[]>();

function cleanupExpiredSessions(nowMs: number): void {
  for (const [meetingId, session] of meetingSessions.entries()) {
    if (session.expiresAtMs <= nowMs) {
      meetingSessions.delete(meetingId);
    }
  }
}

function cloneLatLng(value: MeetingLatLngLiteral): MeetingLatLngLiteral {
  return { lat: value.lat, lng: value.lng };
}

function cloneParticipants(participants: MeetingSessionParticipant[]): MeetingSessionParticipant[] {
  return participants.map((participant) => ({ ...participant }));
}

function clonePlace(place: SuitablePlace): SuitablePlace {
  return {
    ...place,
    location: cloneLatLng(place.location),
  };
}

function cloneParticipantRoutes(
  participantRoutes: Record<number, MeetingSessionParticipantRouteSet>,
): Record<number, MeetingSessionParticipantRouteSet> {
  const clonedRoutes: Record<number, MeetingSessionParticipantRouteSet> = {};
  for (const [participantId, routeSet] of Object.entries(participantRoutes)) {
    const numericParticipantId = Number(participantId);
    if (!Number.isInteger(numericParticipantId)) {
      continue;
    }

    clonedRoutes[numericParticipantId] = {
      driving: {
        ...routeSet.driving,
        path: routeSet.driving.path.map((point) => cloneLatLng(point)),
      },
      transit: {
        ...routeSet.transit,
        path: routeSet.transit.path.map((point) => cloneLatLng(point)),
      },
    };
  }

  return clonedRoutes;
}

function saveMeetingForUser(record: SavedMeetingRecord): void {
  savedMeetingsByMeetingId.set(record.meetingId, record);

  const existingMeetingIds = savedMeetingIdsByOwner.get(record.ownerUserId) ?? [];
  const filteredMeetingIds = existingMeetingIds.filter((meetingId) => meetingId !== record.meetingId);
  savedMeetingIdsByOwner.set(record.ownerUserId, [record.meetingId, ...filteredMeetingIds]);
}

export function createMeetingSession(
  input: MeetingSessionCreateInput,
  ownerUserId: string,
): {
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
    participants: cloneParticipants(input.participants),
    geographicCenter: input.geographicCenter ? cloneLatLng(input.geographicCenter) : null,
    selectedPlace: clonePlace(input.selectedPlace),
    participantRoutes: cloneParticipantRoutes(input.participantRoutes),
    meetingId,
    approvedAt: new Date(nowMs).toISOString(),
    suggestedPlaces: Array.from(uniqueSuggestedPlaces.values()).map((place) => clonePlace(place)),
    votes: [],
  };

  meetingSessions.set(meetingId, { data: session, expiresAtMs, ownerUserId });

  saveMeetingForUser({
    meetingId,
    ownerUserId,
    approvedAt: session.approvedAt,
    participants: cloneParticipants(session.participants),
    geographicCenter: session.geographicCenter ? cloneLatLng(session.geographicCenter) : null,
    selectedPlace: clonePlace(session.selectedPlace),
    suggestedPlaces: session.suggestedPlaces.map((place) => clonePlace(place)),
    participantRoutes: cloneParticipantRoutes(session.participantRoutes),
  });

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

export function getSavedMeetingsForUser(ownerUserId: string): SavedMeetingSummary[] {
  const meetingIds = savedMeetingIdsByOwner.get(ownerUserId) ?? [];
  return meetingIds
    .map((meetingId) => savedMeetingsByMeetingId.get(meetingId))
    .filter((meetingRecord): meetingRecord is SavedMeetingRecord => !!meetingRecord)
    .map((meetingRecord) => ({
      meetingId: meetingRecord.meetingId,
      approvedAt: meetingRecord.approvedAt,
      participants: cloneParticipants(meetingRecord.participants),
      selectedPlace: clonePlace(meetingRecord.selectedPlace),
      suggestedPlaces: meetingRecord.suggestedPlaces.map((place) => clonePlace(place)),
    }));
}

export function repeatSavedMeeting(
  ownerUserId: string,
  meetingId: string,
): { session: MeetingSessionData; expiresAt: string } | null {
  const savedMeetingRecord = savedMeetingsByMeetingId.get(meetingId);
  if (!savedMeetingRecord || savedMeetingRecord.ownerUserId !== ownerUserId) {
    return null;
  }

  return createMeetingSession(
    {
      participants: cloneParticipants(savedMeetingRecord.participants),
      geographicCenter: savedMeetingRecord.geographicCenter
        ? cloneLatLng(savedMeetingRecord.geographicCenter)
        : null,
      suggestedPlaces: savedMeetingRecord.suggestedPlaces.map((place) => clonePlace(place)),
      selectedPlace: clonePlace(savedMeetingRecord.selectedPlace),
      participantRoutes: cloneParticipantRoutes(savedMeetingRecord.participantRoutes),
    },
    ownerUserId,
  );
}
