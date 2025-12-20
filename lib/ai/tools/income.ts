/**
 * SmartCFO Income Tools
 * 
 * Tools for managing income records via AI chat.
 * Uses user's base currency and default tax from settings.
 */

import { tool } from "ai";
import { z } from "zod";
import { supabase } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "./types";

// ============================================
// ADD INCOME TOOL
// ============================================

export const addIncome = tool({
  description: `
Record new income. Preview first (confirmed=false), save after user confirms (confirmed=true).

REQUIRED BEFORE CALLING:
- clientId: Get from searchClients, or addClient if new
- categoryId: Get from getCategories (AI auto-selects best match), or addCategory if none fit

FLOW:
1. confirmed=false → Returns preview (NOT saved)
2. Show preview to user, wait for "confirm"
3. confirmed=true → Saves to database

DO NOT call without clientId/categoryId resolved first.
  `,

  inputSchema: z.object({
    amount: z.number().positive().describe("Income amount (required)"),
    description: z.string().describe("What the income is for (required)"),
    date: z.string().optional().describe("Date in YYYY-MM-DD format. Default: today"),
    clientName: z.string().optional().describe("Client name - will attempt to match existing clients"),
    categoryName: z.string().optional().describe("Category name - will attempt to match existing categories"),
    projectId: z.string().uuid().optional().describe("Project ID if linked to project"),
    referenceNumber: z.string().optional().describe("Invoice or transaction reference"),
    currency: z.string().optional().describe("Override currency (only if user explicitly asks)"),
    taxRate: z.number().optional().describe("Override tax rate (only if user explicitly asks)"),
    confirmed: z.boolean().describe("false=preview only, true=save to database"),
    userId: z.string().uuid().describe("User ID from session"),
  }),

  execute: async (input) => {
    console.log("\n========== [addIncome] TOOL CALLED ==========");
    console.log("[addIncome] Input received:", JSON.stringify(input, null, 2));

    const {
      amount,
      description,
      date,
      clientName,
      categoryName,
      projectId,
      referenceNumber,
      currency,
      taxRate,
      confirmed,
      userId,
    } = input;

    console.log("[addIncome] Extracted values:", { amount, description, date, clientName, confirmed, userId });

    try {
      // ========== STEP 1: Get User Settings ==========
      console.log("[addIncome] Fetching user settings for userId:", userId);

      const { data: userSettings, error: settingsError } = await supabase
        .from("user_settings")
        .select("base_currency, is_tax_registered")
        .eq("user_id", userId)
        .single();

      console.log("[addIncome] User settings:", userSettings, "Error:", settingsError);

      const { data: invoiceSettings, error: invoiceError } = await supabase
        .from("invoice_settings")
        .select("default_tax_rate")
        .eq("user_id", userId)
        .single();

      console.log("[addIncome] Invoice settings:", invoiceSettings, "Error:", invoiceError);

      const baseCurrency = currency || userSettings?.base_currency || "USD";

      // Use user's default tax rate from settings (or override if user explicitly provides one)
      const defaultTaxRate = taxRate ?? (invoiceSettings?.default_tax_rate || 0);

      console.log("[addIncome] Tax settings:", { defaultTaxRate });

      const incomeDate = date || new Date().toISOString().split("T")[0];

      // ========== STEP 2: Match Client (Fuzzy Search with Levenshtein) ==========
      let matchedClient = null;
      let clientSuggestions: Array<{ id: string; name: string; score: number }> = [];

      if (clientName) {
        // Get all user's clients to compare with Levenshtein
        const { data: clients } = await supabase
          .from("clients")
          .select("id, name, company_name")
          .eq("user_id", userId)
          .is("deleted_at", null)
          .limit(100); // Get more clients for better matching

        if (clients && clients.length > 0) {
          // Check for exact match first
          const exactMatch = clients.find(
            (c) => c.name.toLowerCase() === clientName.toLowerCase()
          );

          if (exactMatch) {
            matchedClient = exactMatch;
          } else {
            // Calculate Levenshtein scores for all clients
            clientSuggestions = clients
              .map((c) => ({
                id: c.id,
                name: c.name,
                score: calculateLevenshteinScore(clientName, c.name),
              }))
              .filter((c) => c.score >= 50) // Only keep 50%+ matches
              .sort((a, b) => b.score - a.score) // Best first
              .slice(0, 5); // Top 5 suggestions

            // Auto-match if score >= 85%
            if (clientSuggestions[0]?.score >= 85) {
              const bestMatch = clients.find(c => c.id === clientSuggestions[0].id);
              if (bestMatch) matchedClient = bestMatch;
            }
          }
        }
      }

      // ========== STEP 3: Match Category ==========
      let matchedCategory = null;
      let categorySuggestions: Array<{ id: string; name: string }> = [];

      if (categoryName) {
        const { data: categories } = await supabase
          .from("categories")
          .select("id, name")
          .eq("user_id", userId)
          .eq("type", "income")
          .is("deleted_at", null)
          .ilike("name", `%${categoryName}%`)
          .limit(5);

        if (categories && categories.length > 0) {
          const exactMatch = categories.find(
            (c) => c.name.toLowerCase() === categoryName.toLowerCase()
          );
          matchedCategory = exactMatch || categories[0];
          if (!exactMatch) {
            categorySuggestions = categories.map((c) => ({ id: c.id, name: c.name }));
          }
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
        date: incomeDate,
        taxRate: defaultTaxRate,
        taxAmount,
        totalWithTax,
        client: matchedClient
          ? { id: matchedClient.id, name: matchedClient.name, matched: true }
          : clientName
            ? { name: clientName, matched: false, suggestions: clientSuggestions }
            : null,
        category: matchedCategory
          ? { id: matchedCategory.id, name: matchedCategory.name, matched: true }
          : categoryName
            ? { name: categoryName, matched: false, suggestions: categorySuggestions }
            : null,
        projectId: projectId || null,
        referenceNumber: referenceNumber || null,
      };

      // ========== PREVIEW MODE: Return without saving ==========
      if (!confirmed) {
        return {
          status: "preview",
          preview,
          message: "Review the income details above. Say 'confirm' or 'save' to proceed.",
          warnings: buildWarnings(preview),
        };
      }

      // ========== SAVE MODE: Insert to database ==========
      console.log("[addIncome] SAVE MODE - preparing to insert");

      const incomeRecord = {
        user_id: userId,
        amount,
        description,
        date: incomeDate,
        currency: baseCurrency,
        tax_rate: defaultTaxRate,
        tax_amount: taxAmount,
        // NOTE: total_with_tax is a GENERATED column - PostgreSQL calculates it automatically
        client_id: matchedClient?.id || null,
        category_id: matchedCategory?.id || null,
        project_id: projectId || null,
        reference_number: referenceNumber || null,
        exchange_rate: 1,
        base_amount: amount,
      };

      console.log("[addIncome] Income record to insert:", JSON.stringify(incomeRecord, null, 2));

      const { data: savedIncome, error } = await supabase
        .from("income")
        .insert(incomeRecord)
        .select("id, amount, description, date, total_with_tax")
        .single();

      console.log("[addIncome] Insert result - data:", savedIncome, "error:", error);

      if (error) {
        console.error("[addIncome] INSERT ERROR:", error);
        return {
          status: "error",
          error: "Failed to save income record",
          details: error.message,
        };
      }

      return {
        status: "saved",
        income: {
          id: savedIncome.id,
          amount: formatCurrency(amount, baseCurrency),
          totalWithTax: formatCurrency(totalWithTax, baseCurrency),
          description: savedIncome.description,
          date: formatDate(savedIncome.date),
          client: matchedClient?.name || null,
          category: matchedCategory?.name || null,
        },
        message: `Income of ${formatCurrency(totalWithTax, baseCurrency)} recorded successfully!`,
      };
    } catch (error) {
      console.error("[addIncome] CATCH ERROR:", error);
      return {
        status: "error",
        error: "Something went wrong while processing income",
      };
    }
  },
});

// ============================================
// GET INCOME TOOL
// ============================================

export const getIncome = tool({
  description: `
Fetch income records for the user with optional filters.
Returns list of income with totals.
  `,

  inputSchema: z.object({
    dateFrom: z.string().optional().describe("Start date YYYY-MM-DD"),
    dateTo: z.string().optional().describe("End date YYYY-MM-DD"),
    clientId: z.string().uuid().optional().describe("Filter by client"),
    categoryId: z.string().uuid().optional().describe("Filter by category"),
    projectId: z.string().uuid().optional().describe("Filter by project"),
    limit: z.number().optional().default(20).describe("Max results"),
    userId: z.string().uuid().describe("User ID from session"),
  }),

  execute: async (input) => {
    const { dateFrom, dateTo, clientId, categoryId, projectId, limit, userId } = input;

    try {
      let query = supabase
        .from("income")
        .select(`
          id, amount, description, date, currency, 
          tax_rate, tax_amount, total_with_tax,
          base_amount, exchange_rate,
          reference_number,
          clients(id, name),
          categories(id, name)
        `, { count: "exact" })
        .eq("user_id", userId)
        .is("deleted_at", null)
        .order("date", { ascending: false })
        .limit(limit || 20);

      if (dateFrom) query = query.gte("date", dateFrom);
      if (dateTo) query = query.lte("date", dateTo);
      if (clientId) query = query.eq("client_id", clientId);
      if (categoryId) query = query.eq("category_id", categoryId);
      if (projectId) query = query.eq("project_id", projectId);

      const { data, count, error } = await query;

      if (error) {
        return { status: "error", error: "Failed to fetch income records" };
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
        income: data?.map((r) => {
          const client = r.clients as unknown as { id: string; name: string } | null;
          const category = r.categories as unknown as { id: string; name: string } | null;
          return {
            id: r.id,
            amount: r.amount,
            currency: r.currency,
            baseAmount: r.base_amount,
            exchangeRate: r.exchange_rate,
            description: r.description,
            date: r.date,
            client: client?.name || null,
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
      return { status: "error", error: "Failed to fetch income" };
    }
  },
});

// ============================================
// GET INCOME STATS TOOL
// ============================================

export const getIncomeStats = tool({
  description: `
Get income statistics and summaries for a period.
Use for questions like "how much did I earn this month" or "income summary".
  `,

  inputSchema: z.object({
    period: z.enum(["today", "week", "month", "quarter", "year", "custom"]).describe("Time period"),
    dateFrom: z.string().optional().describe("Custom start date YYYY-MM-DD"),
    dateTo: z.string().optional().describe("Custom end date YYYY-MM-DD"),
    groupBy: z.enum(["client", "category", "none"]).optional().default("none"),
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
        .from("income")
        .select(`
          amount, total_with_tax, currency, base_amount, tax_amount,
          clients(id, name),
          categories(id, name)
        `)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .gte("date", startDate)
        .lte("date", endDate);

      if (error) {
        return { status: "error", error: "Failed to fetch income stats" };
      }

      // Use base_amount for totals (already converted to base currency)
      const totalAmount = data?.reduce((sum, r) => sum + Number(r.base_amount || r.amount), 0) || 0;
      const totalWithTax = data?.reduce((sum, r) => {
        const baseAmt = Number(r.base_amount || r.amount);
        const taxAmt = Number(r.tax_amount || 0);
        return sum + baseAmt + taxAmt;
      }, 0) || 0;
      const recordCount = data?.length || 0;

      // Group by client or category if requested
      let breakdown = null;
      if (groupBy === "client" && data) {
        const byClient: Record<string, number> = {};
        data.forEach((r) => {
          const client = r.clients as unknown as { id: string; name: string } | null;
          const name = client?.name || "No Client";
          byClient[name] = (byClient[name] || 0) + Number(r.amount);
        });
        breakdown = Object.entries(byClient)
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
      return { status: "error", error: "Failed to calculate income stats" };
    }
  },
});

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Calculate Levenshtein distance between two strings
 * Returns the number of single-character edits needed
 */
function levenshteinDistance(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  const m = s1.length;
  const n = s2.length;

  // Create distance matrix
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  // Initialize first column and row
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  // Fill in the matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i - 1][j],     // deletion
          dp[i][j - 1],     // insertion
          dp[i - 1][j - 1]  // substitution
        );
      }
    }
  }

  return dp[m][n];
}

/**
 * Calculate match score (0-100) based on Levenshtein distance
 * "Mexterix" vs "Nexterix" = 1 edit = ~87% match
 */
function calculateLevenshteinScore(search: string, target: string): number {
  const s = search.toLowerCase();
  const t = target.toLowerCase();

  // Exact match
  if (s === t) return 100;

  // Contains match (bonus)
  if (t.includes(s) || s.includes(t)) return 90;

  const distance = levenshteinDistance(s, t);
  const maxLength = Math.max(s.length, t.length);

  if (maxLength === 0) return 100;

  // Convert distance to percentage score
  const score = Math.round((1 - distance / maxLength) * 100);
  return Math.max(0, score);
}

function buildWarnings(preview: any): string[] {
  const warnings: string[] = [];
  if (preview.client && !preview.client.matched && preview.client.suggestions?.length > 0) {
    warnings.push(`Client "${preview.client.name}" not found exactly. Suggestions available.`);
  }
  if (preview.client && !preview.client.matched && (!preview.client.suggestions || preview.client.suggestions.length === 0)) {
    warnings.push(`Client "${preview.client.name}" not found. Will save without client or create new.`);
  }
  if (preview.category && !preview.category.matched) {
    warnings.push(`Category "${preview.category.name}" not found. Will save without category.`);
  }
  return warnings;
}

// ============================================
// UPDATE INCOME TOOL
// ============================================

export const updateIncome = tool({
  description: `
Update an existing income record. Preview first (confirmed=false), then confirm.

FLOW:
1. confirmed=false → Shows current vs new values
2. Show preview to user, wait for "confirm"
3. confirmed=true → Applies changes
  `,

  inputSchema: z.object({
    incomeId: z.string().uuid().describe("Income record ID to update"),
    amount: z.number().positive().optional().describe("New amount"),
    description: z.string().optional().describe("New description"),
    date: z.string().optional().describe("New date YYYY-MM-DD"),
    clientId: z.string().uuid().optional().describe("New client ID"),
    categoryId: z.string().uuid().optional().describe("New category ID"),
    confirmed: z.boolean().describe("false=preview, true=save"),
    userId: z.string().uuid().describe("User ID from session"),
  }),

  execute: async (input) => {
    console.log("\n========== [updateIncome] TOOL CALLED ==========");
    console.log("[updateIncome] Input:", JSON.stringify(input, null, 2));

    const { incomeId, amount, description, date, clientId, categoryId, confirmed, userId } = input;

    try {
      // Get existing income record
      const { data: existing, error: fetchError } = await supabase
        .from("income")
        .select(`
          id, amount, description, date, currency, client_id, category_id,
          clients (id, name),
          categories (id, name)
        `)
        .eq("id", incomeId)
        .eq("user_id", userId)
        .single();

      if (fetchError || !existing) {
        return { status: "not_found", error: "Income record not found" };
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

      if (clientId !== undefined && clientId !== existing.client_id) {
        const { data: newClient } = await supabase
          .from("clients")
          .select("name")
          .eq("id", clientId)
          .single();

        changes.client_id = clientId;
        preview.client = {
          old: (existing as any).clients?.name || "None",
          new: newClient?.name || "Unknown"
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
            incomeId: existing.id,
            current: {
              amount: existing.amount,
              description: existing.description,
              date: existing.date,
              client: (existing as any).clients?.name || "None",
              category: (existing as any).categories?.name || "None",
            },
            changes: preview,
          },
          message: "Review the changes above. Say 'confirm' to apply.",
        };
      }

      // SAVE MODE
      console.log("[updateIncome] Applying changes:", changes);

      const { error: updateError } = await supabase
        .from("income")
        .update(changes)
        .eq("id", incomeId);

      if (updateError) {
        console.error("[updateIncome] Update error:", updateError);
        return { status: "error", error: "Failed to update income record" };
      }

      console.log("[updateIncome] Updated successfully");

      return {
        status: "success",
        result: {
          incomeId: existing.id,
          changes: Object.keys(preview),
        },
        message: `Income record updated successfully! ✅`,
      };
    } catch (error) {
      console.error("[updateIncome] Error:", error);
      return { status: "error", error: "Failed to update income" };
    }
  },
});

// ============================================
// EXPORT ALL INCOME TOOLS
// ============================================

export const incomeTools = {
  addIncome,
  getIncome,
  getIncomeStats,
  updateIncome,
};
