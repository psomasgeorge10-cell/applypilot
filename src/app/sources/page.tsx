import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { SourcesManager } from "@/components/SourcesManager";
import { getSessionUser } from "@/server/auth";
import { listSources } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Companies" };

export default async function SourcesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <>
      <AppHeader user={user} />
      <SourcesManager initial={await listSources(user.id)} />
    </>
  );
}
