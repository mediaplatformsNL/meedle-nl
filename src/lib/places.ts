import { GOOGLE_MAPS_API_KEY } from "./config";
import type { Coordinate } from "./geo";

type PlaceCategory = "restaurant" | "cafe" | "hotel" | "vergaderruimte";

interface PlacesApiResult {
  place_id?: string;
  name?: string;
  vicinity?: string;
  formatted_address?: string;
  rating?: number;
  types?: string[];
  geometry?: {
    location?: {
      lat?: number;
      lng?: number;
    };
  };
}

interface PlacesApiResponse {
  status: string;
  error_message?: string;
  results: PlacesApiResult[];
}

interface PlaceAddressComponent {
  long_name?: string;
  short_name?: string;
  types?: string[];
}

interface PlaceDetailsResult {
  place_id?: string;
  name?: string;
  formatted_address?: string;
  types?: string[];
  address_components?: PlaceAddressComponent[];
  geometry?: {
    location?: {
      lat?: number;
      lng?: number;
    };
  };
}

interface PlaceDetailsResponse {
  status: string;
  error_message?: string;
  result?: PlaceDetailsResult;
}

interface CategorySearchConfig {
  category: PlaceCategory;
  type?: string;
  keyword?: string;
}

export interface SuitablePlace {
  id: string;
  name: string;
  address: string;
  location: Coordinate;
  type: PlaceCategory;
  rating: number | null;
}

const SEARCH_RADIUS_METERS = 3500;
const MAX_SUITABLE_PLACES = 10;
const MAX_DETAILS_LOCATION_DEVIATION_METERS = 300;
const DISALLOWED_PLACE_TYPES = new Set([
  "route",
  "intersection",
  "natural_feature",
  "transit_station",
  "bus_station",
  "train_station",
  "subway_station",
  "plus_code",
]);

const DISALLOWED_ADDRESS_REGEX =
  /\b(water|meer|lake|kanaal|canal|river|rivier|zee|ocean|haven|harbor|snelweg|highway|motorway|autobahn)\b/i;
const ADDRESS_PLACEHOLDER_REGEX = /\b(unnamed road|naamloze weg|zonder adres|unknown|plus code)\b/i;

const CATEGORY_SEARCH_CONFIG: CategorySearchConfig[] = [
  { category: "restaurant", type: "restaurant" },
  { category: "cafe", type: "cafe" },
  { category: "hotel", type: "lodging", keyword: "hotel" },
  { category: "vergaderruimte", keyword: "vergaderruimte meeting room conference room" },
];

function extractAddress(place: { vicinity?: string; formatted_address?: string }): string | null {
  const rawAddress = place.vicinity ?? place.formatted_address ?? "";
  const address = rawAddress.trim();
  return address.length > 0 ? address : null;
}

function extractLocation(place: {
  geometry?: {
    location?: {
      lat?: number;
      lng?: number;
    };
  };
}): Coordinate | null {
  const lat = place.geometry?.location?.lat;
  const lng = place.geometry?.location?.lng;

  if (typeof lat !== "number" || !Number.isFinite(lat)) {
    return null;
  }

  if (typeof lng !== "number" || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng };
}

function normalizePlaceTypes(...typeSources: Array<string[] | undefined>): string[] {
  const normalizedTypes = new Set<string>();

  for (const source of typeSources) {
    for (const type of source ?? []) {
      const normalizedType = type.trim().toLowerCase();
      if (normalizedType) {
        normalizedTypes.add(normalizedType);
      }
    }
  }

  return Array.from(normalizedTypes);
}

function hasReachableAddressComponents(addressComponents: PlaceAddressComponent[] | undefined): boolean {
  if (!addressComponents || addressComponents.length === 0) {
    return false;
  }

  const componentTypes = new Set<string>();
  for (const addressComponent of addressComponents) {
    for (const type of addressComponent.types ?? []) {
      componentTypes.add(type);
    }
  }

  const hasStreet = componentTypes.has("route");
  const hasSpecificDestination =
    componentTypes.has("street_number") ||
    componentTypes.has("premise") ||
    componentTypes.has("subpremise");

  return hasStreet && hasSpecificDestination;
}

function isLogicallyReachableAddress(
  address: string,
  addressComponents: PlaceAddressComponent[] | undefined,
): boolean {
  if (!/[a-z]/i.test(address)) {
    return false;
  }

  if (ADDRESS_PLACEHOLDER_REGEX.test(address)) {
    return false;
  }

  if (hasReachableAddressComponents(addressComponents)) {
    return true;
  }

  // Fallback voor resultaten zonder address_components: we vereisen minimaal een straat + nummerindicatie.
  return /\d/.test(address) && address.includes(",");
}

