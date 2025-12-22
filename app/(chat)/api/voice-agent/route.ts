/**
 * Voice Agent API Endpoint
 * Generates temporary token and configuration for Deepgram Voice Agent
 */

import { NextResponse } from "next/server";
import { geolocation } from "@vercel/functions";
import { auth } from "@/app/(auth)/auth";
import { supabase } from "@/lib/supabase/client";
import { voiceAgentFunctions } from "@/lib/voice/voice-tools";
import {
  systemPrompt,
  type RequestHints,
  type UserContext,
} from "@/lib/ai/prompts";

// Voice Agent configuration endpoint
export async function GET(request: Request) {
  try {
    // Authenticate user
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Check API key
    if (!process.env.DEEPGRAM_API_KEY) {
      console.error("[VoiceAgent] DEEPGRAM_API_KEY not configured");
      return NextResponse.json(
        { error: "Voice agent not configured" },
        { status: 500 }
      );
    }

    // Try to generate temporary token for browser use
    // Falls back to API key for development (requires upgraded API key permissions)
    let authToken = process.env.DEEPGRAM_API_KEY!;

    try {
      const tokenResponse = await fetch(
        "https://api.deepgram.com/v1/auth/grant",
        {
          method: "POST",
          headers: {
            Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ttl_seconds: 600, // 10 minutes
          }),
        }
      );

      if (tokenResponse.ok) {
        const { access_token } = await tokenResponse.json();
        authToken = access_token;
        console.log("[VoiceAgent] Using temporary token");
      } else {
        console.warn(
          "[VoiceAgent] Using API key directly (temp token requires Member+ permissions)"
        );
      }
    } catch (e) {
      console.warn("[VoiceAgent] Token generation failed, using API key");
    }

    // Get user settings from database
    const [userSettingsRes, invoiceSettingsRes] = await Promise.all([
      supabase
        .from("user_settings")
        .select("*")
        .eq("user_id", userId)
        .single(),
      supabase
        .from("invoice_settings")
        .select("*")
        .eq("user_id", userId)
        .single(),
    ]);

    const userSettings = userSettingsRes.data;
    const invoiceSettings = invoiceSettingsRes.data;

    // Build user context (same format used in text chat)
    const userContext: UserContext = {
      userId,
      userName: session.user.name || undefined,
      companyName: userSettings?.company_name || undefined,
      companyAddress: userSettings?.company_address || undefined,
      businessEmail: userSettings?.business_email || undefined,
      baseCurrency: userSettings?.base_currency || "USD",
      enabledCurrencies: userSettings?.enabled_currencies || ["USD"],
      defaultTaxRate: invoiceSettings?.default_tax_rate || 0,
      taxType: invoiceSettings?.tax_type || undefined,
      isTaxRegistered: userSettings?.is_tax_registered || false,
      invoicePrefix: invoiceSettings?.invoice_prefix || "INV-",
      paymentTerms: invoiceSettings?.payment_terms || 30,
      invoiceNotes: invoiceSettings?.invoice_notes || undefined,
      invoiceFooter: invoiceSettings?.invoice_footer || undefined,
      country: userSettings?.country || undefined,
      timezone: userSettings?.timezone || "UTC",
    };

    // Build system instructions using the same systemPrompt as chat (with voice mode)
    const { longitude, latitude, city, country } = geolocation(request);
    const requestHints: RequestHints = { longitude, latitude, city, country };
    
    const voiceInstructions = systemPrompt({
      selectedChatModel: "gpt-4o-mini",
      requestHints,
      userContext,
      mode: "voice",
    });

    // Voice Agent Settings Configuration (exact format per Deepgram docs)
    const agentConfig = {
      type: "Settings",
      audio: {
        input: {
          encoding: "linear16",
          sample_rate: 16000,
        },
        output: {
          encoding: "linear16",
          sample_rate: 24000,
          container: "none",
        },
      },
      agent: {
        language: "en",
        listen: {
          provider: {
            type: "deepgram",
            model: "nova-3",
          },
        },
        think: {
          provider: {
            type: "open_ai",
            model: "gpt-4o-mini",
            temperature: 0.7,
          },
          prompt: voiceInstructions,
          functions: voiceAgentFunctions,
        },
        speak: {
          provider: {
            type: "deepgram",
            model: "aura-2-thalia-en",
          },
        },
      },
    };

    // Return configuration for client
    return NextResponse.json({
      token: authToken,
      config: agentConfig,
      userId,
      wsUrl: "wss://agent.deepgram.com/v1/agent/converse",
    });
  } catch (error) {
    console.error("[VoiceAgent] Error:", error);
    return NextResponse.json(
      { error: "Failed to initialize voice agent" },
      { status: 500 }
    );
  }
}
