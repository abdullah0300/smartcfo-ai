"use client";

/**
 * Voice Agent Button Component
 * Simple button for real-time voice conversation with SmartCFO AI
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type VoiceAgentState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking";

interface VoiceAgentButtonProps {
  className?: string;
  disabled?: boolean;
}

export function VoiceAgentButton({
  className,
  disabled,
}: VoiceAgentButtonProps) {
  const [state, setState] = useState<VoiceAgentState>("idle");
  const [transcript, setTranscript] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopConversation();
    };
  }, []);

  const startConversation = useCallback(async () => {
    if (state !== "idle") return;

    setState("connecting");

    try {
      // 1. Get config and token from API
      const configRes = await fetch("/api/voice-agent");
      if (!configRes.ok) {
        const error = await configRes.json();
        throw new Error(error.error || "Failed to get voice agent config");
      }
      const { token, config, wsUrl } = await configRes.json();

      // 2. Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;

      // 3. Create audio context for output (24kHz)
      audioContextRef.current = new AudioContext({ sampleRate: 24000 });

      // 4. Connect to Deepgram Voice Agent
      const ws = new WebSocket(wsUrl, ["token", token]);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[VoiceAgent] WebSocket connected");
        ws.send(JSON.stringify(config));
        startAudioCapture(stream, ws);
        setState("listening");
        toast.success("Voice chat started! Speak now.");
      };

      ws.onmessage = async (event) => {
        if (event.data instanceof Blob) {
          handleAudioData(event.data);
        } else {
          try {
            const data = JSON.parse(event.data);
            handleMessage(data);
          } catch (e) {
            console.warn("[VoiceAgent] Failed to parse message");
          }
        }
      };

      ws.onerror = (error) => {
        console.error("[VoiceAgent] WebSocket error:", error);
        toast.error("Voice connection error");
        stopConversation();
      };

      ws.onclose = () => {
        console.log("[VoiceAgent] WebSocket closed");
        if (state !== "idle") {
          stopConversation();
        }
      };
    } catch (error) {
      console.error("[VoiceAgent] Start error:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to start voice chat"
      );
      setState("idle");
    }
  }, [state]);

  const handleMessage = useCallback((data: Record<string, unknown>) => {
    const type = data.type as string;

    switch (type) {
      case "UserStartedSpeaking":
        setState("listening");
        break;

      case "ConversationText":
        const role = data.role as string;
        const content = data.content as string;
        if (role === "user") {
          setTranscript(content);
          setState("thinking");
        } else if (role === "assistant") {
          setState("speaking");
        }
        break;

      case "AgentAudioDone":
        setState("listening");
        break;

      case "FunctionCallRequest":
        setState("thinking");
        handleFunctionCall(data);
        break;

      case "Error":
        console.error("[VoiceAgent] Error:", data);
        break;
    }
  }, []);

  const handleFunctionCall = async (data: Record<string, unknown>) => {
    const functions = data.functions as Array<{
      id: string;
      name: string;
      arguments: string;
      client_side: boolean;
    }>;

    if (!functions || functions.length === 0) return;

    for (const func of functions) {
      if (!func.client_side) continue;

      try {
        const parameters = JSON.parse(func.arguments || "{}");

        const response = await fetch("/api/voice-agent/function", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            functionName: func.name,
            parameters,
            functionCallId: func.id,
          }),
        });

        if (!response.ok) throw new Error("Function call failed");

        const { result } = await response.json();

        wsRef.current?.send(
          JSON.stringify({
            type: "FunctionCallResponse",
            id: func.id,
            name: func.name,
            content: JSON.stringify(result),
          })
        );
      } catch (error) {
        console.error("[VoiceAgent] Function call error:", error);
        wsRef.current?.send(
          JSON.stringify({
            type: "FunctionCallResponse",
            id: func.id,
            name: func.name,
            content: JSON.stringify({ error: "Function call failed" }),
          })
        );
      }
    }
  };

  const handleAudioData = async (blob: Blob) => {
    if (!audioContextRef.current) return;

    try {
      const arrayBuffer = await blob.arrayBuffer();
      const int16Array = new Int16Array(arrayBuffer);
      const float32Array = new Float32Array(int16Array.length);

      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768;
      }

      const audioBuffer = audioContextRef.current.createBuffer(
        1,
        float32Array.length,
        24000
      );
      audioBuffer.getChannelData(0).set(float32Array);

      audioQueueRef.current.push(audioBuffer);
      playNextAudio();
    } catch (error) {
      console.error("[VoiceAgent] Audio error:", error);
    }
  };

  const playNextAudio = () => {
    if (
      isPlayingRef.current ||
      audioQueueRef.current.length === 0 ||
      !audioContextRef.current
    )
      return;

    isPlayingRef.current = true;
    const audioBuffer = audioQueueRef.current.shift()!;

    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContextRef.current.destination);

    source.onended = () => {
      isPlayingRef.current = false;
      playNextAudio();
    };

    source.start();
  };

  const startAudioCapture = (stream: MediaStream, ws: WebSocket) => {
    const inputContext = new AudioContext({ sampleRate: 16000 });

    const source = inputContext.createMediaStreamSource(stream);
    const processor = inputContext.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (e) => {
      if (ws.readyState !== WebSocket.OPEN) return;

      const inputData = e.inputBuffer.getChannelData(0);
      const pcmData = new Int16Array(inputData.length);

      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      ws.send(pcmData.buffer);
    };

    source.connect(processor);
    processor.connect(inputContext.destination);
  };

  const stopConversation = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    audioQueueRef.current = [];
    isPlayingRef.current = false;

    setState("idle");
    setTranscript("");
  }, []);

  const toggleConversation = useCallback(() => {
    if (state === "idle") {
      startConversation();
    } else {
      stopConversation();
      toast.info("Voice chat ended");
    }
  }, [state, startConversation, stopConversation]);

  // Button content based on state
  const getButtonContent = () => {
    switch (state) {
      case "connecting":
        return (
          <>
            <LoadingSpinner />
            <span className="ml-2">Connecting...</span>
          </>
        );
      case "listening":
        return (
          <>
            <MicrophoneIcon className="animate-pulse text-green-500" />
            <span className="ml-2">Listening...</span>
          </>
        );
      case "thinking":
        return (
          <>
            <LoadingSpinner />
            <span className="ml-2">Thinking...</span>
          </>
        );
      case "speaking":
        return (
          <>
            <SpeakerIcon className="animate-pulse text-blue-500" />
            <span className="ml-2">Speaking...</span>
          </>
        );
      default:
        return (
          <>
            <VoiceAgentIcon />
            <span className="ml-2">Voice</span>
          </>
        );
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        variant={state === "idle" ? "outline" : "default"}
        size="sm"
        onClick={toggleConversation}
        disabled={disabled}
        className={cn(
          "flex items-center gap-1 transition-all",
          state !== "idle" && "bg-primary text-primary-foreground",
          className
        )}
      >
        {getButtonContent()}
      </Button>

      {/* Show transcript when active */}
      {state !== "idle" && transcript && (
        <div className="text-sm text-muted-foreground max-w-xs truncate">
          You: {transcript}
        </div>
      )}
    </div>
  );
}

