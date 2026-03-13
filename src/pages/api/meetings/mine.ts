import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthenticatedUserId } from "../../../lib/api-auth";
import { getSavedMeetingsForUser } from "../../../lib/meeting-session-store";
import type { SavedMeetingSummary } from "../../../lib/meeting-session";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SavedMeetingSummary[] | { message: string }>,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ message: "Methode niet toegestaan." });
    return;
  }

  const authenticatedUserId = await getAuthenticatedUserId(req);
  if (!authenticatedUserId) {
    res.status(401).json({ message: "Je moet ingelogd zijn om je meetings te bekijken." });
    return;
  }

  try {
    const savedMeetings = await getSavedMeetingsForUser(authenticatedUserId);
    res.status(200).json(savedMeetings);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Opgeslagen meetings konden niet worden opgehaald." });
  }
}