function isClearlyInaccessible(placeTypes: string[], address: string): boolean {
  const hasDisallowedType = placeTypes.some((type) => DISALLOWED_PLACE_TYPES.has(type));
  return hasDisallowedType || DISALLOWED_ADDRESS_REGEX.test(address);
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function distanceMeters(a: Coordinate, b: Coordinate): number {
  const earthRadiusMeters = 6_371_000;
  const latDiff = toRadians(b.lat - a.lat);
  const lngDiff = toRadians(b.lng - a.lng);
  const latA = toRadians(a.lat);
  const latB = toRadians(b.lat);

  const haversineTerm =
    Math.sin(latDiff / 2) * Math.sin(latDiff / 2) +
    Math.cos(latA) * Math.cos(latB) * Math.sin(lngDiff / 2) * Math.sin(lngDiff / 2);
  const arc = 2 * Math.atan2(Math.sqrt(haversineTerm), Math.sqrt(1 - haversineTerm));
  return earthRadiusMeters * arc;
}

async function fetchPlaceDetails(placeId: string): Promise<PlaceDetailsResult | null> {
  const endpoint = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  endpoint.searchParams.set("key", GOOGLE_MAPS_API_KEY);
  endpoint.searchParams.set("place_id", placeId);
  endpoint.searchParams.set("language", "nl");
  endpoint.searchParams.set(
    "fields",
    "place_id,name,formatted_address,types,geometry/location,address_component",
  );

  const response = await fetch(endpoint.toString());
  if (!response.ok) {
    return null;
  }

  const detailsResponse = (await response.json()) as PlaceDetailsResponse;
  if (detailsResponse.status !== "OK") {
    return null;
  }

  return detailsResponse.result ?? null;
}

async function fetchNearbyPlaces(
  midpoint: Coordinate,
  searchConfig: CategorySearchConfig,
): Promise<PlacesApiResult[]> {
  const endpoint = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  endpoint.searchParams.set("key", GOOGLE_MAPS_API_KEY);
  endpoint.searchParams.set("location", `${midpoint.lat},${midpoint.lng}`);
  endpoint.searchParams.set("radius", String(SEARCH_RADIUS_METERS));
  endpoint.searchParams.set("language", "nl");

  if (searchConfig.type) {
    endpoint.searchParams.set("type", searchConfig.type);
  }

  if (searchConfig.keyword) {
    endpoint.searchParams.set("keyword", searchConfig.keyword);
  }

  const response = await fetch(endpoint.toString());
  if (!response.ok) {
    throw new Error(
      `Google Places request voor ${searchConfig.category} gaf HTTP-status ${response.status}.`,
    );
  }

  const placesResponse = (await response.json()) as PlacesApiResponse;
  if (placesResponse.status === "ZERO_RESULTS") {
    return [];
  }

  if (placesResponse.status !== "OK") {
    throw new Error(
      placesResponse.error_message ??
        `Google Places Nearby Search gaf status ${placesResponse.status} voor ${searchConfig.category}.`,
    );
  }

  return placesResponse.results;
}

export async function findSuitablePlacesNearMidpoint(midpoint: Coordinate): Promise<SuitablePlace[]> {
  const categoryResponses = await Promise.all(
    CATEGORY_SEARCH_CONFIG.map(async (searchConfig) => {
      const places = await fetchNearbyPlaces(midpoint, searchConfig);
      return { category: searchConfig.category, places };
    }),
  );

  const placeDetailsCache = new Map<string, Promise<PlaceDetailsResult | null>>();
  const getPlaceDetails = (placeId: string): Promise<PlaceDetailsResult | null> => {
    const cached = placeDetailsCache.get(placeId);
    if (cached) {
      return cached;
    }

    const detailsPromise = fetchPlaceDetails(placeId);
    placeDetailsCache.set(placeId, detailsPromise);
    return detailsPromise;
  };

  const candidatePlaces = await Promise.all(
    categoryResponses.flatMap(({ category, places }) =>
      places.map(async (place): Promise<SuitablePlace | null> => {
        const placeName = place.name?.trim();
        const baseLocation = extractLocation(place);

        if (!placeName || !baseLocation) {
          return null;
        }

        const placeDetails = place.place_id ? await getPlaceDetails(place.place_id) : null;
        const detailsLocation = placeDetails ? extractLocation(placeDetails) : null;

        if (
          detailsLocation &&
          distanceMeters(baseLocation, detailsLocation) > MAX_DETAILS_LOCATION_DEVIATION_METERS
        ) {
          return null;
        }

        const placeAddress = extractAddress(placeDetails ?? place);
        if (!placeAddress) {
          return null;
        }

        const mergedPlaceTypes = normalizePlaceTypes(place.types, placeDetails?.types);
        if (isClearlyInaccessible(mergedPlaceTypes, placeAddress)) {
          return null;
        }

        if (!isLogicallyReachableAddress(placeAddress, placeDetails?.address_components)) {
          return null;
        }

        const placeId =
          placeDetails?.place_id ??
          place.place_id ??
          `${placeName.toLowerCase()}-${placeAddress.toLowerCase()}`;

        return {
          id: placeId,
          name: placeName,
          address: placeAddress,
          location: detailsLocation ?? baseLocation,
          type: category,
          rating: typeof place.rating === "number" ? place.rating : null,
        };
      }),
    ),
  );

  const uniqueSuitablePlaces = new Map<string, SuitablePlace>();

  for (const candidate of candidatePlaces) {
    if (!candidate) {
      continue;
    }

    const existingPlace = uniqueSuitablePlaces.get(candidate.id);
    if (!existingPlace || (candidate.rating ?? 0) > (existingPlace.rating ?? 0)) {
      uniqueSuitablePlaces.set(candidate.id, candidate);
    }
  }

  return Array.from(uniqueSuitablePlaces.values())
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, MAX_SUITABLE_PLACES);
}
