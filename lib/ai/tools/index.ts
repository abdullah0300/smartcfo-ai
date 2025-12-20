// SmartCFO Tools - Main Registry
// This file exports all tools and creates the registry used by the AI

// Import tool categories
import { incomeTools } from "./income";
import { expenseTools } from "./expenses";
import { clientTools } from "./clients";
import { vendorTools } from "./vendors";
import { categoryTools } from "./categories";
import { invoiceTools } from "./invoices";
import { projectTools } from "./projects";

/**
 * ==============================================================
 * TOOL REGISTRY - All tools available to the AI
 * ==============================================================
 */
export const smartCFOTools = {
    // === INCOME TOOLS ===
    ...incomeTools,

    // === EXPENSE TOOLS ===
    ...expenseTools,

    // === CLIENT TOOLS ===
    ...clientTools,

    // === VENDOR TOOLS ===
    ...vendorTools,

    // === CATEGORY TOOLS ===
    ...categoryTools,

    // === INVOICE TOOLS ===
    ...invoiceTools,

    // === PROJECT TOOLS ===
    ...projectTools,
};

// Export type for the tools registry
export type SmartCFOTools = typeof smartCFOTools;

