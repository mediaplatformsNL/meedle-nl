import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { GOOGLE_MAPS_API_KEY } from "../lib/config";
import { calculateGeographicMidpoint } from "../lib/geo";

const NETHERLANDS_CENTER = { lat: 52.1326, lng: 5.2913 };
const NETHERLANDS_ZOOM = 7;
const MAX_PARTICIPANTS = 25;

type ParticipantField = "name" | "location";
type ParticipantCoordinates = { latitude: number; longitude: number };

interface Participant {
  id: number;
  name: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
}

type ParticipantErrors = Partial<Record<ParticipantField, string>>;
type ParticipantGeocodeErrors = Record<number, string>;

interface GeocodingApiResponse {
  status: string;
  error_message?: string;
  results: Array<{
    geometry: {
      location: {
        lat: number;
        lng: number;
      };
    };
  }>;
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

async function geocodeLocation(location: string): Promise<ParticipantCoordinates | "not_found"> {
  const endpoint = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  endpoint.searchParams.set("address", location);
  endpoint.searchParams.set("key", GOOGLE_MAPS_API_KEY);

  const response = await fetch(endpoint.toString());
  if (!response.ok) {
    throw new Error("Geocoding request gaf een ongeldige HTTP response.");
  }

  const geocodingResponse = (await response.json()) as GeocodingApiResponse;
  if (geocodingResponse.status === "ZERO_RESULTS") {
    return "not_found";
  }

  if (geocodingResponse.status !== "OK" || geocodingResponse.results.length === 0) {
    throw new Error(
      geocodingResponse.error_message ??
        `Google Geocoding API retourneerde status ${geocodingResponse.status}.`,
    );
  }

  const coordinates = geocodingResponse.results[0].geometry.location;
  return { latitude: coordinates.lat, longitude: coordinates.lng };
}

export default function Map() {
  const mapRef = useRef<HTMLDivElement>(null);
  const nextIdRef = useRef(2);
  const [participants, setParticipants] = useState<Participant[]>([
    { id: 1, name: "", location: "", latitude: null, longitude: null },
  ]);
  const [touchedFields, setTouchedFields] = useState<
    Record<number, Partial<Record<ParticipantField, boolean>>>
  >({});
  const [hasTriedToContinue, setHasTriedToContinue] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [participantGeocodeErrors, setParticipantGeocodeErrors] = useState<ParticipantGeocodeErrors>(
    {},
  );
  const [geographicCenter, setGeographicCenter] = useState<{ lat: number; lng: number } | null>(null);
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
      { id: nextIdRef.current++, name: "", location: "", latitude: null, longitude: null },
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
    setParticipantGeocodeErrors((previousErrors) => {
      if (!(idToRemove in previousErrors)) {
        return previousErrors;
      }

      const nextErrors = { ...previousErrors };
      delete nextErrors[idToRemove];
      return nextErrors;
    });
    setGeographicCenter(null);
    setContinueStatusMessage(null);
  }

