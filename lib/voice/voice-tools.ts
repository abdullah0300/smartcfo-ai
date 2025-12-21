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
        query: { type: "string", description: "Search term" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["query", "userId"],
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
    description: "Search for vendors by name",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["query", "userId"],
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
          enum: ["income", "expense"],
          description: "Category type",
        },
        userId: { type: "string", description: "User ID" },
      },
      required: ["type", "userId"],
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
