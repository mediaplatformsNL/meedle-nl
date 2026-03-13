import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET } from "./config";

const GOOGLE_OAUTH_AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_EVENTS_ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const GOOGLE_CALENDAR_TOKEN_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export const GOOGLE_CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.events"] as const;
export const GOOGLE_CALENDAR_TIMEZONE = "Europe/Amsterdam";

export interface GoogleCalendarOAuthStatePayload {
  userId: string;
  meetingId: string;
  startsAt: string;
  durationMinutes: number;
  returnToPath: string;
  issuedAt: number;
}

export interface GoogleCalendarTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAtEpochMs: number | null;
}

interface GoogleTokenResponsePayload {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signValue(value: string): string {
  return createHmac("sha256", GOOGLE_CALENDAR_CLIENT_SECRET).update(value).digest("base64url");
}

function isPlaceholder(value: string): boolean {
  return value.includes("{{") || value.trim().length === 0;
}

export function validateGoogleCalendarConfig(): void {
  if (isPlaceholder(GOOGLE_CALENDAR_CLIENT_ID)) {
    throw new Error("GOOGLE_CALENDAR_CLIENT_ID ontbreekt.");
  }
  if (isPlaceholder(GOOGLE_CALENDAR_CLIENT_SECRET)) {
    throw new Error("GOOGLE_CALENDAR_CLIENT_SECRET ontbreekt.");
  }
}

export function getRequestOrigin(req: NextApiRequest): string {
  const forwardedProtoHeader = req.headers["x-forwarded-proto"];
  const protocol = Array.isArray(forwardedProtoHeader)
    ? (forwardedProtoHeader[0] ?? "https")
    : (forwardedProtoHeader ?? "https");

  const host = req.headers.host;
  if (!host) {
    throw new Error("Host-header ontbreekt.");
  }

  return `${protocol}://${host}`;
}

export function getGoogleCalendarRedirectUri(req: NextApiRequest): string {
  return new URL("/api/google-calendar/oauth/callback", getRequestOrigin(req)).toString();
}

export function createGoogleCalendarOAuthState(payload: GoogleCalendarOAuthStatePayload): string {
  const serializedPayload = JSON.stringify(payload);
  const encodedPayload = toBase64Url(serializedPayload);
  const signature = signValue(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function parseGoogleCalendarOAuthState(
  stateValue: string | null | undefined,
): GoogleCalendarOAuthStatePayload | null {
  if (!stateValue) {
    return null;
  }

  const [encodedPayload, providedSignature] = stateValue.split(".");
  if (!encodedPayload || !providedSignature) {
    return null;
  }

  const expectedSignature = signValue(encodedPayload);
  const providedSignatureBuffer = Buffer.from(providedSignature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);

  if (providedSignatureBuffer.length !== expectedSignatureBuffer.length) {
    return null;
  }
  if (!timingSafeEqual(providedSignatureBuffer, expectedSignatureBuffer)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64Url(encodedPayload)) as Partial<GoogleCalendarOAuthStatePayload>;
    if (
      typeof parsed.userId !== "string" ||
      typeof parsed.meetingId !== "string" ||
      typeof parsed.startsAt !== "string" ||
      typeof parsed.durationMinutes !== "number" ||
      typeof parsed.returnToPath !== "string" ||
      typeof parsed.issuedAt !== "number"
    ) {
      return null;
    }

    if (!parsed.returnToPath.startsWith("/")) {
      return null;
    }

    return {
      userId: parsed.userId,
      meetingId: parsed.meetingId,
      startsAt: parsed.startsAt,
      durationMinutes: parsed.durationMinutes,
      returnToPath: parsed.returnToPath,
      issuedAt: parsed.issuedAt,
    };
  } catch {
    return null;
  }
}

function getGoogleCalendarCookieName(userId: string): string {
  const hash = createHash("sha256").update(userId).digest("hex").slice(0, 24);
  return `meedle_gcal_${hash}`;
}

function parseCookies(rawCookieHeader: string | undefined): Record<string, string> {
  if (!rawCookieHeader) {
    return {};
  }

  return rawCookieHeader.split(";").reduce<Record<string, string>>((cookies, part) => {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) {
      return cookies;
    }

    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (!key) {
      return cookies;
    }

    cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function appendSetCookieHeader(res: NextApiResponse, cookieHeaderValue: string): void {
  const existingValue = res.getHeader("Set-Cookie");
  if (!existingValue) {
    res.setHeader("Set-Cookie", cookieHeaderValue);
    return;
  }

  if (Array.isArray(existingValue)) {
    res.setHeader("Set-Cookie", [...existingValue, cookieHeaderValue]);
    return;
  }

  res.setHeader("Set-Cookie", [String(existingValue), cookieHeaderValue]);
}

export function readGoogleCalendarTokensFromRequest(
  req: NextApiRequest,
  userId: string,
): GoogleCalendarTokens | null {
  const cookieName = getGoogleCalendarCookieName(userId);
  const cookieValue = parseCookies(req.headers.cookie)[cookieName];
  if (!cookieValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(cookieValue) as Partial<GoogleCalendarTokens>;
    if (
      typeof parsed.accessToken !== "string" ||
      (parsed.refreshToken !== null && typeof parsed.refreshToken !== "string") ||
      (parsed.expiresAtEpochMs !== null && typeof parsed.expiresAtEpochMs !== "number")
    ) {
      return null;
    }

    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken ?? null,
      expiresAtEpochMs: parsed.expiresAtEpochMs ?? null,
    };
  } catch {
    return null;
  }
}

export function writeGoogleCalendarTokensCookie(
  res: NextApiResponse,
  userId: string,
  tokens: GoogleCalendarTokens,
): void {
  const cookieName = getGoogleCalendarCookieName(userId);
  const payload = encodeURIComponent(JSON.stringify(tokens));
  const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const cookieHeader = `${cookieName}=${payload}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${GOOGLE_CALENDAR_TOKEN_COOKIE_MAX_AGE_SECONDS}${secureCookie}`;
  appendSetCookieHeader(res, cookieHeader);
}

export function isAccessTokenExpired(tokens: GoogleCalendarTokens): boolean {
  if (!tokens.expiresAtEpochMs) {
    return false;
  }

  // Buffer van 30 seconden om race conditions rond expiratie te voorkomen.
  return Date.now() >= tokens.expiresAtEpochMs - 30_000;
}

export function buildGoogleCalendarAuthorizationUrl(
  req: NextApiRequest,
  state: string,
  promptConsent: boolean,
): string {
  validateGoogleCalendarConfig();

  const url = new URL(GOOGLE_OAUTH_AUTHORIZE_ENDPOINT);
  url.searchParams.set("client_id", GOOGLE_CALENDAR_CLIENT_ID);
  url.searchParams.set("redirect_uri", getGoogleCalendarRedirectUri(req));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  if (promptConsent) {
    url.searchParams.set("prompt", "consent");
  }
  url.searchParams.set("state", state);

  return url.toString();
}

async function fetchGoogleTokenEndpoint(
  req: NextApiRequest,
  payload: URLSearchParams,
): Promise<GoogleTokenResponsePayload> {
  const response = await fetch(GOOGLE_OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload.toString(),
  });

  const responseJson = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const errorDescription = responseJson.error_description;
    throw new Error(
      typeof errorDescription === "string"
        ? `Google OAuth tokenfout: ${errorDescription}`
        : "Google OAuth token ophalen is mislukt.",
    );
  }

  return responseJson as GoogleTokenResponsePayload;
}

export async function exchangeAuthorizationCodeForGoogleTokens(
  req: NextApiRequest,
  authorizationCode: string,
): Promise<GoogleCalendarTokens> {
  validateGoogleCalendarConfig();

  const payload = new URLSearchParams({
    code: authorizationCode,
    client_id: GOOGLE_CALENDAR_CLIENT_ID,
    client_secret: GOOGLE_CALENDAR_CLIENT_SECRET,
    redirect_uri: getGoogleCalendarRedirectUri(req),
    grant_type: "authorization_code",
  });
  const tokenPayload = await fetchGoogleTokenEndpoint(req, payload);

  if (typeof tokenPayload.access_token !== "string") {
    throw new Error("Google OAuth gaf geen access_token terug.");
  }

  return {
    accessToken: tokenPayload.access_token,
    refreshToken: tokenPayload.refresh_token ?? null,
    expiresAtEpochMs:
      typeof tokenPayload.expires_in === "number"
        ? Date.now() + tokenPayload.expires_in * 1000
        : null,
  };
}

export async function refreshGoogleAccessToken(
  req: NextApiRequest,
  refreshToken: string,
): Promise<GoogleCalendarTokens> {
  validateGoogleCalendarConfig();

  const payload = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: GOOGLE_CALENDAR_CLIENT_ID,
    client_secret: GOOGLE_CALENDAR_CLIENT_SECRET,
    grant_type: "refresh_token",
  });
  const tokenPayload = await fetchGoogleTokenEndpoint(req, payload);

  if (typeof tokenPayload.access_token !== "string") {
    throw new Error("Google OAuth refresh gaf geen access_token terug.");
  }

  return {
    accessToken: tokenPayload.access_token,
    refreshToken,
    expiresAtEpochMs:
      typeof tokenPayload.expires_in === "number"
        ? Date.now() + tokenPayload.expires_in * 1000
        : null,
  };
}

