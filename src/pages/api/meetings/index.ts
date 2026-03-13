import type { NextApiRequest, NextApiResponse } from "next";
import {
  createMeetingSession,
} from "../../../lib/meeting-session-store";
import type {
  CreateMeetingSessionResponse,
  MeetingLatLngLiteral,
  MeetingSessionCreateInput,
  MeetingSessionParticipant,
  MeetingSessionParticipantRouteSet,
} from "../../../lib/meeting-session";
import type { SuitablePlace } from "../../../lib/places";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isLatLng(value: unknown): value is MeetingLatLngLiteral {
  if (!isObject(value)) {
    return false;
  }

  return isFiniteNumber(value.lat) && isFiniteNumber(value.lng);
}

function isParticipant(value: unknown): value is MeetingSessionParticipant {
  if (!isObject(value)) {
    return false;
  }

  const hasLatitude = value.latitude === null || isFiniteNumber(value.latitude);
  const hasLongitude = value.longitude === null || isFiniteNumber(value.longitude);

  return (
    Number.isInteger(value.id) &&
    typeof value.name === "string" &&
    typeof value.location === "string" &&
    hasLatitude &&
    hasLongitude
  );
}

function isRouteOption(value: unknown): boolean {
  if (!isObject(value)) {
    return false;
  }

  if (!["ok", "unavailable", "error"].includes(String(value.status))) {
    return false;
  }

  const hasDistance = value.distanceText === null || typeof value.distanceText === "string";
  const hasDuration = value.durationText === null || typeof value.durationText === "string";

  return (
    hasDistance &&
    hasDuration &&
    Array.isArray(value.path) &&
    value.path.every((pathEntry) => isLatLng(pathEntry)) &&
    typeof value.message === "string"
  );
}

function isParticipantRouteSet(value: unknown): value is MeetingSessionParticipantRouteSet {
  if (!isObject(value)) {
    return false;
  }

  return isRouteOption(value.driving) && isRouteOption(value.transit);
}

function isSuitablePlace(value: unknown): value is SuitablePlace {
  if (!isObject(value)) {
    return false;
  }

  const hasValidType = ["restaurant", "cafe", "hotel", "vergaderruimte"].includes(
    String(value.type),
  );
  const hasValidRating = value.rating === null || isFiniteNumber(value.rating);

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.address === "string" &&
    isLatLng(value.location) &&
    hasValidType &&
    hasValidRating
  );
}

function toCreateInput(body: unknown): MeetingSessionCreateInput | null {
  if (!isObject(body)) {
    return null;
  }

  if (!Array.isArray(body.participants) || body.participants.length === 0) {
    return null;
  }
  if (!body.participants.every((participant) => isParticipant(participant))) {
    return null;
  }

  const geographicCenter =
    body.geographicCenter === null
      ? null
      : isLatLng(body.geographicCenter)
        ? body.geographicCenter
        : null;

  if (!isSuitablePlace(body.selectedPlace)) {
    return null;
  }

  if (!isObject(body.participantRoutes)) {
    return null;
  }

  const participantRoutes: Record<number, MeetingSessionParticipantRouteSet> = {};
  for (const [participantId, routeSet] of Object.entries(body.participantRoutes)) {
    const participantIdAsNumber = Number(participantId);
    if (!Number.isInteger(participantIdAsNumber) || !isParticipantRouteSet(routeSet)) {
      return null;
    }
    participantRoutes[participantIdAsNumber] = routeSet;
  }

  if (Object.keys(participantRoutes).length === 0) {
    return null;
  }

  return {
    participants: body.participants,
    geographicCenter,
    selectedPlace: body.selectedPlace,
    participantRoutes,
  };
}

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<CreateMeetingSessionResponse | { message: string }>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ message: "Methode niet toegestaan." });
    return;
  }

  const createInput = toCreateInput(req.body);
  if (!createInput) {
    res.status(400).json({ message: "Ongeldige sessiedata ontvangen." });
    return;
  }

  const { session, expiresAt } = createMeetingSession(createInput);
  res.status(201).json({
    meetingId: session.meetingId,
    expiresAt,
  });
}
