import { type NextRequest, NextResponse } from "next/server";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /*
   * Playwright starts the dev server and requires a 200 status to
   * begin the tests, so this ensures that the tests can start
   */
  if (pathname.startsWith("/ping")) {
    return new Response("pong", { status: 200 });
  }

  // Allow all auth routes (login, register, API auth endpoints)
  if (pathname.startsWith("/api/auth") || pathname === "/login" || pathname === "/register") {
    return NextResponse.next();
  }

  // Allow internal API routes called by AI tools (server-to-server)
  if (pathname === "/api/invoice-email") {
    return NextResponse.next();
  }

  // Check for Supabase auth cookies instead of next-auth JWT
  const accessToken = request.cookies.get("sb-access-token")?.value;

  if (!accessToken) {
    // Redirect to login page instead of guest route
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // User is authenticated, allow request
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/chat/:id",
    "/api/:path*",
    "/login",
    "/register",

    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
