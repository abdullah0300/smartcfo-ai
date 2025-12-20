/**
 * Deepgram Speech-to-Text Helper
 * Uses Nova-3 model for high-accuracy transcription
 */

import { createClient } from "@deepgram/sdk";

const deepgram = createClient(process.env.DEEPGRAM_API_KEY!);

export interface TranscriptionResult {
  transcript: string;
  confidence: number;
  duration: number;
}

/**
 * Transcribe audio buffer to text using Deepgram Nova-3
 * @param audioBuffer - Audio data as Buffer (webm, mp3, wav, etc.)
 * @param mimeType - MIME type of the audio (e.g., "audio/webm")
 * @returns Transcription result with text and confidence
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string = "audio/webm"
): Promise<TranscriptionResult> {
  console.log("[Deepgram] Starting transcription...");
  console.log("[Deepgram] Audio size:", audioBuffer.length, "bytes");
  console.log("[Deepgram] MIME type:", mimeType);

  try {
    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
      audioBuffer,
      {
        model: "nova-3",
        smart_format: true,
        punctuate: true,
        language: "en",
      }
    );

    if (error) {
      console.error("[Deepgram] Transcription error:", error);
      throw new Error(`Deepgram error: ${error.message}`);
    }

    const alternative = result.results?.channels?.[0]?.alternatives?.[0];
    
    if (!alternative) {
      console.warn("[Deepgram] No transcription result");
      return { transcript: "", confidence: 0, duration: 0 };
    }

    const transcript = alternative.transcript || "";
    const confidence = alternative.confidence || 0;
    const duration = result.metadata?.duration || 0;

    console.log("[Deepgram] Transcription successful:");
    console.log("[Deepgram] Text:", transcript);
    console.log("[Deepgram] Confidence:", confidence);
    console.log("[Deepgram] Duration:", duration, "seconds");

    return { transcript, confidence, duration };
  } catch (error: any) {
    console.error("[Deepgram] Error:", error);
    throw new Error(`Transcription failed: ${error.message}`);
  }
}
