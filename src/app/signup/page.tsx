import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getSessionUser } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage() {
  if (await getSessionUser()) redirect("/");
  return <AuthForm mode="signup" redirectTo="/profile" />;
}
