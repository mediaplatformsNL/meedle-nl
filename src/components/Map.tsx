import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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

type ParticipantErrors = Partial<Record<ParticipantField, string>>;

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

function validateParticipant(participant: Participant): ParticipantErrors {
  const errors: ParticipantErrors = {};

  if (!participant.name.trim()) {
    errors.name = "Naam is verplicht.";
  }

  if (!participant.location.trim()) {
    errors.location = "Locatie is verplicht.";
  }

  return errors;
}

export default function Map() {
  const mapRef = useRef<HTMLDivElement>(null);
  const nextIdRef = useRef(2);
  const [participants, setParticipants] = useState<Participant[]>([
    { id: 1, name: "", location: "" },
  ]);
  const [touchedFields, setTouchedFields] = useState<
    Record<number, Partial<Record<ParticipantField, boolean>>>
  >({});
  const [hasTriedToContinue, setHasTriedToContinue] = useState(false);
  const [continueStatusMessage, setContinueStatusMessage] = useState<string | null>(null);
  const hasReachedParticipantLimit = participants.length >= MAX_PARTICIPANTS;
  const participantErrors = useMemo(
    () =>
      participants.reduce<Record<number, ParticipantErrors>>((errorsByParticipant, participant) => {
        errorsByParticipant[participant.id] = validateParticipant(participant);
        return errorsByParticipant;
      }, {}),
    [participants],
  );
  const hasFieldErrors = participants.some(
    (participant) => Object.keys(participantErrors[participant.id] ?? {}).length > 0,
  );
  const canContinue = participants.length > 0 && !hasFieldErrors;

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
    setTouchedFields((previousTouchedFields) => {
      const nextTouchedFields = { ...previousTouchedFields };
      delete nextTouchedFields[idToRemove];
      return nextTouchedFields;
    });
    setContinueStatusMessage(null);
  }

  function handleParticipantChange(idToUpdate: number, field: ParticipantField, value: string) {
    setParticipants((previousParticipants) =>
      previousParticipants.map((participant) =>
        participant.id === idToUpdate ? { ...participant, [field]: value } : participant,
      ),
    );
    setContinueStatusMessage(null);
  }

  function handleParticipantBlur(idToUpdate: number, field: ParticipantField) {
    setTouchedFields((previousTouchedFields) => ({
      ...previousTouchedFields,
      [idToUpdate]: {
        ...previousTouchedFields[idToUpdate],
        [field]: true,
      },
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasTriedToContinue(true);

    if (!canContinue) {
      setContinueStatusMessage(null);
      return;
    }

    setContinueStatusMessage("Alle deelnemers zijn volledig ingevuld. Je kunt doorgaan.");
  }

  return (
    <div className="map-wrapper">
      <div ref={mapRef} className="map-fullscreen" aria-label="Google Maps kaart van Nederland" />
      <form className="participants-panel" aria-label="Deelnemersbeheer" onSubmit={handleSubmit} noValidate>
        <div className="participants-panel__header">
          <h2>Deelnemers</h2>
          <p>
            {participants.length} / {MAX_PARTICIPANTS}
          </p>
        </div>

        <div className="participants-panel__list">
          {participants.map((participant, index) => (
            <article className="participant-row" key={participant.id}>
              {(() => {
                const errors = participantErrors[participant.id] ?? {};
                const showNameError = (hasTriedToContinue || touchedFields[participant.id]?.name) && !!errors.name;
                const showLocationError =
                  (hasTriedToContinue || touchedFields[participant.id]?.location) && !!errors.location;

                return (
                  <>
              <p className="participant-row__title">Deelnemer {index + 1}</p>

              <label htmlFor={`participant-name-${participant.id}`}>Naam *</label>
              <input
                id={`participant-name-${participant.id}`}
                type="text"
                value={participant.name}
                required
                placeholder="Bijv. Sam Verbeek"
                aria-invalid={showNameError}
                aria-describedby={showNameError ? `participant-name-error-${participant.id}` : undefined}
                onChange={(event) =>
                  handleParticipantChange(participant.id, "name", event.target.value)
                }
                onBlur={() => handleParticipantBlur(participant.id, "name")}
              />
              {showNameError && (
                <p className="participant-row__error" id={`participant-name-error-${participant.id}`}>
                  {errors.name}
                </p>
              )}

              <label htmlFor={`participant-location-${participant.id}`}>Locatie (adres of plaats) *</label>
              <input
                id={`participant-location-${participant.id}`}
                type="text"
                value={participant.location}
                required
                placeholder="Bijv. Utrecht"
                aria-invalid={showLocationError}
                aria-describedby={
                  showLocationError ? `participant-location-error-${participant.id}` : undefined
                }
                onChange={(event) =>
                  handleParticipantChange(participant.id, "location", event.target.value)
                }
                onBlur={() => handleParticipantBlur(participant.id, "location")}
              />
              {showLocationError && (
                <p className="participant-row__error" id={`participant-location-error-${participant.id}`}>
                  {errors.location}
                </p>
              )}

              <button type="button" onClick={() => handleRemoveParticipant(participant.id)}>
                Verwijderen
              </button>
                  </>
                );
              })()}
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

        <button type="submit" className="participants-panel__continue">
          Doorgaan
        </button>

        {!canContinue && hasTriedToContinue && (
          <p className="participants-panel__validation-message" role="alert">
            Vul voor alle deelnemers zowel naam als locatie in voordat je doorgaat.
          </p>
        )}

        {canContinue && continueStatusMessage && (
          <p className="participants-panel__success-message" role="status">
            {continueStatusMessage}
          </p>
        )}

        {hasReachedParticipantLimit && (
          <p className="participants-panel__limit-message" role="status">
            Maximum van 25 deelnemers bereikt.
          </p>
        )}
      </form>
    </div>
  );
}
