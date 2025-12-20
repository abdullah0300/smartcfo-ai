/**
 * ElevenLabs Text-to-Speech Helper
 * Uses Flash v2.5 model for fast, natural voice synthesis
 */

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";

export interface VoiceSettings {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
}

/**
 * Convert text to speech using ElevenLabs API
 * @param text - Text to convert to speech
 * @param voiceId - Optional voice ID (defaults to env var)
 * @param settings - Optional voice settings
 * @returns Audio buffer (MP3)
 */
export async function textToSpeech(
  text: string,
  voiceId?: string,
  settings?: VoiceSettings
): Promise<Buffer> {
  const voice = voiceId || process.env.ELEVENLABS_VOICE_ID;
  const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5";

  if (!process.env.ELEVENLABS_API_KEY) {
    throw new Error("ELEVENLABS_API_KEY not configured");
  }

  if (!voice) {
    throw new Error("ELEVENLABS_VOICE_ID not configured");
  }

  console.log("[ElevenLabs] Starting TTS...");
  console.log("[ElevenLabs] Text length:", text.length, "chars");
  console.log("[ElevenLabs] Voice ID:", voice);
  console.log("[ElevenLabs] Model:", modelId);

  try {
    const response = await fetch(
      `${ELEVENLABS_API_URL}/text-to-speech/${voice}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: {
            stability: settings?.stability ?? 0.5,
            similarity_boost: settings?.similarity_boost ?? 0.75,
            style: settings?.style ?? 0.0,
            use_speaker_boost: settings?.use_speaker_boost ?? true,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[ElevenLabs] API error:", response.status, errorText);
      throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    console.log("[ElevenLabs] TTS successful");
    console.log("[ElevenLabs] Audio size:", audioBuffer.length, "bytes");

    return audioBuffer;
  } catch (error: any) {
    console.error("[ElevenLabs] Error:", error);
    throw new Error(`TTS failed: ${error.message}`);
  }
}

/**
 * Get available voices from ElevenLabs
 * @returns List of available voices
 */
export async function getVoices(): Promise<any[]> {
  if (!process.env.ELEVENLABS_API_KEY) {
    throw new Error("ELEVENLABS_API_KEY not configured");
  }

  const response = await fetch(`${ELEVENLABS_API_URL}/voices`, {
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch voices: ${response.status}`);
  }

  const data = await response.json();
  return data.voices || [];
}
