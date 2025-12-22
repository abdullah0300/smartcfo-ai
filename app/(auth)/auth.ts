import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { User, UserType } from "@/lib/types/session";

// Re-export UserType for consumers
export type { UserType };

// Create Supabase client for server-side auth
export const supabaseAuth = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface Session {
  user: User | undefined;
}

// Get the current session from Supabase
export async function auth(): Promise<Session | null> {
  console.log("[AUTH] auth() called");
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get("sb-access-token")?.value;

    console.log("[AUTH] Access token present:", !!accessToken);
    console.log("[AUTH] Token length:", accessToken?.length || 0);

    if (!accessToken) {
      console.log("[AUTH] ❌ No access token in cookies - returning null");
      return null;
    }

    // Verify the access token with Supabase
    console.log("[AUTH] Calling supabase.auth.getUser()...");
    const startTime = Date.now();
    const { data: { user }, error } = await supabaseAuth.auth.getUser(accessToken);
    const elapsed = Date.now() - startTime;
    console.log(`[AUTH] getUser() took ${elapsed}ms`);

    if (error) {
      console.log("[AUTH] ❌ getUser error:", error.message);
      return null;
    }

    if (!user) {
      console.log("[AUTH] ❌ No user returned from getUser");
      return null;
    }

    console.log("[AUTH] ✅ User found:", user.id);
    return {
      user: {
        id: user.id,
        email: user.email || "",
        type: "regular",
      },
    };
  } catch (error) {
    console.error("[AUTH] ❌ Exception in auth():", error);
    return null;
  }
}

// Sign in with email and password
export async function signIn(email: string, password: string) {
  const { data, error } = await supabaseAuth.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

// Sign out
export async function signOut(options?: { redirectTo?: string }) {
  // Client-side will clear cookies
  // redirectTo is handled by the form/component
  return { success: true };
}

// Export named handlers for API routes (compatibility with next-auth pattern)
export const handlers = {
  GET: async () => new Response("Not implemented", { status: 501 }),
  POST: async () => new Response("Not implemented", { status: 501 }),
};
