import type { NextApiRequest, NextApiResponse } from "next";
import { getMeetingSession } from "../../../../lib/meeting-session-store";
import type { MeetingSessionData } from "../../../../lib/meeting-session";

function getMeetingIdFromQuery(queryValue: string | string[] | undefined): string | null {
  if (!queryValue) {
    return null;
  }

  const meetingId = Array.isArray(queryValue) ? queryValue[0] : queryValue;
  return meetingId.trim().length > 0 ? meetingId : null;
}

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<MeetingSessionData | { message: string }>,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ message: "Methode niet toegestaan." });
    return;
  }

  const meetingId = getMeetingIdFromQuery(req.query.meetingId);
  if (!meetingId) {
    res.status(400).json({ message: "Geen geldige meeting-id ontvangen." });
    return;
  }

  const session = getMeetingSession(meetingId);
  if (!session) {
    res.status(404).json({ message: "Meeting-sessie niet gevonden of verlopen." });
    return;
  }

  res.status(200).json(session);
}
