import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthenticatedUserId } from "../../../lib/api-auth";
import {
  buildGoogleCalendarAuthorizationUrl,
  createGoogleCalendarEvent,
  createGoogleCalendarOAuthState,
  getRequestOrigin,
  isAccessTokenExpired,
  readGoogleCalendarTokensFromRequest,
  refreshGoogleAccessToken,
  writeGoogleCalendarTokensCookie,
} from "../../../lib/google-calendar";
import type { MeetingSessionData } from "../../../lib/meeting-session";
import { getMeetingSessionForOwner } from "../../../lib/meeting-session-store";

interface CreateGoogleCalendarEventBody {
  meetingId: string;
  startsAt: string;
  durationMinutes: number;
}

interface CreateGoogleCalendarEventSuccessResponse {
  requiresOAuth: false;
  eventId: string;
  eventHtmlLink: string;
}

interface CreateGoogleCalendarEventRequiresOAuthResponse {
  requiresOAuth: true;
  authorizationUrl: string;
  message: string;
}

type CreateGoogleCalendarEventResponse =
  | CreateGoogleCalendarEventSuccessResponse
  | CreateGoogleCalendarEventRequiresOAuthResponse
  | { message: string };

function parseRequestBody(body: unknown): CreateGoogleCalendarEventBody | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const payload = body as Partial<CreateGoogleCalendarEventBody>;
  if (
    typeof payload.meetingId !== "string" ||
    payload.meetingId.trim().length === 0 ||
    typeof payload.startsAt !== "string" ||
    payload.startsAt.trim().length === 0 ||
    typeof payload.durationMinutes !== "number" ||
    !Number.isInteger(payload.durationMinutes)
  ) {
    return null;
  }

  if (payload.durationMinutes < 15 || payload.durationMinutes > 12 * 60) {
    return null;
  }

  const startsAtDate = new Date(payload.startsAt);
  if (!Number.isFinite(startsAtDate.getTime())) {
    return null;
  }

  return {
    meetingId: payload.meetingId,
    startsAt: payload.startsAt,
    durationMinutes: payload.durationMinutes,
  };
}

function buildOAuthAuthorizationUrl(
  req: NextApiRequest,
  userId: string,
  body: CreateGoogleCalendarEventBody,
): string {
  const state = createGoogleCalendarOAuthState({
    userId,
    meetingId: body.meetingId,
    startsAt: body.startsAt,
    durationMinutes: body.durationMinutes,
    returnToPath: `/?meeting=${encodeURIComponent(body.meetingId)}`,
    issuedAt: Date.now(),
  });

  return buildGoogleCalendarAuthorizationUrl(req, state, true);
}

function buildCalendarEventDescription(
  req: NextApiRequest,
  meeting: MeetingSessionData,
): string {
  const participantRows = meeting.participants.map((participant, index) => {
    const participantName = participant.name.trim() || `Deelnemer ${index + 1}`;
    return `- ${participantName} (vertrek: ${participant.location})`;
  });
  const meetingUrl = new URL(
    `/meeting/${encodeURIComponent(meeting.meetingId)}`,
    getRequestOrigin(req),
  ).toString();

  return [
    "Definitieve afspraak vanuit Meedle NL.",
    `Meeting-link: ${meetingUrl}`,
    `Locatie: ${meeting.selectedPlace.name} (${meeting.selectedPlace.address})`,
    "",
    "Deelnemers:",
    ...participantRows,
  ].join("\n");
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CreateGoogleCalendarEventResponse>,
): Promise<void> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ message: "Methode niet toegestaan." });
    return;
  }

  const organizerUserId = await getAuthenticatedUserId(req);
  if (!organizerUserId) {
    res.status(401).json({ message: "Log in om Google Calendar te gebruiken." });
    return;
  }

  const parsedBody = parseRequestBody(req.body);
  if (!parsedBody) {
    res.status(400).json({
      message: "Ongeldige payload. Gebruik meetingId, startsAt en durationMinutes.",
    });
    return;
  }

  const meeting = await getMeetingSessionForOwner(parsedBody.meetingId, organizerUserId);
  if (!meeting) {
    res.status(404).json({ message: "Meeting niet gevonden of je bent geen organisator van deze meeting." });
    return;
  }

  const startsAtDate = new Date(parsedBody.startsAt);
  const endsAtDate = new Date(startsAtDate.getTime() + parsedBody.durationMinutes * 60 * 1000);

  const eventPayload = {
    summary: `Meeting: ${meeting.selectedPlace.name}`,
    description: buildCalendarEventDescription(req, meeting),
    location: meeting.selectedPlace.address,
    startsAtIso: startsAtDate.toISOString(),
    endsAtIso: endsAtDate.toISOString(),
  };

  const oauthResponse: CreateGoogleCalendarEventRequiresOAuthResponse = {
    requiresOAuth: true,
    authorizationUrl: buildOAuthAuthorizationUrl(req, organizerUserId, parsedBody),
    message: "Google OAuth toestemming is nodig om een event aan te maken.",
  };

  let tokens = readGoogleCalendarTokensFromRequest(req, organizerUserId);
  if (!tokens) {
    res.status(401).json(oauthResponse);
    return;
  }

  try {
    if (isAccessTokenExpired(tokens)) {
      if (!tokens.refreshToken) {
        res.status(401).json(oauthResponse);
        return;
      }

      tokens = await refreshGoogleAccessToken(req, tokens.refreshToken);
      writeGoogleCalendarTokensCookie(res, organizerUserId, tokens);
    }

    try {
      const createdEvent = await createGoogleCalendarEvent(tokens.accessToken, eventPayload);
      res.status(200).json({
        requiresOAuth: false,
        eventId: createdEvent.id,
        eventHtmlLink: createdEvent.htmlLink,
      });
      return;
    } catch (error) {
      const responseStatus =
        typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? ((error as { statusCode: number }).statusCode ?? 0)
          : 0;

      if (responseStatus === 401 && tokens.refreshToken) {
        tokens = await refreshGoogleAccessToken(req, tokens.refreshToken);
        writeGoogleCalendarTokensCookie(res, organizerUserId, tokens);
        const retriedEvent = await createGoogleCalendarEvent(tokens.accessToken, eventPayload);
        res.status(200).json({
          requiresOAuth: false,
          eventId: retriedEvent.id,
          eventHtmlLink: retriedEvent.htmlLink,
        });
        return;
      }

      if (responseStatus === 401) {
        res.status(401).json(oauthResponse);
        return;
      }

      throw error;
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: error instanceof Error ? error.message : "Google Calendar event maken is mislukt.",
    });
  }
}
