/**
 * SmartCFO Client Tools
 * 
 * Tools for managing clients via AI chat.
 */

import { tool } from "ai";
import { z } from "zod";
import { supabase } from "@/lib/supabase/client";

// ============================================
// LEVENSHTEIN DISTANCE (for fuzzy matching)
// ============================================

function levenshteinDistance(str1: string, str2: string): number {
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();
    const m = s1.length;
    const n = s2.length;

    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (s1[i - 1] === s2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
        }
    }
    return dp[m][n];
}

function calculateMatchScore(search: string, target: string): number {
    const s = search.toLowerCase();
    const t = target.toLowerCase();
    if (s === t) return 100;
    if (t.includes(s) || s.includes(t)) return 90;
    const distance = levenshteinDistance(s, t);
    const maxLength = Math.max(s.length, t.length);
    if (maxLength === 0) return 100;
    return Math.max(0, Math.round((1 - distance / maxLength) * 100));
}

// ============================================
// HELPER: Detect Search Type
// ============================================

function detectSearchType(term: string): "email" | "phone" | "name" {
    // Email detection: contains @ and .
    if (term.includes("@") && term.includes(".")) {
        return "email";
    }
    // Phone detection: mostly digits, may have + or -
    const digitsOnly = term.replace(/[\s\-\+\(\)]/g, "");
    if (digitsOnly.length >= 7 && /^\d+$/.test(digitsOnly)) {
        return "phone";
    }
    // Default: name search
    return "name";
}

// ============================================
// SEARCH CLIENTS TOOL (Smart Multi-Field)
// ============================================

