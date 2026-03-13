import { useEffect, useRef, useState } from "react";
import { GOOGLE_MAPS_API_KEY } from "../lib/config";

const NETHERLANDS_CENTER = { lat: 52.1326, lng: 5.2913 };
const NETHERLANDS_ZOOM = 7;
const MAX_PARTICIPANTS = 25;

type ParticipantField = "name" | "location";

interface Participant {
  id: number;
  name: string;
  location: string;
}

declare global {
  interface Window {
    google?: {
      maps?: {
        Map: new (element: HTMLElement, options: Record<string, unknown>) => unknown;
      };
    };
  }
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

export default function Map() {
  const mapRef = useRef<HTMLDivElement>(null);
  const nextIdRef = useRef(2);
  const [participants, setParticipants] = useState<Participant[]>([
    { id: 1, name: "", location: "" },
  ]);
  const hasReachedParticipantLimit = participants.length >= MAX_PARTICIPANTS;

  useEffect(() => {
    let isUnmounted = false;

    async function initializeMap() {
      try {
        await loadGoogleMapsScript(GOOGLE_MAPS_API_KEY);

        if (isUnmounted || !mapRef.current || !window.google?.maps) {
          return;
        }

        new window.google.maps.Map(mapRef.current, {
          center: NETHERLANDS_CENTER,
          zoom: NETHERLANDS_ZOOM,
          fullscreenControl: false,
          streetViewControl: false,
        });
      } catch (error) {
        console.error(error);
      }
    }

    initializeMap();

    return () => {
      isUnmounted = true;
    };
  }, []);

  function handleAddParticipant() {
    if (hasReachedParticipantLimit) {
      return;
    }

    setParticipants((previousParticipants) => [
      ...previousParticipants,
      { id: nextIdRef.current++, name: "", location: "" },
    ]);
  }

  function handleRemoveParticipant(idToRemove: number) {
    setParticipants((previousParticipants) =>
      previousParticipants.filter((participant) => participant.id !== idToRemove),
    );
  }

  function handleParticipantChange(idToUpdate: number, field: ParticipantField, value: string) {
    setParticipants((previousParticipants) =>
      previousParticipants.map((participant) =>
        participant.id === idToUpdate ? { ...participant, [field]: value } : participant,
      ),
    );
  }

  return (
    <div className="map-wrapper">
      <div ref={mapRef} className="map-fullscreen" aria-label="Google Maps kaart van Nederland" />
      <aside className="participants-panel" aria-label="Deelnemersbeheer">
        <div className="participants-panel__header">
          <h2>Deelnemers</h2>
          <p>
            {participants.length} / {MAX_PARTICIPANTS}
          </p>
        </div>

        <div className="participants-panel__list">
          {participants.map((participant, index) => (
            <article className="participant-row" key={participant.id}>
              <p className="participant-row__title">Deelnemer {index + 1}</p>

              <label htmlFor={`participant-name-${participant.id}`}>Naam *</label>
              <input
                id={`participant-name-${participant.id}`}
                type="text"
                value={participant.name}
                required
                placeholder="Bijv. Sam Verbeek"
                onChange={(event) =>
                  handleParticipantChange(participant.id, "name", event.target.value)
                }
              />

              <label htmlFor={`participant-location-${participant.id}`}>Locatie (adres of plaats) *</label>
              <input
                id={`participant-location-${participant.id}`}
                type="text"
                value={participant.location}
                required
                placeholder="Bijv. Utrecht"
                onChange={(event) =>
                  handleParticipantChange(participant.id, "location", event.target.value)
                }
              />

              <button type="button" onClick={() => handleRemoveParticipant(participant.id)}>
                Verwijderen
              </button>
            </article>
          ))}
        </div>

        <button
          type="button"
          className="participants-panel__add"
          onClick={handleAddParticipant}
          disabled={hasReachedParticipantLimit}
        >
          Deelnemer toevoegen
        </button>

        {hasReachedParticipantLimit && (
          <p className="participants-panel__limit-message" role="status">
            Maximum van 25 deelnemers bereikt.
          </p>
        )}
      </aside>
    </div>
  );
}