  function handleParticipantChange(idToUpdate: number, field: ParticipantField, value: string) {
    setParticipants((previousParticipants) =>
      previousParticipants.map((participant) => {
        if (participant.id !== idToUpdate) {
          return participant;
        }

        if (field === "location") {
          return { ...participant, location: value, latitude: null, longitude: null };
        }

        return { ...participant, name: value };
      }),
    );
    if (field === "location") {
      setParticipantGeocodeErrors((previousErrors) => {
        if (!(idToUpdate in previousErrors)) {
          return previousErrors;
        }

        const nextErrors = { ...previousErrors };
        delete nextErrors[idToUpdate];
        return nextErrors;
      });
      setGeographicCenter(null);
    }
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasTriedToContinue(true);

    if (!canContinue) {
      setGeographicCenter(null);
      setContinueStatusMessage(null);
      return;
    }

    setIsGeocoding(true);
    setGeographicCenter(null);
    setContinueStatusMessage(null);
    try {
      const geocodeResults = await Promise.all(
        participants.map(async (participant) => {
          try {
            const geocodingResult = await geocodeLocation(participant.location.trim());
            if (geocodingResult === "not_found") {
              return {
                id: participant.id,
                error: `Adres of plaats "${participant.location}" is niet gevonden.`,
              };
            }

            return { id: participant.id, coordinates: geocodingResult };
          } catch (error) {
            console.error(error);
            return {
              id: participant.id,
              error: `Geocoding voor "${participant.location}" is mislukt. Probeer een specifieker adres of plaats.`,
            };
          }
        }),
      );

      const nextGeocodeErrors: ParticipantGeocodeErrors = {};
      const coordinatesByParticipant = new globalThis.Map<number, ParticipantCoordinates>();

      geocodeResults.forEach((result) => {
        if (result.error) {
          nextGeocodeErrors[result.id] = result.error;
          return;
        }

        if (result.coordinates) {
          coordinatesByParticipant.set(result.id, result.coordinates);
        }
      });

      setParticipants((previousParticipants) =>
        previousParticipants.map((participant) => {
          const coordinates = coordinatesByParticipant.get(participant.id);
          if (!coordinates) {
            return { ...participant, latitude: null, longitude: null };
          }

          return { ...participant, ...coordinates };
        }),
      );
      setParticipantGeocodeErrors(nextGeocodeErrors);

      if (Object.keys(nextGeocodeErrors).length > 0) {
        setContinueStatusMessage(
          "Niet alle adressen of plaatsen konden worden gevonden. Controleer de rode meldingen per deelnemer.",
        );
        return;
      }

      const midpoint = calculateGeographicMidpoint(
        Array.from(coordinatesByParticipant.values()).map((coordinates) => ({
          lat: coordinates.latitude,
          lng: coordinates.longitude,
        })),
      );
      setGeographicCenter(midpoint);
      setContinueStatusMessage(
        `Alle deelnemers zijn geocoded. Geografisch middelpunt: ${midpoint.lat.toFixed(6)}, ${midpoint.lng.toFixed(6)}.`,
      );
    } finally {
      setIsGeocoding(false);
    }
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
                const geocodeError = participantGeocodeErrors[participant.id];
                const hasLocationError = showLocationError || !!geocodeError;
                const describedByIds = [
                  showLocationError ? `participant-location-error-${participant.id}` : undefined,
                  geocodeError ? `participant-geocode-error-${participant.id}` : undefined,
                ]
                  .filter(Boolean)
                  .join(" ");

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
                aria-invalid={hasLocationError}
                aria-describedby={describedByIds || undefined}
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
              {!showLocationError && geocodeError && (
                <p className="participant-row__error" id={`participant-geocode-error-${participant.id}`}>
                  {geocodeError}
                </p>
              )}
              {participant.latitude !== null && participant.longitude !== null && !geocodeError && (
                <p className="participant-row__coordinates" role="status">
                  Coördinaten: {participant.latitude.toFixed(6)}, {participant.longitude.toFixed(6)}
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

        <button type="submit" className="participants-panel__continue" disabled={isGeocoding}>
          {isGeocoding ? "Bezig met geocoderen..." : "Doorgaan"}
        </button>

        {!canContinue && hasTriedToContinue && (
          <p className="participants-panel__validation-message" role="alert">
            Vul voor alle deelnemers zowel naam als locatie in voordat je doorgaat.
          </p>
        )}

        {canContinue && continueStatusMessage && (
          <p
            className={
              Object.keys(participantGeocodeErrors).length > 0
                ? "participants-panel__validation-message"
                : "participants-panel__success-message"
            }
            role={Object.keys(participantGeocodeErrors).length > 0 ? "alert" : "status"}
          >
            {continueStatusMessage}
          </p>
        )}
        {canContinue && geographicCenter && (
          <p className="participants-panel__success-message" role="status">
            Centrale coördinaat: {geographicCenter.lat.toFixed(6)}, {geographicCenter.lng.toFixed(6)}
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
