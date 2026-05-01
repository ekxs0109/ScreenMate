import { Activity, Users } from "lucide-react";
import { cn } from "../lib/utils";

export interface ViewerDetail {
  id: string;
  name: string;
  connType: string;
  ping: string | number;
  isGood: boolean;
  online?: boolean;
}

interface ViewerListProps {
  viewers: ViewerDetail[];
  className?: string;
  emptyMessage?: string;
}

export function ViewerList({
  viewers,
  className,
  emptyMessage = "No viewers yet",
}: ViewerListProps) {
  return (
    <div className={cn("flex flex-col h-full bg-zinc-50 dark:bg-zinc-950/40 relative", className)} data-testid="popup-viewer-roster">
      <div className="p-3.5 border-b border-border bg-white/50 dark:bg-zinc-950/50 backdrop-blur-sm flex justify-between items-center shrink-0">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-500" />
          <span className="font-semibold text-sm">Viewer List</span>
        </div>
        <span data-testid="popup-viewer-count" className="px-2.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[11px] font-bold">
          {viewers.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {viewers.map((viewer) => (
          <div
            key={viewer.id}
            data-testid={`popup-viewer-row-${viewer.id}`}
            data-online={viewer.online ? "true" : "false"}
            className="flex items-center justify-between p-3 bg-white dark:bg-zinc-900 border border-border/60 hover:border-border rounded-xl shadow-sm hover:shadow-md transition-all group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0 border border-border/50 group-hover:border-blue-500/30 transition-colors">
                <span className="text-sm font-bold text-zinc-500 dark:text-zinc-400 group-hover:text-blue-500 transition-colors">
                  {viewer.name.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5">
                  <span data-testid={`popup-viewer-name-${viewer.id}`} className="font-semibold text-sm text-foreground truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                    {viewer.name}
                  </span>
                  <div
                    className={cn(
                      "w-1.5 h-1.5 rounded-full shrink-0",
                      viewer.online !== false ? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]" : "bg-zinc-400"
                    )}
                  />
                </div>
                <span className="text-[10px] font-medium text-muted-foreground mt-0.5">
                  {viewer.connType}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 ml-3 shrink-0">
              <div
                className={cn(
                  "px-2 py-0.5 rounded-md text-[11px] font-mono font-bold border transition-colors",
                  viewer.isGood
                    ? "bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-400 border-green-200 dark:border-green-900/50"
                    : "bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-900/50"
                )}
              >
                {viewer.ping}
              </div>
            </div>
          </div>
        ))}

        {viewers.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center animate-in fade-in duration-500">
            <div className="w-16 h-16 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center mb-4">
              <Users className="w-6 h-6 text-muted-foreground/30" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">{emptyMessage}</p>
          </div>
        )}
      </div>
    </div>
  );
}
