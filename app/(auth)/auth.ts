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
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get("sb-access-token")?.value;

    if (!accessToken) {
      return null;
    }

    // Verify the access token with Supabase
    const { data: { user }, error } = await supabaseAuth.auth.getUser(accessToken);

    if (error || !user) {
      return null;
    }

    return {
      user: {
        id: user.id,
        email: user.email || "",
        type: "regular",
      },
    };
  } catch (_error) {
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
export async function signOut() {
  // Client-side will clear cookies
  return { success: true };
}

// Export named handlers for API routes (compatibility with next-auth pattern)
export const handlers = {
  GET: async () => new Response("Not implemented", { status: 501 }),
  POST: async () => new Response("Not implemented", { status: 501 }),
};
