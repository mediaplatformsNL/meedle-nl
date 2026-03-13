import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/router";
import { GOOGLE_MAPS_API_KEY } from "../lib/config";
import { calculateGeographicMidpoint } from "../lib/geo";
import { findSuitablePlacesNearMidpoint, type SuitablePlace } from "../lib/places";
import type {
  CreateMeetingSessionResponse,
  MeetingSessionData,
  MeetingSessionParticipantRoutes,
} from "../lib/meeting-session";

const NETHERLANDS_CENTER = { lat: 52.1326, lng: 5.2913 };
const NETHERLANDS_ZOOM = 7;
const MAX_PARTICIPANTS = 25;
const SINGLE_MARKER_ZOOM = 11;
const MAP_BOUNDS_PADDING_PX = 96;
const PARTICIPANT_MARKER_ICON_URL = "https://maps.google.com/mapfiles/ms/icons/blue-dot.png";
const MIDPOINT_MARKER_ICON_URL = "https://maps.google.com/mapfiles/ms/icons/purple-dot.png";
const PLACE_MARKER_ICON_URL = "https://maps.google.com/mapfiles/ms/icons/green-dot.png";
const DRIVING_ROUTE_COLOR = "#2563eb";
const TRANSIT_ROUTE_COLOR = "#ea580c";

type ParticipantField = "name" | "location";
type ParticipantCoordinates = { latitude: number; longitude: number };
type LatLngLiteral = { lat: number; lng: number };
type RouteMode = "driving" | "transit";
type RouteFetchStatus = "ok" | "unavailable" | "error";

interface GoogleMapsMapInstance {
  setCenter(latLng: LatLngLiteral): void;
  setZoom(zoom: number): void;
  fitBounds(bounds: GoogleMapsLatLngBoundsInstance, padding?: number): void;
}

interface GoogleMapsLatLngBoundsInstance {
  extend(latLng: LatLngLiteral): void;
}

interface GoogleMapsLatLngInstance {
  lat(): number;
  lng(): number;
}

type MarkerLabel =
  | string
  | {
      text: string;
      color?: string;
      fontSize?: string;
      fontWeight?: string;
    };

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

interface GoogleMapsDirectionsLegDistanceOrDuration {
  text?: string;
  value?: number;
}

interface GoogleMapsDirectionsLegInstance {
  distance?: GoogleMapsDirectionsLegDistanceOrDuration;
  duration?: GoogleMapsDirectionsLegDistanceOrDuration;
}

interface GoogleMapsDirectionsRouteInstance {
  legs?: GoogleMapsDirectionsLegInstance[];
  overview_path?: GoogleMapsLatLngInstance[];
}

interface GoogleMapsDirectionsResultInstance {
  routes?: GoogleMapsDirectionsRouteInstance[];
}

interface GoogleMapsDirectionsRequest {
  origin: LatLngLiteral;
  destination: LatLngLiteral;
  travelMode: "DRIVING" | "TRANSIT";
  provideRouteAlternatives?: boolean;
  transitOptions?: {
    departureTime: Date;
  };
}

interface GoogleMapsDirectionsServiceInstance {
  route(
    request: GoogleMapsDirectionsRequest,
    callback: (result: GoogleMapsDirectionsResultInstance | null, status: string) => void,
  ): void;
}

interface Participant {
  id: number;
  name: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
}

type ParticipantErrors = Partial<Record<ParticipantField, string>>;
type ParticipantGeocodeErrors = Record<number, string>;

interface ParticipantRouteOption {
  status: RouteFetchStatus;
  distanceText: string | null;
  durationText: string | null;
  path: LatLngLiteral[];
  message: string;
}

interface ParticipantRouteSet {
  driving: ParticipantRouteOption;
  transit: ParticipantRouteOption;
}

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

declare global {
  interface Window {
    google?: {
      maps?: {
        Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapsMapInstance;
        Marker: new (options: {
          map: GoogleMapsMapInstance;
          position: LatLngLiteral;
          title?: string;
          label?: MarkerLabel;
          icon?: string;
        }) => GoogleMapsMarkerInstance;
        Polyline: new (options: {
          map: GoogleMapsMapInstance;
          path: LatLngLiteral[];
          strokeColor: string;
          strokeOpacity: number;
          strokeWeight: number;
          icons?: Array<{
            icon: GoogleMapsPolylineSymbol;
            offset?: string;
            repeat?: string;
          }>;
        }) => GoogleMapsPolylineInstance;
        DirectionsService: new () => GoogleMapsDirectionsServiceInstance;
        LatLngBounds: new () => GoogleMapsLatLngBoundsInstance;
      };
    };
  }
}

