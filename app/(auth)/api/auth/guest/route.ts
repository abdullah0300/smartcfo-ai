import { NextResponse } from "next/server";

// Guest login is NOT supported for SmartCFO
// Users must log in with their existing SmartCFO accounts
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const redirectUrl = searchParams.get("redirectUrl") || "/login";

  // Redirect to login page - guest users not supported
  return NextResponse.redirect(new URL("/login", request.url));
}
