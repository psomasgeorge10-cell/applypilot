import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { Dashboard } from "@/components/Dashboard";
import { getSessionUser } from "@/server/auth";
import { aiConfigured } from "@/server/ai";
import { getProfileView, listSources } from "@/server/repo";
import { liveSubmissionsEnabled } from "@/server/submit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [profile, sources] = await Promise.all([getProfileView(user.id), listSources(user.id)]);

  return (
    <>
      <AppHeader user={user} />
      <Dashboard
        setup={{
          hasProfile: profile.profile !== null,
          sourceCount: sources.length,
          aiConfigured: aiConfigured(),
          liveSubmissions: liveSubmissionsEnabled(),
          autoApply: profile.settings.autoApply,
        }}
      />
    </>
  );
}
