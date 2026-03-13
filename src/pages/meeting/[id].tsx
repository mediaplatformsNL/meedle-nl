import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { GOOGLE_MAPS_API_KEY } from "../../lib/config";
import type { MeetingSessionData, MeetingSessionRouteOption } from "../../lib/meeting-session";
import type { SuitablePlace } from "../../lib/places";

const NETHERLANDS_CENTER = { lat: 52.1326, lng: 5.2913 };
const NETHERLANDS_ZOOM = 7;
const SINGLE_MARKER_ZOOM = 11;
const MAP_BOUNDS_PADDING_PX = 88;
const PARTICIPANT_MARKER_ICON_URL = "https://maps.google.com/mapfiles/ms/icons/blue-dot.png";
const SELECTED_PLACE_MARKER_ICON_URL = "https://maps.google.com/mapfiles/ms/icons/red-dot.png";
const SUGGESTED_PLACE_MARKER_ICON_URL = "https://maps.google.com/mapfiles/ms/icons/green-dot.png";
const DRIVING_ROUTE_COLOR = "#2563eb";
const TRANSIT_ROUTE_COLOR = "#ea580c";

type LatLngLiteral = { lat: number; lng: number };

interface GoogleMapsMapInstance {
  setCenter(latLng: LatLngLiteral): void;
  setZoom(zoom: number): void;
  fitBounds(bounds: GoogleMapsLatLngBoundsInstance, padding?: number): void;
}

interface GoogleMapsLatLngBoundsInstance {
  extend(latLng: LatLngLiteral): void;
}

interface GoogleMapsMarkerInstance {
  setMap(map: GoogleMapsMapInstance | null): void;
}

interface GoogleMapsPolylineSymbol {
  path: string;
  strokeOpacity?: number;
  scale?: number;
}

interface GoogleMapsPolylineInstance {
  setMap(map: GoogleMapsMapInstance | null): void;
}

function loadGoogleMapsScript(apiKey: string): Promise<void> {
  if (typeof window === "undefined" || window.google?.maps) {
    return Promise.resolve();
  }

  const existingScript = document.getElementById("google-maps-script") as HTMLScriptElement | null;
  if (existingScript) {
    return new Promise((resolve, reject) => {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("Google Maps script kon niet worden geladen.")),
        { once: true },
      );
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = "google-maps-script";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Maps script kon niet worden geladen."));
    document.head.appendChild(script);
  });
}

function formatPlaceCategory(category: SuitablePlace["type"]): string {
  switch (category) {
    case "restaurant":
      return "Restaurant";
    case "cafe":
      return "Café";
    case "hotel":
      return "Hotel";
    case "vergaderruimte":
      return "Vergaderruimte";
    default:
      return category;
  }
}

function summarizeRoute(route: MeetingSessionRouteOption): string {
  if (route.status !== "ok") {
    return route.message;
  }

  return `${route.durationText ?? "Reistijd onbekend"} · ${route.distanceText ?? "Afstand onbekend"}`;
}

function normalizeMeetingSession(session: MeetingSessionData): MeetingSessionData {
  const suggestedPlaces =
    Array.isArray(session.suggestedPlaces) && session.suggestedPlaces.length > 0
      ? session.suggestedPlaces
      : [session.selectedPlace];
  const votes = Array.isArray(session.votes) ? session.votes : [];

  return {
    ...session,
    suggestedPlaces,
    votes,
  };
}

