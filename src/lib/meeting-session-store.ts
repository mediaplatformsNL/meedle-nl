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
import { createServerSupabaseClient } from "./supabase";

const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

interface MeetingRow {
  id: string;
  ownerUserId: string;
  approvedAt: string;
  expiresAt: string | null;
  participantsJson: MeetingSessionParticipant[];
  geographicCenterJson: MeetingLatLngLiteral | null;
  selectedPlaceJson: SuitablePlace;
  suggestedPlacesJson: SuitablePlace[];
  participantRoutesJson: Record<number, MeetingSessionParticipantRouteSet>;
}

interface VoteRow {
  id: string;
  participant_name: string;
  place_id: string;
  place_name: string;
  created_at: string;
  comments: Array<{ content: string }> | null;
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

function normalizeSuggestedPlaces(
  selectedPlace: SuitablePlace,
  suggestedPlaces: SuitablePlace[] | undefined,
): SuitablePlace[] {
  const uniqueSuggestedPlaces = new Map<string, SuitablePlace>();
  for (const place of suggestedPlaces ?? []) {
    uniqueSuggestedPlaces.set(place.id, clonePlace(place));
  }
  uniqueSuggestedPlaces.set(selectedPlace.id, clonePlace(selectedPlace));
  return Array.from(uniqueSuggestedPlaces.values());
}

function getSuggestedPlacesFromRow(row: MeetingRow): SuitablePlace[] {
  return normalizeSuggestedPlaces(row.selectedPlaceJson, row.suggestedPlacesJson);
}

function toMeetingSessionData(row: MeetingRow, votes: MeetingLocationVote[]): MeetingSessionData {
  return {
    meetingId: row.id,
    approvedAt: row.approvedAt,
    participants: cloneParticipants(row.participantsJson),
    geographicCenter: row.geographicCenterJson ? cloneLatLng(row.geographicCenterJson) : null,
    selectedPlace: clonePlace(row.selectedPlaceJson),
    suggestedPlaces: getSuggestedPlacesFromRow(row),
    participantRoutes: cloneParticipantRoutes(row.participantRoutesJson),
    votes,
  };
}

async function getMeetingRowById(meetingId: string): Promise<MeetingRow | null> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("meetings")
    .select(
      "id, owner_user_id, approved_at, expires_at, participants_json, geographic_center_json, selected_place_json, suggested_places_json, participant_routes_json",
    )
    .eq("id", meetingId)
    .maybeSingle();

  if (error) {
    throw new Error(`Kon meeting niet ophalen: ${error.message}`);
  }
  if (!data) {
    return null;
  }

  return {
    id: data.id as string,
    ownerUserId: data.owner_user_id as string,
    approvedAt: data.approved_at as string,
    expiresAt: (data.expires_at as string | null) ?? null,
    participantsJson: (data.participants_json as MeetingSessionParticipant[]) ?? [],
    geographicCenterJson: (data.geographic_center_json as MeetingLatLngLiteral | null) ?? null,
    selectedPlaceJson: data.selected_place_json as SuitablePlace,
    suggestedPlacesJson: (data.suggested_places_json as SuitablePlace[]) ?? [],
    participantRoutesJson:
      (data.participant_routes_json as Record<number, MeetingSessionParticipantRouteSet>) ?? {},
  };
}

