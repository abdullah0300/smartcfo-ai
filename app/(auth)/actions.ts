"use server";

import { z } from "zod";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

const authFormSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

// Create Supabase client for auth actions
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type LoginActionState = {
  status: "idle" | "in_progress" | "success" | "failed" | "invalid_data";
};

export const login = async (
  _: LoginActionState,
  formData: FormData
): Promise<LoginActionState> => {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    // Sign in with Supabase Auth
    const { data, error } = await supabase.auth.signInWithPassword({
      email: validatedData.email,
      password: validatedData.password,
    });

    if (error) {
      console.error("Supabase login error:", error.message);
      return { status: "failed" };
    }

    if (!data.session) {
      return { status: "failed" };
    }

    // Set cookies for server-side session
    const cookieStore = await cookies();

    cookieStore.set("sb-access-token", data.session.access_token, {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    cookieStore.set("sb-refresh-token", data.session.refresh_token, {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    // Also store user ID for easy access
    cookieStore.set("sb-user-id", data.user.id, {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
    });

    return { status: "success" };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: "invalid_data" };
    }

    console.error("Login error:", error);
    return { status: "failed" };
  }
};

export type RegisterActionState = {
  status:
  | "idle"
  | "in_progress"
  | "success"
  | "failed"
  | "user_exists"
  | "invalid_data";
};

export const register = async (
  _: RegisterActionState,
  formData: FormData
): Promise<RegisterActionState> => {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    // For SmartCFO, users should register through the main SmartCFO app
    // This AI chatbot only supports login with existing accounts
    console.log("Register attempt blocked - users must register through SmartCFO app");

    return {
      status: "failed"
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: "invalid_data" };
    }

    return { status: "failed" };
  }
};

// Logout action
export const logout = async (): Promise<{ success: boolean }> => {
  try {
    const cookieStore = await cookies();

    cookieStore.delete("sb-access-token");
    cookieStore.delete("sb-refresh-token");
    cookieStore.delete("sb-user-id");

    return { success: true };
  } catch (_error) {
    return { success: false };
  }
};