export default function MeetingDetailPage() {
  const router = useRouter();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<GoogleMapsMapInstance | null>(null);
  const markerRefs = useRef<GoogleMapsMarkerInstance[]>([]);
  const routePolylineRefs = useRef<GoogleMapsPolylineInstance[]>([]);

  const [meeting, setMeeting] = useState<MeetingSessionData | null>(null);
  const [isLoadingMeeting, setIsLoadingMeeting] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [isSubmittingVote, setIsSubmittingVote] = useState(false);
  const [submitStatusMessage, setSubmitStatusMessage] = useState<string | null>(null);
  const [submitErrorMessage, setSubmitErrorMessage] = useState<string | null>(null);
  const [selectedVotePlaceId, setSelectedVotePlaceId] = useState<string | null>(null);
  const [participantName, setParticipantName] = useState("");
  const [comment, setComment] = useState("");

  const voteCountsByPlace = useMemo(() => {
    const countByPlace = new Map<string, number>();

    for (const vote of meeting?.votes ?? []) {
      countByPlace.set(vote.placeId, (countByPlace.get(vote.placeId) ?? 0) + 1);
    }

    return countByPlace;
  }, [meeting?.votes]);

  useEffect(() => {
    let isUnmounted = false;

    async function initializeMap() {
      try {
        await loadGoogleMapsScript(GOOGLE_MAPS_API_KEY);
        if (isUnmounted || !mapRef.current || !window.google?.maps) {
          return;
        }

        mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
          center: NETHERLANDS_CENTER,
          zoom: NETHERLANDS_ZOOM,
          fullscreenControl: false,
          streetViewControl: false,
        });
      } catch (error) {
        console.error(error);
      }
    }

    void initializeMap();

    return () => {
      isUnmounted = true;
      markerRefs.current.forEach((marker) => marker.setMap(null));
      markerRefs.current = [];
      routePolylineRefs.current.forEach((routePolyline) => routePolyline.setMap(null));
      routePolylineRefs.current = [];
      mapInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!router.isReady) {
      return;
    }

    const meetingId = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;
    if (typeof meetingId !== "string" || meetingId.trim().length === 0) {
      setLoadingError("Ongeldige meeting-id.");
      return;
    }

    let isCancelled = false;

    async function fetchMeeting() {
      setIsLoadingMeeting(true);
      setLoadingError(null);

      try {
        const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}`);
        if (!response.ok) {
          throw new Error(`Meetingdata ophalen mislukt (status: ${response.status}).`);
        }

        const session = normalizeMeetingSession((await response.json()) as MeetingSessionData);
        if (isCancelled) {
          return;
        }

        setMeeting(session);
        setSelectedVotePlaceId((current) => current ?? session.selectedPlace.id);
      } catch (error) {
        if (isCancelled) {
          return;
        }

        console.error(error);
        setLoadingError(
          "Meetingdata kon niet worden opgehaald. Controleer of de link geldig is en probeer opnieuw.",
        );
      } finally {
        if (!isCancelled) {
          setIsLoadingMeeting(false);
        }
      }
    }

    void fetchMeeting();

    return () => {
      isCancelled = true;
    };
  }, [router.isReady, router.query.id]);

  useEffect(() => {
    if (!router.isReady || !meeting) {
      return;
    }

    const meetingId = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;
    if (typeof meetingId !== "string" || meetingId.trim().length === 0) {
      return;
    }

    let isCancelled = false;
    const intervalId = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}`);
        if (!response.ok) {
          return;
        }

        const latestSession = normalizeMeetingSession((await response.json()) as MeetingSessionData);
        if (!isCancelled) {
          setMeeting(latestSession);
        }
      } catch (error) {
        console.error(error);
      }
    }, 15000);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [meeting?.meetingId, router.isReady, router.query.id]);

  useEffect(() => {
    if (!meeting) {
      return;
    }

    if (
      !selectedVotePlaceId ||
      !meeting.suggestedPlaces.some((place) => place.id === selectedVotePlaceId)
    ) {
      setSelectedVotePlaceId(meeting.selectedPlace.id);
    }
  }, [meeting, selectedVotePlaceId]);

  useEffect(() => {
    const googleMaps = window.google?.maps;
    if (!mapInstanceRef.current || !googleMaps || !meeting) {
      return;
    }

    const map = mapInstanceRef.current;
    const nextMarkers: GoogleMapsMarkerInstance[] = [];
    const bounds = new googleMaps.LatLngBounds();
    let firstMarkerPosition: LatLngLiteral | null = null;
    let markerCount = 0;

    markerRefs.current.forEach((marker) => marker.setMap(null));
    markerRefs.current = [];
    routePolylineRefs.current.forEach((routePolyline) => routePolyline.setMap(null));
    routePolylineRefs.current = [];

    const registerPosition = (position: LatLngLiteral) => {
      bounds.extend(position);
      if (!firstMarkerPosition) {
        firstMarkerPosition = position;
      }
      markerCount += 1;
    };

    meeting.participants.forEach((participant, index) => {
      if (participant.latitude === null || participant.longitude === null) {
        return;
      }

      const displayName = participant.name.trim() || `Deelnemer ${index + 1}`;
      const position = { lat: participant.latitude, lng: participant.longitude };
      const marker = new googleMaps.Marker({
        map,
        position,
        title: `Vertrekpunt ${displayName}`,
        icon: PARTICIPANT_MARKER_ICON_URL,
      });

      nextMarkers.push(marker);
      registerPosition(position);
    });

    for (const place of meeting.suggestedPlaces) {
      const isSelectedPlace = place.id === meeting.selectedPlace.id;
      const marker = new googleMaps.Marker({
        map,
        position: place.location,
        title: isSelectedPlace ? `Gekozen voorstel: ${place.name}` : `Voorgesteld: ${place.name}`,
        icon: isSelectedPlace ? SELECTED_PLACE_MARKER_ICON_URL : SUGGESTED_PLACE_MARKER_ICON_URL,
      });
      nextMarkers.push(marker);
      registerPosition(place.location);
    }

    const nextRoutePolylines: GoogleMapsPolylineInstance[] = [];
    const transitDashSymbol: GoogleMapsPolylineSymbol = {
      path: "M 0,-1 0,1",
      strokeOpacity: 1,
      scale: 3,
    };

    Object.values(meeting.participantRoutes).forEach((routeSet) => {
      if (routeSet.driving.status === "ok" && routeSet.driving.path.length > 0) {
        routeSet.driving.path.forEach((position) => registerPosition(position));
        const drivingPolyline = new googleMaps.Polyline({
          map,
          path: routeSet.driving.path,
          strokeColor: DRIVING_ROUTE_COLOR,
          strokeOpacity: 0.85,
          strokeWeight: 5,
        });
        nextRoutePolylines.push(drivingPolyline);
      }

      if (routeSet.transit.status === "ok" && routeSet.transit.path.length > 0) {
        routeSet.transit.path.forEach((position) => registerPosition(position));
        const transitPolyline = new googleMaps.Polyline({
          map,
          path: routeSet.transit.path,
          strokeColor: TRANSIT_ROUTE_COLOR,
          strokeOpacity: 0,
          strokeWeight: 5,
          icons: [
            {
              icon: transitDashSymbol,
              offset: "0",
              repeat: "12px",
            },
          ],
        });
        nextRoutePolylines.push(transitPolyline);
      }
    });

    markerRefs.current = nextMarkers;
    routePolylineRefs.current = nextRoutePolylines;

    if (markerCount === 0) {
      map.setCenter(NETHERLANDS_CENTER);
      map.setZoom(NETHERLANDS_ZOOM);
      return;
    }

    if (markerCount === 1 && firstMarkerPosition) {
      map.setCenter(firstMarkerPosition);
      map.setZoom(SINGLE_MARKER_ZOOM);
      return;
    }

    map.fitBounds(bounds, MAP_BOUNDS_PADDING_PX);
  }, [meeting]);

  async function handleSubmitVote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const meetingId = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;
    if (!meeting || typeof meetingId !== "string") {
      return;
    }

    const trimmedName = participantName.trim();
    if (!trimmedName || !selectedVotePlaceId) {
      setSubmitErrorMessage("Naam en gekozen locatie zijn verplicht om te stemmen.");
      setSubmitStatusMessage(null);
      return;
    }

    setIsSubmittingVote(true);
    setSubmitErrorMessage(null);
    setSubmitStatusMessage(null);

    try {
      const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/votes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          participantName: trimmedName,
          placeId: selectedVotePlaceId,
          comment: comment.trim() ? comment.trim() : null,
        }),
      });

      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(errorPayload?.message ?? `Stem plaatsen mislukt (status: ${response.status}).`);
      }

      const updatedMeeting = normalizeMeetingSession((await response.json()) as MeetingSessionData);
      setMeeting(updatedMeeting);
      setComment("");
      setSubmitStatusMessage("Je stem en reactie zijn opgeslagen en zichtbaar voor andere deelnemers.");
    } catch (error) {
      console.error(error);
      setSubmitErrorMessage(
        error instanceof Error ? error.message : "Stem plaatsen mislukt. Probeer het opnieuw.",
      );
    } finally {
      setIsSubmittingVote(false);
    }
  }

  return (
    <>
      <Head>
        <title>Meeting detail | Meedle NL</title>
        <meta name="description" content="Publieke meetingpagina met kaart, routes en stemmen." />
      </Head>
      <main className="meeting-page">
        <div ref={mapRef} className="meeting-page__map" aria-label="Kaart met meetingroutes" />
        <aside className="meeting-page__panel" aria-label="Meetinginformatie en stemmen">
          <h1>Meeting</h1>

          {isLoadingMeeting && <p className="meeting-page__status">Meetingdata laden...</p>}
          {loadingError && <p className="meeting-page__error">{loadingError}</p>}

          {meeting && (
            <>
              <section className="meeting-page__section">
                <h2>Gekozen voorstel</h2>
                <p className="meeting-page__place-name">{meeting.selectedPlace.name}</p>
                <p>{meeting.selectedPlace.address}</p>
                <p>
                  Type: {formatPlaceCategory(meeting.selectedPlace.type)}
                  {meeting.selectedPlace.rating !== null
                    ? ` · Rating ${meeting.selectedPlace.rating.toFixed(1)}`
                    : " · Rating onbekend"}
                </p>
              </section>

              <section className="meeting-page__section">
                <h2>Voorgestelde locaties ({meeting.suggestedPlaces.length})</h2>
                <ul className="meeting-page__list">
                  {meeting.suggestedPlaces.map((place) => {
                    const voteCount = voteCountsByPlace.get(place.id) ?? 0;
                    const isSelected = selectedVotePlaceId === place.id;
                    return (
                      <li
                        key={place.id}
                        className={
                          isSelected
                            ? "meeting-page__list-item meeting-page__list-item--selected"
                            : "meeting-page__list-item"
                        }
                      >
                        <p className="meeting-page__place-name">{place.name}</p>
                        <p>{place.address}</p>
                        <p>
                          Type: {formatPlaceCategory(place.type)} · Stemmen: {voteCount}
                        </p>
                        <button type="button" onClick={() => setSelectedVotePlaceId(place.id)}>
                          {isSelected ? "Gekozen voor stem" : "Kies voor stem"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section className="meeting-page__section">
                <h2>Plaats je stem/reactie</h2>
                <form className="meeting-page__vote-form" onSubmit={handleSubmitVote}>
                  <label htmlFor="meeting-vote-name">Naam *</label>
                  <input
                    id="meeting-vote-name"
                    value={participantName}
                    onChange={(event) => setParticipantName(event.target.value)}
                    required
                    placeholder="Bijv. Sam Verbeek"
                  />

                  <label htmlFor="meeting-vote-comment">Reactie (optioneel)</label>
                  <textarea
                    id="meeting-vote-comment"
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    rows={3}
                    placeholder="Bijv. Goed bereikbaar met OV."
                  />

                  <button type="submit" disabled={isSubmittingVote || !selectedVotePlaceId}>
                    {isSubmittingVote ? "Stem plaatsen..." : "Stem plaatsen"}
                  </button>
                </form>
                {submitStatusMessage && <p className="meeting-page__status">{submitStatusMessage}</p>}
                {submitErrorMessage && <p className="meeting-page__error">{submitErrorMessage}</p>}
              </section>

              <section className="meeting-page__section">
                <h2>Routes per deelnemer</h2>
                <ul className="meeting-page__list">
                  {meeting.participants.map((participant, index) => {
                    const routeSet = meeting.participantRoutes[participant.id];
                    if (!routeSet) {
                      return null;
                    }

                    const displayName = participant.name.trim() || `Deelnemer ${index + 1}`;
                    return (
                      <li key={participant.id} className="meeting-page__list-item">
                        <p className="meeting-page__place-name">{displayName}</p>
                        <p>Vertrekpunt: {participant.location}</p>
                        <p>Auto: {summarizeRoute(routeSet.driving)}</p>
                        <p>OV: {summarizeRoute(routeSet.transit)}</p>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section className="meeting-page__section">
                <h2>Stemmen & reacties ({meeting.votes.length})</h2>
                {meeting.votes.length === 0 ? (
                  <p>Nog geen stemmen geplaatst.</p>
                ) : (
                  <ul className="meeting-page__list">
                    {[...meeting.votes]
                      .sort(
                        (a, b) =>
                          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
                      )
                      .map((vote) => (
                        <li key={vote.id} className="meeting-page__list-item">
                          <p className="meeting-page__place-name">
                            {vote.participantName} stemde op {vote.placeName}
                          </p>
                          {vote.comment && <p>“{vote.comment}”</p>}
                          <p>{new Date(vote.createdAt).toLocaleString("nl-NL")}</p>
                        </li>
                      ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </aside>
      </main>
    </>
  );
}
