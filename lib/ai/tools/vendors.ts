/**
 * SmartCFO Vendor Tools
 * 
 * Tools for managing vendors via AI chat.
 * Similar to client tools but for expense tracking.
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
// SEARCH VENDORS TOOL (Smart Multi-Field)
// ============================================

export const searchVendors = tool({
    description: `
Search for vendors by name, email, phone, or address.
Automatically detects what type of search to perform:
- Email format (contains @) → searches email field
- Phone format (mostly digits) → searches phone field
- Otherwise → fuzzy name search with Levenshtein matching

Use this when user mentions any vendor info to find the correct vendor.
  `,

    inputSchema: z.object({
        searchTerm: z.string().describe("Vendor name, email, phone, or any identifying info"),
        limit: z.number().optional().default(5).describe("Max results to return"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [searchVendors] TOOL CALLED ==========");
        console.log("[searchVendors] Input received:", JSON.stringify(input, null, 2));

        const { searchTerm, limit, userId } = input;
        const searchType = detectSearchType(searchTerm);
        console.log("[searchVendors] Detected search type:", searchType);

        try {
            const { data: vendors, error } = await supabase
                .from("vendors")
                .select("id, name, email, address, phone, tax_id")
                .eq("user_id", userId)
                .is("deleted_at", null)
                .limit(100);

            console.log("[searchVendors] Vendors fetched:", vendors?.length, "error:", error);

            if (!vendors || vendors.length === 0) {
                return {
                    status: "success",
                    matches: [],
                    searchType,
                    message: "No vendors found. Would you like to create one?",
                };
            }

            // Smart matching based on detected type
            let matches: Array<{
                id: string;
                name: string;
                email: string | null;
                phone: string | null;
                address: string | null;
                score: number;
                matchedOn: string;
            }> = [];

            const term = searchTerm.toLowerCase();

            if (searchType === "email") {
                // Exact or partial email match
                matches = vendors
                    .filter((v) => v.email?.toLowerCase().includes(term))
                    .map((v) => ({
                        id: v.id,
                        name: v.name,
                        email: v.email,
                        phone: v.phone,
                        address: v.address,
                        score: v.email?.toLowerCase() === term ? 100 : 90,
                        matchedOn: "email",
                    }));
            } else if (searchType === "phone") {
                // Phone match (strip formatting)
                const searchDigits = term.replace(/[\s\-\+\(\)]/g, "");
                matches = vendors
                    .filter((v) => {
                        if (!v.phone) return false;
                        const phoneDigits = v.phone.replace(/[\s\-\+\(\)]/g, "");
                        return phoneDigits.includes(searchDigits) || searchDigits.includes(phoneDigits);
                    })
                    .map((v) => ({
                        id: v.id,
                        name: v.name,
                        email: v.email,
                        phone: v.phone,
                        address: v.address,
                        score: 90,
                        matchedOn: "phone",
                    }));
            } else {
                // Name search with Levenshtein + also check other fields
                matches = vendors
                    .map((v) => {
                        const nameScore = calculateMatchScore(searchTerm, v.name);
                        // Also check if term appears in address
                        const addressMatch = v.address?.toLowerCase().includes(term);

                        let bestScore = nameScore;
                        let matchedOn = "name";

                        if (addressMatch && nameScore < 50) {
                            bestScore = 80;
                            matchedOn = "address";
                        }

                        return {
                            id: v.id,
                            name: v.name,
                            email: v.email,
                            phone: v.phone,
                            address: v.address,
                            score: bestScore,
                            matchedOn,
                        };
                    })
                    .filter((v) => v.score >= 50);
            }

            // Sort by score and limit
            matches = matches
                .sort((a, b) => b.score - a.score)
                .slice(0, limit);

            console.log("[searchVendors] Matches found:", matches.length, "by:", searchType);

            if (matches.length === 0) {
                return {
                    status: "success",
                    matches: [],
                    searchType,
                    message: `No vendors matching "${searchTerm}". Would you like to create a new vendor?`,
                };
            }

            return {
                status: "success",
                matches,
                searchType,
                bestMatch: matches[0].score >= 80 ? matches[0] : null,
            };
        } catch (error) {
            console.error("[searchVendors] Error:", error);
            return { status: "error", error: "Failed to search vendors" };
        }
    },
});

// ============================================
// ADD VENDOR TOOL
// ============================================

export const addVendor = tool({
    description: `
Create a new vendor/supplier for expense tracking.
Call this AFTER user confirms they want to create a new vendor.
Pass any details the user provided (email, phone, address, tax ID).
If user just said "yes" or "create it", pass only the name.
  `,

    inputSchema: z.object({
        name: z.string().describe("Vendor name (required)"),
        email: z.string().email().optional().describe("Vendor email"),
        phone: z.string().optional().describe("Phone number"),
        address: z.string().optional().describe("Vendor address"),
        taxId: z.string().optional().describe("Vendor tax ID"),
        paymentTerms: z.number().optional().describe("Payment terms in days"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [addVendor] TOOL CALLED ==========");
        console.log("[addVendor] Input received:", JSON.stringify(input, null, 2));

        const { name, email, phone, address, taxId, paymentTerms, userId } = input;

        try {
            // Check if vendor already exists
            console.log("[addVendor] Checking if vendor exists...");
            const { data: existing, error: checkError } = await supabase
                .from("vendors")
                .select("id, name")
                .eq("user_id", userId)
                .ilike("name", name)
                .is("deleted_at", null)
                .limit(1);

            console.log("[addVendor] Existing check - data:", existing, "error:", checkError);

            if (existing && existing.length > 0) {
                console.log("[addVendor] Vendor already exists:", existing[0]);
                return {
                    status: "exists",
                    vendor: existing[0],
                    message: `Vendor "${existing[0].name}" already exists.`,
                };
            }

            // Create new vendor
            console.log("[addVendor] Creating new vendor...");
            const insertData = {
                user_id: userId,
                name,
                email: email || null,
                phone: phone || null,
                address: address || null,
                tax_id: taxId || null,
                payment_terms: paymentTerms || 30,
            };
            console.log("[addVendor] Insert data:", JSON.stringify(insertData, null, 2));

            const { data: newVendor, error } = await supabase
                .from("vendors")
                .insert(insertData)
                .select("id, name, email, address")
                .single();

            console.log("[addVendor] Insert result - data:", newVendor, "error:", error);

            if (error) {
                console.error("[addVendor] INSERT ERROR:", error);
                return { status: "error", error: "Failed to create vendor", details: error.message };
            }

            console.log("[addVendor] SUCCESS! Vendor created:", newVendor);
            return {
                status: "success",
                vendor: {
                    id: newVendor.id,
                    name: newVendor.name,
                    email: newVendor.email,
                    address: newVendor.address,
                },
                message: `Created new vendor: ${newVendor.name}`,
            };
        } catch (error) {
            console.error("[addVendor] CATCH ERROR:", error);
            return { status: "error", error: "Failed to create vendor" };
        }
    },
});

// ============================================
// GET VENDOR TOOL
// ============================================

export const getVendor = tool({
    description: `
Get details for a specific vendor by ID.
  `,

    inputSchema: z.object({
        vendorId: z.string().uuid().describe("Vendor ID"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [getVendor] TOOL CALLED ==========");
        console.log("[getVendor] Input received:", JSON.stringify(input, null, 2));

        const { vendorId, userId } = input;

        try {
            const { data: vendor, error } = await supabase
                .from("vendors")
                .select("id, name, email, phone, address, tax_id, payment_terms, created_at")
                .eq("id", vendorId)
                .eq("user_id", userId)
                .is("deleted_at", null)
                .single();

            console.log("[getVendor] Query result - data:", vendor, "error:", error);

            if (error || !vendor) {
                return { status: "error", error: "Vendor not found" };
            }

            return {
                status: "success",
                vendor: {
                    id: vendor.id,
                    name: vendor.name,
                    email: vendor.email,
                    phone: vendor.phone,
                    address: vendor.address,
                    taxId: vendor.tax_id,
                    paymentTerms: vendor.payment_terms,
                    createdAt: vendor.created_at,
                },
            };
        } catch (error) {
            console.error("[getVendor] Error:", error);
            return { status: "error", error: "Failed to get vendor" };
        }
    },
});

// ============================================
// UPDATE VENDOR TOOL
// ============================================

export const updateVendor = tool({
    description: `
Update an existing vendor. Preview first (confirmed=false), then confirm.

FLOW:
1. confirmed=false → Shows current vs new values
2. Show preview to user, wait for "confirm"
3. confirmed=true → Applies changes
    `,

    inputSchema: z.object({
        vendorId: z.string().uuid().describe("Vendor ID to update"),
        name: z.string().optional().describe("New vendor name"),
        email: z.string().optional().describe("New email"),
        phone: z.string().optional().describe("New phone"),
        companyName: z.string().optional().describe("New company name"),
        address: z.string().optional().describe("New address"),
        confirmed: z.boolean().describe("false=preview, true=save"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [updateVendor] TOOL CALLED ==========");
        console.log("[updateVendor] Input:", JSON.stringify(input, null, 2));

        const { vendorId, name, email, phone, companyName, address, confirmed, userId } = input;

        try {
            // Get existing vendor
            const { data: existing, error: fetchError } = await supabase
                .from("vendors")
                .select("*")
                .eq("id", vendorId)
                .eq("user_id", userId)
                .is("deleted_at", null)
                .single();

            if (fetchError || !existing) {
                return { status: "not_found", error: "Vendor not found" };
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
                        vendorId: existing.id,
                        vendorName: existing.name,
                        changes: preview,
                    },
                    message: `Review changes for ${existing.name}. Say 'confirm' to apply.`,
                };
            }

            // SAVE MODE
            const { error: updateError } = await supabase
                .from("vendors")
                .update(changes)
                .eq("id", vendorId);

            if (updateError) {
                return { status: "error", error: "Failed to update vendor" };
            }

            return {
                status: "success",
                message: `Vendor ${existing.name} updated successfully! ✅`,
            };
        } catch (error) {
            return { status: "error", error: "Failed to update vendor" };
        }
    },
});

// ============================================
// EXPORT
// ============================================

export const vendorTools = {
    searchVendors,
    addVendor,
    getVendor,
    updateVendor,
};