export const searchClients = tool({
    description: `
Search for clients by name, email, phone, company name, or address.
Automatically detects what type of search to perform:
- Email format (contains @) → searches email field
- Phone format (mostly digits) → searches phone field
- Otherwise → fuzzy name/company search with Levenshtein matching

Use this when user mentions any client info to find the correct client.
  `,

    inputSchema: z.object({
        searchTerm: z.string().describe("Client name, email, phone, company, or any identifying info"),
        limit: z.number().optional().default(5).describe("Max results to return"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [searchClients] TOOL CALLED ==========");
        console.log("[searchClients] Input received:", JSON.stringify(input, null, 2));

        const { searchTerm, limit, userId } = input;
        const searchType = detectSearchType(searchTerm);
        console.log("[searchClients] Detected search type:", searchType);

        try {
            const { data: clients, error } = await supabase
                .from("clients")
                .select("id, name, email, company_name, phone, address")
                .eq("user_id", userId)
                .is("deleted_at", null)
                .limit(100);

            console.log("[searchClients] Clients fetched:", clients?.length, "error:", error);

            if (!clients || clients.length === 0) {
                return {
                    status: "success",
                    matches: [],
                    searchType,
                    message: "No clients found. Would you like to create one?",
                };
            }

            // Smart matching based on detected type
            let matches: Array<{
                id: string;
                name: string;
                email: string | null;
                phone: string | null;
                companyName: string | null;
                address: string | null;
                score: number;
                matchedOn: string;
            }> = [];

            const term = searchTerm.toLowerCase();

            if (searchType === "email") {
                // Exact or partial email match
                matches = clients
                    .filter((c) => c.email?.toLowerCase().includes(term))
                    .map((c) => ({
                        id: c.id,
                        name: c.name,
                        email: c.email,
                        phone: c.phone,
                        companyName: c.company_name,
                        address: c.address,
                        score: c.email?.toLowerCase() === term ? 100 : 90,
                        matchedOn: "email",
                    }));
            } else if (searchType === "phone") {
                // Phone match (strip formatting)
                const searchDigits = term.replace(/[\s\-\+\(\)]/g, "");
                matches = clients
                    .filter((c) => {
                        if (!c.phone) return false;
                        const phoneDigits = c.phone.replace(/[\s\-\+\(\)]/g, "");
                        return phoneDigits.includes(searchDigits) || searchDigits.includes(phoneDigits);
                    })
                    .map((c) => ({
                        id: c.id,
                        name: c.name,
                        email: c.email,
                        phone: c.phone,
                        companyName: c.company_name,
                        address: c.address,
                        score: 90,
                        matchedOn: "phone",
                    }));
            } else {
                // Name/company search with Levenshtein + also check other fields
                matches = clients
                    .map((c) => {
                        const nameScore = calculateMatchScore(searchTerm, c.name);
                        const companyScore = c.company_name ? calculateMatchScore(searchTerm, c.company_name) : 0;
                        const addressMatch = c.address?.toLowerCase().includes(term);

                        let bestScore = Math.max(nameScore, companyScore);
                        let matchedOn = nameScore >= companyScore ? "name" : "company_name";

                        if (addressMatch && bestScore < 50) {
                            bestScore = 80;
                            matchedOn = "address";
                        }

                        return {
                            id: c.id,
                            name: c.name,
                            email: c.email,
                            phone: c.phone,
                            companyName: c.company_name,
                            address: c.address,
                            score: bestScore,
                            matchedOn,
                        };
                    })
                    .filter((c) => c.score >= 50);
            }

            // Sort by score and limit
            matches = matches
                .sort((a, b) => b.score - a.score)
                .slice(0, limit);

            console.log("[searchClients] Matches found:", matches.length, "by:", searchType);

            if (matches.length === 0) {
                return {
                    status: "success",
                    matches: [],
                    searchType,
                    message: `No clients matching "${searchTerm}". Would you like to create a new client?`,
                };
            }

            return {
                status: "success",
                matches,
                searchType,
                bestMatch: matches[0].score >= 80 ? matches[0] : null,
            };
        } catch (error) {
            console.error("[searchClients] Error:", error);
            return { status: "error", error: "Failed to search clients" };
        }
    },
});

// ============================================
// ADD CLIENT TOOL
// ============================================

export const addClient = tool({
    description: `
Create a new client for income tracking.
Call this AFTER user confirms they want to create a new client.
Pass any details the user provided (email, phone, company, address).
If user just said "yes" or "create it", pass only the name.
  `,

    inputSchema: z.object({
        name: z.string().describe("Client name (required)"),
        email: z.string().email().optional().describe("Client email"),
        phone: z.string().optional().describe("Phone number"),
        companyName: z.string().optional().describe("Company name if different from client name"),
        address: z.string().optional().describe("Client address"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [addClient] TOOL CALLED ==========");
        console.log("[addClient] Input received:", JSON.stringify(input, null, 2));

        const { name, email, phone, companyName, address, userId } = input;

        try {
            // Check if client already exists
            console.log("[addClient] Checking if client exists...");
            const { data: existing, error: checkError } = await supabase
                .from("clients")
                .select("id, name")
                .eq("user_id", userId)
                .ilike("name", name)
                .is("deleted_at", null)
                .limit(1);

            console.log("[addClient] Existing check - data:", existing, "error:", checkError);

            if (existing && existing.length > 0) {
                console.log("[addClient] Client already exists:", existing[0]);
                return {
                    status: "exists",
                    client: existing[0],
                    message: `Client "${existing[0].name}" already exists.`,
                };
            }

            // Create new client
            console.log("[addClient] Creating new client...");
            const insertData = {
                user_id: userId,
                name,
                email: email || null,
                phone: phone || null,
                company_name: companyName || null,
                address: address || null,
            };
            console.log("[addClient] Insert data:", JSON.stringify(insertData, null, 2));

            const { data: newClient, error } = await supabase
                .from("clients")
                .insert(insertData)
                .select("id, name, email, company_name")
                .single();

            console.log("[addClient] Insert result - data:", newClient, "error:", error);

            if (error) {
                console.error("[addClient] INSERT ERROR:", error);
                return { status: "error", error: "Failed to create client", details: error.message };
            }

            console.log("[addClient] SUCCESS! Client created:", newClient);
            return {
                status: "success",
                client: {
                    id: newClient.id,
                    name: newClient.name,
                    email: newClient.email,
                    companyName: newClient.company_name,
                },
                message: `Created new client: ${newClient.name}`,
            };
        } catch (error) {
            console.error("[addClient] CATCH ERROR:", error);
            return { status: "error", error: "Failed to create client" };
        }
    },
});

// ============================================
// GET CLIENT TOOL
// ============================================

export const getClient = tool({
    description: `
Get details for a specific client by ID.
  `,

    inputSchema: z.object({
        clientId: z.string().uuid().describe("Client ID"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        const { clientId, userId } = input;

        try {
            const { data: client, error } = await supabase
                .from("clients")
                .select("id, name, email, phone, company_name, address, created_at")
                .eq("id", clientId)
                .eq("user_id", userId)
                .is("deleted_at", null)
                .single();

            if (error || !client) {
                return { status: "error", error: "Client not found" };
            }

            return {
                status: "success",
                client: {
                    id: client.id,
                    name: client.name,
                    email: client.email,
                    phone: client.phone,
                    companyName: client.company_name,
                    address: client.address,
                    createdAt: client.created_at,
                },
            };
        } catch (error) {
            return { status: "error", error: "Failed to get client" };
        }
    },
});

// ============================================
// UPDATE CLIENT TOOL
// ============================================

export const updateClient = tool({
    description: `
Update an existing client. Preview first (confirmed=false), then confirm.

FLOW:
1. confirmed=false → Shows current vs new values
2. Show preview to user, wait for "confirm"
3. confirmed=true → Applies changes
    `,

    inputSchema: z.object({
        clientId: z.string().uuid().describe("Client ID to update"),
        name: z.string().optional().describe("New client name"),
        email: z.string().optional().describe("New email"),
        phone: z.string().optional().describe("New phone"),
        companyName: z.string().optional().describe("New company name"),
        address: z.string().optional().describe("New address"),
        confirmed: z.boolean().describe("false=preview, true=save"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [updateClient] TOOL CALLED ==========");
        console.log("[updateClient] Input:", JSON.stringify(input, null, 2));

        const { clientId, name, email, phone, companyName, address, confirmed, userId } = input;

        try {
            // Get existing client
            const { data: existing, error: fetchError } = await supabase
                .from("clients")
                .select("*")
                .eq("id", clientId)
                .eq("user_id", userId)
                .is("deleted_at", null)
                .single();

            if (fetchError || !existing) {
                return { status: "not_found", error: "Client not found" };
            }

            // Build changes
            const changes: Record<string, any> = {};
            const preview: Record<string, { old: any; new: any }> = {};

            if (name !== undefined && name !== existing.name) {
                changes.name = name;
                preview.name = { old: existing.name, new: name };
            }
            if (email !== undefined && email !== existing.email) {
                changes.email = email;
                preview.email = { old: existing.email || "None", new: email };
            }
            if (phone !== undefined && phone !== existing.phone) {
                changes.phone = phone;
                preview.phone = { old: existing.phone || "None", new: phone };
            }
            if (companyName !== undefined && companyName !== existing.company_name) {
                changes.company_name = companyName;
                preview.company = { old: existing.company_name || "None", new: companyName };
            }
            if (address !== undefined && address !== existing.address) {
                changes.address = address;
                preview.address = { old: existing.address || "None", new: address };
            }

            if (Object.keys(changes).length === 0) {
                return { status: "no_changes", message: "No changes to apply." };
            }

            // PREVIEW MODE
            if (!confirmed) {
                return {
                    status: "preview",
                    preview: {
                        clientId: existing.id,
                        clientName: existing.name,
                        changes: preview,
                    },
                    message: `Review changes for ${existing.name}. Say 'confirm' to apply.`,
                };
            }

            // SAVE MODE
            const { error: updateError } = await supabase
                .from("clients")
                .update(changes)
                .eq("id", clientId);

            if (updateError) {
                return { status: "error", error: "Failed to update client" };
            }

            return {
                status: "success",
                message: `Client ${existing.name} updated successfully! ✅`,
            };
        } catch (error) {
            return { status: "error", error: "Failed to update client" };
        }
    },
});

// ============================================
// EXPORT
// ============================================

export const clientTools = {
    searchClients,
    addClient,
    getClient,
    updateClient,
};
