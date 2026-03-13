import type { NextApiRequest, NextApiResponse } from "next";
import {
  createGoogleCalendarEvent,
  exchangeAuthorizationCodeForGoogleTokens,
  getRequestOrigin,
  parseGoogleCalendarOAuthState,
  readGoogleCalendarTokensFromRequest,
  refreshGoogleAccessToken,
  writeGoogleCalendarTokensCookie,
} from "../../../../lib/google-calendar";
import { getMeetingSessionForOwner } from "../../../../lib/meeting-session-store";

function getQueryParam(queryValue: string | string[] | undefined): string | null {
  if (!queryValue) {
    return null;
  }
  const value = Array.isArray(queryValue) ? queryValue[0] : queryValue;
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  return value;
}

function toSafeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Google Calendar koppeling is mislukt.";
  }

  const message = error.message.trim();
  if (message.length === 0) {
    return "Google Calendar koppeling is mislukt.";
  }

  return message.slice(0, 180);
}

function redirectToPlanner(
  req: NextApiRequest,
  res: NextApiResponse,
  returnToPath: string,
  status: "success" | "error",
  details: { eventHtmlLink?: string; errorMessage?: string },
): void {
  const redirectUrl = new URL(returnToPath, getRequestOrigin(req));
  redirectUrl.searchParams.set("calendar", status);
  if (details.eventHtmlLink) {
    redirectUrl.searchParams.set("calendarEventLink", details.eventHtmlLink);
  }
  if (details.errorMessage) {
    redirectUrl.searchParams.set("calendarError", details.errorMessage);
  }

  res.redirect(302, redirectUrl.toString());
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).send("Methode niet toegestaan.");
    return;
  }

  const authorizationCode = getQueryParam(req.query.code);
  const state = parseGoogleCalendarOAuthState(getQueryParam(req.query.state));
  if (!authorizationCode || !state) {
    res.status(400).send("Ongeldige Google OAuth callback.");
    return;
  }

  if (Date.now() - state.issuedAt > 20 * 60 * 1000) {
    redirectToPlanner(req, res, state.returnToPath, "error", {
      errorMessage: "OAuth-sessie is verlopen. Start de Google Calendar koppeling opnieuw.",
    });
    return;
  }

  try {
    const existingTokens = readGoogleCalendarTokensFromRequest(req, state.userId);
    let tokens = await exchangeAuthorizationCodeForGoogleTokens(req, authorizationCode);
    if (!tokens.refreshToken && existingTokens?.refreshToken) {
      tokens = {
        ...tokens,
        refreshToken: existingTokens.refreshToken,
      };
    }
    writeGoogleCalendarTokensCookie(res, state.userId, tokens);

    const meeting = await getMeetingSessionForOwner(state.meetingId, state.userId);
    if (!meeting) {
      throw new Error("Meeting niet gevonden of je bent geen organisator van deze meeting.");
    }

    const startsAtDate = new Date(state.startsAt);
    if (!Number.isFinite(startsAtDate.getTime())) {
      throw new Error("Ongeldige meetingtijd ontvangen.");
    }
    const endsAtDate = new Date(startsAtDate.getTime() + state.durationMinutes * 60 * 1000);

    const eventInput = {
      summary: `Meeting: ${meeting.selectedPlace.name}`,
      description: [
        "Definitieve afspraak vanuit Meedle NL.",
        `Locatie: ${meeting.selectedPlace.name} (${meeting.selectedPlace.address})`,
        "",
        "Deelnemers:",
        ...meeting.participants.map((participant, index) => {
          const participantName = participant.name.trim() || `Deelnemer ${index + 1}`;
          return `- ${participantName} (vertrek: ${participant.location})`;
        }),
      ].join("\n"),
      location: meeting.selectedPlace.address,
      startsAtIso: startsAtDate.toISOString(),
      endsAtIso: endsAtDate.toISOString(),
    };

    try {
      const createdEvent = await createGoogleCalendarEvent(tokens.accessToken, eventInput);
      redirectToPlanner(req, res, state.returnToPath, "success", {
        eventHtmlLink: createdEvent.htmlLink,
      });
      return;
    } catch (eventError) {
      const responseStatus =
        typeof (eventError as { statusCode?: unknown }).statusCode === "number"
          ? ((eventError as { statusCode: number }).statusCode ?? 0)
          : 0;

      if (responseStatus === 401 && tokens.refreshToken) {
        tokens = await refreshGoogleAccessToken(req, tokens.refreshToken);
        writeGoogleCalendarTokensCookie(res, state.userId, tokens);
        const retriedEvent = await createGoogleCalendarEvent(tokens.accessToken, eventInput);
        redirectToPlanner(req, res, state.returnToPath, "success", {
          eventHtmlLink: retriedEvent.htmlLink,
        });
        return;
      }

      throw eventError;
    }
  } catch (error) {
    console.error(error);
    redirectToPlanner(req, res, state.returnToPath, "error", {
      errorMessage: toSafeErrorMessage(error),
    });
  }
}
