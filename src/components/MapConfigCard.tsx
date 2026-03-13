import { GOOGLE_MAPS_API_KEY } from "../lib/config";

function maskApiKey(apiKey: string): string {
  if (!apiKey) {
    return "Niet ingesteld";
  }

  if (apiKey.length < 10) {
    return apiKey;
  }

  return `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;
}

export default function MapConfigCard() {
  return (
    <section className="card">
      <h2>Google Maps configuratie</h2>
      <p>API key (gemaskeerd): {maskApiKey(GOOGLE_MAPS_API_KEY)}</p>
    </section>
  );
}
