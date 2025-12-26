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
  onConversationText?: (role: 'user' | 'assistant', content: string, isNewTurn: boolean) => void;
}

export function VoiceAgentButton({
  className,
  disabled,
  onConversationText,
}: VoiceAgentButtonProps) {
  const [state, setState] = useState<VoiceAgentState>("idle");
  const [transcript, setTranscript] = useState("");
  
  // Track last role for turn detection (new turn = role changed)
  const lastRoleRef = useRef<'user' | 'assistant' | null>(null);
  const turnResetRef = useRef<boolean>(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  
  // Sample rate measurement for debugging
  const sampleCountRef = useRef<number>(0);
  const measurementStartRef = useRef<number>(0);
  const lastRateLogRef = useRef<number>(0);

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

      // 3. Create audio context for output at 24kHz (matching Deepgram output)
      audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      
      // CRITICAL: Log actual sample rate - browser may not honor our request!
      console.log(`[VoiceAgent] ⚡ Requested sample rate: 24000, Actual: ${audioContextRef.current.sampleRate}`);
      if (audioContextRef.current.sampleRate !== 24000) {
        console.warn(`[VoiceAgent] ⚠️ Sample rate mismatch! Audio may play at wrong speed.`);
      }
      
      // 4. Load PCM worklet processor for audio playback
      await audioContextRef.current.audioWorklet.addModule("/pcm-processor.js");
      workletNodeRef.current = new AudioWorkletNode(
        audioContextRef.current,
        "pcm-player-processor"
      );
      workletNodeRef.current.connect(audioContextRef.current.destination);

      // 4. Connect to Deepgram Voice Agent
      const ws = new WebSocket(wsUrl, ["token", token]);
      ws.binaryType = "arraybuffer"; // Receive binary data as ArrayBuffer
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[VoiceAgent] WebSocket connected");
        ws.send(JSON.stringify(config));
        startAudioCapture(stream, ws);
        setState("listening");
        toast.success("Voice chat started! Speak now.");
      };

      ws.onmessage = async (event) => {
        // Binary data (audio) comes as ArrayBuffer
        if (event.data instanceof ArrayBuffer) {
          if (event.data.byteLength > 0) {
            const sampleCount = event.data.byteLength / 2; // Int16 = 2 bytes per sample
            
            // Track samples for rate measurement
            const now = performance.now();
            if (measurementStartRef.current === 0) {
              measurementStartRef.current = now;
              sampleCountRef.current = 0;
            }
            sampleCountRef.current += sampleCount;
            
            // Log actual sample rate every 2 seconds
            const elapsed = (now - measurementStartRef.current) / 1000;
            if (elapsed >= 2 && now - lastRateLogRef.current > 2000) {
              const actualRate = Math.round(sampleCountRef.current / elapsed);
              console.log(`[VoiceAgent] 📊 SAMPLE RATE: Actual=${actualRate} samples/sec (Expected=24000)`);
              lastRateLogRef.current = now;
            }
            
            console.log(`[VoiceAgent] 🔊 Audio chunk received: ${event.data.byteLength} bytes`);
            handleAudioData(event.data);
          }
        } else if (typeof event.data === "string") {
          // Text messages are JSON
          try {
            const data = JSON.parse(event.data);
            console.log(`[VoiceAgent] 📨 Message type: ${data.type}`, data);
            handleMessage(data);
          } catch (e) {
            console.warn("[VoiceAgent] Failed to parse message:", event.data.substring(0, 100));
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
        // BARGE-IN: User is interrupting - immediately stop AI audio playback
        // Note: Deepgram Voice Agent handles barge-in server-side automatically
        // We just need to clear the client-side audio buffer
        console.log("[VoiceAgent] 🛑 User started speaking - clearing audio buffer (barge-in)");
        
        // Clear the PCM playback buffer immediately
        if (workletNodeRef.current) {
          workletNodeRef.current.port.postMessage('clear');
        }
        
        // Reset sample rate measurement for next response
        measurementStartRef.current = 0;
        sampleCountRef.current = 0;
        
        setState("listening");
        break;

      case "ConversationText":
        // Use ConversationText for real-time chat display (research confirmed this is correct)
        const role = data.role as string;
        const content = data.content as string;
        
        // Detect if this is a new turn (role changed or explicitly reset)
        const isNewTurn = turnResetRef.current || role !== lastRoleRef.current;
        lastRoleRef.current = role as 'user' | 'assistant';
        turnResetRef.current = false;
        
        if (role === "user") {
          setTranscript(content);
          setState("thinking");
          onConversationText?.('user', content, isNewTurn);
        } else if (role === "assistant") {
          setState("speaking");
          onConversationText?.('assistant', content, isNewTurn);
        }
        break;

      case "History":
        // History is for context management, not for UI display
        // Just log it for debugging
        console.log("[VoiceAgent] History event (context):", data.role || 'function_call');
        break;

      case "AgentAudioDone":
        setState("listening");
        // Mark next ConversationText as new turn (AI finished speaking)
        turnResetRef.current = true;
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
    console.log("[VoiceAgent] 🔧 FunctionCallRequest received:", data);
    const functions = data.functions as Array<{
      id: string;
      name: string;
      arguments: string;
      client_side: boolean;
    }>;

    if (!functions || functions.length === 0) {
      console.log("[VoiceAgent] ⚠️ No functions in request");
      return;
    }

    for (const func of functions) {
      console.log(`[VoiceAgent] 📞 Function: ${func.name}, client_side: ${func.client_side}`);
      if (!func.client_side) {
        console.log(`[VoiceAgent] ⏭️ Skipping server-side function: ${func.name}`);
        continue;
      }

      try {
        const parameters = JSON.parse(func.arguments || "{}");
        console.log(`[VoiceAgent] 🚀 Calling ${func.name} with:`, parameters);
        const startTime = Date.now();

        const response = await fetch("/api/voice-agent/function", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            functionName: func.name,
            parameters,
            functionCallId: func.id,
          }),
        });

        const elapsed = Date.now() - startTime;
        console.log(`[VoiceAgent] ⏱️ Function ${func.name} took ${elapsed}ms`);

        if (!response.ok) {
          console.error(`[VoiceAgent] ❌ Function ${func.name} HTTP error: ${response.status}`);
          throw new Error("Function call failed");
        }

        const { result } = await response.json();
        console.log(`[VoiceAgent] ✅ Function ${func.name} result:`, result);

        const responsePayload = {
          type: "FunctionCallResponse",
          id: func.id,
          name: func.name,
          content: JSON.stringify(result),
        };
        console.log(`[VoiceAgent] 📤 Sending FunctionCallResponse:`, responsePayload);
        wsRef.current?.send(JSON.stringify(responsePayload));
      } catch (error) {
        console.error(`[VoiceAgent] ❌ Function ${func.name} error:`, error);
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
    console.log("[VoiceAgent] 🔧 FunctionCallRequest processing complete");
  };

  // Create WAV header for linear16 PCM data
  const createWavHeader = (dataLength: number, sampleRate: number): ArrayBuffer => {
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);
    
    // RIFF header
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, dataLength + 36, true); // file size - 8
    view.setUint32(8, 0x57415645, false); // "WAVE"
    
    // fmt chunk
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, 1, true); // audio format (PCM)
    view.setUint16(22, 1, true); // num channels
    view.setUint32(24, sampleRate, true); // sample rate
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    
    // data chunk
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, dataLength, true); // data size
    
    return buffer;
  };

  const handleAudioData = async (arrayBuffer: ArrayBuffer) => {
    if (!workletNodeRef.current) {
      console.warn("[VoiceAgent] ⚠️ Audio received but worklet not ready");
      return;
    }

    try {
      // Ensure proper byte alignment for Int16Array
      const alignedBuffer = arrayBuffer.slice(0, arrayBuffer.byteLength);
      const int16Data = new Int16Array(alignedBuffer);
      
      if (int16Data.length === 0) {
        console.log("[VoiceAgent] ⚠️ Empty audio chunk");
        return;
      }
      
      // Convert int16 to float32 (-1.0 to 1.0)
      const float32Data = new Float32Array(int16Data.length);
      for (let i = 0; i < int16Data.length; i++) {
        float32Data[i] = int16Data[i] / 32768.0;
      }
      
      // Post audio samples directly to worklet for playback
      workletNodeRef.current.port.postMessage(float32Data);
    } catch (error) {
      console.error("[VoiceAgent] ❌ Audio processing error:", error);
    }
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

    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

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

  // Button content based on state - icon only for clean design
  const getButtonContent = () => {
    switch (state) {
      case "connecting":
        return <LoadingSpinner />;
      case "listening":
        return <MicrophoneIcon />;
      case "thinking":
        return <LoadingSpinner />;
      case "speaking":
        return <SpeakerIcon />;
      default:
        return <VoiceAgentIcon />;
    }
  };
  // Always show animated waveform when active, static when idle
  const isActive = state !== "idle";

  // Status text for the badge above icon
  const getStatusText = () => {
    switch (state) {
      case "connecting": return "Connecting...";
      case "listening": return "Listening";
      case "thinking": return "Thinking...";
      case "speaking": return "Speaking";
      default: return null;
    }
  };

  return (
    <div className="relative flex flex-col items-center">
      {/* Status text above icon */}
      {isActive && (
        <span className="absolute -top-6 text-xs text-muted-foreground whitespace-nowrap animate-fade-in">
          {getStatusText()}
        </span>
      )}
      {/* Pulsing ring when idle */}
      {state === "idle" && (
        <span className="absolute inset-0 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 opacity-60 animate-ping-slow" />
      )}
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleConversation}
        disabled={disabled}
        className={cn(
          "relative z-10 rounded-full transition-all duration-300 text-white",
          state === "idle" && "h-8 w-8 bg-gradient-to-br from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-md hover:shadow-lg",
          isActive && "h-10 w-10 bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg",
          className
        )}
      >
        <VoiceAgentIcon isActive={isActive} />
      </Button>
    </div>
  );
}

// Animated Waveform Icon
function VoiceAgentIcon({ isActive = false }: { isActive?: boolean }) {
  return (
    <svg 
      width={isActive ? "24" : "20"} 
      height={isActive ? "24" : "20"} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
      className="transition-all duration-300"
    >
      {/* Sound wave bars with animation when active */}
      <line 
        x1="4" y1="10" x2="4" y2="14" 
        className={isActive ? "animate-wave-1" : ""}
      />
      <line 
        x1="8" y1="7" x2="8" y2="17" 
        className={isActive ? "animate-wave-2" : ""}
      />
      <line 
        x1="12" y1="4" x2="12" y2="20" 
        className={isActive ? "animate-wave-3" : ""}
      />
      <line 
        x1="16" y1="7" x2="16" y2="17" 
        className={isActive ? "animate-wave-4" : ""}
      />
      <line 
        x1="20" y1="10" x2="20" y2="14" 
        className={isActive ? "animate-wave-5" : ""}
      />
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
