/**
 * API Route: Send Invoice Email
 * 
 * This route proxies requests to the Supabase Edge Function for sending invoice emails.
 * It uses the service role key to authenticate with the Edge Function.
 */

import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
    console.log("\n========== [API] /api/invoice-email ==========");

    try {
        const body = await request.json();
        console.log("[API] Request body:", JSON.stringify(body, null, 2));

        const { invoiceId, recipientEmail, ccEmails, subject, message, attachPdf, userId } = body;

        // Validate required fields
        if (!invoiceId || !recipientEmail) {
            return NextResponse.json(
                { error: "Missing required fields: invoiceId and recipientEmail" },
                { status: 400 }
            );
        }

        if (!userId) {
            return NextResponse.json(
                { error: "User ID is required" },
                { status: 401 }
            );
        }

        // Get Supabase URL and service role key
        const supabaseUrl = process.env.SUPABASE_URL;
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !serviceRoleKey) {
            console.error("[API] Missing Supabase configuration");
            return NextResponse.json(
                { error: "Server configuration error" },
                { status: 500 }
            );
        }

        console.log("[API] Calling Edge Function at:", `${supabaseUrl}/functions/v1/send-invoice-email`);

        // Call Supabase Edge Function with service role key
        const response = await fetch(
            `${supabaseUrl}/functions/v1/send-invoice-email`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${serviceRoleKey}`,
                },
                body: JSON.stringify({
                    invoiceId,
                    recipientEmail,
                    ccEmails: ccEmails || [],
                    subject,
                    message,
                    attachPdf: attachPdf || false,
                }),
            }
        );

        const result = await response.json();
        console.log("[API] Edge Function response:", result);

        if (!response.ok) {
            console.error("[API] Edge Function error:", result);
            return NextResponse.json(
                { error: result.error || "Failed to send email" },
                { status: response.status }
            );
        }

        console.log("[API] Email sent successfully");
        return NextResponse.json(result);

    } catch (error) {
        console.error("[API] Error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

// Handle OPTIONS for CORS
export async function OPTIONS() {
    return NextResponse.json({}, { status: 200 });
}
