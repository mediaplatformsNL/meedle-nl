import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getBrowserSupabaseClient } from "./supabase";

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  signInWithEmail(email: string): Promise<void>;
  signOut(): Promise<void>;
  getAccessToken(): Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const supabase = getBrowserSupabaseClient();
    let isUnmounted = false;

    void supabase.auth.getSession().then(({ data }) => {
      if (isUnmounted) {
        return;
      }

      setSession(data.session ?? null);
      setIsLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setIsLoading(false);
    });

    return () => {
      isUnmounted = true;
      data.subscription.unsubscribe();
    };
  }, []);

  const signInWithEmail = useCallback(async (email: string) => {
    const supabase = getBrowserSupabaseClient();
    const redirectTo = typeof window !== "undefined" ? window.location.origin : undefined;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo,
      },
    });
    if (error) {
      throw error;
    }
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getBrowserSupabaseClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      throw error;
    }
  }, []);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    if (session?.access_token) {
      return session.access_token;
    }

    const supabase = getBrowserSupabaseClient();
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      return null;
    }

    setSession(data.session ?? null);
    return data.session?.access_token ?? null;
  }, [session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      isLoading,
      signInWithEmail,
      signOut,
      getAccessToken,
    }),
    [getAccessToken, isLoading, session?.user, signInWithEmail, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const authContext = useContext(AuthContext);
  if (!authContext) {
    throw new Error("useAuth moet binnen AuthProvider worden gebruikt.");
  }

  return authContext;
}
