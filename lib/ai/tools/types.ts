// SmartCFO Tools - Type Definitions
// These types define the structure for all AI tools in the system

import { z } from "zod";

/**
 * Context passed to every tool execution
 * Contains the authenticated user's information
 */
export interface ToolContext {
    userId: string;
    userEmail: string;
}

/**
 * Standard response format for tools that return lists
 */
export interface PaginatedResult<T> {
    data: T[];
    total: number;
    hasMore?: boolean;
}

/**
 * Standard response format for tools that create/update records
 */
export interface MutationResult {
    success: boolean;
    message: string;
    id?: string;
    error?: string;
}

/**
 * Date range filter - commonly used across many tools
 */
export const dateRangeSchema = z.object({
    dateFrom: z.string().optional().describe("Start date in YYYY-MM-DD format"),
    dateTo: z.string().optional().describe("End date in YYYY-MM-DD format"),
});

/**
 * Pagination parameters - commonly used for list queries
 */
export const paginationSchema = z.object({
    limit: z.number().optional().default(20).describe("Maximum number of results to return"),
    offset: z.number().optional().default(0).describe("Number of results to skip"),
});

/**
 * Common category types in SmartCFO
 */
export type CategoryType = "income" | "expense";

/**
 * Common status types for invoices
 */
export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled";

/**
 * Helper to format currency for AI responses
 */
export function formatCurrency(amount: number, currency = "USD"): string {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
    }).format(amount);
}

/**
 * Helper to format date for AI responses
 */
export function formatDate(date: string | Date): string {
    return new Date(date).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}
