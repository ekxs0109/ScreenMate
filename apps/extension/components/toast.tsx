import { useCallback, useEffect, useState } from "react";
import { Info, X } from "lucide-react";

import { cn } from "../lib/utils";

export type ToastTone = "info" | "error";
export type ToastMessage = {
  id: string;
  text: string;
  tone: ToastTone;
};

export function useToastQueue() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((text: string, tone: ToastTone = "info") => {
    const trimmed = text.trim();
    if (!trimmed || trimmed === "Room closed.") {
      return;
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current.slice(-2), { id, text: trimmed, tone }]);
  }, []);

  return {
    dismissToast,
    pushToast,
    toasts,
  };
}

export function ToastViewport({
  onDismiss,
  toasts,
}: {
  onDismiss: (id: string) => void;
  toasts: ToastMessage[];
}) {
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[2147483647] flex w-[min(340px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} onDismiss={onDismiss} toast={toast} />
      ))}
    </div>
  );
}

function ToastItem({
  onDismiss,
  toast,
}: {
  onDismiss: (id: string) => void;
  toast: ToastMessage;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 4_500);
    return () => clearTimeout(timer);
  }, [onDismiss, toast.id]);

  return (
    <div
      className={cn(
        "pointer-events-auto flex items-start gap-2 rounded-xl border bg-card/95 p-3 text-xs font-semibold shadow-2xl backdrop-blur animate-in fade-in slide-in-from-top-1",
        toast.tone === "error"
          ? "border-red-200 text-red-600 dark:border-red-900/60 dark:text-red-300"
          : "border-border text-foreground",
      )}
      role="status"
    >
      <Info className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 leading-relaxed">{toast.text}</span>
      <button
        aria-label="Dismiss"
        className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        onClick={() => onDismiss(toast.id)}
        type="button"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
