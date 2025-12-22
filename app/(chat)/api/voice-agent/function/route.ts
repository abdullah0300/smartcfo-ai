/**
 * Voice Agent Function Call Handler
 * Handles function call requests from Deepgram Voice Agent
 */

import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { executeVoiceTool } from "@/lib/voice/voice-tools";

export async function POST(request: Request) {
  console.log("[VoiceFunction] POST request received");
  try {
    // Authenticate user
    console.log("[VoiceFunction] Calling auth()...");
    const session = await auth();
    console.log("[VoiceFunction] Auth result:", session ? `User: ${session.user?.id}` : "null");
    
    if (!session?.user?.id) {
      console.log("[VoiceFunction] ❌ Returning 401 - no session or user id");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { functionName, parameters, functionCallId } = body;

    if (!functionName) {
      return NextResponse.json(
        { error: "Missing functionName" },
        { status: 400 }
      );
    }

    console.log(`[VoiceAgent] Function call: ${functionName}`);

    // Ensure userId is set from session (security)
    const safeParams = {
      ...parameters,
      userId: session.user.id,
    };

    // Execute the tool
    const result = await executeVoiceTool(functionName, safeParams);

    return NextResponse.json({
      functionCallId,
      result,
    });
  } catch (error) {
    console.error("[VoiceAgent] Function call error:", error);
    return NextResponse.json(
      { error: "Function call failed" },
      { status: 500 }
    );
  }
}
