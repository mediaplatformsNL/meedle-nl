import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import AuthPanel from "../components/AuthPanel";
import { useAuth } from "../lib/auth-context";
import type { CreateMeetingSessionResponse, SavedMeetingSummary } from "../lib/meeting-session";

function summarizeParticipants(meeting: SavedMeetingSummary): string {
  const participantNames = meeting.participants
    .map((participant, index) => participant.name.trim() || `Deelnemer ${index + 1}`)
    .slice(0, 5);

  if (meeting.participants.length > 5) {
    participantNames.push(`+${meeting.participants.length - 5} meer`);
  }

  return participantNames.join(", ");
}

function summarizeLocations(meeting: SavedMeetingSummary): string {
  const uniqueNames = new Set<string>();
  uniqueNames.add(meeting.selectedPlace.name);
  for (const place of meeting.suggestedPlaces) {
    uniqueNames.add(place.name);
  }

  return Array.from(uniqueNames).slice(0, 4).join(", ");
}

export default function SavedMeetingsPage() {
  const router = useRouter();
  const { user, isLoading, getAccessToken } = useAuth();
  const [meetings, setMeetings] = useState<SavedMeetingSummary[]>([]);
  const [isLoadingMeetings, setIsLoadingMeetings] = useState(false);
  const [isRepeatingMeetingId, setIsRepeatingMeetingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const hasMeetings = meetings.length > 0;
  const sortedMeetings = useMemo(
    () =>
      [...meetings].sort(
        (a, b) => new Date(b.approvedAt).getTime() - new Date(a.approvedAt).getTime(),
      ),
    [meetings],
  );

  useEffect(() => {
    if (!user) {
      setMeetings([]);
      setErrorMessage(null);
      setStatusMessage(null);
      return;
    }

    let isCancelled = false;
    async function fetchSavedMeetings() {
      setIsLoadingMeetings(true);
      setErrorMessage(null);
      setStatusMessage(null);
      try {
        const accessToken = await getAccessToken();
        if (!accessToken) {
          throw new Error("Kon geen geldige loginstatus vinden. Log opnieuw in.");
        }

        const response = await fetch("/api/meetings/mine", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        if (!response.ok) {
          const errorPayload = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(
            errorPayload?.message ?? `Meetings ophalen mislukt (status: ${response.status}).`,
          );
        }

        const payload = (await response.json()) as SavedMeetingSummary[];
        if (isCancelled) {
          return;
        }

        setMeetings(payload);
      } catch (error) {
        if (isCancelled) {
          return;
        }
        console.error(error);
        setErrorMessage(error instanceof Error ? error.message : "Meetings ophalen is mislukt.");
      } finally {
        if (!isCancelled) {
          setIsLoadingMeetings(false);
        }
      }
    }

    void fetchSavedMeetings();

    return () => {
      isCancelled = true;
    };
  }, [getAccessToken, user]);

  async function handleRepeatMeeting(meetingId: string) {
    setIsRepeatingMeetingId(meetingId);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error("Kon geen geldige loginstatus vinden. Log opnieuw in.");
      }

      const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/repeat`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(errorPayload?.message ?? `Meeting herhalen mislukt (status: ${response.status}).`);
      }

      const payload = (await response.json()) as CreateMeetingSessionResponse;
      setStatusMessage("Meeting is herhaald. De planner opent nu met de opgeslagen data.");
      await router.push(`/?meeting=${encodeURIComponent(payload.meetingId)}`);
    } catch (error) {
      console.error(error);
      setErrorMessage(error instanceof Error ? error.message : "Meeting herhalen is mislukt.");
    } finally {
      setIsRepeatingMeetingId(null);
    }
  }

  return (
    <>
      <Head>
        <title>Mijn meetings | Meedle NL</title>
        <meta
          name="description"
          content="Overzicht van opgeslagen meetings per ingelogde gebruiker met herhaaloptie."
        />
      </Head>
      <main className="saved-meetings-page">
        <div className="saved-meetings-page__auth">
          <AuthPanel />
        </div>

        <section className="saved-meetings-page__content" aria-label="Overzicht opgeslagen meetings">
          <h1>Mijn opgeslagen meetings</h1>
          {isLoading && <p className="saved-meetings-page__status">Loginstatus laden...</p>}
          {!isLoading && !user && (
            <p className="saved-meetings-page__status">
              Log in via e-mail om je opgeslagen meetings te bekijken en te herhalen.
            </p>
          )}

          {user && isLoadingMeetings && <p className="saved-meetings-page__status">Meetings laden...</p>}
          {errorMessage && <p className="saved-meetings-page__error">{errorMessage}</p>}
          {statusMessage && <p className="saved-meetings-page__status">{statusMessage}</p>}

          {user && !isLoadingMeetings && !hasMeetings && !errorMessage && (
            <p className="saved-meetings-page__status">
              Nog geen opgeslagen meetings. Maak eerst een meeting in de planner.
            </p>
          )}

          {user && sortedMeetings.length > 0 && (
            <ul className="saved-meetings-page__list">
              {sortedMeetings.map((meeting) => (
                <li key={meeting.meetingId} className="saved-meetings-page__item">
                  <p>
                    <strong>Datum:</strong> {new Date(meeting.approvedAt).toLocaleString("nl-NL")}
                  </p>
                  <p>
                    <strong>Deelnemers ({meeting.participants.length}):</strong>{" "}
                    {summarizeParticipants(meeting)}
                  </p>
                  <p>
                    <strong>Locaties:</strong> {summarizeLocations(meeting)}
                  </p>
                  <p>
                    <strong>Gekozen locatie:</strong> {meeting.selectedPlace.name} (
                    {meeting.selectedPlace.address})
                  </p>
                  <button
                    type="button"
                    onClick={() => handleRepeatMeeting(meeting.meetingId)}
                    disabled={isRepeatingMeetingId !== null}
                  >
                    {isRepeatingMeetingId === meeting.meetingId ? "Herhalen..." : "Meeting herhalen"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