// Icons
function VoiceAgentIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1a2 2 0 0 0-2 2v4a2 2 0 1 0 4 0V3a2 2 0 0 0-2-2Z" />
      <path d="M4.5 7a.5.5 0 0 0-1 0 4.5 4.5 0 0 0 4 4.473V13H6a.5.5 0 0 0 0 1h4a.5.5 0 0 0 0-1H8.5v-1.527A4.5 4.5 0 0 0 12.5 7a.5.5 0 0 0-1 0 3.5 3.5 0 1 1-7 0Z" />
      <circle cx="13" cy="3" r="2" fill="#22c55e" />
    </svg>
  );
}

function MicrophoneIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
    >
      <path d="M8 1a2 2 0 0 0-2 2v4a2 2 0 1 0 4 0V3a2 2 0 0 0-2-2Z" />
      <path d="M4.5 7a.5.5 0 0 0-1 0 4.5 4.5 0 0 0 4 4.473V13H6a.5.5 0 0 0 0 1h4a.5.5 0 0 0 0-1H8.5v-1.527A4.5 4.5 0 0 0 12.5 7a.5.5 0 0 0-1 0 3.5 3.5 0 1 1-7 0Z" />
    </svg>
  );
}

function SpeakerIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
    >
      <path d="M7.5 2.5L4.5 5H2a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2.5l3 2.5V2.5Z" />
      <path
        d="M10 5c.5.5 1 1.5 1 3s-.5 2.5-1 3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M12 3c1 1 2 2.5 2 5s-1 4-2 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LoadingSpinner() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className="animate-spin"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="31.4"
        strokeDashoffset="10"
      />
    </svg>
  );
}
