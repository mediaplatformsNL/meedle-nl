import type { SuitablePlace } from "./places";

export type MeetingRouteFetchStatus = "ok" | "unavailable" | "error";

export interface MeetingLatLngLiteral {
  lat: number;
  lng: number;
}

export interface MeetingSessionParticipant {
  id: number;
  name: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
}

export interface MeetingSessionRouteOption {
  status: MeetingRouteFetchStatus;
  distanceText: string | null;
  durationText: string | null;
  path: MeetingLatLngLiteral[];
  message: string;
}

export interface MeetingSessionParticipantRouteSet {
  driving: MeetingSessionRouteOption;
  transit: MeetingSessionRouteOption;
}

export type MeetingSessionParticipantRoutes = Record<number, MeetingSessionParticipantRouteSet>;

export interface MeetingLocationVote {
  id: string;
  participantName: string;
  placeId: string;
  placeName: string;
  comment: string | null;
  createdAt: string;
}

export const MAX_VOTE_COMMENT_LENGTH = 120;

export interface MeetingSessionCreateInput {
  participants: MeetingSessionParticipant[];
  geographicCenter: MeetingLatLngLiteral | null;
  suggestedPlaces?: SuitablePlace[];
  selectedPlace: SuitablePlace;
  participantRoutes: MeetingSessionParticipantRoutes;
}

export interface MeetingSessionData
  extends Omit<MeetingSessionCreateInput, "suggestedPlaces"> {
  meetingId: string;
  approvedAt: string;
  suggestedPlaces: SuitablePlace[];
  votes: MeetingLocationVote[];
}

export interface CreateMeetingSessionResponse {
  meetingId: string;
  expiresAt: string;
}

export interface AddMeetingVoteInput {
  participantName: string;
  placeId: string;
  comment: string | null;
}

export interface SavedMeetingSummary {
  meetingId: string;
  approvedAt: string;
  participants: MeetingSessionParticipant[];
  selectedPlace: SuitablePlace;
  suggestedPlaces: SuitablePlace[];
}
