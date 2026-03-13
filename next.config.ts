import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "AIzaSyB5NCPpj4QeNbyie8ZIPa5aA6cS4mcYLEk",
    NEXT_PUBLIC_SUPABASE_URL: process.env.SUPABASE_URL ?? "{{SUPABASE_URL}}",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? "{{SUPABASE_ANON_KEY}}",
  },
};

export default nextConfig;
