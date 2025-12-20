/**
 * SmartCFO Project Tools
 * 
 * Tools for managing projects, milestones, goals, time tracking, and notes via AI chat.
 */

import { tool } from "ai";
import { z } from "zod";
import { supabase } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "./types";

// ============================================
// HELPER: Levenshtein Distance for fuzzy matching
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
// SEARCH PROJECTS TOOL
// ============================================

export const searchProjects = tool({
    description: `
Search for projects by name. Uses fuzzy matching to find projects even with typos.
Use when user mentions a project by name to find the projectId.

FLOW:
1. Call with project name/query
2. Returns matches with scores (100=exact, 80+=good match)
3. Use projectId for other operations
    `,

    inputSchema: z.object({
        query: z.string().describe("Project name to search for"),
        status: z.enum(["active", "completed", "on_hold", "cancelled", "all"]).optional().default("all").describe("Filter by status"),
        clientName: z.string().optional().describe("Filter by client name"),
        limit: z.number().optional().default(10).describe("Max results"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [searchProjects] TOOL CALLED ==========");
        console.log("[searchProjects] Input:", JSON.stringify(input, null, 2));

        const { query, status, clientName, limit, userId } = input;

        try {
            // Build query
            let dbQuery = supabase
                .from("projects")
                .select(`
                    id, name, description, status, budget_amount, budget_currency,
                    start_date, end_date, color, created_at,
                    client:clients(id, name)
                `)
                .eq("user_id", userId)
                .is("deleted_at", null);

            if (status && status !== "all") {
                dbQuery = dbQuery.eq("status", status);
            }

            const { data: projects, error } = await dbQuery.limit(100);

            if (error) throw error;

            if (!projects || projects.length === 0) {
                return {
                    status: "success",
                    matches: [],
                    message: "No projects found. Would you like to create one?",
                };
            }

            // Filter by client if specified
            let filteredProjects = projects;
            if (clientName) {
                filteredProjects = projects.filter((p: any) => 
                    p.client?.name?.toLowerCase().includes(clientName.toLowerCase())
                );
            }

            // Fuzzy match by name
            const matches = filteredProjects
                .map((p: any) => ({
                    id: p.id,
                    name: p.name,
                    description: p.description,
                    status: p.status,
                    budgetAmount: p.budget_amount,
                    budgetCurrency: p.budget_currency || "USD",
                    startDate: p.start_date,
                    endDate: p.end_date,
                    clientName: p.client?.name || null,
                    score: calculateMatchScore(query, p.name),
                }))
                .filter((m: any) => m.score >= 50)
                .sort((a: any, b: any) => b.score - a.score)
                .slice(0, limit);

            return {
                status: "success",
                matches,
                totalFound: matches.length,
                message: matches.length > 0
                    ? `Found ${matches.length} project(s) matching "${query}"`
                    : `No projects found matching "${query}". Would you like to create one?`,
            };
        } catch (error: any) {
            console.error("[searchProjects] Error:", error);
            return { status: "error", message: error.message };
        }
    },
});

// ============================================
// GET PROJECT DETAILS TOOL
// ============================================

export const getProjectDetails = tool({
    description: `
Get full project details including milestones, goals, time stats, and recent notes.
Use when user wants to see a project summary or asks "show me project X".
    `,

    inputSchema: z.object({
        projectId: z.string().uuid().optional().describe("Project UUID"),
        projectName: z.string().optional().describe("Project name (will search)"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [getProjectDetails] TOOL CALLED ==========");
        console.log("[getProjectDetails] Input:", JSON.stringify(input, null, 2));

        const { projectId, projectName, userId } = input;

        try {
            let targetProjectId = projectId;

            // If no projectId, search by name
            if (!targetProjectId && projectName) {
                const { data: projects } = await supabase
                    .from("projects")
                    .select("id, name")
                    .eq("user_id", userId)
                    .is("deleted_at", null)
                    .ilike("name", `%${projectName}%`)
                    .limit(1);

                if (!projects || projects.length === 0) {
                    return { status: "error", message: `Project "${projectName}" not found` };
                }
                targetProjectId = projects[0].id;
            }

            if (!targetProjectId) {
                return { status: "error", message: "Please provide projectId or projectName" };
            }

            // Fetch project with client
            const { data: project, error: projectError } = await supabase
                .from("projects")
                .select(`
                    *,
                    client:clients(id, name, email)
                `)
                .eq("id", targetProjectId)
                .eq("user_id", userId)
                .single();

            if (projectError || !project) {
                return { status: "error", message: "Project not found" };
            }

            // Fetch milestones
            const { data: milestones } = await supabase
                .from("project_milestones")
                .select("*")
                .eq("project_id", targetProjectId)
                .is("deleted_at", null)
                .order("due_date", { ascending: true });

            // Fetch goals
            const { data: goals } = await supabase
                .from("project_goals")
                .select("*")
                .eq("project_id", targetProjectId)
                .is("deleted_at", null)
                .order("order_index", { ascending: true });

            // Fetch time entries summary
            const { data: timeEntries } = await supabase
                .from("project_time_entries")
                .select("hours, billable, amount")
                .eq("project_id", targetProjectId)
                .is("deleted_at", null);

            // Calculate time stats
            const timeStats = {
                totalHours: 0,
                billableHours: 0,
                nonBillableHours: 0,
                totalAmount: 0,
            };
            if (timeEntries) {
                for (const entry of timeEntries) {
                    timeStats.totalHours += Number(entry.hours) || 0;
                    if (entry.billable) {
                        timeStats.billableHours += Number(entry.hours) || 0;
                        timeStats.totalAmount += Number(entry.amount) || 0;
                    } else {
                        timeStats.nonBillableHours += Number(entry.hours) || 0;
                    }
                }
            }

            // Fetch recent notes (last 5)
            const { data: notes } = await supabase
                .from("project_notes")
                .select("*")
                .eq("project_id", targetProjectId)
                .is("deleted_at", null)
                .order("date", { ascending: false })
                .limit(5);

            // Fetch linked income/expenses
            const { data: income } = await supabase
                .from("income")
                .select("id, amount, description, date")
                .eq("project_id", targetProjectId)
                .is("deleted_at", null);

            const { data: expenses } = await supabase
                .from("expenses")
                .select("id, amount, description, date")
                .eq("project_id", targetProjectId)
                .is("deleted_at", null);

            // Calculate financial stats
            const totalIncome = income?.reduce((sum, i) => sum + Number(i.amount), 0) || 0;
            const totalExpenses = expenses?.reduce((sum, e) => sum + Number(e.amount), 0) || 0;
            const profit = totalIncome - totalExpenses;
            const margin = totalIncome > 0 ? Math.round((profit / totalIncome) * 100) : 0;

            // Budget usage
            const budgetAmount = Number(project.budget_amount) || 0;
            const budgetUsed = budgetAmount > 0 ? Math.round((totalExpenses / budgetAmount) * 100) : 0;

            // Milestone progress
            const milestonesTotal = milestones?.length || 0;
            const milestonesCompleted = milestones?.filter((m: any) => 
                m.status === "completed" || m.status === "paid"
            ).length || 0;

            // Goal progress
            const goalsTotal = goals?.length || 0;
            const goalsDone = goals?.filter((g: any) => g.status === "done").length || 0;

            return {
                status: "success",
                project: {
                    id: project.id,
                    name: project.name,
                    description: project.description,
                    status: project.status,
                    client: project.client,
                    budgetAmount: project.budget_amount,
                    budgetCurrency: project.budget_currency || "USD",
                    startDate: project.start_date,
                    endDate: project.end_date,
                    color: project.color,
                },
                stats: {
                    totalIncome,
                    totalExpenses,
                    profit,
                    margin: `${margin}%`,
                    budgetAmount,
                    budgetUsed: `${budgetUsed}%`,
                    budgetRemaining: budgetAmount - totalExpenses,
                },
                milestones: {
                    total: milestonesTotal,
                    completed: milestonesCompleted,
                    progress: milestonesTotal > 0 ? `${Math.round((milestonesCompleted / milestonesTotal) * 100)}%` : "0%",
                    items: milestones || [],
                },
                goals: {
                    total: goalsTotal,
                    done: goalsDone,
                    progress: goalsTotal > 0 ? `${Math.round((goalsDone / goalsTotal) * 100)}%` : "0%",
                    items: goals || [],
                },
                timeTracking: timeStats,
                recentNotes: notes || [],
            };
        } catch (error: any) {
            console.error("[getProjectDetails] Error:", error);
            return { status: "error", message: error.message };
        }
    },
});

// ============================================
// CREATE PROJECT TOOL
// ============================================

export const createProject = tool({
    description: `
Create a new project. Preview first (confirmed=false), save after user confirms.

FLOW:
1. confirmed=false → Returns preview (NOT saved)
2. Show preview to user, wait for "confirm"
3. confirmed=true → Saves to database
    `,

    inputSchema: z.object({
        name: z.string().describe("Project name (required, must be unique)"),
        clientName: z.string().optional().describe("Client name to link (will search)"),
        description: z.string().optional().describe("Project description"),
        budgetAmount: z.number().optional().describe("Total budget amount"),
        budgetCurrency: z.string().optional().describe("Currency (default: user's base currency)"),
        startDate: z.string().optional().describe("Start date YYYY-MM-DD"),
        endDate: z.string().optional().describe("End date YYYY-MM-DD"),
        color: z.string().optional().describe("Hex color code like #6366F1"),
        confirmed: z.boolean().describe("false=preview, true=save"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [createProject] TOOL CALLED ==========");
        console.log("[createProject] Input:", JSON.stringify(input, null, 2));

        const {
            name, clientName, description, budgetAmount, budgetCurrency,
            startDate, endDate, color, confirmed, userId
        } = input;

        try {
            // Check if project name already exists
            const { data: existing } = await supabase
                .from("projects")
                .select("id")
                .eq("user_id", userId)
                .ilike("name", name)
                .is("deleted_at", null)
                .limit(1);

            if (existing && existing.length > 0) {
                return { status: "error", message: `Project "${name}" already exists` };
            }

            // Resolve client if provided
            let clientId = null;
            let resolvedClientName = null;
            if (clientName) {
                const { data: clients } = await supabase
                    .from("clients")
                    .select("id, name")
                    .eq("user_id", userId)
                    .ilike("name", `%${clientName}%`)
                    .is("deleted_at", null)
                    .limit(1);

                if (clients && clients.length > 0) {
                    clientId = clients[0].id;
                    resolvedClientName = clients[0].name;
                }
            }

            // Get user's base currency
            const { data: userSettings } = await supabase
                .from("user_settings")
                .select("base_currency")
                .eq("user_id", userId)
                .single();

            const currency = budgetCurrency || userSettings?.base_currency || "USD";

            // Validate dates
            if (startDate && endDate && new Date(endDate) <= new Date(startDate)) {
                return { status: "error", message: "End date must be after start date" };
            }

            // Build preview
            const preview = {
                name,
                client: resolvedClientName || clientName || "None",
                description: description || "No description",
                budget: budgetAmount ? formatCurrency(budgetAmount, currency) : "Not set",
                startDate: startDate ? formatDate(startDate) : "Not set",
                endDate: endDate ? formatDate(endDate) : "Not set",
                color: color || "#6366F1",
            };

            // Preview mode
            if (!confirmed) {
                return {
                    status: "preview",
                    preview,
                    warnings: clientName && !clientId ? [`Client "${clientName}" not found`] : [],
                    message: "Project preview ready. Say 'confirm' to create!",
                };
            }

            // Create project
            const { data: project, error } = await supabase
                .from("projects")
                .insert({
                    user_id: userId,
                    client_id: clientId,
                    name,
                    description,
                    status: "active",
                    budget_amount: budgetAmount || null,
                    budget_currency: currency,
                    start_date: startDate || null,
                    end_date: endDate || null,
                    color: color || "#6366F1",
                })
                .select()
                .single();

            if (error) throw error;

            return {
                status: "success",
                projectId: project.id,
                projectName: project.name,
                message: `Project "${name}" created! 🎉`,
            };
        } catch (error: any) {
            console.error("[createProject] Error:", error);
            return { status: "error", message: error.message };
        }
    },
});

// ============================================
// UPDATE PROJECT TOOL
// ============================================

export const updateProject = tool({
    description: `
Update an existing project. Preview first (confirmed=false), save after user confirms.
    `,

    inputSchema: z.object({
        projectId: z.string().uuid().describe("Project ID to update"),
        name: z.string().optional().describe("New name"),
        clientName: z.string().optional().describe("New client name"),
        description: z.string().optional().describe("New description"),
        status: z.enum(["active", "completed", "on_hold", "cancelled"]).optional().describe("New status"),
        budgetAmount: z.number().optional().describe("New budget amount"),
        startDate: z.string().optional().describe("New start date YYYY-MM-DD"),
        endDate: z.string().optional().describe("New end date YYYY-MM-DD"),
        color: z.string().optional().describe("New color hex code"),
        confirmed: z.boolean().describe("false=preview, true=save"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [updateProject] TOOL CALLED ==========");
        console.log("[updateProject] Input:", JSON.stringify(input, null, 2));

        const {
            projectId, name, clientName, description, status,
            budgetAmount, startDate, endDate, color, confirmed, userId
        } = input;

        try {
            // Fetch existing project
            const { data: project, error: fetchError } = await supabase
                .from("projects")
                .select("*")
                .eq("id", projectId)
                .eq("user_id", userId)
                .single();

            if (fetchError || !project) {
                return { status: "error", message: "Project not found" };
            }

            // Build updates
            const updates: any = { updated_at: new Date().toISOString() };
            const changes: string[] = [];

            if (name && name !== project.name) {
                updates.name = name;
                changes.push(`Name: ${project.name} → ${name}`);
            }
            if (description !== undefined && description !== project.description) {
                updates.description = description;
                changes.push(`Description updated`);
            }
            if (status && status !== project.status) {
                updates.status = status;
                changes.push(`Status: ${project.status} → ${status}`);
            }
            if (budgetAmount !== undefined && budgetAmount !== project.budget_amount) {
                updates.budget_amount = budgetAmount;
                changes.push(`Budget: ${project.budget_amount} → ${budgetAmount}`);
            }
            if (startDate && startDate !== project.start_date) {
                updates.start_date = startDate;
                changes.push(`Start date: ${project.start_date} → ${startDate}`);
            }
            if (endDate && endDate !== project.end_date) {
                updates.end_date = endDate;
                changes.push(`End date: ${project.end_date} → ${endDate}`);
            }
            if (color && color !== project.color) {
                updates.color = color;
                changes.push(`Color: ${project.color} → ${color}`);
            }

            // Resolve client if provided
            if (clientName) {
                const { data: clients } = await supabase
                    .from("clients")
                    .select("id, name")
                    .eq("user_id", userId)
                    .ilike("name", `%${clientName}%`)
                    .is("deleted_at", null)
                    .limit(1);

                if (clients && clients.length > 0) {
                    updates.client_id = clients[0].id;
                    changes.push(`Client: → ${clients[0].name}`);
                }
            }

            if (changes.length === 0) {
                return { status: "info", message: "No changes detected" };
            }

            // Preview mode
            if (!confirmed) {
                return {
                    status: "preview",
                    projectName: project.name,
                    changes,
                    message: "Preview changes. Say 'confirm' to apply!",
                };
            }

            // Apply updates
            const { error } = await supabase
                .from("projects")
                .update(updates)
                .eq("id", projectId);

            if (error) throw error;

            return {
                status: "success",
                message: `Project "${project.name}" updated! ✅`,
                changes,
            };
        } catch (error: any) {
            console.error("[updateProject] Error:", error);
            return { status: "error", message: error.message };
        }
    },
});

// ============================================
// MILESTONE TOOLS
// ============================================

export const createMilestone = tool({
    description: `
Add a milestone (payment phase) to a project.
Milestones track payment phases: pending → in_progress → completed → paid
    `,

    inputSchema: z.object({
        projectId: z.string().uuid().describe("Project ID"),
        name: z.string().describe("Milestone name"),
        description: z.string().optional().describe("Description"),
        dueDate: z.string().optional().describe("Due date YYYY-MM-DD"),
        targetAmount: z.number().optional().describe("Expected payment amount"),
        currency: z.string().optional().describe("Currency"),
        confirmed: z.boolean().describe("false=preview, true=save"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [createMilestone] TOOL CALLED ==========");
        const { projectId, name, description, dueDate, targetAmount, currency, confirmed, userId } = input;

        try {
            // Verify project exists
            const { data: project } = await supabase
                .from("projects")
                .select("id, name, budget_currency")
                .eq("id", projectId)
                .eq("user_id", userId)
                .single();

            if (!project) {
                return { status: "error", message: "Project not found" };
            }

            const milestonesCurrency = currency || project.budget_currency || "USD";

            // Preview
            if (!confirmed) {
                return {
                    status: "preview",
                    projectName: project.name,
                    milestone: {
                        name,
                        description: description || "No description",
                        dueDate: dueDate ? formatDate(dueDate) : "Not set",
                        targetAmount: targetAmount ? formatCurrency(targetAmount, milestonesCurrency) : "Not set",
                    },
                    message: "Milestone preview. Say 'confirm' to add!",
                };
            }

            // Create milestone
            const { data: milestone, error } = await supabase
                .from("project_milestones")
                .insert({
                    project_id: projectId,
                    user_id: userId,
                    name,
                    description,
                    due_date: dueDate || null,
                    target_amount: targetAmount || null,
                    currency: milestonesCurrency,
                    status: "pending",
                })
                .select()
                .single();

            if (error) throw error;

            return {
                status: "success",
                milestoneId: milestone.id,
                message: `Milestone "${name}" added to ${project.name}! 🎯`,
            };
        } catch (error: any) {
            console.error("[createMilestone] Error:", error);
            return { status: "error", message: error.message };
        }
    },
});

export const updateMilestone = tool({
    description: `
Update a milestone status or details.
Status flow: pending → in_progress → completed → paid
    `,

    inputSchema: z.object({
        milestoneId: z.string().uuid().describe("Milestone ID"),
        name: z.string().optional().describe("New name"),
        status: z.enum(["pending", "in_progress", "completed", "paid"]).optional().describe("New status"),
        dueDate: z.string().optional().describe("New due date YYYY-MM-DD"),
        targetAmount: z.number().optional().describe("New target amount"),
        invoiceId: z.string().uuid().optional().describe("Link to invoice ID when paid"),
        confirmed: z.boolean().describe("false=preview, true=save"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [updateMilestone] TOOL CALLED ==========");
        const { milestoneId, name, status, dueDate, targetAmount, invoiceId, confirmed, userId } = input;

        try {
            // Fetch existing milestone
            const { data: milestone, error: fetchError } = await supabase
                .from("project_milestones")
                .select("*, project:projects(name)")
                .eq("id", milestoneId)
                .eq("user_id", userId)
                .single();

            if (fetchError || !milestone) {
                return { status: "error", message: "Milestone not found" };
            }

            const updates: any = { updated_at: new Date().toISOString() };
            const changes: string[] = [];

            if (name && name !== milestone.name) {
                updates.name = name;
                changes.push(`Name: ${milestone.name} → ${name}`);
            }
            if (status && status !== milestone.status) {
                updates.status = status;
                changes.push(`Status: ${milestone.status} → ${status}`);
                if (status === "completed" && !milestone.completion_date) {
                    updates.completion_date = new Date().toISOString().split("T")[0];
                }
            }
            if (dueDate && dueDate !== milestone.due_date) {
                updates.due_date = dueDate;
                changes.push(`Due date: ${milestone.due_date} → ${dueDate}`);
            }
            if (targetAmount !== undefined && targetAmount !== milestone.target_amount) {
                updates.target_amount = targetAmount;
                changes.push(`Amount: ${milestone.target_amount} → ${targetAmount}`);
            }
            if (invoiceId) {
                updates.invoice_id = invoiceId;
                changes.push(`Invoice linked`);
            }

            if (changes.length === 0) {
                return { status: "info", message: "No changes detected" };
            }

            if (!confirmed) {
                return {
                    status: "preview",
                    milestoneName: milestone.name,
                    projectName: (milestone as any).project?.name,
                    changes,
                    message: "Preview changes. Say 'confirm' to apply!",
                };
            }

            const { error } = await supabase
                .from("project_milestones")
                .update(updates)
                .eq("id", milestoneId);

            if (error) throw error;

            return {
                status: "success",
                message: `Milestone "${milestone.name}" updated! ✅`,
                changes,
            };
        } catch (error: any) {
            console.error("[updateMilestone] Error:", error);
            return { status: "error", message: error.message };
        }
    },
});

export const deleteMilestone = tool({
    description: `Delete a milestone from a project (soft delete).`,

    inputSchema: z.object({
        milestoneId: z.string().uuid().describe("Milestone ID"),
        confirmed: z.boolean().describe("false=preview, true=delete"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [deleteMilestone] TOOL CALLED ==========");
        const { milestoneId, confirmed, userId } = input;

        try {
            const { data: milestone } = await supabase
                .from("project_milestones")
                .select("id, name, project:projects(name)")
                .eq("id", milestoneId)
                .eq("user_id", userId)
                .single();

            if (!milestone) {
                return { status: "error", message: "Milestone not found" };
            }

            if (!confirmed) {
                return {
                    status: "preview",
                    message: `Delete milestone "${milestone.name}" from ${(milestone as any).project?.name}? Say 'confirm' to proceed.`,
                };
            }

            await supabase
                .from("project_milestones")
                .update({ deleted_at: new Date().toISOString() })
                .eq("id", milestoneId);

            return { status: "success", message: `Milestone "${milestone.name}" deleted! 🗑️` };
        } catch (error: any) {
            console.error("[deleteMilestone] Error:", error);
            return { status: "error", message: error.message };
        }
    },
});

// ============================================
// GOAL TOOLS
// ============================================

export const createGoal = tool({
    description: `Add a goal/deliverable to a project (todo checklist item).`,

    inputSchema: z.object({
        projectId: z.string().uuid().describe("Project ID"),
        title: z.string().describe("Goal title"),
        description: z.string().optional().describe("Description"),
        confirmed: z.boolean().describe("false=preview, true=save"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [createGoal] TOOL CALLED ==========");
        const { projectId, title, description, confirmed, userId } = input;

        try {
            const { data: project } = await supabase
                .from("projects")
                .select("id, name")
                .eq("id", projectId)
                .eq("user_id", userId)
                .single();

            if (!project) {
                return { status: "error", message: "Project not found" };
            }

            // Get max order_index
            const { data: existingGoals } = await supabase
                .from("project_goals")
                .select("order_index")
                .eq("project_id", projectId)
                .is("deleted_at", null)
                .order("order_index", { ascending: false })
                .limit(1);

            const nextOrder = (existingGoals?.[0]?.order_index || 0) + 1;

            if (!confirmed) {
                return {
                    status: "preview",
                    projectName: project.name,
                    goal: { title, description: description || "No description" },
                    message: "Goal preview. Say 'confirm' to add!",
                };
            }

            const { data: goal, error } = await supabase
                .from("project_goals")
                .insert({
                    project_id: projectId,
                    user_id: userId,
                    title,
                    description,
                    status: "todo",
                    order_index: nextOrder,
                })
                .select()
                .single();

            if (error) throw error;

            return {
                status: "success",
                goalId: goal.id,
                message: `Goal "${title}" added to ${project.name}! ☑️`,
            };
        } catch (error: any) {
            console.error("[createGoal] Error:", error);
            return { status: "error", message: error.message };
        }
    },
});

export const updateGoal = tool({
    description: `Update a goal status or title. Status: todo → in_progress → done`,

    inputSchema: z.object({
        goalId: z.string().uuid().describe("Goal ID"),
        title: z.string().optional().describe("New title"),
        status: z.enum(["todo", "in_progress", "done"]).optional().describe("New status"),
        confirmed: z.boolean().describe("false=preview, true=save"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [updateGoal] TOOL CALLED ==========");
        const { goalId, title, status, confirmed, userId } = input;

        try {
            const { data: goal } = await supabase
                .from("project_goals")
                .select("*, project:projects(name)")
                .eq("id", goalId)
                .eq("user_id", userId)
                .single();

            if (!goal) {
                return { status: "error", message: "Goal not found" };
            }

            const updates: any = { updated_at: new Date().toISOString() };
            const changes: string[] = [];

            if (title && title !== goal.title) {
                updates.title = title;
                changes.push(`Title: ${goal.title} → ${title}`);
            }
            if (status && status !== goal.status) {
                updates.status = status;
                const statusEmoji = status === "done" ? "✅" : status === "in_progress" ? "⏳" : "☐";
                changes.push(`Status: ${goal.status} → ${status} ${statusEmoji}`);
            }

            if (changes.length === 0) {
                return { status: "info", message: "No changes detected" };
            }

            if (!confirmed) {
                return {
                    status: "preview",
                    goalTitle: goal.title,
                    projectName: (goal as any).project?.name,
                    changes,
                    message: "Preview changes. Say 'confirm' to apply!",
                };
            }

            await supabase.from("project_goals").update(updates).eq("id", goalId);

            return { status: "success", message: `Goal updated! ${changes.join(", ")}` };
        } catch (error: any) {
            console.error("[updateGoal] Error:", error);
            return { status: "error", message: error.message };
        }
    },
});

export const deleteGoal = tool({
    description: `Delete a goal from a project (soft delete).`,

    inputSchema: z.object({
        goalId: z.string().uuid().describe("Goal ID"),
        confirmed: z.boolean().describe("false=preview, true=delete"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [deleteGoal] TOOL CALLED ==========");
        const { goalId, confirmed, userId } = input;

        try {
            const { data: goal } = await supabase
                .from("project_goals")
                .select("id, title, project:projects(name)")
                .eq("id", goalId)
                .eq("user_id", userId)
                .single();

            if (!goal) {
                return { status: "error", message: "Goal not found" };
            }

            if (!confirmed) {
                return {
                    status: "preview",
                    message: `Delete goal "${goal.title}"? Say 'confirm' to proceed.`,
                };
            }

            await supabase
                .from("project_goals")
                .update({ deleted_at: new Date().toISOString() })
                .eq("id", goalId);

            return { status: "success", message: `Goal "${goal.title}" deleted! 🗑️` };
        } catch (error: any) {
            console.error("[deleteGoal] Error:", error);
            return { status: "error", message: error.message };
        }
    },
});

// ============================================
// TIME TRACKING TOOLS
// ============================================

export const logTime = tool({
    description: `Log time worked on a project. Supports billable and non-billable hours.`,

    inputSchema: z.object({
        projectId: z.string().uuid().describe("Project ID"),
        date: z.string().describe("Date YYYY-MM-DD"),
        hours: z.number().positive().describe("Hours worked (e.g., 2.5)"),
        description: z.string().optional().describe("What was worked on"),
        billable: z.boolean().describe("true=billable, false=non-billable"),
        hourlyRate: z.number().optional().describe("Hourly rate for billable hours"),
        confirmed: z.boolean().describe("false=preview, true=save"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [logTime] TOOL CALLED ==========");
        const { projectId, date, hours, description, billable, hourlyRate, confirmed, userId } = input;

        try {
            const { data: project } = await supabase
                .from("projects")
                .select("id, name")
                .eq("id", projectId)
                .eq("user_id", userId)
                .single();

            if (!project) {
                return { status: "error", message: "Project not found" };
            }

            const amount = billable && hourlyRate ? hours * hourlyRate : null;

            if (!confirmed) {
                return {
                    status: "preview",
                    projectName: project.name,
                    timeEntry: {
                        date: formatDate(date),
                        hours,
                        description: description || "No description",
                        billable: billable ? "Yes" : "No",
                        hourlyRate: hourlyRate || "N/A",
                        amount: amount ? formatCurrency(amount, "USD") : "N/A",
                    },
                    message: "Time entry preview. Say 'confirm' to log!",
                };
            }

            const { data: entry, error } = await supabase
                .from("project_time_entries")
                .insert({
                    project_id: projectId,
                    user_id: userId,
                    date,
                    hours,
                    description,
                    billable,
                    hourly_rate: hourlyRate || null,
                    amount,
                })
                .select()
                .single();

            if (error) throw error;

            return {
                status: "success",
                timeEntryId: entry.id,
                message: `Logged ${hours} hours on ${project.name}! ⏱️`,
            };
        } catch (error: any) {
            console.error("[logTime] Error:", error);
            return { status: "error", message: error.message };
        }
    },
});

export const getTimeEntries = tool({
    description: `Get time entries for a project with optional filters.`,

    inputSchema: z.object({
        projectId: z.string().uuid().describe("Project ID"),
        dateFrom: z.string().optional().describe("Start date YYYY-MM-DD"),
        dateTo: z.string().optional().describe("End date YYYY-MM-DD"),
        billableOnly: z.boolean().optional().describe("Only billable entries"),
        limit: z.number().optional().default(20).describe("Max results"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [getTimeEntries] TOOL CALLED ==========");
        const { projectId, dateFrom, dateTo, billableOnly, limit, userId } = input;

        try {
            let query = supabase
                .from("project_time_entries")
                .select("*")
                .eq("project_id", projectId)
                .eq("user_id", userId)
                .is("deleted_at", null);

            if (dateFrom) query = query.gte("date", dateFrom);
            if (dateTo) query = query.lte("date", dateTo);
            if (billableOnly) query = query.eq("billable", true);

            const { data: entries, error } = await query
                .order("date", { ascending: false })
                .limit(limit);

            if (error) throw error;

            // Calculate totals
            let totalHours = 0;
            let billableHours = 0;
            let totalAmount = 0;

            for (const entry of entries || []) {
                totalHours += Number(entry.hours) || 0;
                if (entry.billable) {
                    billableHours += Number(entry.hours) || 0;
                    totalAmount += Number(entry.amount) || 0;
                }
            }

            return {
                status: "success",
                entries: entries || [],
                summary: {
                    totalHours,
                    billableHours,
                    nonBillableHours: totalHours - billableHours,
                    totalAmount,
                },
            };
        } catch (error: any) {
            console.error("[getTimeEntries] Error:", error);
            return { status: "error", message: error.message };
        }
    },
});

export const deleteTimeEntry = tool({
    description: `Delete a time entry (soft delete).`,

    inputSchema: z.object({
        timeEntryId: z.string().uuid().describe("Time entry ID"),
        confirmed: z.boolean().describe("false=preview, true=delete"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [deleteTimeEntry] TOOL CALLED ==========");
        const { timeEntryId, confirmed, userId } = input;

        try {
            const { data: entry } = await supabase
                .from("project_time_entries")
                .select("id, hours, date, project:projects(name)")
                .eq("id", timeEntryId)
                .eq("user_id", userId)
                .single();

            if (!entry) {
                return { status: "error", message: "Time entry not found" };
            }

            if (!confirmed) {
                return {
                    status: "preview",
                    message: `Delete ${entry.hours} hours from ${formatDate(entry.date)}? Say 'confirm' to proceed.`,
                };
            }

            await supabase
                .from("project_time_entries")
                .update({ deleted_at: new Date().toISOString() })
                .eq("id", timeEntryId);

            return { status: "success", message: `Time entry deleted! 🗑️` };
        } catch (error: any) {
            console.error("[deleteTimeEntry] Error:", error);
            return { status: "error", message: error.message };
        }
    },
});

// ============================================
// NOTES/ACTIVITY TOOLS
// ============================================

export const addProjectNote = tool({
    description: `Add a note/activity to a project (meeting, call, email, etc.).`,

    inputSchema: z.object({
        projectId: z.string().uuid().describe("Project ID"),
        type: z.enum(["note", "meeting", "call", "email", "change_request", "other"]).describe("Activity type"),
        title: z.string().describe("Note/activity title"),
        content: z.string().optional().describe("Detailed content"),
        date: z.string().describe("Date YYYY-MM-DD"),
        confirmed: z.boolean().describe("false=preview, true=save"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [addProjectNote] TOOL CALLED ==========");
        const { projectId, type, title, content, date, confirmed, userId } = input;

        try {
            const { data: project } = await supabase
                .from("projects")
                .select("id, name")
                .eq("id", projectId)
                .eq("user_id", userId)
                .single();

            if (!project) {
                return { status: "error", message: "Project not found" };
            }

            const typeEmoji: Record<string, string> = {
                note: "📝",
                meeting: "👥",
                call: "📞",
                email: "✉️",
                change_request: "🔄",
                other: "📋",
            };

            if (!confirmed) {
                return {
                    status: "preview",
                    projectName: project.name,
                    note: {
                        type: `${typeEmoji[type]} ${type}`,
                        title,
                        content: content || "No content",
                        date: formatDate(date),
                    },
                    message: "Note preview. Say 'confirm' to add!",
                };
            }

            const { data: note, error } = await supabase
                .from("project_notes")
                .insert({
                    project_id: projectId,
                    user_id: userId,
                    type,
                    title,
                    content,
                    date,
                })
                .select()
                .single();

            if (error) throw error;

            return {
                status: "success",
                noteId: note.id,
                message: `${typeEmoji[type]} ${type.charAt(0).toUpperCase() + type.slice(1)} added to ${project.name}!`,
            };
        } catch (error: any) {
            console.error("[addProjectNote] Error:", error);
            return { status: "error", message: error.message };
        }
    },
});

export const getProjectNotes = tool({
    description: `Get notes/activity log for a project.`,

    inputSchema: z.object({
        projectId: z.string().uuid().describe("Project ID"),
        type: z.string().optional().describe("Filter by type"),
        limit: z.number().optional().default(10).describe("Max results"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [getProjectNotes] TOOL CALLED ==========");
        const { projectId, type, limit, userId } = input;

        try {
            let query = supabase
                .from("project_notes")
                .select("*")
                .eq("project_id", projectId)
                .eq("user_id", userId)
                .is("deleted_at", null);

            if (type) query = query.eq("type", type);

            const { data: notes, error } = await query
                .order("date", { ascending: false })
                .limit(limit);

            if (error) throw error;

            return {
                status: "success",
                notes: notes || [],
                total: notes?.length || 0,
            };
        } catch (error: any) {
            console.error("[getProjectNotes] Error:", error);
            return { status: "error", message: error.message };
        }
    },
});

export const deleteProjectNote = tool({
    description: `Delete a project note (soft delete).`,

    inputSchema: z.object({
        noteId: z.string().uuid().describe("Note ID"),
        confirmed: z.boolean().describe("false=preview, true=delete"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [deleteProjectNote] TOOL CALLED ==========");
        const { noteId, confirmed, userId } = input;

        try {
            const { data: note } = await supabase
                .from("project_notes")
                .select("id, title, type")
                .eq("id", noteId)
                .eq("user_id", userId)
                .single();

            if (!note) {
                return { status: "error", message: "Note not found" };
            }

            if (!confirmed) {
                return {
                    status: "preview",
                    message: `Delete ${note.type} "${note.title}"? Say 'confirm' to proceed.`,
                };
            }

            await supabase
                .from("project_notes")
                .update({ deleted_at: new Date().toISOString() })
                .eq("id", noteId);

            return { status: "success", message: `Note deleted! 🗑️` };
        } catch (error: any) {
            console.error("[deleteProjectNote] Error:", error);
            return { status: "error", message: error.message };
        }
    },
});

// ============================================
// EXPORT ALL PROJECT TOOLS
// ============================================

export const projectTools = {
    // Core Project
    searchProjects,
    getProjectDetails,
    createProject,
    updateProject,
    // Milestones
    createMilestone,
    updateMilestone,
    deleteMilestone,
    // Goals
    createGoal,
    updateGoal,
    deleteGoal,
    // Time Tracking
    logTime,
    getTimeEntries,
    deleteTimeEntry,
    // Notes
    addProjectNote,
    getProjectNotes,
    deleteProjectNote,
};
