"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, api } from "@/lib/api-client";
import { fieldErrors, loginSchema, signupSchema } from "@/lib/validation";
import { LogoIcon } from "./icons";
import { Button, Card, Field, controlClass } from "./ui";

/** Credentials created by `npm run db:setup`; only offered when that account exists. */
const DEMO = { email: "demo@example.com", password: "password123" };

export function AuthForm({
  mode,
  redirectTo,
  showDemo = false,
}: {
  mode: "login" | "signup";
  redirectTo: string;
  /** Pre-fill the demo account's credentials (only when it exists). */
  showDemo?: boolean;
}) {
  const router = useRouter();
  const isSignup = mode === "signup";
  const [name, setName] = useState("");
  const [email, setEmail] = useState(showDemo ? DEMO.email : "");
  const [password, setPassword] = useState(showDemo ? DEMO.password : "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = isSignup
      ? signupSchema.safeParse({ name, email, password })
      : loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }

    setSubmitting(true);
    setErrors({});
    setFormError(null);
    try {
      if (isSignup) await api.signup(name, email, password);
      else await api.login(email, password);
      router.replace(isSignup ? "/profile" : redirectTo);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && Object.keys(caught.details).length > 0) setErrors(caught.details);
      else setFormError(caught instanceof ApiError ? caught.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <LogoIcon className="size-11 text-indigo-600" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {isSignup ? "Create your ApplyPilot account" : "Sign in to ApplyPilot"}
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Find matching roles, get tailored cover letters, apply in one click.
            </p>
          </div>
        </div>

        <Card className="p-6">
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            {formError && (
              <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                {formError}
              </p>
            )}
            {isSignup && (
              <Field label="Name" htmlFor="name" error={errors.name}>
                <input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)}
                  className={controlClass(Boolean(errors.name))} />
              </Field>
            )}
            <Field label="Email" htmlFor="email" error={errors.email}>
              <input id="email" type="email" autoComplete="username" value={email}
                onChange={(e) => setEmail(e.target.value)} className={controlClass(Boolean(errors.email))} />
            </Field>
            <Field label="Password" htmlFor="password" error={errors.password}
              hint={isSignup ? "At least 8 characters" : undefined}>
              <input id="password" type="password" autoComplete={isSignup ? "new-password" : "current-password"}
                value={password} onChange={(e) => setPassword(e.target.value)}
                className={controlClass(Boolean(errors.password))} />
            </Field>
            <Button type="submit" variant="primary" loading={submitting} className="mt-1 w-full">
              {isSignup ? "Create account" : "Sign in"}
            </Button>
          </form>
        </Card>

        <p className="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
          {isSignup ? (
            <>Already have an account? <Link href="/login" className="font-medium text-indigo-600 hover:underline">Sign in</Link></>
          ) : (
            <>New here? <Link href="/signup" className="font-medium text-indigo-600 hover:underline">Create an account</Link></>
          )}
        </p>
        {showDemo && (
          <p className="mt-2 text-center text-xs text-slate-500 dark:text-slate-400">
            Demo account: <code className="font-mono">{DEMO.email}</code> / <code className="font-mono">{DEMO.password}</code>
          </p>
        )}
      </div>
    </div>
  );
}
