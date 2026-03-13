import { useEffect, useRef } from "react";

const GOOGLE_MAPS_API_KEY = "AIzaSyB5NCPpj4QeNbyie8ZIPa5aA6cS4mcYLEk";
const NETHERLANDS_CENTER = { lat: 52.1326, lng: 5.2913 };
const NETHERLANDS_ZOOM = 7;

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

  return <div ref={mapRef} className="map-fullscreen" aria-label="Google Maps kaart van Nederland" />;
}
