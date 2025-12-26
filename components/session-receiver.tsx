"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface PostMessageSession {
  access_token: string;
  refresh_token: string;
  user?: {
    id: string;
    email?: string;
  };
}

/**
 * SessionReceiver Component
 * 
 * This component listens for postMessage from the parent window (main SaaS app)
 * and receives the Supabase session to authenticate the user without requiring
 * a separate login in the chatbot iframe.
 */
export function SessionReceiver() {
  const router = useRouter();
  const [isReceiving, setIsReceiving] = useState(false);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      // Security: Only accept messages from allowed origins
      const allowedOrigins = [
        "https://smartcfo.webcraftio.com",
        "http://localhost:3000",
        "http://localhost:3001",
      ];

      if (!allowedOrigins.includes(event.origin)) {
        console.log("[SessionReceiver] Ignored message from:", event.origin);
        return;
      }

      // Check if this is an auth session message
      if (event.data?.type === "AUTH_SESSION" && event.data?.session) {
        console.log("[SessionReceiver] Received auth session from parent");
        setIsReceiving(true);

        try {
          const session: PostMessageSession = event.data.session;

          // Send the token to our API to set the cookies
          const response = await fetch("/api/auth/set-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accessToken: session.access_token,
              refreshToken: session.refresh_token,
              userId: session.user?.id,
            }),
          });

          if (response.ok) {
            console.log("[SessionReceiver] ✅ Session set successfully");
            // Refresh the page to pick up the new session
            router.refresh();
          } else {
            console.error("[SessionReceiver] ❌ Failed to set session");
          }
        } catch (error) {
          console.error("[SessionReceiver] ❌ Error setting session:", error);
        } finally {
          setIsReceiving(false);
        }
      }
    };

    // Add the message listener
    window.addEventListener("message", handleMessage);

    // Request session from parent on mount (in case we're in an iframe)
    if (window.parent !== window) {
      console.log("[SessionReceiver] In iframe, requesting session from parent");
      window.parent.postMessage({ type: "REQUEST_AUTH_SESSION" }, "*");
    }

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [router]);

  // This component doesn't render anything visible
  if (isReceiving) {
    return (
      <div className="fixed inset-0 bg-background/80 flex items-center justify-center z-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
          <p className="mt-2 text-sm text-muted-foreground">Authenticating...</p>
        </div>
      </div>
    );
  }

  return null;
}
