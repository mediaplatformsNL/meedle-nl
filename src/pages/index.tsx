import Head from "next/head";
import Map from "../components/Map";

export default function HomePage() {
  return (
    <>
      <Head>
        <title>Meedle NL</title>
        <meta
          name="description"
          content="Fullscreen Google Maps kaart gecentreerd op Nederland."
        />
      </Head>
      <main className="fullscreen-page">
        <Map />
      </main>
    </>
  );
}
