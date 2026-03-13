import Head from "next/head";
import MapConfigCard from "../components/MapConfigCard";

export default function HomePage() {
  return (
    <>
      <Head>
        <title>Meedle NL</title>
        <meta
          name="description"
          content="Next.js basisapp voor een eerlijke en bereikbare vergaderlocatie."
        />
      </Head>
      <main>
        <h1>Meedle NL</h1>
        <p>Nieuwe Next.js applicatie met TypeScript en een duidelijke src-structuur.</p>
        <MapConfigCard />
      </main>
    </>
  );
}
