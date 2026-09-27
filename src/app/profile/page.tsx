import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { ProfileEditor } from "@/components/ProfileEditor";
import { getSessionUser } from "@/server/auth";
import { getProfileView } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <>
      <AppHeader user={user} />
      <ProfileEditor initial={await getProfileView(user.id)} />
    </>
  );
}
