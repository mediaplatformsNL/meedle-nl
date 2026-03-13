import type { NextApiRequest, NextApiResponse } from "next";
import { addMeetingVote, getMeetingSession } from "../../../../lib/meeting-session-store";
import type { AddMeetingVoteInput, MeetingSessionData } from "../../../../lib/meeting-session";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getMeetingIdFromQuery(queryValue: string | string[] | undefined): string | null {
  if (!queryValue) {
    return null;
  }

  const meetingId = Array.isArray(queryValue) ? queryValue[0] : queryValue;
  return meetingId.trim().length > 0 ? meetingId.trim() : null;
}

function toAddVoteInput(body: unknown): AddMeetingVoteInput | null {
  if (!isObject(body)) {
    return null;
  }

  if (typeof body.participantName !== "string" || body.participantName.trim().length === 0) {
    return null;
  }

  if (typeof body.placeId !== "string" || body.placeId.trim().length === 0) {
    return null;
  }

  if (body.comment !== undefined && body.comment !== null && typeof body.comment !== "string") {
    return null;
  }

  return {
    participantName: body.participantName,
    placeId: body.placeId,
    comment: typeof body.comment === "string" && body.comment.trim().length > 0 ? body.comment : null,
  };
}

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<MeetingSessionData | { message: string }>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ message: "Methode niet toegestaan." });
    return;
  }

  const meetingId = getMeetingIdFromQuery(req.query.meetingId);
  if (!meetingId) {
    res.status(400).json({ message: "Geen geldige meeting-id ontvangen." });
    return;
  }

  const addVoteInput = toAddVoteInput(req.body);
  if (!addVoteInput) {
    res.status(400).json({
      message:
        "Ongeldige stemdata ontvangen. Naam en locatie-id zijn verplicht, reactie is optioneel.",
    });
    return;
  }

  const existingSession = getMeetingSession(meetingId);
  if (!existingSession) {
    res.status(404).json({ message: "Meeting-sessie niet gevonden of verlopen." });
    return;
  }

  const placeExists = existingSession.suggestedPlaces.some((place) => place.id === addVoteInput.placeId);
  if (!placeExists) {
    res.status(400).json({ message: "Gekozen locatie bestaat niet in deze meeting." });
    return;
  }

  const voteResult = addMeetingVote(meetingId, addVoteInput);
  if (!voteResult) {
    res.status(404).json({ message: "Meeting-sessie niet gevonden of verlopen." });
    return;
  }

  res.status(200).json(voteResult.session);
}
