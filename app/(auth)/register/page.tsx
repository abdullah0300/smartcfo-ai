"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { AuthForm } from "@/components/auth-form";
import { SubmitButton } from "@/components/submit-button";
import { toast } from "@/components/toast";
import { type RegisterActionState, register } from "../actions";

export default function Page() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [isSuccessful, setIsSuccessful] = useState(false);

  const [state, formAction] = useActionState<RegisterActionState, FormData>(
    register,
    {
      status: "idle",
    }
  );

  useEffect(() => {
    if (state.status === "user_exists") {
      toast({
        type: "error",
        description: "Account already exists! Please sign in instead.",
      });
    } else if (state.status === "failed") {
      toast({
        type: "error",
        description: "Registration is only available through SmartCFO app.",
      });
    } else if (state.status === "invalid_data") {
      toast({
        type: "error",
        description: "Failed validating your submission!",
      });
    } else if (state.status === "success") {
      setIsSuccessful(true);
      router.push("/");
      router.refresh();
    }
  }, [state.status, router]);

  const handleSubmit = (formData: FormData) => {
    setEmail(formData.get("email") as string);
    formAction(formData);
  };

  return (
    <div className="flex h-dvh w-screen items-start justify-center bg-background pt-12 md:items-center md:pt-0">
      <div className="flex w-full max-w-md flex-col gap-12 overflow-hidden rounded-2xl">
        <div className="flex flex-col items-center justify-center gap-2 px-4 text-center sm:px-16">
          <h3 className="font-semibold text-xl dark:text-zinc-50">SmartCFO Registration</h3>
          <p className="text-gray-500 text-sm dark:text-zinc-400">
            Please register through the main SmartCFO application
          </p>
        </div>
        <div className="px-4 sm:px-16">
          <p className="mt-4 text-center text-gray-600 text-sm dark:text-zinc-400">
            {"Already have an account? "}
            <Link
              className="font-semibold text-gray-800 hover:underline dark:text-zinc-200"
              href="/login"
            >
              Sign in
            </Link>
          </p>
          <p className="mt-4 text-center text-gray-600 text-sm dark:text-zinc-400">
            {"Need to create an account? Visit "}
            <a
              className="font-semibold text-gray-800 hover:underline dark:text-zinc-200"
              href="https://smartcfo.app"
              target="_blank"
              rel="noopener noreferrer"
            >
              SmartCFO
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