export interface CreateGoogleCalendarEventInput {
  summary: string;
  description: string;
  location: string;
  startsAtIso: string;
  endsAtIso: string;
}

export interface CreatedGoogleCalendarEvent {
  id: string;
  htmlLink: string;
}

export async function createGoogleCalendarEvent(
  accessToken: string,
  input: CreateGoogleCalendarEventInput,
): Promise<CreatedGoogleCalendarEvent> {
  const response = await fetch(GOOGLE_CALENDAR_EVENTS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary: input.summary,
      description: input.description,
      location: input.location,
      start: {
        dateTime: input.startsAtIso,
        timeZone: GOOGLE_CALENDAR_TIMEZONE,
      },
      end: {
        dateTime: input.endsAtIso,
        timeZone: GOOGLE_CALENDAR_TIMEZONE,
      },
    }),
  });

  const responseJson = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const apiError = responseJson.error as Record<string, unknown> | undefined;
    const apiErrorMessage = apiError?.message;
    const error = new Error(
      typeof apiErrorMessage === "string"
        ? `Google Calendar event maken mislukt: ${apiErrorMessage}`
        : "Google Calendar event maken mislukt.",
    ) as Error & { statusCode?: number };
    error.statusCode = response.status;
    throw error;
  }

  const id = responseJson.id;
  const htmlLink = responseJson.htmlLink;
  if (typeof id !== "string" || typeof htmlLink !== "string") {
    throw new Error("Google Calendar response bevatte geen geldig event.");
  }

  return { id, htmlLink };
}