async function getVotesByMeetingId(meetingId: string): Promise<MeetingLocationVote[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("votes")
    .select("id, participant_name, place_id, place_name, created_at, comments(content)")
    .eq("meeting_id", meetingId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Kon stemmen niet ophalen: ${error.message}`);
  }

  const voteRows = (data ?? []) as VoteRow[];
  return voteRows.map((voteRow) => {
    const comment = voteRow.comments?.[0]?.content;
    return {
      id: voteRow.id,
      participantName: voteRow.participant_name,
      placeId: voteRow.place_id,
      placeName: voteRow.place_name,
      comment: typeof comment === "string" && comment.trim().length > 0 ? comment : null,
      createdAt: voteRow.created_at,
    };
  });
}

function isMeetingExpired(expiresAt: string | null, nowMs: number): boolean {
  if (!expiresAt) {
    return false;
  }

  const expiresAtMs = new Date(expiresAt).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
}

export async function createMeetingSession(
  input: MeetingSessionCreateInput,
  ownerUserId: string,
): Promise<{
  session: MeetingSessionData;
  expiresAt: string;
}> {
  const nowMs = Date.now();
  const meetingId = nanoid(24);
  const expiresAtMs = nowMs + SESSION_TTL_MS;
  const approvedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(expiresAtMs).toISOString();
  const suggestedPlaces = normalizeSuggestedPlaces(input.selectedPlace, input.suggestedPlaces);

  const session: MeetingSessionData = {
    participants: cloneParticipants(input.participants),
    geographicCenter: input.geographicCenter ? cloneLatLng(input.geographicCenter) : null,
    selectedPlace: clonePlace(input.selectedPlace),
    participantRoutes: cloneParticipantRoutes(input.participantRoutes),
    meetingId,
    approvedAt,
    suggestedPlaces,
    votes: [],
  };

  const supabase = createServerSupabaseClient();
  const { error: createMeetingError } = await supabase.from("meetings").insert({
    id: meetingId,
    owner_user_id: ownerUserId,
    approved_at: approvedAt,
    expires_at: expiresAt,
    participants_json: session.participants,
    geographic_center_json: session.geographicCenter,
    selected_place_json: session.selectedPlace,
    suggested_places_json: session.suggestedPlaces,
    participant_routes_json: session.participantRoutes,
  });
  if (createMeetingError) {
    throw new Error(`Meeting opslaan mislukt: ${createMeetingError.message}`);
  }

  const participantRows = session.participants.map((participant) => ({
    meeting_id: meetingId,
    participant_id: participant.id,
    participant_name: participant.name,
    participant_location: participant.location,
    latitude: participant.latitude,
    longitude: participant.longitude,
  }));

  if (participantRows.length > 0) {
    const { error: insertParticipantsError } = await supabase
      .from("meeting_participants")
      .insert(participantRows);

    if (insertParticipantsError) {
      await supabase.from("meetings").delete().eq("id", meetingId);
      throw new Error(`Meeting deelnemers opslaan mislukt: ${insertParticipantsError.message}`);
    }
  }

  return {
    session,
    expiresAt,
  };
}

export async function getMeetingSession(meetingId: string): Promise<MeetingSessionData | null> {
  const nowMs = Date.now();
  const meetingRow = await getMeetingRowById(meetingId);
  if (!meetingRow || isMeetingExpired(meetingRow.expiresAt, nowMs)) {
    return null;
  }

  const votes = await getVotesByMeetingId(meetingId);
  return toMeetingSessionData(meetingRow, votes);
}

export async function getMeetingSessionForOwner(
  meetingId: string,
  ownerUserId: string,
): Promise<MeetingSessionData | null> {
  const nowMs = Date.now();
  const meetingRow = await getMeetingRowById(meetingId);
  if (!meetingRow || meetingRow.ownerUserId !== ownerUserId || isMeetingExpired(meetingRow.expiresAt, nowMs)) {
    return null;
  }

  const votes = await getVotesByMeetingId(meetingId);
  return toMeetingSessionData(meetingRow, votes);
}

export async function addMeetingVote(
  meetingId: string,
  input: AddMeetingVoteInput,
  voterUserId?: string | null,
): Promise<{ session: MeetingSessionData; vote: MeetingLocationVote } | null> {
  const nowMs = Date.now();
  const meetingRow = await getMeetingRowById(meetingId);
  if (!meetingRow || isMeetingExpired(meetingRow.expiresAt, nowMs)) {
    return null;
  }

  const votedPlace = getSuggestedPlacesFromRow(meetingRow).find((place) => place.id === input.placeId);
  if (!votedPlace) {
    return null;
  }

  const voteId = nanoid(14);
  const trimmedParticipantName = input.participantName.trim();
  const trimmedComment = input.comment ? input.comment.trim().slice(0, MAX_VOTE_COMMENT_LENGTH) : null;
  const createdAt = new Date(nowMs).toISOString();

  const supabase = createServerSupabaseClient();
  const { error: createVoteError } = await supabase.from("votes").insert({
    id: voteId,
    meeting_id: meetingId,
    user_id: voterUserId ?? null,
    participant_name: trimmedParticipantName,
    place_id: votedPlace.id,
    place_name: votedPlace.name,
    created_at: createdAt,
  });
  if (createVoteError) {
    throw new Error(`Stem opslaan mislukt: ${createVoteError.message}`);
  }

  if (trimmedComment) {
    const { error: createCommentError } = await supabase.from("comments").insert({
      id: nanoid(14),
      vote_id: voteId,
      meeting_id: meetingId,
      user_id: voterUserId ?? null,
      content: trimmedComment,
      created_at: createdAt,
    });
    if (createCommentError) {
      await supabase.from("votes").delete().eq("id", voteId);
      throw new Error(`Reactie opslaan mislukt: ${createCommentError.message}`);
    }
  }

  const vote: MeetingLocationVote = {
    id: voteId,
    participantName: trimmedParticipantName,
    placeId: votedPlace.id,
    placeName: votedPlace.name,
    comment: trimmedComment,
    createdAt,
  };

  const session = await getMeetingSession(meetingId);
  if (!session) {
    return null;
  }

  return { session, vote };
}

export async function getSavedMeetingsForUser(ownerUserId: string): Promise<SavedMeetingSummary[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("meetings")
    .select("id, approved_at, participants_json, selected_place_json, suggested_places_json")
    .eq("owner_user_id", ownerUserId)
    .order("approved_at", { ascending: false });

  if (error) {
    throw new Error(`Opgeslagen meetings ophalen mislukt: ${error.message}`);
  }

  return (data ?? []).map((meeting) => {
    const selectedPlace = meeting.selected_place_json as SuitablePlace;
    const suggestedPlaces = normalizeSuggestedPlaces(
      selectedPlace,
      (meeting.suggested_places_json as SuitablePlace[]) ?? [],
    );

    return {
      meetingId: meeting.id as string,
      approvedAt: meeting.approved_at as string,
      participants: cloneParticipants((meeting.participants_json as MeetingSessionParticipant[]) ?? []),
      selectedPlace: clonePlace(selectedPlace),
      suggestedPlaces,
    };
  });
}

export async function repeatSavedMeeting(
  ownerUserId: string,
  meetingId: string,
): Promise<{ session: MeetingSessionData; expiresAt: string } | null> {
  const savedMeeting = await getMeetingRowById(meetingId);
  if (!savedMeeting || savedMeeting.ownerUserId !== ownerUserId) {
    return null;
  }

  return await createMeetingSession(
    {
      participants: cloneParticipants(savedMeeting.participantsJson),
      geographicCenter: savedMeeting.geographicCenterJson
        ? cloneLatLng(savedMeeting.geographicCenterJson)
        : null,
      suggestedPlaces: getSuggestedPlacesFromRow(savedMeeting),
      selectedPlace: clonePlace(savedMeeting.selectedPlaceJson),
      participantRoutes: cloneParticipantRoutes(savedMeeting.participantRoutesJson),
    },
    ownerUserId,
  );
}
