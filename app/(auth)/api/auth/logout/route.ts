import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST() {
    try {
        const cookieStore = await cookies();

        // Clear all Supabase auth cookies
        cookieStore.delete("sb-access-token");
        cookieStore.delete("sb-refresh-token");
        cookieStore.delete("sb-user-id");

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Logout error:", error);
        return NextResponse.json({ success: false }, { status: 500 });
    }
}

export async function GET() {
    // Redirect to POST
    return NextResponse.redirect(new URL("/login", "http://localhost:3000"));
}
