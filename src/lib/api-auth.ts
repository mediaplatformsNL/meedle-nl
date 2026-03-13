import type { NextApiRequest } from "next";
import { createServerSupabaseClient } from "./supabase";

function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return token.trim() || null;
}

export async function getAuthenticatedUserId(req: NextApiRequest): Promise<string | null> {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return null;
  }

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return null;
  }

  return data.user.id;
}