function truncateMarkerLabel(label: string, maxLength = 28): string {
  if (label.length <= maxLength) {
    return label;
  }

  return `${label.slice(0, maxLength - 1)}…`;
}

function isGeocodedParticipant(
  participant: Participant,
): participant is Participant & { latitude: number; longitude: number } {
  return typeof participant.latitude === "number" && typeof participant.longitude === "number";
}

function routeModeLabel(mode: RouteMode): string {
  return mode === "driving" ? "autoroute" : "OV-route";
}

function createUnavailableRouteOption(
  mode: RouteMode,
  status: RouteFetchStatus,
  message?: string,
): ParticipantRouteOption {
  const fallbackMessage =
    status === "error"
      ? `Route ophalen voor ${routeModeLabel(mode)} is mislukt.`
      : `Geen ${routeModeLabel(mode)} beschikbaar.`;

  return {
    status,
    distanceText: null,
    durationText: null,
    path: [],
    message: message ?? fallbackMessage,
  };
}

function summarizeRouteOption(routeOption: ParticipantRouteOption): string {
  if (routeOption.status !== "ok") {
    return routeOption.message;
  }

  return `${routeOption.durationText ?? "Reistijd onbekend"} · ${
    routeOption.distanceText ?? "Afstand onbekend"
  }`;
}

function normalizeParticipantRoutes(
  routesByParticipant: MeetingSessionParticipantRoutes,
): Record<number, ParticipantRouteSet> {
  const normalizedRoutes: Record<number, ParticipantRouteSet> = {};

  for (const [participantId, routeSet] of Object.entries(routesByParticipant)) {
    const numericParticipantId = Number(participantId);
    if (Number.isInteger(numericParticipantId)) {
      normalizedRoutes[numericParticipantId] = routeSet;
    }
  }

  return normalizedRoutes;
}

