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
const DISALLOWED_PLACE_TYPES = new Set([
  "route",
  "intersection",
  "natural_feature",
  "transit_station",
]);

const DISALLOWED_ADDRESS_REGEX =
  /\b(water|meer|lake|kanaal|canal|river|rivier|zee|ocean|haven|harbor|snelweg|highway|motorway|autobahn)\b/i;

const CATEGORY_SEARCH_CONFIG: CategorySearchConfig[] = [
  { category: "restaurant", type: "restaurant" },
  { category: "cafe", type: "cafe" },
  { category: "hotel", type: "lodging", keyword: "hotel" },
  { category: "vergaderruimte", keyword: "vergaderruimte meeting room conference room" },
];

function extractAddress(place: PlacesApiResult): string | null {
  const rawAddress = place.vicinity ?? place.formatted_address ?? "";
  const address = rawAddress.trim();
  return address.length > 0 ? address : null;
}

function extractLocation(place: PlacesApiResult): Coordinate | null {
  const lat = place.geometry?.location?.lat;
  const lng = place.geometry?.location?.lng;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng };
}

function isClearlyInaccessible(place: PlacesApiResult, address: string): boolean {
  const placeTypes = place.types ?? [];
  const hasDisallowedType = placeTypes.some((type) => DISALLOWED_PLACE_TYPES.has(type));

  if (hasDisallowedType) {
    return true;
  }

  return DISALLOWED_ADDRESS_REGEX.test(address);
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

  const uniqueSuitablePlaces = new Map<string, SuitablePlace>();

  for (const { category, places } of categoryResponses) {
    for (const place of places) {
      const placeName = place.name?.trim();
      const placeAddress = extractAddress(place);
      const placeLocation = extractLocation(place);

      if (!placeName || !placeAddress || !placeLocation) {
        continue;
      }

      if (isClearlyInaccessible(place, placeAddress)) {
        continue;
      }

      const placeId = place.place_id ?? `${placeName.toLowerCase()}-${placeAddress.toLowerCase()}`;
      const candidate: SuitablePlace = {
        id: placeId,
        name: placeName,
        address: placeAddress,
        location: placeLocation,
        type: category,
        rating: typeof place.rating === "number" ? place.rating : null,
      };

      const existingPlace = uniqueSuitablePlaces.get(placeId);
      if (!existingPlace || (candidate.rating ?? 0) > (existingPlace.rating ?? 0)) {
        uniqueSuitablePlaces.set(placeId, candidate);
      }
    }
  }

  return Array.from(uniqueSuitablePlaces.values())
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, MAX_SUITABLE_PLACES);
}
