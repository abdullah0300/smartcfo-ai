/**
 * Voice Transcription API Route
 * POST /api/voice/transcribe
 * 
 * Receives audio file (webm/mp3/wav), transcribes using Deepgram Nova-3
 */

import { NextRequest, NextResponse } from "next/server";
import { transcribeAudio } from "@/lib/voice/deepgram";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  console.log("\n========== [/api/voice/transcribe] ==========");

  try {
    // Check for API key
    if (!process.env.DEEPGRAM_API_KEY) {
      console.error("[transcribe] DEEPGRAM_API_KEY not configured");
      return NextResponse.json(
        { error: "Voice transcription not configured" },
        { status: 500 }
      );
    }

    // Get form data with audio file
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;

    if (!audioFile) {
      console.error("[transcribe] No audio file provided");
      return NextResponse.json(
        { error: "No audio file provided" },
        { status: 400 }
      );
    }

    console.log("[transcribe] Received audio file:");
    console.log("[transcribe] Name:", audioFile.name);
    console.log("[transcribe] Type:", audioFile.type);
    console.log("[transcribe] Size:", audioFile.size, "bytes");

    // Convert File to Buffer
    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Transcribe
    const result = await transcribeAudio(buffer, audioFile.type);

    console.log("[transcribe] Success! Transcript:", result.transcript);

    return NextResponse.json({
      transcript: result.transcript,
      confidence: result.confidence,
      duration: result.duration,
    });
  } catch (error: any) {
    console.error("[transcribe] Error:", error);
    return NextResponse.json(
      { error: error.message || "Transcription failed" },
      { status: 500 }
    );
  }
}
