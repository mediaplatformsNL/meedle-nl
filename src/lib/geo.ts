export interface Coordinate {
  lat: number;
  lng: number;
}

export interface WeightedCoordinate extends Coordinate {
  weight?: number;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Bereken het (gewogen) geografische middelpunt van meerdere coördinaten
 * op basis van een standaard sferische vector-gemiddelde methode.
 */
export function calculateGeographicMidpoint(coordinates: WeightedCoordinate[]): Coordinate {
  if (coordinates.length === 0) {
    throw new Error("Minstens één coördinaat is vereist om een middelpunt te berekenen.");
  }

  let x = 0;
  let y = 0;
  let z = 0;
  let totalWeight = 0;

  for (const coordinate of coordinates) {
    const { lat, lng } = coordinate;
    const weight = coordinate.weight ?? 1;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error("Alle latitude/longitude waarden moeten numeriek zijn.");
    }

    if (!Number.isFinite(weight) || weight < 0) {
      throw new Error("Gewichten moeten numeriek zijn en mogen niet negatief zijn.");
    }

    if (weight === 0) {
      continue;
    }

    const latRad = toRadians(lat);
    const lngRad = toRadians(lng);
    const cosLat = Math.cos(latRad);

    x += cosLat * Math.cos(lngRad) * weight;
    y += cosLat * Math.sin(lngRad) * weight;
    z += Math.sin(latRad) * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) {
    throw new Error("Som van gewichten moet groter dan nul zijn.");
  }

  x /= totalWeight;
  y /= totalWeight;
  z /= totalWeight;

  const hyp = Math.sqrt(x * x + y * y);
  if (hyp === 0 && z === 0) {
    throw new Error("Geografisch middelpunt kan niet eenduidig worden bepaald.");
  }

  return {
    lat: toDegrees(Math.atan2(z, hyp)),
    lng: toDegrees(Math.atan2(y, x)),
  };
}
