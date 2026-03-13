import type { NextApiRequest, NextApiResponse } from "next";
import { addMeetingVote, getMeetingSession } from "../../../../lib/meeting-session-store";
import { getAuthenticatedUserId } from "../../../../lib/api-auth";
import { MAX_VOTE_COMMENT_LENGTH } from "../../../../lib/meeting-session";
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

function toAddVoteInput(body: unknown): { input: AddMeetingVoteInput } | { error: string } {
  if (!isObject(body)) {
    return { error: "Ongeldige stemdata ontvangen." };
  }

  if (typeof body.participantName !== "string" || body.participantName.trim().length === 0) {
    return { error: "Naam is verplicht om een stem/reactie te plaatsen." };
  }

  if (typeof body.placeId !== "string" || body.placeId.trim().length === 0) {
    return { error: "Kies een geldige locatie om te stemmen." };
  }

  if (body.comment !== undefined && body.comment !== null && typeof body.comment !== "string") {
    return { error: "Reactie moet tekst zijn." };
  }

  const normalizedComment =
    typeof body.comment === "string" && body.comment.trim().length > 0 ? body.comment.trim() : null;
  if (normalizedComment && normalizedComment.length > MAX_VOTE_COMMENT_LENGTH) {
    return { error: `Reactie mag maximaal ${MAX_VOTE_COMMENT_LENGTH} tekens bevatten.` };
  }

  return {
    input: {
      participantName: body.participantName,
      placeId: body.placeId,
      comment: normalizedComment,
    },
  };
}

export default async function handler(
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

  const addVoteInputResult = toAddVoteInput(req.body);
  if ("error" in addVoteInputResult) {
    res.status(400).json({
      message: addVoteInputResult.error,
    });
    return;
  }
  const addVoteInput = addVoteInputResult.input;

  try {
    const existingSession = await getMeetingSession(meetingId);
    if (!existingSession) {
      res.status(404).json({ message: "Meeting-sessie niet gevonden of verlopen." });
      return;
    }

    const placeExists = existingSession.suggestedPlaces.some((place) => place.id === addVoteInput.placeId);
    if (!placeExists) {
      res.status(400).json({ message: "Gekozen locatie bestaat niet in deze meeting." });
      return;
    }

    const authenticatedUserId = await getAuthenticatedUserId(req);
    const voteResult = await addMeetingVote(meetingId, addVoteInput, authenticatedUserId);
    if (!voteResult) {
      res.status(404).json({ message: "Meeting-sessie niet gevonden of verlopen." });
      return;
    }

    res.status(200).json(voteResult.session);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Stem of reactie kon niet worden opgeslagen." });
  }
}
