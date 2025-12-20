// User Context Fetcher
// Fetches user settings from profiles, user_settings, and invoice_settings tables

import { supabase } from "@/lib/supabase/client";
import type { UserContext } from "@/lib/ai/prompts";

/**
 * Fetch user context from database for AI system prompt
 * This data is injected into the prompt so AI knows user's settings
 */
export async function getUserContext(userId: string): Promise<UserContext> {
    try {
        // Fetch profile
        const { data: profile } = await supabase
            .from("profiles")
            .select("full_name, company_name, company_address, email")
            .eq("id", userId)
            .single();

        // Fetch user settings
        const { data: settings } = await supabase
            .from("user_settings")
            .select(`
        base_currency,
        enabled_currencies,
        country,
        time_zone,
        is_tax_registered,
        vat_scheme,
        uk_vat_scheme
      `)
            .eq("user_id", userId)
            .single();

        // Fetch invoice settings
        const { data: invoiceSettings } = await supabase
            .from("invoice_settings")
            .select(`
        default_tax_rate,
        invoice_prefix,
        payment_terms,
        invoice_notes,
        invoice_footer
      `)
            .eq("user_id", userId)
            .single();

        // Build user context object
        const userContext: UserContext = {
            // User ID - IMPORTANT for tools
            userId: userId,

            // Profile
            userName: profile?.full_name || undefined,
            companyName: profile?.company_name || undefined,
            companyAddress: profile?.company_address || undefined,
            businessEmail: profile?.email || undefined,

            // Currency
            baseCurrency: settings?.base_currency || "USD",
            enabledCurrencies: Array.isArray(settings?.enabled_currencies)
                ? settings.enabled_currencies
                : [settings?.base_currency || "USD"],

            // Tax
            defaultTaxRate: invoiceSettings?.default_tax_rate || 0,
            taxType: determineTaxType(settings?.country),
            isTaxRegistered: settings?.is_tax_registered || false,
            taxScheme: settings?.vat_scheme || settings?.uk_vat_scheme || "standard",

            // Invoice defaults
            invoicePrefix: invoiceSettings?.invoice_prefix || "INV-",
            paymentTerms: invoiceSettings?.payment_terms || 30,
            invoiceNotes: invoiceSettings?.invoice_notes || undefined,
            invoiceFooter: invoiceSettings?.invoice_footer || undefined,

            // Location
            country: settings?.country || undefined,
            timezone: settings?.time_zone || "UTC",
        };

        return userContext;
    } catch (error) {
        console.error("Error fetching user context:", error);
        // Return minimal defaults
        return {
            userId: userId,
            baseCurrency: "USD",
            enabledCurrencies: ["USD"],
            defaultTaxRate: 0,
            isTaxRegistered: false,
        };
    }
}

/**
 * Determine tax type based on country
 */
function determineTaxType(country?: string): string {
    if (!country) return "Tax";

    const vatCountries = [
        "GB", "UK", "DE", "FR", "IT", "ES", "NL", "BE", "AT", "PL",
        "SE", "DK", "FI", "IE", "PT", "GR", "CZ", "RO", "HU"
    ];
    const gstCountries = ["AU", "NZ", "IN", "SG", "MY", "CA"];

    if (vatCountries.includes(country.toUpperCase())) return "VAT";
    if (gstCountries.includes(country.toUpperCase())) return "GST";
    if (country.toUpperCase() === "US") return "Sales Tax";

    return "Tax";
}
