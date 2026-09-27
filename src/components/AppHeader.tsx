"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { initials } from "@/lib/format";
import type { SessionUser } from "@/lib/types";
import { LogoIcon, LogoutIcon } from "./icons";
import { Button, cx } from "./ui";

const NAV = [
  { href: "/", label: "Applications" },
  { href: "/sources", label: "Companies" },
  { href: "/profile", label: "Profile" },
];

export function AppHeader({ user }: { user: SessionUser }) {
  const router = useRouter();
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await api.logout();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2.5">
            <LogoIcon className="size-8 text-indigo-600" />
            <span className="hidden text-sm font-semibold text-slate-900 sm:inline dark:text-slate-50">
              ApplyPilot
            </span>
          </Link>
          <nav className="flex items-center gap-1" aria-label="Main">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={pathname === item.href ? "page" : undefined}
                className={cx(
                  "rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
                  pathname === item.href
                    ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-50"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <span
            className="hidden size-9 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700 sm:flex dark:bg-indigo-500/15 dark:text-indigo-300"
            title={`${user.name} (${user.email})`}
          >
            {initials(user.name)}
          </span>
          <Button variant="ghost" onClick={signOut} loading={signingOut} className="px-2">
            <LogoutIcon className="size-4" />
            <span className="sr-only">Sign out</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
