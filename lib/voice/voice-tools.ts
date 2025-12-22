/**
 * Voice Agent Tools Adapter
 * Converts SmartCFO tools to Deepgram Voice Agent function format
 */

import { smartCFOTools } from "@/lib/ai/tools";

/**
 * Tool definitions for Deepgram Voice Agent function calling
 * These are the functions the voice agent can call during conversation
 */
export const voiceAgentFunctions = [
  // === INCOME FUNCTIONS ===
  {
    name: "addIncome",
    description:
      "Record new income. Requires amount, description, and userId. Use confirmed=false for preview, confirmed=true to save.",
    parameters: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Income amount" },
        description: { type: "string", description: "What the income is for" },
        clientName: { type: "string", description: "Client name (optional)" },
        categoryName: {
          type: "string",
          description: "Category name (optional)",
        },
        confirmed: {
          type: "boolean",
          description: "false=preview, true=save",
        },
        userId: { type: "string", description: "User ID" },
      },
      required: ["amount", "description", "confirmed", "userId"],
    },
  },
  {
    name: "getIncome",
    description: "Fetch income records with optional filters",
    parameters: {
      type: "object",
      properties: {
        dateFrom: { type: "string", description: "Start date YYYY-MM-DD" },
        dateTo: { type: "string", description: "End date YYYY-MM-DD" },
        limit: { type: "number", description: "Max results (default 20)" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["userId"],
    },
  },
  {
    name: "getIncomeStats",
    description:
      "Get income statistics for a period (today, week, month, year)",
    parameters: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["today", "week", "month", "quarter", "year"],
          description: "Time period",
        },
        userId: { type: "string", description: "User ID" },
      },
      required: ["period", "userId"],
    },
  },

  // === EXPENSE FUNCTIONS ===
  {
    name: "addExpense",
    description:
      "Record new expense. Requires amount, description, and userId. Use confirmed=false for preview.",
    parameters: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Expense amount" },
        description: { type: "string", description: "What the expense is for" },
        vendorName: { type: "string", description: "Vendor name (optional)" },
        categoryName: {
          type: "string",
          description: "Category name (optional)",
        },
        confirmed: {
          type: "boolean",
          description: "false=preview, true=save",
        },
        userId: { type: "string", description: "User ID" },
      },
      required: ["amount", "description", "confirmed", "userId"],
    },
  },
  {
    name: "getExpenses",
    description: "Fetch expense records with optional filters",
    parameters: {
      type: "object",
      properties: {
        dateFrom: { type: "string", description: "Start date YYYY-MM-DD" },
        dateTo: { type: "string", description: "End date YYYY-MM-DD" },
        limit: { type: "number", description: "Max results (default 20)" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["userId"],
    },
  },
  {
    name: "getExpenseStats",
    description: "Get expense statistics for a period",
    parameters: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["today", "week", "month", "quarter", "year"],
          description: "Time period",
        },
        userId: { type: "string", description: "User ID" },
      },
      required: ["period", "userId"],
    },
  },

  // === CLIENT FUNCTIONS ===
  {
    name: "searchClients",
    description: "Search for clients by name, email, or phone",
    parameters: {
      type: "object",
      properties: {
        searchTerm: { type: "string", description: "Client name, email, phone, or any identifying info" },
        limit: { type: "number", description: "Max results (default 5)" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["searchTerm", "userId"],
    },
  },
  {
    name: "addClient",
    description: "Create a new client",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Client name" },
        email: { type: "string", description: "Client email (optional)" },
        phone: { type: "string", description: "Client phone (optional)" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["name", "userId"],
    },
  },

  // === VENDOR FUNCTIONS ===
  {
    name: "searchVendors",
    description: "Search for vendors by name, email, or phone",
    parameters: {
      type: "object",
      properties: {
        searchTerm: { type: "string", description: "Vendor name, email, phone, or any identifying info" },
        limit: { type: "number", description: "Max results (default 5)" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["searchTerm", "userId"],
    },
  },
  {
    name: "addVendor",
    description: "Create a new vendor",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Vendor name" },
        email: { type: "string", description: "Vendor email (optional)" },
        phone: { type: "string", description: "Vendor phone (optional)" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["name", "userId"],
    },
  },

  // === INVOICE FUNCTIONS ===
  {
    name: "createInvoice",
    description:
      "Create a new invoice. Use confirmed=false for preview, confirmed=true to save.",
    parameters: {
      type: "object",
      properties: {
        clientId: { type: "string", description: "Client ID" },
        items: {
          type: "array",
          description: "Invoice line items",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              quantity: { type: "number" },
              unitPrice: { type: "number" },
            },
          },
        },
        confirmed: {
          type: "boolean",
          description: "false=preview, true=save",
        },
        userId: { type: "string", description: "User ID" },
      },
      required: ["clientId", "items", "confirmed", "userId"],
    },
  },
  {
    name: "getInvoices",
    description: "Get invoices with optional filters",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["draft", "sent", "paid", "overdue"],
          description: "Filter by status",
        },
        limit: { type: "number", description: "Max results" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["userId"],
    },
  },

  // === CATEGORY FUNCTIONS ===
  {
    name: "getCategories",
    description: "Get categories for income or expense",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["income", "expense", "all"],
          description: "Category type",
        },
        searchTerm: { type: "string", description: "Optional name to search for" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["userId"],
    },
  },
  {
    name: "addCategory",
    description: "Create a new category for income or expenses",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Category name" },
        type: { type: "string", enum: ["income", "expense"], description: "Category type" },
        color: { type: "string", description: "Color code (hex)" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["name", "type", "userId"],
    },
  },
  {
    name: "updateCategory",
    description: "Update an existing category",
    parameters: {
      type: "object",
      properties: {
        categoryId: { type: "string", description: "Category ID" },
        name: { type: "string", description: "New category name" },
        color: { type: "string", description: "New color (hex)" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["categoryId", "userId"],
    },
  },

  // === CLIENT UPDATE FUNCTIONS ===
  {
    name: "getClient",
    description: "Get details for a specific client by ID",
    parameters: {
      type: "object",
      properties: {
        clientId: { type: "string", description: "Client ID" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["clientId", "userId"],
    },
  },
  {
    name: "updateClient",
    description: "Update an existing client. Preview first (confirmed=false).",
    parameters: {
      type: "object",
      properties: {
        clientId: { type: "string", description: "Client ID" },
        name: { type: "string", description: "New client name" },
        email: { type: "string", description: "New email" },
        phone: { type: "string", description: "New phone" },
        companyName: { type: "string", description: "New company name" },
        address: { type: "string", description: "New address" },
        confirmed: { type: "boolean", description: "false=preview, true=save" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["clientId", "confirmed", "userId"],
    },
  },

  // === VENDOR UPDATE FUNCTIONS ===
  {
    name: "getVendor",
    description: "Get details for a specific vendor by ID",
    parameters: {
      type: "object",
      properties: {
        vendorId: { type: "string", description: "Vendor ID" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["vendorId", "userId"],
    },
  },
  {
    name: "updateVendor",
    description: "Update an existing vendor. Preview first (confirmed=false).",
    parameters: {
      type: "object",
      properties: {
        vendorId: { type: "string", description: "Vendor ID" },
        name: { type: "string", description: "New vendor name" },
        email: { type: "string", description: "New email" },
        phone: { type: "string", description: "New phone" },
        address: { type: "string", description: "New address" },
        confirmed: { type: "boolean", description: "false=preview, true=save" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["vendorId", "confirmed", "userId"],
    },
  },

  // === INCOME/EXPENSE UPDATE FUNCTIONS ===
  {
    name: "updateIncome",
    description: "Update an existing income record. Preview first (confirmed=false).",
    parameters: {
      type: "object",
      properties: {
        incomeId: { type: "string", description: "Income record ID" },
        amount: { type: "number", description: "New amount" },
        description: { type: "string", description: "New description" },
        date: { type: "string", description: "New date YYYY-MM-DD" },
        clientId: { type: "string", description: "New client ID" },
        categoryId: { type: "string", description: "New category ID" },
        confirmed: { type: "boolean", description: "false=preview, true=save" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["incomeId", "confirmed", "userId"],
    },
  },
  {
    name: "updateExpense",
    description: "Update an existing expense record. Preview first (confirmed=false).",
    parameters: {
      type: "object",
      properties: {
        expenseId: { type: "string", description: "Expense record ID" },
        amount: { type: "number", description: "New amount" },
        description: { type: "string", description: "New description" },
        date: { type: "string", description: "New date YYYY-MM-DD" },
        vendorId: { type: "string", description: "New vendor ID" },
        categoryId: { type: "string", description: "New category ID" },
        confirmed: { type: "boolean", description: "false=preview, true=save" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["expenseId", "confirmed", "userId"],
    },
  },

  // === MORE INVOICE FUNCTIONS ===
  {
    name: "getInvoiceById",
    description: "Get detailed information about a specific invoice",
    parameters: {
      type: "object",
      properties: {
        invoiceId: { type: "string", description: "Invoice UUID" },
        invoiceNumber: { type: "string", description: "Invoice number like INV-001" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["userId"],
    },
  },
  {
    name: "getOverdueInvoices",
    description: "Get all overdue (unpaid past due date) invoices",
    parameters: {
      type: "object",
      properties: {
        userId: { type: "string", description: "User ID" },
      },
      required: ["userId"],
    },
  },
  {
    name: "markInvoicePaid",
    description: "Mark an invoice as paid. Preview first (confirmed=false).",
    parameters: {
      type: "object",
      properties: {
        invoiceId: { type: "string", description: "Invoice UUID" },
        invoiceNumber: { type: "string", description: "Invoice number" },
        paymentDate: { type: "string", description: "Payment date YYYY-MM-DD" },
        paymentMethod: { type: "string", description: "Payment method" },
        referenceNumber: { type: "string", description: "Payment reference" },
        confirmed: { type: "boolean", description: "false=preview, true=save" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["confirmed", "userId"],
    },
  },
  {
    name: "updateInvoice",
    description: "Update an existing invoice. Preview first (confirmed=false).",
    parameters: {
      type: "object",
      properties: {
        invoiceId: { type: "string", description: "Invoice UUID" },
        invoiceNumber: { type: "string", description: "Invoice number" },
        date: { type: "string", description: "New invoice date YYYY-MM-DD" },
        dueDate: { type: "string", description: "New due date YYYY-MM-DD" },
        notes: { type: "string", description: "New notes" },
        confirmed: { type: "boolean", description: "false=preview, true=save" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["confirmed", "userId"],
    },
  },

  // === RECURRING INVOICE FUNCTIONS ===
  {
    name: "getRecurringInvoices",
    description: "Get user's recurring invoice schedules",
    parameters: {
      type: "object",
      properties: {
        isActive: { type: "boolean", description: "Filter: true=active only, false=paused only" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["userId"],
    },
  },
  {
    name: "toggleRecurring",
    description: "Pause or resume a recurring invoice. Preview first (confirmed=false).",
    parameters: {
      type: "object",
      properties: {
        recurringId: { type: "string", description: "Recurring invoice ID" },
        isActive: { type: "boolean", description: "true=resume, false=pause" },
        confirmed: { type: "boolean", description: "false=preview, true=execute" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["recurringId", "isActive", "confirmed", "userId"],
    },
  },
  {
    name: "deleteRecurring",
    description: "Cancel a recurring invoice schedule. Preview first (confirmed=false).",
    parameters: {
      type: "object",
      properties: {
        recurringId: { type: "string", description: "Recurring invoice ID" },
        confirmed: { type: "boolean", description: "false=preview, true=delete" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["recurringId", "confirmed", "userId"],
    },
  },

  // === TEMPLATE FUNCTIONS ===
  {
    name: "getInvoiceTemplates",
    description: "Get user's saved invoice templates",
    parameters: {
      type: "object",
      properties: {
        userId: { type: "string", description: "User ID" },
      },
      required: ["userId"],
    },
  },
  {
    name: "createFromTemplate",
    description: "Create a new invoice from a saved template. Preview first (confirmed=false).",
    parameters: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template UUID" },
        clientId: { type: "string", description: "Client ID for the new invoice" },
        date: { type: "string", description: "Invoice date YYYY-MM-DD" },
        confirmed: { type: "boolean", description: "false=preview, true=create" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["templateId", "clientId", "confirmed", "userId"],
    },
  },
  {
    name: "saveAsTemplate",
    description: "Save an existing invoice as a reusable template",
    parameters: {
      type: "object",
      properties: {
        invoiceId: { type: "string", description: "Invoice UUID" },
        invoiceNumber: { type: "string", description: "Invoice number" },
        templateName: { type: "string", description: "Name for the template" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["templateName", "userId"],
    },
  },

  // === PROJECT FUNCTIONS ===
  {
    name: "searchProjects",
    description: "Search for projects by name, status, or client",
    parameters: {
      type: "object",
      properties: {
        searchTerm: { type: "string", description: "Project name to search" },
        status: { type: "string", enum: ["active", "completed", "on_hold", "cancelled"], description: "Filter by status" },
        clientName: { type: "string", description: "Filter by client name" },
        limit: { type: "number", description: "Max results" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["userId"],
    },
  },
  {
    name: "getProjectDetails",
    description: "Get detailed information about a project including milestones, goals, and time entries",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project UUID" },
        projectName: { type: "string", description: "Project name (will search)" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["userId"],
    },
  },
  {
    name: "createProject",
    description: "Create a new project. Preview first (confirmed=false).",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Project name" },
        clientId: { type: "string", description: "Client ID" },
        budget: { type: "number", description: "Project budget" },
        budgetCurrency: { type: "string", description: "Budget currency" },
        startDate: { type: "string", description: "Start date YYYY-MM-DD" },
        endDate: { type: "string", description: "End date YYYY-MM-DD" },
        status: { type: "string", enum: ["active", "completed", "on_hold", "cancelled"], description: "Project status" },
        color: { type: "string", description: "Hex color code" },
        confirmed: { type: "boolean", description: "false=preview, true=save" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["name", "confirmed", "userId"],
    },
  },
  {
    name: "updateProject",
    description: "Update an existing project. Preview first (confirmed=false).",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        name: { type: "string", description: "New project name" },
        status: { type: "string", enum: ["active", "completed", "on_hold", "cancelled"], description: "New status" },
        budget: { type: "number", description: "New budget" },
        endDate: { type: "string", description: "New end date YYYY-MM-DD" },
        color: { type: "string", description: "New color hex code" },
        confirmed: { type: "boolean", description: "false=preview, true=save" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["projectId", "confirmed", "userId"],
    },
  },

  // === MILESTONE FUNCTIONS ===
  {
    name: "createMilestone",
    description: "Add a milestone (payment phase) to a project. Preview first (confirmed=false).",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        name: { type: "string", description: "Milestone name" },
        description: { type: "string", description: "Description" },
        dueDate: { type: "string", description: "Due date YYYY-MM-DD" },
        targetAmount: { type: "number", description: "Expected payment amount" },
        currency: { type: "string", description: "Currency" },
        confirmed: { type: "boolean", description: "false=preview, true=save" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["projectId", "name", "confirmed", "userId"],
    },
  },
  {
    name: "updateMilestone",
    description: "Update a milestone status or details. Preview first (confirmed=false).",
    parameters: {
      type: "object",
      properties: {
        milestoneId: { type: "string", description: "Milestone ID" },
        name: { type: "string", description: "New name" },
        status: { type: "string", enum: ["pending", "in_progress", "completed", "paid"], description: "New status" },
        dueDate: { type: "string", description: "New due date" },
        targetAmount: { type: "number", description: "New target amount" },
        invoiceId: { type: "string", description: "Link to invoice ID when paid" },
        confirmed: { type: "boolean", description: "false=preview, true=save" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["milestoneId", "confirmed", "userId"],
    },
  },
  {
    name: "deleteMilestone",
    description: "Delete a milestone. Preview first (confirmed=false).",
    parameters: {
      type: "object",
      properties: {
        milestoneId: { type: "string", description: "Milestone ID" },
        confirmed: { type: "boolean", description: "false=preview, true=delete" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["milestoneId", "confirmed", "userId"],
    },
  },

  // === GOAL FUNCTIONS ===
  {
    name: "createGoal",
    description: "Add a goal/deliverable to a project. Preview first (confirmed=false).",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        title: { type: "string", description: "Goal title" },
        description: { type: "string", description: "Description" },
        confirmed: { type: "boolean", description: "false=preview, true=save" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["projectId", "title", "confirmed", "userId"],
    },
  },
  {
    name: "updateGoal",
    description: "Update a goal status or title. Preview first (confirmed=false).",
    parameters: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "Goal ID" },
        title: { type: "string", description: "New title" },
        status: { type: "string", enum: ["todo", "in_progress", "done"], description: "New status" },
        confirmed: { type: "boolean", description: "false=preview, true=save" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["goalId", "confirmed", "userId"],
    },
  },
  {
    name: "deleteGoal",
    description: "Delete a goal. Preview first (confirmed=false).",
    parameters: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "Goal ID" },
        confirmed: { type: "boolean", description: "false=preview, true=delete" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["goalId", "confirmed", "userId"],
    },
  },

  // === TIME TRACKING FUNCTIONS ===
  {
    name: "logTime",
    description: "Log time worked on a project. Preview first (confirmed=false).",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        date: { type: "string", description: "Date YYYY-MM-DD" },
        hours: { type: "number", description: "Hours worked (e.g., 2.5)" },
        description: { type: "string", description: "What was worked on" },
        billable: { type: "boolean", description: "true=billable, false=non-billable" },
        hourlyRate: { type: "number", description: "Hourly rate for billable hours" },
        confirmed: { type: "boolean", description: "false=preview, true=save" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["projectId", "date", "hours", "billable", "confirmed", "userId"],
    },
  },
  {
    name: "getTimeEntries",
    description: "Get time entries for a project with optional filters",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        dateFrom: { type: "string", description: "Start date YYYY-MM-DD" },
        dateTo: { type: "string", description: "End date YYYY-MM-DD" },
        billableOnly: { type: "boolean", description: "Only billable entries" },
        limit: { type: "number", description: "Max results" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["projectId", "userId"],
    },
  },
  {
    name: "deleteTimeEntry",
    description: "Delete a time entry. Preview first (confirmed=false).",
    parameters: {
      type: "object",
      properties: {
        timeEntryId: { type: "string", description: "Time entry ID" },
        confirmed: { type: "boolean", description: "false=preview, true=delete" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["timeEntryId", "confirmed", "userId"],
    },
  },

  // === PROJECT NOTES FUNCTIONS ===
  {
    name: "addProjectNote",
    description: "Add a note/activity to a project. Preview first (confirmed=false).",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        type: { type: "string", enum: ["note", "meeting", "call", "email", "change_request", "other"], description: "Activity type" },
        title: { type: "string", description: "Note/activity title" },
        content: { type: "string", description: "Detailed content" },
        date: { type: "string", description: "Date YYYY-MM-DD" },
        confirmed: { type: "boolean", description: "false=preview, true=save" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["projectId", "type", "title", "date", "confirmed", "userId"],
    },
  },
  {
    name: "getProjectNotes",
    description: "Get notes/activity log for a project",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        type: { type: "string", description: "Filter by type" },
        limit: { type: "number", description: "Max results" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["projectId", "userId"],
    },
  },
  {
    name: "deleteProjectNote",
    description: "Delete a project note. Preview first (confirmed=false).",
    parameters: {
      type: "object",
      properties: {
        noteId: { type: "string", description: "Note ID" },
        confirmed: { type: "boolean", description: "false=preview, true=delete" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["noteId", "confirmed", "userId"],
    },
  },
];

/**
 * Execute a SmartCFO tool by name with given parameters
 */
export async function executeVoiceTool(
  functionName: string,
  parameters: Record<string, unknown>
): Promise<unknown> {
  console.log(`[VoiceTool] Executing: ${functionName}`);
  console.log(`[VoiceTool] Parameters:`, JSON.stringify(parameters, null, 2));

  // Get the tool from registry
  const tool = smartCFOTools[functionName as keyof typeof smartCFOTools];

  if (!tool) {
    console.error(`[VoiceTool] Tool not found: ${functionName}`);
    return { error: `Tool "${functionName}" not found` };
  }

  try {
    // Execute the tool - cast to any to bypass strict typing
    // The tool.execute expects specific input types but we're calling dynamically
    const executeFn = tool.execute as (
      input: Record<string, unknown>,
      options: { toolCallId: string; messages: unknown[] }
    ) => Promise<unknown>;

    const result = await executeFn(parameters, {
      toolCallId: `voice-${Date.now()}`,
      messages: [],
    });

    console.log(`[VoiceTool] Result:`, JSON.stringify(result, null, 2));
    return result;
  } catch (error: unknown) {
    console.error(`[VoiceTool] Error:`, error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return { error: `Tool execution failed: ${message}` };
  }
}
