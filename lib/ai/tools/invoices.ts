/**
 * SmartCFO Invoice Tools
 * 
 * Tools for managing invoices via AI chat.
 * Supports both standard and UK VAT-specific invoices.
 */

import { tool } from "ai";
import { z } from "zod";
import { supabase } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "./types";

// Helper function for team support (matches database.ts getEffectiveUserId)
async function getEffectiveUserId(userId: string): Promise<string> {
    try {
        const { data: teamMember } = await supabase
            .from("team_members")
            .select("team_id")
            .eq("user_id", userId)
            .eq("status", "active")
            .maybeSingle();

        return teamMember?.team_id || userId;
    } catch {
        return userId;
    }
}

// ============================================
// GET INVOICES TOOL
// ============================================

export const getInvoices = tool({
    description: `
Get user's invoices with optional filters.
Use to list invoices, check status, or find specific invoices.
    `,

    inputSchema: z.object({
        status: z.enum(["draft", "sent", "paid", "overdue", "partially_paid", "canceled", "all"]).optional().default("all").describe("Filter by status"),
        clientId: z.string().uuid().optional().describe("Filter by client"),
        dateFrom: z.string().optional().describe("Start date YYYY-MM-DD"),
        dateTo: z.string().optional().describe("End date YYYY-MM-DD"),
        limit: z.number().optional().default(10).describe("Max results"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [getInvoices] TOOL CALLED ==========");
        console.log("[getInvoices] Input:", JSON.stringify(input, null, 2));

        const { status, clientId, dateFrom, dateTo, limit, userId } = input;

        try {
            const effectiveUserId = await getEffectiveUserId(userId);

            let query = supabase
                .from("invoices")
                .select(`
                    id,
                    invoice_number,
                    date,
                    due_date,
                    status,
                    subtotal,
                    tax_amount,
                    total,
                    currency,
                    amount_paid,
                    balance_due,
                    client_id,
                    clients (id, name, company_name)
                `)
                .eq("user_id", effectiveUserId)
                .is("deleted_at", null)
                .order("date", { ascending: false })
                .limit(limit || 10);

            // Apply filters
            if (status && status !== "all") {
                if (status === "overdue") {
                    const today = new Date().toISOString().split("T")[0];
                    query = query
                        .lt("due_date", today)
                        .not("status", "in", '("paid","canceled")');
                } else {
                    query = query.eq("status", status);
                }
            }

            if (clientId) {
                query = query.eq("client_id", clientId);
            }

            if (dateFrom) {
                query = query.gte("date", dateFrom);
            }

            if (dateTo) {
                query = query.lte("date", dateTo);
            }

            const { data: invoices, error } = await query;

            if (error) {
                console.error("[getInvoices] Error:", error);
                return { status: "error", error: "Failed to fetch invoices" };
            }

            return {
                status: "success",
                invoices: (invoices || []).map((inv: any) => ({
                    id: inv.id,
                    number: inv.invoice_number,
                    client: inv.clients?.name || "No client",
                    clientCompany: inv.clients?.company_name,
                    date: inv.date,
                    dueDate: inv.due_date,
                    status: inv.status,
                    total: inv.total,
                    currency: inv.currency,
                    amountPaid: inv.amount_paid || 0,
                    balanceDue: inv.balance_due || inv.total,
                })),
                count: (invoices || []).length,
            };
        } catch (error) {
            console.error("[getInvoices] Error:", error);
            return { status: "error", error: "Failed to get invoices" };
        }
    },
});

// ============================================
// GET INVOICE BY ID TOOL
// ============================================

export const getInvoiceById = tool({
    description: `
Get detailed information about a specific invoice.
Use when user asks about a specific invoice by number or ID.
    `,

    inputSchema: z.object({
        invoiceId: z.string().uuid().optional().describe("Invoice UUID"),
        invoiceNumber: z.string().optional().describe("Invoice number like INV-001"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [getInvoiceById] TOOL CALLED ==========");
        console.log("[getInvoiceById] Input:", JSON.stringify(input, null, 2));

        const { invoiceId, invoiceNumber, userId } = input;

        try {
            const effectiveUserId = await getEffectiveUserId(userId);

            let query = supabase
                .from("invoices")
                .select(`
                    *,
                    clients (id, name, company_name, email, phone, address),
                    invoice_items (id, description, quantity, rate, amount, tax_rate, tax_amount, net_amount, gross_amount),
                    categories (id, name)
                `)
                .eq("user_id", effectiveUserId)
                .is("deleted_at", null);

            if (invoiceId) {
                query = query.eq("id", invoiceId);
            } else if (invoiceNumber) {
                query = query.eq("invoice_number", invoiceNumber);
            } else {
                return { status: "error", error: "Please provide invoice ID or number" };
            }

            const { data: invoice, error } = await query.single();

            if (error || !invoice) {
                return { status: "not_found", error: "Invoice not found" };
            }

            // Get payments
            const { data: payments } = await supabase
                .from("invoice_payments")
                .select("*")
                .eq("invoice_id", invoice.id)
                .order("payment_date", { ascending: false });

            return {
                status: "success",
                invoice: {
                    id: invoice.id,
                    number: invoice.invoice_number,
                    status: invoice.status,
                    date: invoice.date,
                    dueDate: invoice.due_date,
                    client: invoice.clients ? {
                        name: invoice.clients.name,
                        company: invoice.clients.company_name,
                        email: invoice.clients.email,
                    } : null,
                    items: invoice.invoice_items || [],
                    subtotal: invoice.subtotal,
                    taxRate: invoice.tax_rate,
                    taxAmount: invoice.tax_amount,
                    total: invoice.total,
                    currency: invoice.currency,
                    amountPaid: invoice.amount_paid || 0,
                    balanceDue: invoice.balance_due || invoice.total,
                    notes: invoice.notes,
                    category: invoice.categories?.name,
                    payments: payments || [],
                },
            };
        } catch (error) {
            console.error("[getInvoiceById] Error:", error);
            return { status: "error", error: "Failed to get invoice" };
        }
    },
});

// ============================================
// GET OVERDUE INVOICES TOOL
// ============================================

export const getOverdueInvoices = tool({
    description: `
Get all overdue (unpaid past due date) invoices.
Use when user asks "Do I have overdue invoices?" or "What's unpaid?"
    `,

    inputSchema: z.object({
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [getOverdueInvoices] TOOL CALLED ==========");
        console.log("[getOverdueInvoices] Input:", JSON.stringify(input, null, 2));

        const { userId } = input;
        const today = new Date().toISOString().split("T")[0];

        try {
            const effectiveUserId = await getEffectiveUserId(userId);

            const { data: invoices, error } = await supabase
                .from("invoices")
                .select(`
                    id,
                    invoice_number,
                    date,
                    due_date,
                    total,
                    balance_due,
                    currency,
                    clients (name, company_name)
                `)
                .eq("user_id", effectiveUserId)
                .is("deleted_at", null)
                .lt("due_date", today)
                .not("status", "in", '("paid","canceled")')
                .order("due_date", { ascending: true });

            if (error) {
                console.error("[getOverdueInvoices] Error:", error);
                return { status: "error", error: "Failed to fetch overdue invoices" };
            }

            const overdueList = (invoices || []).map((inv: any) => {
                const dueDate = new Date(inv.due_date);
                const todayDate = new Date(today);
                const daysOverdue = Math.floor((todayDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

                return {
                    id: inv.id,
                    number: inv.invoice_number,
                    client: inv.clients?.name || "No client",
                    dueDate: inv.due_date,
                    daysOverdue,
                    total: inv.total,
                    balanceDue: inv.balance_due || inv.total,
                    currency: inv.currency,
                };
            });

            const totalOverdue = overdueList.reduce((sum, inv) => sum + (inv.balanceDue || 0), 0);

            return {
                status: "success",
                invoices: overdueList,
                count: overdueList.length,
                totalOverdue,
                currency: overdueList[0]?.currency || "USD",
            };
        } catch (error) {
            console.error("[getOverdueInvoices] Error:", error);
            return { status: "error", error: "Failed to get overdue invoices" };
        }
    },
});

// ============================================
// CREATE INVOICE TOOL
// ============================================

export const createInvoice = tool({
    description: `
Create a new invoice. Preview first (confirmed=false), save after user confirms (confirmed=true).
Optionally make it recurring with makeRecurring=true and frequency.

REQUIRED BEFORE CALLING:
- clientId: Get from searchClients, or addClient if new
- items: Array of {description, quantity, rate}

FLOW:
1. confirmed=false → Returns preview (NOT saved)
2. Show preview to user, wait for "confirm"
3. confirmed=true → Saves to database (+ recurring if enabled)

DO NOT call without clientId resolved first.
    `,

    inputSchema: z.object({
        clientId: z.string().uuid().describe("Client ID from searchClients"),
        items: z.array(z.object({
            description: z.string().describe("Item description"),
            quantity: z.number().positive().describe("Quantity"),
            rate: z.number().positive().describe("Rate per unit"),
            taxRate: z.number().optional().describe("Tax rate % for this item (UK VAT)"),
        })).describe("Invoice line items"),
        date: z.string().optional().describe("Invoice date YYYY-MM-DD, default today"),
        dueDate: z.string().optional().describe("Due date YYYY-MM-DD, default +30 days"),
        notes: z.string().optional().describe("Invoice notes"),
        currency: z.string().optional().describe("Currency code, default user's base"),
        projectId: z.string().uuid().optional().describe("Optional project ID"),
        incomeCategoryId: z.string().uuid().optional().describe("Optional income category"),
        makeRecurring: z.boolean().optional().default(false).describe("Make this a recurring invoice"),
        frequency: z.enum(["weekly", "biweekly", "monthly", "quarterly", "yearly"]).optional().describe("Recurring frequency"),
        recurringEndDate: z.string().optional().describe("Optional end date for recurring YYYY-MM-DD"),
        confirmed: z.boolean().describe("false=preview, true=save"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [createInvoice] TOOL CALLED ==========");
        console.log("[createInvoice] Input:", JSON.stringify(input, null, 2));

        const {
            clientId,
            items,
            date,
            dueDate,
            notes,
            currency,
            projectId,
            incomeCategoryId,
            makeRecurring,
            frequency,
            recurringEndDate,
            confirmed,
            userId
        } = input;

        try {
            // Get effective user ID for team support
            const effectiveUserId = await getEffectiveUserId(userId);

            // Get user settings
            const { data: userSettings } = await supabase
                .from("user_settings")
                .select("base_currency")
                .eq("user_id", effectiveUserId)
                .single();

            const { data: invoiceSettings } = await supabase
                .from("invoice_settings")
                .select("default_tax_rate, payment_terms")
                .eq("user_id", effectiveUserId)
                .single();

            const baseCurrency = userSettings?.base_currency || "USD";
            const defaultTaxRate = invoiceSettings?.default_tax_rate || 0;
            const paymentTerms = invoiceSettings?.payment_terms || 30;

            // Get invoice number from RPC function (same as InvoiceForm)
            let invoiceNumber: string;
            try {
                const { data: rpcNumber, error: rpcError } = await supabase
                    .rpc("get_next_invoice_number", { p_user_id: effectiveUserId });

                if (rpcError) throw rpcError;
                invoiceNumber = rpcNumber;
            } catch (rpcErr) {
                console.error("[createInvoice] RPC error, using fallback:", rpcErr);
                invoiceNumber = `INV-${Date.now()}`;
            }

            // Calculate invoice date and due date
            const invoiceDate = date || new Date().toISOString().split("T")[0];
            const calculatedDueDate = dueDate || new Date(
                new Date(invoiceDate).getTime() + paymentTerms * 24 * 60 * 60 * 1000
            ).toISOString().split("T")[0];

            // Calculate items and totals
            const calculatedItems = items.map(item => {
                const netAmount = item.quantity * item.rate;
                const itemTaxRate = item.taxRate ?? defaultTaxRate;
                const taxAmount = (netAmount * itemTaxRate) / 100;
                const grossAmount = netAmount + taxAmount;

                return {
                    description: item.description,
                    quantity: item.quantity,
                    rate: item.rate,
                    amount: netAmount,
                    tax_rate: itemTaxRate,
                    tax_amount: taxAmount,
                    net_amount: netAmount,
                    gross_amount: grossAmount,
                };
            });

            const subtotal = calculatedItems.reduce((sum, item) => sum + item.net_amount, 0);
            const totalTax = calculatedItems.reduce((sum, item) => sum + item.tax_amount, 0);
            const total = subtotal + totalTax;

            // Get client info
            const { data: client } = await supabase
                .from("clients")
                .select("name, company_name")
                .eq("id", clientId)
                .single();

            // invoiceNumber is already set from RPC above

            // PREVIEW MODE
            if (!confirmed) {
                return {
                    status: "preview",
                    preview: {
                        invoiceNumber,
                        client: client?.name || "Unknown",
                        clientCompany: client?.company_name,
                        date: invoiceDate,
                        dueDate: calculatedDueDate,
                        items: calculatedItems.map(item => ({
                            description: item.description,
                            quantity: item.quantity,
                            rate: item.rate,
                            amount: item.gross_amount,
                            taxRate: item.tax_rate,
                            taxAmount: item.tax_amount,
                        })),
                        subtotal,
                        taxAmount: totalTax,
                        total,
                        currency: currency || baseCurrency,
                        notes,
                    },
                    message: "Preview ready. Say 'confirm' to create this invoice.",
                };
            }

            // SAVE MODE
            console.log("[createInvoice] SAVE MODE - inserting invoice");

            // Insert invoice
            const { data: newInvoice, error: invoiceError } = await supabase
                .from("invoices")
                .insert({
                    user_id: effectiveUserId,
                    invoice_number: invoiceNumber,
                    client_id: clientId,
                    date: invoiceDate,
                    due_date: calculatedDueDate,
                    status: "draft",
                    subtotal,
                    tax_rate: defaultTaxRate,
                    tax_amount: totalTax,
                    total,
                    balance_due: total,
                    currency: currency || baseCurrency,
                    notes: notes || null,
                    project_id: projectId || null,
                    income_category_id: incomeCategoryId || null,
                    exchange_rate: 1,
                    base_amount: subtotal,
                })
                .select("id, invoice_number, total")
                .single();

            if (invoiceError) {
                console.error("[createInvoice] Invoice insert error:", invoiceError);
                return { status: "error", error: "Failed to create invoice" };
            }

            // Insert invoice items
            const itemsToInsert = calculatedItems.map(item => ({
                invoice_id: newInvoice.id,
                ...item,
            }));

            const { error: itemsError } = await supabase
                .from("invoice_items")
                .insert(itemsToInsert);

            if (itemsError) {
                console.error("[createInvoice] Items insert error:", itemsError);
                // Don't fail completely, invoice was created
            }

            // Update next invoice number (matching InvoiceForm behavior)
            const { data: currentSettings } = await supabase
                .from("invoice_settings")
                .select("next_number")
                .eq("user_id", effectiveUserId)
                .single();

            if (currentSettings) {
                await supabase
                    .from("invoice_settings")
                    .update({ next_number: (currentSettings.next_number || 1) + 1 })
                    .eq("user_id", effectiveUserId);
            }

            console.log("[createInvoice] Invoice created:", newInvoice.invoice_number);

            // Handle recurring invoice creation if enabled
            let recurringCreated = false;
            if (makeRecurring && frequency) {
                console.log("[createInvoice] Creating recurring invoice schedule");

                // Calculate next date based on frequency
                const calculateNextDate = (baseDate: string, freq: string): string => {
                    const nextDate = new Date(baseDate);
                    switch (freq) {
                        case "weekly": nextDate.setDate(nextDate.getDate() + 7); break;
                        case "biweekly": nextDate.setDate(nextDate.getDate() + 14); break;
                        case "monthly": nextDate.setMonth(nextDate.getMonth() + 1); break;
                        case "quarterly": nextDate.setMonth(nextDate.getMonth() + 3); break;
                        case "yearly": nextDate.setFullYear(nextDate.getFullYear() + 1); break;
                    }
                    return nextDate.toISOString().split("T")[0];
                };

                const templateData = {
                    items: calculatedItems,
                    subtotal,
                    tax_rate: defaultTaxRate,
                    tax_amount: totalTax,
                    total,
                    currency: currency || baseCurrency,
                    notes: notes || null,
                    payment_terms: paymentTerms,
                    income_category_id: incomeCategoryId || null,
                };

                const { error: recurringError } = await supabase
                    .from("recurring_invoices")
                    .insert({
                        user_id: effectiveUserId,
                        invoice_id: newInvoice.id,
                        client_id: clientId,
                        template_data: templateData,
                        frequency,
                        next_date: calculateNextDate(invoiceDate, frequency),
                        end_date: recurringEndDate || null,
                        is_active: true,
                    });

                if (recurringError) {
                    console.error("[createInvoice] Recurring insert error:", recurringError);
                } else {
                    recurringCreated = true;
                    console.log("[createInvoice] Recurring schedule created");
                }
            }

            const recurringMsg = recurringCreated ? ` Set to recur ${frequency}! 🔁` : "";

            return {
                status: "success",
                invoice: {
                    id: newInvoice.id,
                    number: newInvoice.invoice_number,
                    total: newInvoice.total,
                    currency: currency || baseCurrency,
                    isRecurring: recurringCreated,
                    frequency: recurringCreated ? frequency : undefined,
                },
                message: `Invoice ${newInvoice.invoice_number} created for ${client?.name}!${recurringMsg}`,
            };
        } catch (error) {
            console.error("[createInvoice] Error:", error);
            return { status: "error", error: "Failed to create invoice" };
        }
    },
});

// ============================================
// MARK INVOICE PAID TOOL
// ============================================

export const markInvoicePaid = tool({
    description: `
Record a payment on an invoice. Preview first (confirmed=false), save after user confirms (confirmed=true).

FLOW:
1. confirmed=false → Returns preview of payment (NOT saved)
2. Show preview to user, wait for "confirm"
3. confirmed=true → Records payment and updates invoice
    `,

    inputSchema: z.object({
        invoiceId: z.string().uuid().optional().describe("Invoice UUID"),
        invoiceNumber: z.string().optional().describe("Invoice number like INV-001"),
        paymentAmount: z.number().positive().optional().describe("Amount paid, default: full balance"),
        paymentDate: z.string().optional().describe("Payment date YYYY-MM-DD, default: today"),
        paymentMethod: z.string().optional().describe("Payment method (bank, cash, etc)"),
        referenceNumber: z.string().optional().describe("Payment reference"),
        confirmed: z.boolean().describe("false=preview, true=save"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [markInvoicePaid] TOOL CALLED ==========");
        console.log("[markInvoicePaid] Input:", JSON.stringify(input, null, 2));

        const { invoiceId, invoiceNumber, paymentAmount, paymentDate, paymentMethod, referenceNumber, confirmed, userId } = input;

        try {
            const effectiveUserId = await getEffectiveUserId(userId);

            // Find invoice
            let query = supabase
                .from("invoices")
                .select("id, invoice_number, total, balance_due, status, currency, client_id, clients(name)")
                .eq("user_id", effectiveUserId)
                .is("deleted_at", null);

            if (invoiceId) {
                query = query.eq("id", invoiceId);
            } else if (invoiceNumber) {
                query = query.eq("invoice_number", invoiceNumber);
            } else {
                return { status: "error", error: "Please provide invoice ID or number" };
            }

            const { data: invoice, error } = await query.single();

            if (error || !invoice) {
                return { status: "not_found", error: "Invoice not found" };
            }

            if (invoice.status === "paid") {
                return { status: "already_paid", message: `Invoice ${invoice.invoice_number} is already fully paid.` };
            }

            const currentBalance = invoice.balance_due || invoice.total;
            const amount = paymentAmount || currentBalance;
            const paidDate = paymentDate || new Date().toISOString().split("T")[0];

            if (amount > currentBalance) {
                return {
                    status: "error",
                    error: `Payment amount (${amount}) exceeds balance due (${currentBalance})`,
                };
            }

            const clientName = (invoice as any).clients?.name || "client";
            const newBalance = currentBalance - amount;
            const newStatus = newBalance <= 0 ? "paid" : "partially_paid";

            // PREVIEW MODE
            if (!confirmed) {
                return {
                    status: "preview",
                    preview: {
                        invoiceNumber: invoice.invoice_number,
                        client: clientName,
                        currentBalance,
                        paymentAmount: amount,
                        paymentDate: paidDate,
                        paymentMethod: paymentMethod || "Not specified",
                        newBalance: Math.max(0, newBalance),
                        newStatus,
                        currency: invoice.currency,
                    },
                    message: `Ready to record payment of ${amount} ${invoice.currency} for invoice ${invoice.invoice_number}. New status will be: ${newStatus}. Say 'confirm' to proceed!`,
                };
            }

            // SAVE MODE
            console.log("[markInvoicePaid] SAVE MODE - recording payment");

            // Record payment
            const { error: paymentError } = await supabase
                .from("invoice_payments")
                .insert({
                    invoice_id: invoice.id,
                    user_id: effectiveUserId,
                    amount,
                    payment_date: paidDate,
                    payment_method: paymentMethod || null,
                    reference_number: referenceNumber || null,
                });

            if (paymentError) {
                console.error("[markInvoicePaid] Payment insert error:", paymentError);
                return { status: "error", error: "Failed to record payment" };
            }

            // Update invoice
            const newAmountPaid = (invoice.total - currentBalance) + amount;

            const { error: updateError } = await supabase
                .from("invoices")
                .update({
                    status: newStatus,
                    amount_paid: newAmountPaid,
                    balance_due: Math.max(0, newBalance),
                    paid_date: newStatus === "paid" ? paidDate : null,
                    actual_paid_date: newStatus === "paid" ? paidDate : null,
                    payment_locked_at: new Date().toISOString(),
                })
                .eq("id", invoice.id);

            if (updateError) {
                console.error("[markInvoicePaid] Update error:", updateError);
            }

            console.log("[markInvoicePaid] Payment recorded:", invoice.invoice_number);

            return {
                status: "success",
                result: {
                    invoiceNumber: invoice.invoice_number,
                    amountPaid: amount,
                    newBalance: Math.max(0, newBalance),
                    newStatus,
                    currency: invoice.currency,
                },
                message: newStatus === "paid"
                    ? `Invoice ${invoice.invoice_number} marked as fully paid! 🎉`
                    : `Payment of ${amount} recorded. Balance remaining: ${newBalance}`,
            };
        } catch (error) {
            console.error("[markInvoicePaid] Error:", error);
            return { status: "error", error: "Failed to record payment" };
        }
    },
});

// ============================================
// SEND INVOICE EMAIL TOOL
// ============================================

export const sendInvoiceEmail = tool({
    description: `
Send invoice email to client. Preview first (confirmed=false), send after user confirms (confirmed=true).

FLOW:
1. confirmed=false → Returns preview of email (NOT sent)
2. Show preview to user, wait for "confirm"
3. confirmed=true → Sends email via Resend API

REQUIRED: Invoice must exist and client must have email address.
    `,

    inputSchema: z.object({
        invoiceId: z.string().uuid().optional().describe("Invoice UUID"),
        invoiceNumber: z.string().optional().describe("Invoice number like INV-001"),
        customMessage: z.string().optional().describe("Optional custom message for email body"),
        ccEmails: z.array(z.string()).optional().describe("Optional CC email addresses"),
        attachPdf: z.boolean().optional().default(false).describe("Attach PDF to email"),
        confirmed: z.boolean().describe("false=preview, true=send"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [sendInvoiceEmail] TOOL CALLED ==========");
        console.log("[sendInvoiceEmail] Input:", JSON.stringify(input, null, 2));

        const { invoiceId, invoiceNumber, customMessage, ccEmails, attachPdf, confirmed, userId } = input;

        try {
            const effectiveUserId = await getEffectiveUserId(userId);

            // Find invoice
            let query = supabase
                .from("invoices")
                .select(`
                    id,
                    invoice_number,
                    total,
                    currency,
                    date,
                    due_date,
                    status,
                    client_id,
                    clients (id, name, email, company_name)
                `)
                .eq("user_id", effectiveUserId)
                .is("deleted_at", null);

            if (invoiceId) {
                query = query.eq("id", invoiceId);
            } else if (invoiceNumber) {
                query = query.eq("invoice_number", invoiceNumber);
            } else {
                return { status: "error", error: "Please provide invoice ID or number" };
            }

            const { data: invoice, error } = await query.single();

            if (error || !invoice) {
                return { status: "not_found", error: "Invoice not found" };
            }

            const client = invoice.clients as any;
            if (!client?.email) {
                return {
                    status: "error",
                    error: `No email address found for client "${client?.name || 'Unknown'}". Please update client email first.`,
                };
            }

            // PREVIEW MODE
            if (!confirmed) {
                return {
                    status: "preview",
                    preview: {
                        invoiceNumber: invoice.invoice_number,
                        client: client.name,
                        clientEmail: client.email,
                        amount: invoice.total,
                        currency: invoice.currency,
                        dueDate: invoice.due_date,
                        ccEmails: ccEmails || [],
                        attachPdf: attachPdf || false,
                        customMessage: customMessage || "Thank you for your business! Please find your invoice details below.",
                    },
                    message: `Ready to send invoice ${invoice.invoice_number} (${invoice.total} ${invoice.currency}) to ${client.name} at ${client.email}. Say 'confirm' to send!`,
                };
            }

            // SEND MODE
            console.log("[sendInvoiceEmail] SEND MODE - calling API proxy");

            // Call our Next.js API route which proxies to Edge Function
            // Using absolute URL for server-side fetch
            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
            const response = await fetch(
                `${baseUrl}/api/invoice-email`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        invoiceId: invoice.id,
                        recipientEmail: client.email,
                        ccEmails: ccEmails || [],
                        subject: `Invoice ${invoice.invoice_number}`,
                        message: customMessage,
                        attachPdf: attachPdf || false,
                        userId: effectiveUserId,
                    }),
                }
            );

            const result = await response.json();

            if (!response.ok) {
                console.error("[sendInvoiceEmail] Edge function error:", result);
                return {
                    status: "error",
                    error: result.error || "Failed to send email",
                };
            }

            console.log("[sendInvoiceEmail] Email sent successfully:", result);

            return {
                status: "success",
                result: {
                    invoiceNumber: invoice.invoice_number,
                    sentTo: client.email,
                    amount: invoice.total,
                    currency: invoice.currency,
                },
                message: `Invoice ${invoice.invoice_number} sent to ${client.name} at ${client.email}! 📧`,
            };
        } catch (error) {
            console.error("[sendInvoiceEmail] Error:", error);
            return { status: "error", error: "Failed to send invoice email" };
        }
    },
});

// ============================================
// GET RECURRING INVOICES TOOL
// ============================================

export const getRecurringInvoices = tool({
    description: `
Get user's recurring invoice schedules.
Use to list active or all recurring invoices.
    `,

    inputSchema: z.object({
        isActive: z.boolean().optional().describe("Filter: true=active only, false=paused only, undefined=all"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [getRecurringInvoices] TOOL CALLED ==========");
        console.log("[getRecurringInvoices] Input:", JSON.stringify(input, null, 2));

        const { isActive, userId } = input;

        try {
            const effectiveUserId = await getEffectiveUserId(userId);

            let query = supabase
                .from("recurring_invoices")
                .select(`
                    id,
                    frequency,
                    next_date,
                    end_date,
                    is_active,
                    created_at,
                    template_data,
                    client_id,
                    clients (id, name, company_name)
                `)
                .eq("user_id", effectiveUserId)
                .order("next_date", { ascending: true });

            if (isActive !== undefined) {
                query = query.eq("is_active", isActive);
            }

            const { data: recurring, error } = await query;

            if (error) {
                console.error("[getRecurringInvoices] Error:", error);
                return { status: "error", error: "Failed to fetch recurring invoices" };
            }

            const result = (recurring || []).map((r: any) => ({
                id: r.id,
                client: r.clients?.name || "Unknown",
                clientCompany: r.clients?.company_name,
                frequency: r.frequency,
                nextDate: r.next_date,
                endDate: r.end_date,
                isActive: r.is_active,
                amount: r.template_data?.total || 0,
                currency: r.template_data?.currency || "USD",
            }));

            return {
                status: "success",
                recurring: result,
                count: result.length,
                activeCount: result.filter(r => r.isActive).length,
            };
        } catch (error) {
            console.error("[getRecurringInvoices] Error:", error);
            return { status: "error", error: "Failed to get recurring invoices" };
        }
    },
});

// ============================================
// TOGGLE RECURRING INVOICE TOOL
// ============================================

export const toggleRecurring = tool({
    description: `
Pause or resume a recurring invoice. Preview first (confirmed=false), then confirm.

FLOW:
1. confirmed=false → Returns preview of action
2. Show preview to user, wait for "confirm"
3. confirmed=true → Updates is_active status
    `,

    inputSchema: z.object({
        recurringId: z.string().uuid().describe("Recurring invoice UUID"),
        isActive: z.boolean().describe("true=resume, false=pause"),
        confirmed: z.boolean().describe("false=preview, true=execute"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [toggleRecurring] TOOL CALLED ==========");
        console.log("[toggleRecurring] Input:", JSON.stringify(input, null, 2));

        const { recurringId, isActive, confirmed, userId } = input;

        try {
            const effectiveUserId = await getEffectiveUserId(userId);

            // Find recurring invoice
            const { data: recurring, error } = await supabase
                .from("recurring_invoices")
                .select(`
                    id,
                    frequency,
                    next_date,
                    is_active,
                    template_data,
                    clients (name)
                `)
                .eq("id", recurringId)
                .eq("user_id", effectiveUserId)
                .single();

            if (error || !recurring) {
                return { status: "not_found", error: "Recurring invoice not found" };
            }

            const clientName = (recurring as any).clients?.name || "Unknown";
            const action = isActive ? "resume" : "pause";

            // PREVIEW MODE
            if (!confirmed) {
                return {
                    status: "preview",
                    preview: {
                        recurringId: recurring.id,
                        client: clientName,
                        frequency: recurring.frequency,
                        nextDate: recurring.next_date,
                        currentStatus: recurring.is_active ? "Active" : "Paused",
                        newStatus: isActive ? "Active" : "Paused",
                        action,
                    },
                    message: `Ready to ${action} recurring invoice for ${clientName} (${recurring.frequency}). Say 'confirm' to proceed!`,
                };
            }

            // EXECUTE MODE
            console.log("[toggleRecurring] Updating status to:", isActive);

            const { error: updateError } = await supabase
                .from("recurring_invoices")
                .update({
                    is_active: isActive,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", recurringId);

            if (updateError) {
                console.error("[toggleRecurring] Update error:", updateError);
                return { status: "error", error: "Failed to update recurring invoice" };
            }

            console.log("[toggleRecurring] Status updated successfully");

            return {
                status: "success",
                result: {
                    recurringId: recurring.id,
                    client: clientName,
                    newStatus: isActive ? "Active" : "Paused",
                },
                message: isActive
                    ? `Recurring invoice for ${clientName} resumed! ▶️`
                    : `Recurring invoice for ${clientName} paused! ⏸️`,
            };
        } catch (error) {
            console.error("[toggleRecurring] Error:", error);
            return { status: "error", error: "Failed to toggle recurring invoice" };
        }
    },
});

// ============================================
// DELETE RECURRING INVOICE TOOL
// ============================================

export const deleteRecurring = tool({
    description: `
Cancel/delete a recurring invoice schedule. Preview first (confirmed=false), then confirm.
Note: This only stops future generations. Already-created invoices are kept.

FLOW:
1. confirmed=false → Returns preview with warning
2. Show preview to user, wait for "confirm"
3. confirmed=true → Deletes recurring schedule
    `,

    inputSchema: z.object({
        recurringId: z.string().uuid().describe("Recurring invoice UUID"),
        confirmed: z.boolean().describe("false=preview, true=delete"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [deleteRecurring] TOOL CALLED ==========");
        console.log("[deleteRecurring] Input:", JSON.stringify(input, null, 2));

        const { recurringId, confirmed, userId } = input;

        try {
            const effectiveUserId = await getEffectiveUserId(userId);

            // Find recurring invoice
            const { data: recurring, error } = await supabase
                .from("recurring_invoices")
                .select(`
                    id,
                    frequency,
                    next_date,
                    template_data,
                    clients (name)
                `)
                .eq("id", recurringId)
                .eq("user_id", effectiveUserId)
                .single();

            if (error || !recurring) {
                return { status: "not_found", error: "Recurring invoice not found" };
            }

            const clientName = (recurring as any).clients?.name || "Unknown";

            // PREVIEW MODE
            if (!confirmed) {
                return {
                    status: "preview",
                    preview: {
                        recurringId: recurring.id,
                        client: clientName,
                        frequency: recurring.frequency,
                        nextDate: recurring.next_date,
                        amount: recurring.template_data?.total || 0,
                        currency: recurring.template_data?.currency || "USD",
                    },
                    message: `⚠️ This will permanently cancel the ${recurring.frequency} recurring invoice for ${clientName}. Already-created invoices will be kept. Say 'confirm' to proceed.`,
                };
            }

            // DELETE MODE
            console.log("[deleteRecurring] Deleting recurring invoice");

            const { error: deleteError } = await supabase
                .from("recurring_invoices")
                .delete()
                .eq("id", recurringId);

            if (deleteError) {
                console.error("[deleteRecurring] Delete error:", deleteError);
                return { status: "error", error: "Failed to delete recurring invoice" };
            }

            console.log("[deleteRecurring] Deleted successfully");

            return {
                status: "success",
                result: {
                    recurringId: recurring.id,
                    client: clientName,
                },
                message: `Recurring invoice for ${clientName} cancelled. Past invoices are kept. 🗑️`,
            };
        } catch (error) {
            console.error("[deleteRecurring] Error:", error);
            return { status: "error", error: "Failed to delete recurring invoice" };
        }
    },
});

// ============================================
// GET INVOICE TEMPLATES TOOL
// ============================================

export const getInvoiceTemplates = tool({
    description: `
Get user's saved invoice templates.
Use to list available templates for quick invoice creation.
    `,

    inputSchema: z.object({
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [getInvoiceTemplates] TOOL CALLED ==========");
        console.log("[getInvoiceTemplates] Input:", JSON.stringify(input, null, 2));

        const { userId } = input;

        try {
            const effectiveUserId = await getEffectiveUserId(userId);

            const { data: templates, error } = await supabase
                .from("invoice_templates")
                .select("*")
                .eq("user_id", effectiveUserId)
                .order("created_at", { ascending: false });

            if (error) {
                console.error("[getInvoiceTemplates] Error:", error);
                return { status: "error", error: "Failed to fetch templates" };
            }

            const result = (templates || []).map((t: any) => ({
                id: t.id,
                name: t.name,
                itemCount: t.template_data?.items?.length || 0,
                total: t.template_data?.total || 0,
                currency: t.template_data?.currency || "USD",
                taxRate: t.template_data?.tax_rate || 0,
            }));

            return {
                status: "success",
                templates: result,
                count: result.length,
            };
        } catch (error) {
            console.error("[getInvoiceTemplates] Error:", error);
            return { status: "error", error: "Failed to get templates" };
        }
    },
});

// ============================================
// CREATE FROM TEMPLATE TOOL
// ============================================

export const createFromTemplate = tool({
    description: `
Create a new invoice from a saved template. Preview first (confirmed=false), then confirm.

FLOW:
1. confirmed=false → Returns preview with template data
2. Show preview to user, wait for "confirm"
3. confirmed=true → Creates invoice using template
    `,

    inputSchema: z.object({
        templateId: z.string().uuid().describe("Template UUID"),
        clientId: z.string().uuid().describe("Client ID for the new invoice"),
        date: z.string().optional().describe("Invoice date YYYY-MM-DD, default today"),
        confirmed: z.boolean().describe("false=preview, true=create"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [createFromTemplate] TOOL CALLED ==========");
        console.log("[createFromTemplate] Input:", JSON.stringify(input, null, 2));

        const { templateId, clientId, date, confirmed, userId } = input;

        try {
            const effectiveUserId = await getEffectiveUserId(userId);

            // Get template
            const { data: template, error: templateError } = await supabase
                .from("invoice_templates")
                .select("*")
                .eq("id", templateId)
                .eq("user_id", effectiveUserId)
                .single();

            if (templateError || !template) {
                return { status: "not_found", error: "Template not found" };
            }

            // Get client
            const { data: client } = await supabase
                .from("clients")
                .select("name, company_name")
                .eq("id", clientId)
                .single();

            const templateData = template.template_data;
            const invoiceDate = date || new Date().toISOString().split("T")[0];

            // Get invoice settings
            const { data: invoiceSettings } = await supabase
                .from("invoice_settings")
                .select("payment_terms")
                .eq("user_id", effectiveUserId)
                .single();

            const paymentTerms = invoiceSettings?.payment_terms || 30;
            const dueDate = new Date(
                new Date(invoiceDate).getTime() + paymentTerms * 24 * 60 * 60 * 1000
            ).toISOString().split("T")[0];

            // PREVIEW MODE
            if (!confirmed) {
                return {
                    status: "preview",
                    preview: {
                        templateName: template.name,
                        client: client?.name || "Unknown",
                        date: invoiceDate,
                        dueDate,
                        items: templateData.items || [],
                        subtotal: templateData.subtotal || 0,
                        taxAmount: templateData.tax_amount || 0,
                        total: templateData.total || 0,
                        currency: templateData.currency || "USD",
                    },
                    message: `Ready to create invoice from template "${template.name}" for ${client?.name}. Say 'confirm' to create!`,
                };
            }

            // CREATE MODE - Call createInvoice logic
            console.log("[createFromTemplate] Creating invoice from template");

            // Get invoice number
            let invoiceNumber: string;
            try {
                const { data: rpcNumber, error: rpcError } = await supabase
                    .rpc("get_next_invoice_number", { p_user_id: effectiveUserId });
                if (rpcError) throw rpcError;
                invoiceNumber = rpcNumber;
            } catch {
                invoiceNumber = `INV-${Date.now()}`;
            }

            // Get user settings
            const { data: userSettings } = await supabase
                .from("user_settings")
                .select("base_currency")
                .eq("user_id", effectiveUserId)
                .single();

            const baseCurrency = userSettings?.base_currency || "USD";

            // Insert invoice
            const { data: newInvoice, error: invoiceError } = await supabase
                .from("invoices")
                .insert({
                    user_id: effectiveUserId,
                    invoice_number: invoiceNumber,
                    client_id: clientId,
                    date: invoiceDate,
                    due_date: dueDate,
                    status: "draft",
                    subtotal: templateData.subtotal || 0,
                    tax_rate: templateData.tax_rate || 0,
                    tax_amount: templateData.tax_amount || 0,
                    total: templateData.total || 0,
                    balance_due: templateData.total || 0,
                    currency: templateData.currency || baseCurrency,
                    notes: templateData.notes || null,
                    income_category_id: templateData.income_category_id || null,
                    exchange_rate: 1,
                    base_amount: templateData.subtotal || 0,
                })
                .select("id, invoice_number, total")
                .single();

            if (invoiceError) {
                console.error("[createFromTemplate] Invoice error:", invoiceError);
                return { status: "error", error: "Failed to create invoice" };
            }

            // Insert items
            if (templateData.items && templateData.items.length > 0) {
                const itemsToInsert = templateData.items.map((item: any) => ({
                    invoice_id: newInvoice.id,
                    description: item.description,
                    quantity: item.quantity,
                    rate: item.rate,
                    amount: item.amount || item.net_amount,
                    tax_rate: item.tax_rate || 0,
                    tax_amount: item.tax_amount || 0,
                    net_amount: item.net_amount || item.amount,
                    gross_amount: item.gross_amount || item.amount,
                }));

                await supabase.from("invoice_items").insert(itemsToInsert);
            }

            // Update invoice number
            const { data: currentSettings } = await supabase
                .from("invoice_settings")
                .select("next_number")
                .eq("user_id", effectiveUserId)
                .single();

            if (currentSettings) {
                await supabase
                    .from("invoice_settings")
                    .update({ next_number: (currentSettings.next_number || 1) + 1 })
                    .eq("user_id", effectiveUserId);
            }

            console.log("[createFromTemplate] Invoice created:", newInvoice.invoice_number);

            return {
                status: "success",
                invoice: {
                    id: newInvoice.id,
                    number: newInvoice.invoice_number,
                    total: newInvoice.total,
                    currency: templateData.currency || baseCurrency,
                },
                message: `Invoice ${newInvoice.invoice_number} created from template "${template.name}"! 📋`,
            };
        } catch (error) {
            console.error("[createFromTemplate] Error:", error);
            return { status: "error", error: "Failed to create invoice from template" };
        }
    },
});

// ============================================
// SAVE AS TEMPLATE TOOL
// ============================================

export const saveAsTemplate = tool({
    description: `
Save an existing invoice as a reusable template.
Use when user wants to save an invoice for future use.
    `,

    inputSchema: z.object({
        invoiceId: z.string().uuid().optional().describe("Invoice UUID"),
        invoiceNumber: z.string().optional().describe("Invoice number like INV-001"),
        templateName: z.string().describe("Name for the template"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [saveAsTemplate] TOOL CALLED ==========");
        console.log("[saveAsTemplate] Input:", JSON.stringify(input, null, 2));

        const { invoiceId, invoiceNumber, templateName, userId } = input;

        try {
            const effectiveUserId = await getEffectiveUserId(userId);

            // Find invoice
            let query = supabase
                .from("invoices")
                .select(`
                    *,
                    invoice_items (*)
                `)
                .eq("user_id", effectiveUserId)
                .is("deleted_at", null);

            if (invoiceId) {
                query = query.eq("id", invoiceId);
            } else if (invoiceNumber) {
                query = query.eq("invoice_number", invoiceNumber);
            } else {
                return { status: "error", error: "Please provide invoice ID or number" };
            }

            const { data: invoice, error } = await query.single();

            if (error || !invoice) {
                return { status: "not_found", error: "Invoice not found" };
            }

            // Create template data
            const templateData = {
                items: invoice.invoice_items || [],
                subtotal: invoice.subtotal,
                tax_rate: invoice.tax_rate,
                tax_amount: invoice.tax_amount,
                total: invoice.total,
                currency: invoice.currency,
                notes: invoice.notes,
                payment_terms: invoice.payment_terms,
                income_category_id: invoice.income_category_id,
            };

            // Insert template
            const { data: newTemplate, error: insertError } = await supabase
                .from("invoice_templates")
                .insert({
                    user_id: effectiveUserId,
                    name: templateName,
                    template_data: templateData,
                })
                .select("id, name")
                .single();

            if (insertError) {
                console.error("[saveAsTemplate] Insert error:", insertError);
                return { status: "error", error: "Failed to save template" };
            }

            console.log("[saveAsTemplate] Template saved:", newTemplate.name);

            return {
                status: "success",
                template: {
                    id: newTemplate.id,
                    name: newTemplate.name,
                },
                message: `Template "${templateName}" saved from invoice ${invoice.invoice_number}! ✅`,
            };
        } catch (error) {
            console.error("[saveAsTemplate] Error:", error);
            return { status: "error", error: "Failed to save template" };
        }
    },
});

// ============================================
// UPDATE INVOICE TOOL
// ============================================

export const updateInvoice = tool({
    description: `
Update an existing invoice. Preview first (confirmed=false), then confirm.

EDITABLE: date, due_date, notes
NOTE: To edit items, create a new invoice. This tool is for metadata changes only.

⚠️ HMRC COMPLIANCE: Paid invoices CANNOT be modified or deleted.
    `,

    inputSchema: z.object({
        invoiceId: z.string().uuid().optional().describe("Invoice UUID"),
        invoiceNumber: z.string().optional().describe("Invoice number like INV-001"),
        date: z.string().optional().describe("New invoice date YYYY-MM-DD"),
        dueDate: z.string().optional().describe("New due date YYYY-MM-DD"),
        notes: z.string().optional().describe("New notes"),
        confirmed: z.boolean().describe("false=preview, true=save"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [updateInvoice] TOOL CALLED ==========");
        console.log("[updateInvoice] Input:", JSON.stringify(input, null, 2));

        const { invoiceId, invoiceNumber, date, dueDate, notes, confirmed, userId } = input;

        try {
            const effectiveUserId = await getEffectiveUserId(userId);

            // Find invoice
            let query = supabase
                .from("invoices")
                .select("*")
                .eq("user_id", effectiveUserId)
                .is("deleted_at", null);

            if (invoiceId) {
                query = query.eq("id", invoiceId);
            } else if (invoiceNumber) {
                query = query.eq("invoice_number", invoiceNumber);
            } else {
                return { status: "error", error: "Please provide invoice ID or number" };
            }

            const { data: existing, error: fetchError } = await query.single();

            if (fetchError || !existing) {
                return { status: "not_found", error: "Invoice not found" };
            }

            // HMRC Compliance: Paid invoices cannot be modified
            if (existing.status === "paid") {
                return {
                    status: "blocked",
                    error: "⚠️ Cannot modify paid invoice",
                    reason: "Once an invoice is marked as paid, it cannot be edited or deleted for HMRC compliance. This ensures your financial records remain accurate for tax purposes.",
                    suggestion: "If you need to make corrections, create a credit note or a new invoice instead.",
                };
            }

            // Build changes
            const changes: Record<string, any> = {};
            const preview: Record<string, { old: any; new: any }> = {};

            if (date !== undefined && date !== existing.date) {
                changes.date = date;
                preview.date = { old: existing.date, new: date };
            }
            if (dueDate !== undefined && dueDate !== existing.due_date) {
                changes.due_date = dueDate;
                preview.dueDate = { old: existing.due_date, new: dueDate };
            }
            if (notes !== undefined && notes !== existing.notes) {
                changes.notes = notes;
                preview.notes = { old: existing.notes || "None", new: notes };
            }

            if (Object.keys(changes).length === 0) {
                return { status: "no_changes", message: "No changes to apply." };
            }

            // PREVIEW MODE
            if (!confirmed) {
                return {
                    status: "preview",
                    preview: {
                        invoiceNumber: existing.invoice_number,
                        changes: preview,
                    },
                    message: `Review changes for ${existing.invoice_number}. Say 'confirm' to apply.`,
                };
            }

            // SAVE MODE
            const { error: updateError } = await supabase
                .from("invoices")
                .update(changes)
                .eq("id", existing.id);

            if (updateError) {
                return { status: "error", error: "Failed to update invoice" };
            }

            return {
                status: "success",
                message: `Invoice ${existing.invoice_number} updated successfully! ✅`,
            };
        } catch (error) {
            return { status: "error", error: "Failed to update invoice" };
        }
    },
});

// ============================================
// UPDATE RECURRING TOOL
// ============================================

export const updateRecurring = tool({
    description: `
Update a recurring invoice schedule. Preview first (confirmed=false), then confirm.

EDITABLE: frequency, next_invoice_date, end_date
    `,

    inputSchema: z.object({
        recurringId: z.string().uuid().describe("Recurring schedule ID"),
        frequency: z.enum(["weekly", "biweekly", "monthly", "quarterly", "yearly"]).optional(),
        nextDate: z.string().optional().describe("Next invoice date YYYY-MM-DD"),
        endDate: z.string().optional().describe("End date YYYY-MM-DD (null to remove)"),
        confirmed: z.boolean().describe("false=preview, true=save"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [updateRecurring] TOOL CALLED ==========");
        console.log("[updateRecurring] Input:", JSON.stringify(input, null, 2));

        const { recurringId, frequency, nextDate, endDate, confirmed, userId } = input;

        try {
            const effectiveUserId = await getEffectiveUserId(userId);

            // Get existing
            const { data: existing, error: fetchError } = await supabase
                .from("recurring_invoices")
                .select("*")
                .eq("id", recurringId)
                .eq("user_id", effectiveUserId)
                .single();

            if (fetchError || !existing) {
                return { status: "not_found", error: "Recurring schedule not found" };
            }

            // Build changes
            const changes: Record<string, any> = {};
            const preview: Record<string, { old: any; new: any }> = {};

            if (frequency !== undefined && frequency !== existing.frequency) {
                changes.frequency = frequency;
                preview.frequency = { old: existing.frequency, new: frequency };
            }
            if (nextDate !== undefined && nextDate !== existing.next_invoice_date) {
                changes.next_invoice_date = nextDate;
                preview.nextDate = { old: existing.next_invoice_date, new: nextDate };
            }
            if (endDate !== undefined) {
                changes.end_date = endDate || null;
                preview.endDate = { old: existing.end_date || "Never", new: endDate || "Never" };
            }

            if (Object.keys(changes).length === 0) {
                return { status: "no_changes", message: "No changes to apply." };
            }

            // PREVIEW MODE
            if (!confirmed) {
                return {
                    status: "preview",
                    preview: {
                        recurringId: existing.id,
                        changes: preview,
                    },
                    message: "Review the changes. Say 'confirm' to apply.",
                };
            }

            // SAVE MODE
            const { error: updateError } = await supabase
                .from("recurring_invoices")
                .update(changes)
                .eq("id", recurringId);

            if (updateError) {
                return { status: "error", error: "Failed to update recurring schedule" };
            }

            return {
                status: "success",
                message: `Recurring schedule updated successfully! ✅`,
            };
        } catch (error) {
            return { status: "error", error: "Failed to update recurring" };
        }
    },
});

// ============================================
// UPDATE TEMPLATE TOOL
// ============================================

export const updateTemplate = tool({
    description: `
Update an invoice template name.
    `,

    inputSchema: z.object({
        templateId: z.string().uuid().describe("Template ID to update"),
        name: z.string().describe("New template name"),
        userId: z.string().uuid().describe("User ID from session"),
    }),

    execute: async (input) => {
        console.log("\n========== [updateTemplate] TOOL CALLED ==========");
        console.log("[updateTemplate] Input:", JSON.stringify(input, null, 2));

        const { templateId, name, userId } = input;

        try {
            const effectiveUserId = await getEffectiveUserId(userId);

            // Get existing
            const { data: existing, error: fetchError } = await supabase
                .from("invoice_templates")
                .select("*")
                .eq("id", templateId)
                .eq("user_id", effectiveUserId)
                .single();

            if (fetchError || !existing) {
                return { status: "not_found", error: "Template not found" };
            }

            // Update
            const { error: updateError } = await supabase
                .from("invoice_templates")
                .update({ name })
                .eq("id", templateId);

            if (updateError) {
                return { status: "error", error: "Failed to update template" };
            }

            return {
                status: "success",
                message: `Template renamed from "${existing.name}" to "${name}"! ✅`,
            };
        } catch (error) {
            return { status: "error", error: "Failed to update template" };
        }
    },
});

// ============================================
// EXPORT
// ============================================

export const invoiceTools = {
    getInvoices,
    getInvoiceById,
    getOverdueInvoices,
    createInvoice,
    markInvoicePaid,
    sendInvoiceEmail,
    getRecurringInvoices,
    toggleRecurring,
    deleteRecurring,
    getInvoiceTemplates,
    createFromTemplate,
    saveAsTemplate,
    updateInvoice,
    updateRecurring,
    updateTemplate,
};
