import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthenticatedUserId } from "../../../../lib/api-auth";
import { repeatSavedMeeting } from "../../../../lib/meeting-session-store";
import type { CreateMeetingSessionResponse } from "../../../../lib/meeting-session";

function getMeetingIdFromQuery(queryValue: string | string[] | undefined): string | null {
  if (!queryValue) {
    return null;
  }

  const meetingId = Array.isArray(queryValue) ? queryValue[0] : queryValue;
  return meetingId.trim().length > 0 ? meetingId.trim() : null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CreateMeetingSessionResponse | { message: string }>,
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

  const authenticatedUserId = await getAuthenticatedUserId(req);
  if (!authenticatedUserId) {
    res.status(401).json({ message: "Je moet ingelogd zijn om meetings te herhalen." });
    return;
  }

  try {
    const repeatResult = await repeatSavedMeeting(authenticatedUserId, meetingId);
    if (!repeatResult) {
      res.status(404).json({ message: "Meeting niet gevonden of niet toegankelijk voor deze gebruiker." });
      return;
    }

    res.status(201).json({
      meetingId: repeatResult.session.meetingId,
      expiresAt: repeatResult.expiresAt,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Meeting kon niet worden herhaald." });
  }
}
