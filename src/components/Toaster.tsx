"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertIcon, CheckIcon, CloseIcon } from "./icons";
import { cx } from "./ui";

export interface Toast {
  id: number;
  tone: "success" | "error";
  message: string;
}

const DISMISS_AFTER_MS = 4000;

/**
 * Minimal toast queue. Returns the list to render plus a `notify` callback;
 * timers are cleaned up on unmount so a dismissed toast cannot fire later.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (tone: Toast["tone"], message: string) => {
      const id = (nextId.current += 1);
      setToasts((current) => [...current, { id, tone, message }]);
      timers.current.push(setTimeout(() => dismiss(id), DISMISS_AFTER_MS));
    },
    [dismiss],
  );

  return { toasts, notify, dismiss };
}

export function Toaster({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      // Announced politely so a screen reader hears "Project created" without
      // being interrupted mid-sentence.
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-60 flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cx(
            "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-4 py-3 shadow-lg",
            toast.tone === "success"
              ? "border-emerald-200 bg-white text-slate-800 dark:border-emerald-500/30 dark:bg-slate-900 dark:text-slate-100"
              : "border-rose-200 bg-white text-slate-800 dark:border-rose-500/30 dark:bg-slate-900 dark:text-slate-100",
          )}
        >
          <span
            className={cx(
              "mt-0.5 rounded-full p-1",
              toast.tone === "success"
                ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300"
                : "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300",
            )}
          >
            {toast.tone === "success" ? (
              <CheckIcon className="size-3.5" />
            ) : (
              <AlertIcon className="size-3.5" />
            )}
          </span>
          <p className="flex-1 text-sm">{toast.message}</p>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
            className="-m-1 rounded-lg p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