async function fetchDirectionsRoute(
  directionsService: GoogleMapsDirectionsServiceInstance,
  origin: LatLngLiteral,
  destination: LatLngLiteral,
  mode: RouteMode,
): Promise<ParticipantRouteOption> {
  const request: GoogleMapsDirectionsRequest = {
    origin,
    destination,
    travelMode: mode === "driving" ? "DRIVING" : "TRANSIT",
    provideRouteAlternatives: false,
  };

  if (mode === "transit") {
    request.transitOptions = { departureTime: new Date() };
  }

  return new Promise((resolve) => {
    directionsService.route(request, (result, status) => {
      if (status !== "OK" || !result?.routes?.length) {
        if (status === "ZERO_RESULTS" || status === "NOT_FOUND") {
          resolve(createUnavailableRouteOption(mode, "unavailable"));
          return;
        }

        resolve(
          createUnavailableRouteOption(
            mode,
            "error",
            `Route ophalen voor ${routeModeLabel(mode)} is mislukt (status: ${status}).`,
          ),
        );
        return;
      }

      const route = result.routes[0];
      const firstLeg = route.legs?.[0];
      const distanceText = firstLeg?.distance?.text?.trim() ?? null;
      const durationText = firstLeg?.duration?.text?.trim() ?? null;
      const path = (route.overview_path ?? []).map((point) => ({ lat: point.lat(), lng: point.lng() }));

      resolve({
        status: "ok",
        distanceText,
        durationText,
        path,
        message: `${routeModeLabel(mode)} beschikbaar.`,
      });
    });
  });
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
  const router = useRouter();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<GoogleMapsMapInstance | null>(null);
  const markerRefs = useRef<GoogleMapsMarkerInstance[]>([]);
  const routePolylineRefs = useRef<GoogleMapsPolylineInstance[]>([]);
  const nextIdRef = useRef(2);
  const [participants, setParticipants] = useState<Participant[]>([
    { id: 1, name: "", location: "", latitude: null, longitude: null },
  ]);
  const [touchedFields, setTouchedFields] = useState<
    Record<number, Partial<Record<ParticipantField, boolean>>>
  >({});
  const [hasTriedToContinue, setHasTriedToContinue] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isSearchingSuitablePlaces, setIsSearchingSuitablePlaces] = useState(false);
  const [participantGeocodeErrors, setParticipantGeocodeErrors] = useState<ParticipantGeocodeErrors>(
    {},
  );
  const [geographicCenter, setGeographicCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [suitablePlaces, setSuitablePlaces] = useState<SuitablePlace[]>([]);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [participantRoutes, setParticipantRoutes] = useState<Record<number, ParticipantRouteSet>>({});
  const [isCalculatingRoutes, setIsCalculatingRoutes] = useState(false);
  const [routeStatusMessage, setRouteStatusMessage] = useState<string | null>(null);
  const [isRouteStatusError, setIsRouteStatusError] = useState(false);
  const [activeRouteModeByParticipant, setActiveRouteModeByParticipant] = useState<
    Record<number, RouteMode>
  >({});
  const [isProposalApproved, setIsProposalApproved] = useState(false);
  const [meetingLink, setMeetingLink] = useState<string | null>(null);
  const [loadedMeetingId, setLoadedMeetingId] = useState<string | null>(null);
  const [meetingLinkStatusMessage, setMeetingLinkStatusMessage] = useState<string | null>(null);
  const [isGeneratingMeetingLink, setIsGeneratingMeetingLink] = useState(false);
  const [isLoadingMeetingSession, setIsLoadingMeetingSession] = useState(false);
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
  const geocodedParticipantCount = participants.filter(isGeocodedParticipant).length;
  const hasAllParticipantsGeocoded = participants.length > 0 && participants.every(isGeocodedParticipant);
  const selectedPlace = useMemo(
    () => suitablePlaces.find((place) => place.id === selectedPlaceId) ?? null,
    [selectedPlaceId, suitablePlaces],
  );
  const canCalculateRoutes =
    hasAllParticipantsGeocoded &&
    selectedPlace !== null &&
    !isGeocoding &&
    !isSearchingSuitablePlaces &&
    !isCalculatingRoutes;
  const hasRouteResults = Object.keys(participantRoutes).length > 0;
  const canApproveProposal = hasRouteResults && selectedPlace !== null && !isCalculatingRoutes;
  const canGenerateMeetingLink = canApproveProposal && isProposalApproved && !isGeneratingMeetingLink;

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

    initializeMap();

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
    const googleMaps = window.google?.maps;
    if (!mapInstanceRef.current || !googleMaps) {
      return;
    }

    const map = mapInstanceRef.current;
    const nextMarkers: GoogleMapsMarkerInstance[] = [];
    const bounds = new googleMaps.LatLngBounds();
    let firstMarkerPosition: LatLngLiteral | null = null;
    let markerCount = 0;

    markerRefs.current.forEach((marker) => marker.setMap(null));
    markerRefs.current = [];

    const registerPosition = (position: LatLngLiteral) => {
      bounds.extend(position);
      if (!firstMarkerPosition) {
        firstMarkerPosition = position;
      }
      markerCount += 1;
    };

    participants.forEach((participant, index) => {
      if (participant.latitude === null || participant.longitude === null) {
        return;
      }

      const displayName = participant.name.trim() || `Deelnemer ${index + 1}`;
      const position = { lat: participant.latitude, lng: participant.longitude };
      const marker = new googleMaps.Marker({
        map,
        position,
        title: `Deelnemer: ${displayName}`,
        label: {
          text: truncateMarkerLabel(displayName),
          color: "#0f172a",
          fontSize: "12px",
          fontWeight: "700",
        },
        icon: PARTICIPANT_MARKER_ICON_URL,
      });

      nextMarkers.push(marker);
      registerPosition(position);
    });

    if (geographicCenter) {
      const midpointMarker = new googleMaps.Marker({
        map,
        position: geographicCenter,
        title: `Geografisch middelpunt (${geographicCenter.lat.toFixed(6)}, ${geographicCenter.lng.toFixed(6)})`,
        label: {
          text: "Middelpunt",
          color: "#6b21a8",
          fontSize: "12px",
          fontWeight: "700",
        },
        icon: MIDPOINT_MARKER_ICON_URL,
      });
      nextMarkers.push(midpointMarker);
      registerPosition(geographicCenter);
    }

    suitablePlaces.forEach((place) => {
      const placeType = formatPlaceCategory(place.type);
      const labelText = `${place.name} (${placeType})`;
      const marker = new googleMaps.Marker({
        map,
        position: place.location,
        title: labelText,
        label: {
          text: truncateMarkerLabel(labelText),
          color: "#14532d",
          fontSize: "11px",
          fontWeight: "700",
        },
        icon: PLACE_MARKER_ICON_URL,
      });

      nextMarkers.push(marker);
      registerPosition(place.location);
    });

    Object.values(participantRoutes).forEach((routeSet) => {
      [routeSet.driving, routeSet.transit].forEach((routeOption) => {
        if (routeOption.status !== "ok") {
          return;
        }

        routeOption.path.forEach((position) => registerPosition(position));
      });
    });

    markerRefs.current = nextMarkers;

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
  }, [participants, geographicCenter, suitablePlaces, participantRoutes]);

  useEffect(() => {
    const googleMaps = window.google?.maps;
    if (!mapInstanceRef.current || !googleMaps) {
      return;
    }

    const map = mapInstanceRef.current;
    const nextRoutePolylines: GoogleMapsPolylineInstance[] = [];
    const transitDashSymbol: GoogleMapsPolylineSymbol = {
      path: "M 0,-1 0,1",
      strokeOpacity: 1,
      scale: 3,
    };

    routePolylineRefs.current.forEach((routePolyline) => routePolyline.setMap(null));
    routePolylineRefs.current = [];

    Object.values(participantRoutes).forEach((routeSet) => {
      if (routeSet.driving.status === "ok" && routeSet.driving.path.length > 0) {
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

    routePolylineRefs.current = nextRoutePolylines;
  }, [participantRoutes]);

  useEffect(() => {
    if (!router.isReady) {
      return;
    }

    const rawMeetingId = router.query.meeting;
    const meetingIdFromQueryValue = Array.isArray(rawMeetingId) ? rawMeetingId[0] : rawMeetingId;
    if (
      typeof meetingIdFromQueryValue !== "string" ||
      !meetingIdFromQueryValue ||
      meetingIdFromQueryValue === loadedMeetingId
    ) {
      return;
    }
    const meetingIdFromQuery = meetingIdFromQueryValue;

    let isCancelled = false;

    async function loadMeetingSessionFromUrl() {
      setIsLoadingMeetingSession(true);
      setMeetingLinkStatusMessage("Meeting-sessie laden vanuit gedeelde URL...");

      try {
        const response = await fetch(`/api/meetings/${encodeURIComponent(meetingIdFromQuery)}`);
        if (!response.ok) {
          throw new Error(`Meeting-sessie ophalen mislukt (status: ${response.status}).`);
        }

        const session = (await response.json()) as MeetingSessionData;
        if (isCancelled) {
          return;
        }

        const restoredRoutes = normalizeParticipantRoutes(session.participantRoutes);
        const maxParticipantId = session.participants.reduce(
          (highestId, participant) => Math.max(highestId, participant.id),
          0,
        );
        const activeModes: Record<number, RouteMode> = {};
        for (const participantId of Object.keys(restoredRoutes)) {
          activeModes[Number(participantId)] = "driving";
        }

        setParticipants(session.participants);
        nextIdRef.current = maxParticipantId + 1;
        setTouchedFields({});
        setHasTriedToContinue(false);
        setParticipantGeocodeErrors({});
        setGeographicCenter(session.geographicCenter);
        setSuitablePlaces([session.selectedPlace]);
        setSelectedPlaceId(session.selectedPlace.id);
        setParticipantRoutes(restoredRoutes);
        setActiveRouteModeByParticipant(activeModes);
        setRouteStatusMessage("Routegegevens geladen vanuit meeting-sessie.");
        setIsRouteStatusError(false);
        setIsProposalApproved(true);
        setContinueStatusMessage(
          `Meeting-sessie geladen met ${session.participants.length} deelnemer(s).`,
        );

        const meetingUrl = new URL(window.location.pathname, window.location.origin);
        meetingUrl.searchParams.set("meeting", session.meetingId);
        setMeetingLink(meetingUrl.toString());
        setMeetingLinkStatusMessage(
          `Sessie geladen. Meeting is goedgekeurd op ${new Date(session.approvedAt).toLocaleString("nl-NL")}.`,
        );
        setLoadedMeetingId(session.meetingId);
      } catch (error) {
        if (isCancelled) {
          return;
        }

        console.error(error);
        setMeetingLinkStatusMessage(
          "Meeting-sessie kon niet worden geladen. Controleer of de link geldig en niet verlopen is.",
        );
      } finally {
        if (!isCancelled) {
          setIsLoadingMeetingSession(false);
        }
      }
    }

    void loadMeetingSessionFromUrl();

    return () => {
      isCancelled = true;
    };
  }, [loadedMeetingId, router.isReady, router.query.meeting]);

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
    setSuitablePlaces([]);
    setSelectedPlaceId(null);
    setParticipantRoutes({});
    setRouteStatusMessage(null);
    setIsRouteStatusError(false);
    setActiveRouteModeByParticipant({});
    setIsProposalApproved(false);
    setMeetingLink(null);
    setMeetingLinkStatusMessage(null);
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
      setSuitablePlaces([]);
      setSelectedPlaceId(null);
      setParticipantRoutes({});
      setRouteStatusMessage(null);
      setIsRouteStatusError(false);
      setActiveRouteModeByParticipant({});
      setIsProposalApproved(false);
      setMeetingLink(null);
      setMeetingLinkStatusMessage(null);
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
      setSuitablePlaces([]);
      setSelectedPlaceId(null);
      setParticipantRoutes({});
      setRouteStatusMessage(null);
      setIsRouteStatusError(false);
      setActiveRouteModeByParticipant({});
      setIsProposalApproved(false);
      setMeetingLink(null);
      setMeetingLinkStatusMessage(null);
      setContinueStatusMessage(null);
      return;
    }

    setIsGeocoding(true);
    setGeographicCenter(null);
    setSuitablePlaces([]);
    setSelectedPlaceId(null);
    setParticipantRoutes({});
    setRouteStatusMessage(null);
    setIsRouteStatusError(false);
    setActiveRouteModeByParticipant({});
    setIsProposalApproved(false);
    setMeetingLink(null);
    setMeetingLinkStatusMessage(null);
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

      try {
        setIsSearchingSuitablePlaces(true);
        const places = await findSuitablePlacesNearMidpoint(midpoint);
        setSuitablePlaces(places);
        setSelectedPlaceId((currentSelectedPlaceId) => {
          if (currentSelectedPlaceId && places.some((place) => place.id === currentSelectedPlaceId)) {
            return currentSelectedPlaceId;
          }

          return places[0]?.id ?? null;
        });

        if (places.length === 0) {
          setContinueStatusMessage(
            `Alle deelnemers zijn geocoded. Geografisch middelpunt: ${midpoint.lat.toFixed(6)}, ${midpoint.lng.toFixed(6)}. Geen geschikte locaties gevonden binnen 3500 meter.`,
          );
        } else {
          setContinueStatusMessage(
            `Alle deelnemers zijn geocoded. Geografisch middelpunt: ${midpoint.lat.toFixed(6)}, ${midpoint.lng.toFixed(6)}. ${places.length} geschikte locaties gevonden binnen 3500 meter.`,
          );
        }
      } catch (error) {
        console.error(error);
        setContinueStatusMessage(
          `Geografisch middelpunt berekend (${midpoint.lat.toFixed(6)}, ${midpoint.lng.toFixed(6)}), maar zoeken naar geschikte locaties is mislukt.`,
        );
      } finally {
        setIsSearchingSuitablePlaces(false);
      }
    } finally {
      setIsGeocoding(false);
    }
  }

  function handleSelectSuggestedPlace(placeId: string) {
    setSelectedPlaceId(placeId);
    setParticipantRoutes({});
    setRouteStatusMessage(null);
    setIsRouteStatusError(false);
    setActiveRouteModeByParticipant({});
    setIsProposalApproved(false);
    setMeetingLink(null);
    setMeetingLinkStatusMessage(null);
  }

  function handleRouteTabChange(participantId: number, mode: RouteMode) {
    setActiveRouteModeByParticipant((previous) => ({
      ...previous,
      [participantId]: mode,
    }));
  }

  async function handleCalculateRoutes() {
    if (!selectedPlace || !window.google?.maps?.DirectionsService) {
      setRouteStatusMessage("Google Directions service is nog niet beschikbaar.");
      setIsRouteStatusError(true);
      return;
    }

    const geocodedParticipants = participants.filter(isGeocodedParticipant);
    if (geocodedParticipants.length === 0) {
      setRouteStatusMessage("Er zijn geen deelnemers met geldige vertrekcoördinaten.");
      setIsRouteStatusError(true);
      return;
    }

    setIsCalculatingRoutes(true);
    setParticipantRoutes({});
    setRouteStatusMessage(null);
    setIsRouteStatusError(false);
    setIsProposalApproved(false);
    setMeetingLink(null);
    setMeetingLinkStatusMessage(null);
    try {
      const directionsService = new window.google.maps.DirectionsService();
      const routeEntries = await Promise.all(
        geocodedParticipants.map(async (participant) => {
          const origin: LatLngLiteral = { lat: participant.latitude, lng: participant.longitude };
          const destination: LatLngLiteral = selectedPlace.location;
          const [drivingRoute, transitRoute] = await Promise.all([
            fetchDirectionsRoute(directionsService, origin, destination, "driving"),
            fetchDirectionsRoute(directionsService, origin, destination, "transit"),
          ]);

          return {
            participantId: participant.id,
            routes: {
              driving: drivingRoute,
              transit: transitRoute,
            },
          };
        }),
      );

      const nextParticipantRoutes: Record<number, ParticipantRouteSet> = {};
      const nextActiveModes: Record<number, RouteMode> = {};
      let fullRouteCount = 0;
      let anyRouteCount = 0;

      routeEntries.forEach((entry) => {
        nextParticipantRoutes[entry.participantId] = entry.routes;
        nextActiveModes[entry.participantId] = "driving";

        const hasDrivingRoute = entry.routes.driving.status === "ok";
        const hasTransitRoute = entry.routes.transit.status === "ok";

        if (hasDrivingRoute || hasTransitRoute) {
          anyRouteCount += 1;
        }
        if (hasDrivingRoute && hasTransitRoute) {
          fullRouteCount += 1;
        }
      });

      setParticipantRoutes(nextParticipantRoutes);
      setActiveRouteModeByParticipant(nextActiveModes);

      if (anyRouteCount === 0) {
        setRouteStatusMessage("Er konden geen routes worden opgehaald voor de geselecteerde locatie.");
        setIsRouteStatusError(true);
      } else {
        setRouteStatusMessage(
          `${anyRouteCount} deelnemer(s) hebben minimaal één routeoptie; ${fullRouteCount} deelnemer(s) hebben zowel auto als OV.`,
        );
        setIsRouteStatusError(false);
      }
    } catch (error) {
      console.error(error);
      setRouteStatusMessage("Routeberekening is mislukt. Probeer het opnieuw.");
      setIsRouteStatusError(true);
    } finally {
      setIsCalculatingRoutes(false);
    }
  }

  function handleToggleProposalApproval() {
    if (!canApproveProposal || !selectedPlace) {
      return;
    }

    const nextApprovalState = !isProposalApproved;
    setIsProposalApproved(nextApprovalState);
    setMeetingLink(null);
    setMeetingLinkStatusMessage(
      nextApprovalState
        ? `Voorstel "${selectedPlace.name}" is goedgekeurd. Je kunt nu de unieke meeting-link genereren.`
        : "Goedkeuring ingetrokken. Keur het locatievoorstel opnieuw goed om een meeting-link te genereren.",
    );
  }

  async function handleGenerateMeetingLink() {
    if (!canGenerateMeetingLink || !selectedPlace) {
      return;
    }

    setIsGeneratingMeetingLink(true);
    setMeetingLink(null);
    setMeetingLinkStatusMessage("Meeting-sessie opslaan en unieke URL genereren...");

    try {
      const response = await fetch("/api/meetings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          participants,
          geographicCenter,
          selectedPlace,
          participantRoutes: participantRoutes as MeetingSessionParticipantRoutes,
        }),
      });

      if (!response.ok) {
        throw new Error(`Meeting-sessie opslaan mislukt (status: ${response.status}).`);
      }

      const payload = (await response.json()) as CreateMeetingSessionResponse;
      const meetingUrl = new URL(window.location.pathname, window.location.origin);
      meetingUrl.searchParams.set("meeting", payload.meetingId);

      setMeetingLink(meetingUrl.toString());
      setLoadedMeetingId(payload.meetingId);
      setMeetingLinkStatusMessage(
        `Unieke meeting-link is gegenereerd. Sessiedata is tijdelijk opgeslagen tot ${new Date(
          payload.expiresAt,
        ).toLocaleString("nl-NL")}.`,
      );
    } catch (error) {
      console.error(error);
      setMeetingLinkStatusMessage(
        "Meeting-link genereren is mislukt. Probeer opnieuw nadat het voorstel is goedgekeurd.",
      );
    } finally {
      setIsGeneratingMeetingLink(false);
    }
  }

  async function handleCopyMeetingLink() {
    if (!meetingLink || typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(meetingLink);
      setMeetingLinkStatusMessage("Meeting-link is gekopieerd naar het klembord.");
    } catch (error) {
      console.error(error);
      setMeetingLinkStatusMessage("Kopiëren van de meeting-link is mislukt. Kopieer de URL handmatig.");
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

        <button
          type="submit"
          className="participants-panel__continue"
          disabled={isGeocoding || isSearchingSuitablePlaces || isCalculatingRoutes || isLoadingMeetingSession}
        >
          {isGeocoding
            ? "Bezig met geocoderen..."
            : isSearchingSuitablePlaces
              ? "Zoeken naar geschikte locaties..."
              : isCalculatingRoutes
                ? "Routes berekenen..."
              : isLoadingMeetingSession
                ? "Meeting-sessie laden..."
              : "Doorgaan"}
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
        {canContinue && suitablePlaces.length > 0 && (
          <section className="participants-panel__places" aria-label="Geschikte locaties">
            <h3>Geschikte locaties (selecteer er één)</h3>
            <ul>
              {suitablePlaces.map((place) => (
                <li
                  key={place.id}
                  className={
                    selectedPlaceId === place.id
                      ? "participants-panel__place participants-panel__place--selected"
                      : "participants-panel__place"
                  }
                >
                  <p className="participants-panel__place-name">{place.name}</p>
                  <p>{place.address}</p>
                  <p>
                    Type: {formatPlaceCategory(place.type)}
                    {place.rating !== null ? ` · Rating: ${place.rating.toFixed(1)}` : " · Rating: onbekend"}
                  </p>
                  <p>
                    Locatie: {place.location.lat.toFixed(6)}, {place.location.lng.toFixed(6)}
                  </p>
                  <button
                    type="button"
                    className="participants-panel__place-select"
                    onClick={() => handleSelectSuggestedPlace(place.id)}
                    aria-pressed={selectedPlaceId === place.id}
                  >
                    {selectedPlaceId === place.id ? "Geselecteerd" : "Selecteer"}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {canContinue && suitablePlaces.length > 0 && (
          <section className="participants-panel__routes" aria-label="Routeberekening">
            <h3>Routes naar geselecteerde locatie</h3>
            <p className="participants-panel__route-target">
              {selectedPlace
                ? `Bestemming: ${selectedPlace.name} (${selectedPlace.address})`
                : "Selecteer eerst een voorgestelde locatie."}
            </p>
            <button
              type="button"
              className="participants-panel__routes-button"
              onClick={handleCalculateRoutes}
              disabled={!canCalculateRoutes}
            >
              {isCalculatingRoutes ? "Routes berekenen..." : "Bereken auto- en OV-routes"}
            </button>
            {routeStatusMessage && (
              <p
                className={
                  isRouteStatusError
                    ? "participants-panel__validation-message"
                    : "participants-panel__success-message"
                }
                role={isRouteStatusError ? "alert" : "status"}
              >
                {routeStatusMessage}
              </p>
            )}
          </section>
        )}

        {hasRouteResults && selectedPlace && (
          <section className="participants-panel__routes-results" aria-label="Routes per deelnemer">
            <h3>Route-opties per deelnemer</h3>
            <ul>
              {participants.map((participant, index) => {
                const routeSet = participantRoutes[participant.id];
                if (!routeSet) {
                  return null;
                }

                const participantDisplayName = participant.name.trim() || `Deelnemer ${index + 1}`;
                const activeMode = activeRouteModeByParticipant[participant.id] ?? "driving";
                const activeRoute = activeMode === "driving" ? routeSet.driving : routeSet.transit;
                const tabBaseId = `participant-route-tabs-${participant.id}`;

                return (
                  <li key={participant.id} className="participants-panel__route-card">
                    <p className="participants-panel__route-participant">{participantDisplayName}</p>
                    <p className="participants-panel__route-summary">
                      Auto: {summarizeRouteOption(routeSet.driving)}
                    </p>
                    <p className="participants-panel__route-summary">
                      Openbaar vervoer: {summarizeRouteOption(routeSet.transit)}
                    </p>
                    <div className="participants-panel__route-tabs" role="tablist">
                      <button
                        type="button"
                        role="tab"
                        id={`${tabBaseId}-driving`}
                        aria-selected={activeMode === "driving"}
                        aria-controls={`${tabBaseId}-panel`}
                        className={
                          activeMode === "driving"
                            ? "participants-panel__route-tab participants-panel__route-tab--active"
                            : "participants-panel__route-tab"
                        }
                        onClick={() => handleRouteTabChange(participant.id, "driving")}
                      >
                        Auto
                      </button>
                      <button
                        type="button"
                        role="tab"
                        id={`${tabBaseId}-transit`}
                        aria-selected={activeMode === "transit"}
                        aria-controls={`${tabBaseId}-panel`}
                        className={
                          activeMode === "transit"
                            ? "participants-panel__route-tab participants-panel__route-tab--active"
                            : "participants-panel__route-tab"
                        }
                        onClick={() => handleRouteTabChange(participant.id, "transit")}
                      >
                        Openbaar vervoer
                      </button>
                    </div>
                    <div
                      className="participants-panel__route-panel"
                      role="tabpanel"
                      id={`${tabBaseId}-panel`}
                      aria-labelledby={`${tabBaseId}-${activeMode}`}
                    >
                      {activeRoute.status === "ok" ? (
                        <>
                          <p>Reistijd: {activeRoute.durationText ?? "Onbekend"}</p>
                          <p>Afstand: {activeRoute.distanceText ?? "Onbekend"}</p>
                        </>
                      ) : (
                        <p className="participant-row__error">{activeRoute.message}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {hasRouteResults && selectedPlace && (
          <section
            className="participants-panel__approval"
            aria-label="Voorstelgoedkeuring en meeting-linkgeneratie"
          >
            <h3>Voorstel goedkeuren en meeting-link delen</h3>
            <p className="participants-panel__route-target">
              Locatievoorstel: {selectedPlace.name} ({selectedPlace.address})
            </p>
            <button
              type="button"
              className="participants-panel__approval-button"
              onClick={handleToggleProposalApproval}
              disabled={!canApproveProposal}
            >
              {isProposalApproved ? "Goedkeuring intrekken" : "Locatievoorstel goedkeuren"}
            </button>
            <button
              type="button"
              className="participants-panel__meeting-link-button"
              onClick={handleGenerateMeetingLink}
              disabled={!canGenerateMeetingLink}
            >
              {isGeneratingMeetingLink
                ? "Meeting-link genereren..."
                : "Genereer unieke, deelbare meeting-link"}
            </button>
            {meetingLink && (
              <p className="participants-panel__meeting-link-url" role="status">
                <a href={meetingLink}>{meetingLink}</a>
              </p>
            )}
            {meetingLink && (
              <button
                type="button"
                className="participants-panel__meeting-link-copy"
                onClick={handleCopyMeetingLink}
              >
                Kopieer meeting-link
              </button>
            )}
            {meetingLinkStatusMessage && (
              <p
                className={
                  canGenerateMeetingLink
                    ? "participants-panel__success-message"
                    : "participants-panel__validation-message"
                }
                role={canGenerateMeetingLink ? "status" : "alert"}
              >
                {meetingLinkStatusMessage}
              </p>
            )}
          </section>
        )}

        {hasReachedParticipantLimit && (
          <p className="participants-panel__limit-message" role="status">
            Maximum van 25 deelnemers bereikt.
          </p>
        )}
      </form>
      <aside className="map-legend" aria-label="Kaartgids">
        <h3>Kaartgids</h3>
        <ul>
          <li>
            <span className="map-legend__swatch map-legend__swatch--participant" aria-hidden="true" />
            Deelnemers ({geocodedParticipantCount}) met naamlabel
          </li>
          <li>
            <span className="map-legend__swatch map-legend__swatch--midpoint" aria-hidden="true" />
            Berekend middelpunt (duidelijk gemarkeerd)
          </li>
          <li>
            <span className="map-legend__swatch map-legend__swatch--place" aria-hidden="true" />
            Locatiesuggesties ({suitablePlaces.length}) met naam en type
          </li>
          <li>
            <span className="map-legend__swatch map-legend__swatch--driving-route" aria-hidden="true" />
            Autoroute (doorgetrokken blauw)
          </li>
          <li>
            <span className="map-legend__swatch map-legend__swatch--transit-route" aria-hidden="true" />
            OV-route (oranje stippellijn)
          </li>
        </ul>
      </aside>
    </div>
  );
}
