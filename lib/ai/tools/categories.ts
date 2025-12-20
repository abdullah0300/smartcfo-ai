/**
 * SmartCFO Category Tools
 * 
 * Tools for managing income/expense categories via AI chat.
 */

import { tool } from "ai";
import { z } from "zod";
import { supabase } from "@/lib/supabase/client";

// ============================================
// GET CATEGORIES TOOL
// ============================================

export const getCategories = tool({
    description: `
Get user's categories. Can filter by type (income/expense).
Use when user mentions a category name to find matching ones.
  `,

    inputSchema: z.object({
        type: z.enum(["income", "expense", "all"]).optional().default("all").describe("Filter by category type"),
        searchTerm: z.string().optional().describe("Optional name to search for"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [getCategories] TOOL CALLED ==========");
        console.log("[getCategories] Input received:", JSON.stringify(input, null, 2));

        const { type, searchTerm, userId } = input;

        try {
            let query = supabase
                .from("categories")
                .select("id, name, type, color, description")
                .eq("user_id", userId)
                .is("deleted_at", null)
                .order("name");

            if (type && type !== "all") {
                query = query.eq("type", type);
            }

            const { data: categories, error } = await query;

            console.log("[getCategories] Query result - data:", categories?.length, "error:", error);

            if (error) {
                console.error("[getCategories] SUPABASE ERROR:", error);
                return { status: "error", error: "Failed to fetch categories", details: error.message };
            }

            let result = categories || [];

            // If search term provided, filter by name
            if (searchTerm && result.length > 0) {
                const term = searchTerm.toLowerCase();
                result = result.filter((c) =>
                    c.name.toLowerCase().includes(term) ||
                    term.includes(c.name.toLowerCase())
                );
            }

            return {
                status: "success",
                categories: result.map((c) => ({
                    id: c.id,
                    name: c.name,
                    type: c.type,
                    color: c.color,
                })),
                count: result.length,
            };
        } catch (error) {
            return { status: "error", error: "Failed to get categories" };
        }
    },
});

// ============================================
// ADD CATEGORY TOOL
// ============================================

export const addCategory = tool({
    description: `
Create a new category for income or expenses.
Use when user wants to add income/expense with a category that doesn't exist.
  `,

    inputSchema: z.object({
        name: z.string().describe("Category name"),
        type: z.enum(["income", "expense"]).describe("Category type"),
        color: z.string().optional().describe("Color code (hex)"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        const { name, type, color, userId } = input;

        try {
            // Check if category already exists
            const { data: existing } = await supabase
                .from("categories")
                .select("id, name")
                .eq("user_id", userId)
                .eq("type", type)
                .ilike("name", name)
                .is("deleted_at", null)
                .limit(1);

            if (existing && existing.length > 0) {
                return {
                    status: "exists",
                    category: existing[0],
                    message: `Category "${existing[0].name}" already exists.`,
                };
            }

            // Create new category
            const { data: newCategory, error } = await supabase
                .from("categories")
                .insert({
                    user_id: userId,
                    name,
                    type,
                    color: color || null,
                })
                .select("id, name, type, color")
                .single();

            if (error) {
                return { status: "error", error: "Failed to create category" };
            }

            return {
                status: "success",
                category: {
                    id: newCategory.id,
                    name: newCategory.name,
                    type: newCategory.type,
                    color: newCategory.color,
                },
                message: `Created new ${type} category: ${newCategory.name}`,
            };
        } catch (error) {
            return { status: "error", error: "Failed to create category" };
        }
    },
});

// ============================================
// UPDATE CATEGORY TOOL
// ============================================

export const updateCategory = tool({
    description: `
Update an existing category. No preview needed for simple edits.
    `,

    inputSchema: z.object({
        categoryId: z.string().uuid().describe("Category ID to update"),
        name: z.string().optional().describe("New category name"),
        color: z.string().optional().describe("New color (hex)"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [updateCategory] TOOL CALLED ==========");
        console.log("[updateCategory] Input:", JSON.stringify(input, null, 2));

        const { categoryId, name, color, userId } = input;

        try {
            // Get existing category
            const { data: existing, error: fetchError } = await supabase
                .from("categories")
                .select("*")
                .eq("id", categoryId)
                .eq("user_id", userId)
                .is("deleted_at", null)
                .single();

            if (fetchError || !existing) {
                return { status: "not_found", error: "Category not found" };
            }

            // Build changes
            const changes: Record<string, any> = {};
            if (name !== undefined && name !== existing.name) {
                changes.name = name;
            }
            if (color !== undefined && color !== existing.color) {
                changes.color = color;
            }

            if (Object.keys(changes).length === 0) {
                return { status: "no_changes", message: "No changes to apply." };
            }

            // Update
            const { error: updateError } = await supabase
                .from("categories")
                .update(changes)
                .eq("id", categoryId);

            if (updateError) {
                return { status: "error", error: "Failed to update category" };
            }

            return {
                status: "success",
                message: `Category "${existing.name}" updated successfully! ✅`,
            };
        } catch (error) {
            return { status: "error", error: "Failed to update category" };
        }
    },
});

// ============================================
// EXPORT
// ============================================

export const categoryTools = {
    getCategories,
    addCategory,
    updateCategory,
};
