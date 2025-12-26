import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { supabaseAuth } from "@/app/(auth)/auth";

/**
 * POST /api/auth/set-session
 * 
 * Receives access token from client (via postMessage from parent SaaS)
 * and sets the authentication cookies for the chatbot.
 */
export async function POST(request: Request) {
  try {
    const { accessToken, refreshToken, userId } = await request.json();

    if (!accessToken) {
      return NextResponse.json(
        { error: "Access token is required" },
        { status: 400 }
      );
    }

    // Verify the token is valid by getting the user
    const { data: { user }, error } = await supabaseAuth.auth.getUser(accessToken);

    if (error || !user) {
      console.error("[set-session] Invalid token:", error?.message);
      return NextResponse.json(
        { error: "Invalid access token" },
        { status: 401 }
      );
    }

    console.log("[set-session] ✅ Token verified for user:", user.id);

    // Set the cookies
    const cookieStore = await cookies();

    cookieStore.set("sb-access-token", accessToken, {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none", // Required for cross-origin iframe
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    if (refreshToken) {
      cookieStore.set("sb-refresh-token", refreshToken, {
        path: "/",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "none",
        maxAge: 60 * 60 * 24 * 30, // 30 days
      });
    }

    cookieStore.set("sb-user-id", user.id, {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      maxAge: 60 * 60 * 24 * 7,
    });

    return NextResponse.json({ success: true, userId: user.id });
  } catch (error) {
    console.error("[set-session] Error:", error);
    return NextResponse.json(
      { error: "Failed to set session" },
      { status: 500 }
    );
  }
}
