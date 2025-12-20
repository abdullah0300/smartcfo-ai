/**
 * SmartCFO Expense Tools
 * 
 * Tools for managing expense records via AI chat.
 * Uses user's base currency and default tax from settings.
 */

import { tool } from "ai";
import { z } from "zod";
import { supabase } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "./types";

// ============================================
// ADD EXPENSE TOOL
// ============================================

export const addExpense = tool({
    description: `
Record new expense. Preview first (confirmed=false), save after user confirms (confirmed=true).

BEFORE CALLING:
- vendorId: OPTIONAL - get from searchVendors if user mentions a specific vendor/restaurant/store
  Skip vendor for: client meetings, personal expenses, general business costs, misc expenses
- categoryId: Get from getCategories (AI auto-selects best match), or addCategory if none fit

FLOW:
1. confirmed=false → Returns preview (NOT saved)
2. Show preview to user, wait for "confirm"
3. confirmed=true → Saves to database

VENDOR IS OPTIONAL for context like:
- "client meeting expense", "meeting dinner" → No vendor needed
- "office supplies", "business lunch" → No vendor needed
- "I spent 500 on dinner with client" → No vendor needed
  `,

    inputSchema: z.object({
        amount: z.number().positive().describe("Expense amount (required)"),
        description: z.string().describe("What the expense is for (required)"),
        date: z.string().optional().describe("Date in YYYY-MM-DD format. Default: today"),
        vendorId: z.string().uuid().optional().describe("Vendor ID - MUST be obtained from searchVendors or addVendor first"),
        categoryId: z.string().uuid().optional().describe("Category ID - MUST be obtained from getCategories or addCategory first"),
        projectId: z.string().uuid().optional().describe("Project ID if linked to project"),
        referenceNumber: z.string().optional().describe("Receipt or reference number"),
        currency: z.string().optional().describe("Override currency (only if user explicitly asks)"),
        taxRate: z.number().optional().describe("Override tax rate (only if user explicitly asks)"),
        confirmed: z.boolean().describe("false=preview only, true=save to database"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [addExpense] TOOL CALLED ==========");
        console.log("[addExpense] Input received:", JSON.stringify(input, null, 2));

        const {
            amount,
            description,
            date,
            vendorId,
            categoryId,
            projectId,
            referenceNumber,
            currency,
            taxRate,
            confirmed,
            userId,
        } = input;

        try {
            // ========== STEP 1: Get User Settings ==========
            const { data: userSettings } = await supabase
                .from("user_settings")
                .select("base_currency")
                .eq("user_id", userId)
                .single();

            const { data: invoiceSettings } = await supabase
                .from("invoice_settings")
                .select("default_tax_rate")
                .eq("user_id", userId)
                .single();

            const baseCurrency = currency || userSettings?.base_currency || "USD";
            const defaultTaxRate = taxRate ?? (invoiceSettings?.default_tax_rate || 0);
            const expenseDate = date || new Date().toISOString().split("T")[0];

            // ========== STEP 2: Get Vendor Details (if vendorId provided) ==========
            let vendorInfo: { id: string; name: string } | null = null;
            if (vendorId) {
                const { data: vendor } = await supabase
                    .from("vendors")
                    .select("id, name")
                    .eq("id", vendorId)
                    .eq("user_id", userId)
                    .is("deleted_at", null)
                    .single();

                if (vendor) {
                    vendorInfo = vendor;
                }
            }

            // ========== STEP 3: Get Category Details (if categoryId provided) ==========
            let categoryInfo: { id: string; name: string } | null = null;
            if (categoryId) {
                const { data: category } = await supabase
                    .from("categories")
                    .select("id, name")
                    .eq("id", categoryId)
                    .eq("user_id", userId)
                    .is("deleted_at", null)
                    .single();

                if (category) {
                    categoryInfo = category;
                }
            }

            // ========== STEP 4: Calculate Tax ==========
            const taxAmount = (amount * defaultTaxRate) / 100;
            const totalWithTax = amount + taxAmount;

            // ========== STEP 5: Build Preview ==========
            const preview = {
                amount,
                currency: baseCurrency,
                description,
                date: expenseDate,
                taxRate: defaultTaxRate,
                taxAmount,
                totalWithTax,
                vendor: vendorInfo ? { id: vendorInfo.id, name: vendorInfo.name } : null,
                category: categoryInfo ? { id: categoryInfo.id, name: categoryInfo.name } : null,
                projectId: projectId || null,
                referenceNumber: referenceNumber || null,
            };

            // Build hints for missing optional fields
            const hints: string[] = [];
            if (!vendorInfo) {
                hints.push("No vendor linked. Use searchVendors and addVendor first if needed.");
            }
            if (!categoryInfo) {
                hints.push("No category linked. Use getCategories and addCategory first if needed.");
            }
            if (!referenceNumber) {
                hints.push("Got a receipt number? You can add it for reference.");
            }

            // ========== PREVIEW MODE: Return without saving ==========
            if (!confirmed) {
                return {
                    status: "preview",
                    preview,
                    message: "Review the expense details above. Say 'confirm' or 'save' to proceed.",
                    hints,
                };
            }

            // ========== SAVE MODE: Insert to database ==========
            console.log("[addExpense] SAVE MODE - preparing to insert");

            const expenseRecord = {
                user_id: userId,
                amount,
                description,
                date: expenseDate,
                currency: baseCurrency,
                tax_rate: defaultTaxRate,
                tax_amount: taxAmount,
                vendor: vendorInfo?.name || null,
                vendor_id: vendorInfo?.id || null,
                category_id: categoryInfo?.id || null,
                project_id: projectId || null,
                reference_number: referenceNumber || null,
                exchange_rate: 1,
                base_amount: amount,
            };

            console.log("[addExpense] Expense record to insert:", JSON.stringify(expenseRecord, null, 2));

            const { data: savedExpense, error } = await supabase
                .from("expenses")
                .insert(expenseRecord)
                .select("id, amount, description, date, total_with_tax")
                .single();

            console.log("[addExpense] Insert result - data:", savedExpense, "error:", error);

            if (error) {
                console.error("[addExpense] INSERT ERROR:", error);
                return {
                    status: "error",
                    error: "Failed to save expense record",
                    details: error.message,
                };
            }

            return {
                status: "saved",
                expense: {
                    id: savedExpense.id,
                    amount: formatCurrency(amount, baseCurrency),
                    totalWithTax: formatCurrency(totalWithTax, baseCurrency),
                    description: savedExpense.description,
                    date: formatDate(savedExpense.date),
                    vendor: vendorInfo?.name || null,
                    category: categoryInfo?.name || null,
                },
                message: `Expense of ${formatCurrency(totalWithTax, baseCurrency)} recorded successfully!`,
            };
        } catch (error) {
            console.error("[addExpense] CATCH ERROR:", error);
            return {
                status: "error",
                error: "Something went wrong while processing expense",
            };
        }
    },
});

// ============================================
// GET EXPENSES TOOL
// ============================================

export const getExpenses = tool({
    description: `
Fetch expense records for the user with optional filters.
Returns list of expenses with totals.
  `,

    inputSchema: z.object({
        dateFrom: z.string().optional().describe("Start date YYYY-MM-DD"),
        dateTo: z.string().optional().describe("End date YYYY-MM-DD"),
        categoryId: z.string().uuid().optional().describe("Filter by category"),
        projectId: z.string().uuid().optional().describe("Filter by project"),
        vendorId: z.string().uuid().optional().describe("Filter by vendor ID"),
        vendorName: z.string().optional().describe("Filter by vendor name (partial match)"),
        limit: z.number().optional().default(20).describe("Max results"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        const { dateFrom, dateTo, categoryId, projectId, vendorId, vendorName, limit, userId } = input;

        try {
            let query = supabase
                .from("expenses")
                .select(`
          id, amount, description, date, currency, 
          tax_rate, tax_amount, total_with_tax,
          base_amount, exchange_rate,
          reference_number, vendor, vendor_id,
          categories(id, name),
          vendors(id, name)
        `, { count: "exact" })
                .eq("user_id", userId)
                .is("deleted_at", null)
                .order("date", { ascending: false })
                .limit(limit || 20);

            if (dateFrom) query = query.gte("date", dateFrom);
            if (dateTo) query = query.lte("date", dateTo);
            if (categoryId) query = query.eq("category_id", categoryId);
            if (projectId) query = query.eq("project_id", projectId);
            if (vendorId) query = query.eq("vendor_id", vendorId);
            if (vendorName) query = query.ilike("vendor", `%${vendorName}%`);

            const { data, count, error } = await query;

            if (error) {
                return { status: "error", error: "Failed to fetch expense records" };
            }

            // Use base_amount for totals (already converted to base currency)
            const total = data?.reduce((sum, r) => sum + Number(r.base_amount || r.amount), 0) || 0;
            const totalWithTax = data?.reduce((sum, r) => {
                const baseAmt = Number(r.base_amount || r.amount);
                const taxAmt = Number(r.tax_amount || 0);
                return sum + baseAmt + taxAmt;
            }, 0) || 0;

            // Get user's base currency for display
            const { data: settings } = await supabase
                .from("user_settings")
                .select("base_currency")
                .eq("user_id", userId)
                .single();
            const baseCurrency = settings?.base_currency || "USD";

            return {
                status: "success",
                baseCurrency,
                expenses: data?.map((r) => {
                    const category = r.categories as unknown as { id: string; name: string } | null;
                    const vendor = r.vendors as unknown as { id: string; name: string } | null;
                    return {
                        id: r.id,
                        amount: r.amount,
                        currency: r.currency,
                        baseAmount: r.base_amount,
                        exchangeRate: r.exchange_rate,
                        description: r.description,
                        date: r.date,
                        vendor: vendor?.name || r.vendor || null,
                        vendorId: r.vendor_id || null,
                        category: category?.name || null,
                    };
                }),
                summary: {
                    count: count || 0,
                    totalAmount: total,
                    totalWithTax,
                },
            };
        } catch (error) {
            return { status: "error", error: "Failed to fetch expenses" };
        }
    },
});

// ============================================
// GET EXPENSE STATS TOOL
// ============================================

export const getExpenseStats = tool({
    description: `
Get expense statistics and summaries for a period.
Use for questions like "how much did I spend this month" or "expense summary".
  `,

    inputSchema: z.object({
        period: z.enum(["today", "week", "month", "quarter", "year", "custom"]).describe("Time period"),
        dateFrom: z.string().optional().describe("Custom start date YYYY-MM-DD"),
        dateTo: z.string().optional().describe("Custom end date YYYY-MM-DD"),
        groupBy: z.enum(["vendor", "category", "none"]).optional().default("none"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        const { period, dateFrom, dateTo, groupBy, userId } = input;

        try {
            // Calculate date range based on period
            const now = new Date();
            let startDate: string;
            let endDate: string = now.toISOString().split("T")[0];

            switch (period) {
                case "today":
                    startDate = endDate;
                    break;
                case "week":
                    const weekAgo = new Date(now);
                    weekAgo.setDate(weekAgo.getDate() - 7);
                    startDate = weekAgo.toISOString().split("T")[0];
                    break;
                case "month":
                    startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
                    break;
                case "quarter":
                    const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
                    startDate = `${now.getFullYear()}-${String(quarterMonth + 1).padStart(2, "0")}-01`;
                    break;
                case "year":
                    startDate = `${now.getFullYear()}-01-01`;
                    break;
                case "custom":
                    startDate = dateFrom || endDate;
                    endDate = dateTo || endDate;
                    break;
                default:
                    startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
            }

            const { data, error } = await supabase
                .from("expenses")
                .select(`
          amount, total_with_tax, currency, base_amount, tax_amount, vendor,
          categories(id, name),
          vendors(id, name)
        `)
                .eq("user_id", userId)
                .is("deleted_at", null)
                .gte("date", startDate)
                .lte("date", endDate);

            if (error) {
                return { status: "error", error: "Failed to fetch expense stats" };
            }

            // Use base_amount for totals (already converted to base currency)
            const totalAmount = data?.reduce((sum, r) => sum + Number(r.base_amount || r.amount), 0) || 0;
            const totalWithTax = data?.reduce((sum, r) => {
                const baseAmt = Number(r.base_amount || r.amount);
                const taxAmt = Number(r.tax_amount || 0);
                return sum + baseAmt + taxAmt;
            }, 0) || 0;
            const recordCount = data?.length || 0;

            // Group by vendor or category if requested
            let breakdown = null;
            if (groupBy === "vendor" && data) {
                const byVendor: Record<string, number> = {};
                data.forEach((r) => {
                    const vendor = r.vendors as unknown as { id: string; name: string } | null;
                    const name = vendor?.name || r.vendor || "No Vendor";
                    byVendor[name] = (byVendor[name] || 0) + Number(r.amount);
                });
                breakdown = Object.entries(byVendor)
                    .map(([name, amount]) => ({ name, amount }))
                    .sort((a, b) => b.amount - a.amount);
            } else if (groupBy === "category" && data) {
                const byCategory: Record<string, number> = {};
                data.forEach((r) => {
                    const category = r.categories as unknown as { id: string; name: string } | null;
                    const name = category?.name || "Uncategorized";
                    byCategory[name] = (byCategory[name] || 0) + Number(r.amount);
                });
                breakdown = Object.entries(byCategory)
                    .map(([name, amount]) => ({ name, amount }))
                    .sort((a, b) => b.amount - a.amount);
            }

            return {
                status: "success",
                period: { from: startDate, to: endDate },
                stats: {
                    totalAmount,
                    totalWithTax,
                    recordCount,
                    averagePerRecord: recordCount > 0 ? totalAmount / recordCount : 0,
                },
                breakdown,
            };
        } catch (error) {
            return { status: "error", error: "Failed to calculate expense stats" };
        }
    },
});

// ============================================
// UPDATE EXPENSE TOOL
// ============================================

export const updateExpense = tool({
    description: `
Update an existing expense record. Preview first (confirmed=false), then confirm.

FLOW:
1. confirmed=false → Shows current vs new values
2. Show preview to user, wait for "confirm"
3. confirmed=true → Applies changes
    `,

    inputSchema: z.object({
        expenseId: z.string().uuid().describe("Expense record ID to update"),
        amount: z.number().positive().optional().describe("New amount"),
        description: z.string().optional().describe("New description"),
        date: z.string().optional().describe("New date YYYY-MM-DD"),
        vendorId: z.string().uuid().optional().describe("New vendor ID"),
        categoryId: z.string().uuid().optional().describe("New category ID"),
        confirmed: z.boolean().describe("false=preview, true=save"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [updateExpense] TOOL CALLED ==========");
        console.log("[updateExpense] Input:", JSON.stringify(input, null, 2));

        const { expenseId, amount, description, date, vendorId, categoryId, confirmed, userId } = input;

        try {
            // Get existing expense record
            const { data: existing, error: fetchError } = await supabase
                .from("expenses")
                .select(`
                    id, amount, description, date, currency, vendor_id, category_id,
                    vendors:vendor_id (id, name),
                    categories (id, name)
                `)
                .eq("id", expenseId)
                .eq("user_id", userId)
                .single();

            if (fetchError || !existing) {
                return { status: "not_found", error: "Expense record not found" };
            }

            // Build changes object
            const changes: Record<string, any> = {};
            const preview: Record<string, { old: any; new: any }> = {};

            if (amount !== undefined && amount !== existing.amount) {
                changes.amount = amount;
                changes.base_amount = amount;
                preview.amount = { old: existing.amount, new: amount };
            }

            if (description !== undefined && description !== existing.description) {
                changes.description = description;
                preview.description = { old: existing.description, new: description };
            }

            if (date !== undefined && date !== existing.date) {
                changes.date = date;
                preview.date = { old: existing.date, new: date };
            }

            if (vendorId !== undefined && vendorId !== existing.vendor_id) {
                const { data: newVendor } = await supabase
                    .from("vendors")
                    .select("name")
                    .eq("id", vendorId)
                    .single();

                changes.vendor_id = vendorId;
                preview.vendor = {
                    old: (existing as any).vendors?.name || "None",
                    new: newVendor?.name || "Unknown"
                };
            }

            if (categoryId !== undefined && categoryId !== existing.category_id) {
                const { data: newCategory } = await supabase
                    .from("categories")
                    .select("name")
                    .eq("id", categoryId)
                    .single();

                changes.category_id = categoryId;
                preview.category = {
                    old: (existing as any).categories?.name || "None",
                    new: newCategory?.name || "Unknown"
                };
            }

            if (Object.keys(changes).length === 0) {
                return {
                    status: "no_changes",
                    message: "No changes to apply. Values are the same as current."
                };
            }

            // PREVIEW MODE
            if (!confirmed) {
                return {
                    status: "preview",
                    preview: {
                        expenseId: existing.id,
                        current: {
                            amount: existing.amount,
                            description: existing.description,
                            date: existing.date,
                            vendor: (existing as any).vendors?.name || "None",
                            category: (existing as any).categories?.name || "None",
                        },
                        changes: preview,
                    },
                    message: "Review the changes above. Say 'confirm' to apply.",
                };
            }

            // SAVE MODE
            console.log("[updateExpense] Applying changes:", changes);

            const { error: updateError } = await supabase
                .from("expenses")
                .update(changes)
                .eq("id", expenseId);

            if (updateError) {
                console.error("[updateExpense] Update error:", updateError);
                return { status: "error", error: "Failed to update expense record" };
            }

            console.log("[updateExpense] Updated successfully");

            return {
                status: "success",
                result: {
                    expenseId: existing.id,
                    changes: Object.keys(preview),
                },
                message: `Expense record updated successfully! ✅`,
            };
        } catch (error) {
            console.error("[updateExpense] Error:", error);
            return { status: "error", error: "Failed to update expense" };
        }
    },
});

// ============================================
// EXPORT ALL EXPENSE TOOLS
// ============================================

export const expenseTools = {
    addExpense,
    getExpenses,
    getExpenseStats,
    updateExpense,
};
