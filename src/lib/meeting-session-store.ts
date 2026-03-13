import { nanoid } from "nanoid";
import type { MeetingSessionCreateInput, MeetingSessionData } from "./meeting-session";

const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

interface StoredMeetingSession {
  data: MeetingSessionData;
  expiresAtMs: number;
}

const meetingSessions = new Map<string, StoredMeetingSession>();

function cleanupExpiredSessions(nowMs: number): void {
  for (const [meetingId, session] of meetingSessions.entries()) {
    if (session.expiresAtMs <= nowMs) {
      meetingSessions.delete(meetingId);
    }
  }
}

export function createMeetingSession(input: MeetingSessionCreateInput): {
  session: MeetingSessionData;
  expiresAt: string;
} {
  const nowMs = Date.now();
  cleanupExpiredSessions(nowMs);

  const meetingId = nanoid(24);
  const expiresAtMs = nowMs + SESSION_TTL_MS;

  const session: MeetingSessionData = {
    ...input,
    meetingId,
    approvedAt: new Date(nowMs).toISOString(),
  };

  meetingSessions.set(meetingId, { data: session, expiresAtMs });

  return {
    session,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export function getMeetingSession(meetingId: string): MeetingSessionData | null {
  const nowMs = Date.now();
  cleanupExpiredSessions(nowMs);

  const session = meetingSessions.get(meetingId);
  if (!session || session.expiresAtMs <= nowMs) {
    meetingSessions.delete(meetingId);
    return null;
  }

  return session.data;
}
