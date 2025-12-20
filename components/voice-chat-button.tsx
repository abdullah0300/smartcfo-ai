"use client";

/**
 * Voice Chat Button Component
 * 
 * Records audio, transcribes it, and sends to chat.
 * - Press and hold to record (up to 60s)
 * - Release to transcribe and send
 * - Shows recording indicator
 */

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MicrophoneIcon, LoaderIcon, StopIcon } from "./icons";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

interface VoiceChatButtonProps {
  onTranscript: (transcript: string) => void;
  disabled?: boolean;
  className?: string;
}

type RecordingState = "idle" | "recording" | "transcribing" | "speaking";

function PureVoiceChatButton({
  onTranscript,
  disabled = false,
  className,
}: VoiceChatButtonProps) {
  const [state, setState] = useState<RecordingState>("idle");
  const [audioLevel, setAudioLevel] = useState(0);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const recordingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
      }
    };
  }, []);

  // Animate audio level visualization
  const updateAudioLevel = useCallback(() => {
    if (!analyserRef.current) return;
    
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);
    
    const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    setAudioLevel(Math.min(average / 128, 1)); // Normalize to 0-1
    
    animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        }
      });
      
      streamRef.current = stream;
      
      // Setup audio visualization
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      
      // Start visualization
      updateAudioLevel();
      
      // Setup MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") 
        ? "audio/webm" 
        : "audio/mp4";
      
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        // Stop visualization
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        
        if (audioChunksRef.current.length === 0) {
          setState("idle");
          return;
        }
        
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        
        // Skip if too short (less than 500ms of audio)
        if (audioBlob.size < 5000) {
          toast.error("Recording too short. Please hold longer.");
          setState("idle");
          return;
        }
        
        await transcribeAndSend(audioBlob);
      };
      
      mediaRecorder.start(100); // Collect in 100ms chunks
      setState("recording");
      
      // Auto-stop after 60 seconds
      recordingTimeoutRef.current = setTimeout(() => {
        stopRecording();
        toast.info("Maximum recording time reached (60s)");
      }, 60000);
      
    } catch (error: any) {
      console.error("[VoiceChat] Microphone access error:", error);
      
      if (error.name === "NotAllowedError") {
        toast.error("Microphone access denied. Please allow microphone access.");
      } else if (error.name === "NotFoundError") {
        toast.error("No microphone found. Please connect a microphone.");
      } else {
        toast.error("Could not access microphone.");
      }
      
      setState("idle");
    }
  }, [updateAudioLevel]);

  const stopRecording = useCallback(() => {
    // Clear auto-stop timeout
    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
    
    // Stop media recorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    
    // Stop all tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    // Stop visualization
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    setAudioLevel(0);
  }, []);

  const transcribeAndSend = useCallback(async (audioBlob: Blob) => {
    setState("transcribing");
    
    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");
      
      const response = await fetch("/api/voice/transcribe", {
        method: "POST",
        body: formData,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Transcription failed");
      }
      
      const data = await response.json();
      const transcript = data.transcript?.trim();
      
      if (!transcript) {
        toast.error("Couldn't understand that. Please try again.");
        setState("idle");
        return;
      }
      
      console.log("[VoiceChat] Transcribed:", transcript);
      
      // Send transcript to chat
      onTranscript(transcript);
      setState("idle");
      
    } catch (error: any) {
      console.error("[VoiceChat] Transcription error:", error);
      toast.error(error.message || "Transcription failed");
      setState("idle");
    }
  }, [onTranscript]);

  const handleMouseDown = useCallback(() => {
    if (disabled || state !== "idle") return;
    startRecording();
  }, [disabled, state, startRecording]);

  const handleMouseUp = useCallback(() => {
    if (state === "recording") {
      stopRecording();
    }
  }, [state, stopRecording]);

  // Also handle touch events for mobile
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    handleMouseDown();
  }, [handleMouseDown]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    handleMouseUp();
  }, [handleMouseUp]);

  // Determine button style based on state
  const isRecording = state === "recording";
  const isProcessing = state === "transcribing" || state === "speaking";

  return (
    <Button
      className={cn(
        "aspect-square h-8 rounded-lg p-1 transition-all duration-200",
        isRecording && "bg-red-500 text-white hover:bg-red-600 scale-110",
        isProcessing && "bg-primary/20",
        !isRecording && !isProcessing && "hover:bg-accent",
        className
      )}
      data-testid="voice-chat-button"
      disabled={disabled || isProcessing}
      onMouseDown={handleMouseDown}
      onMouseLeave={handleMouseUp}
      onMouseUp={handleMouseUp}
      onTouchEnd={handleTouchEnd}
      onTouchStart={handleTouchStart}
      style={isRecording ? {
        boxShadow: `0 0 ${10 + audioLevel * 20}px ${2 + audioLevel * 5}px rgba(239, 68, 68, ${0.3 + audioLevel * 0.4})`,
      } : undefined}
      title={isRecording ? "Release to send" : "Hold to record"}
      variant="ghost"
    >
      {isProcessing ? (
        <span className="animate-spin">
          <LoaderIcon size={14} />
        </span>
      ) : isRecording ? (
        <StopIcon size={14} />
      ) : (
        <MicrophoneIcon size={14} />
      )}
    </Button>
  );
}

export const VoiceChatButton = memo(PureVoiceChatButton);
