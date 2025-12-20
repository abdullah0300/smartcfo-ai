/**
 * Text-to-Speech API Route
 * POST /api/voice/speak
 * 
 * Receives text, converts to speech using ElevenLabs Flash v2.5
 */

import { NextRequest, NextResponse } from "next/server";
import { textToSpeech } from "@/lib/voice/elevenlabs";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  console.log("\n========== [/api/voice/speak] ==========");

  try {
    // Check for API key
    if (!process.env.ELEVENLABS_API_KEY) {
      console.error("[speak] ELEVENLABS_API_KEY not configured");
      return NextResponse.json(
        { error: "Voice synthesis not configured" },
        { status: 500 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { text, voiceId, settings } = body;

    if (!text || typeof text !== "string") {
      console.error("[speak] No text provided");
      return NextResponse.json(
        { error: "No text provided" },
        { status: 400 }
      );
    }

    // Limit text length to prevent abuse
    const maxLength = 5000;
    if (text.length > maxLength) {
      console.error("[speak] Text too long:", text.length);
      return NextResponse.json(
        { error: `Text too long. Maximum ${maxLength} characters.` },
        { status: 400 }
      );
    }

    console.log("[speak] Text length:", text.length);
    console.log("[speak] Text preview:", text.substring(0, 100) + "...");

    // Generate speech
    const audioBuffer = await textToSpeech(text, voiceId, settings);

    console.log("[speak] Success! Audio size:", audioBuffer.length, "bytes");

    // Return audio as MP3 stream
    return new NextResponse(new Uint8Array(audioBuffer), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.length.toString(),
        "Cache-Control": "no-cache",
      },
    });
  } catch (error: any) {
    console.error("[speak] Error:", error);
    return NextResponse.json(
      { error: error.message || "Speech synthesis failed" },
      { status: 500 }
    );
  }
}
