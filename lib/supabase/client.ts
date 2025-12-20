import { createClient } from "@supabase/supabase-js";

// Create Supabase client using service role for server-side operations
export const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Create client with user token for authenticated requests
export function createSupabaseClient(accessToken?: string) {
    return createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        {
            global: {
                headers: accessToken
                    ? { Authorization: `Bearer ${accessToken}` }
                    : {},
            },
        }
    );
}

// Export types
export type SupabaseClient = ReturnType<typeof createClient>;
