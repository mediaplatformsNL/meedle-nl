import Head from "next/head";
import Map from "../components/Map";
import AuthPanel from "../components/AuthPanel";

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
        <div className="auth-panel-floating">
          <AuthPanel />
        </div>
      </main>
    </>
  );
}
