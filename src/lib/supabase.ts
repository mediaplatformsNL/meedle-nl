import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

let browserSupabaseClient: SupabaseClient | null = null;

function validateSupabaseConfig(): void {
  if (!SUPABASE_URL || SUPABASE_URL.includes("{{")) {
    throw new Error(
      "Supabase URL ontbreekt. Stel SUPABASE_URL in (wordt doorgezet naar NEXT_PUBLIC_SUPABASE_URL).",
    );
  }

  if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes("{{")) {
    throw new Error(
      "Supabase anon key ontbreekt. Stel SUPABASE_ANON_KEY in (wordt doorgezet naar NEXT_PUBLIC_SUPABASE_ANON_KEY).",
    );
  }
}

export function getBrowserSupabaseClient(): SupabaseClient {
  if (typeof window === "undefined") {
    throw new Error("Browser Supabase client kan alleen in de browser worden gebruikt.");
  }

  validateSupabaseConfig();
  if (!browserSupabaseClient) {
    browserSupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  }

  return browserSupabaseClient;
}

export function createServerSupabaseClient(): SupabaseClient {
  validateSupabaseConfig();
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
