import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { LogEntry } from "@/lib/workflow";

const severityStyles: Record<LogEntry["severity"], string> = {
  info: "text-foreground/80",
  success: "text-emerald-600 dark:text-emerald-400",
  error: "text-red-600 dark:text-red-400",
  accent: "text-blue-600 dark:text-blue-400",
  muted: "text-muted-foreground",
};

export interface EventLogProps {
  log: LogEntry[];
}

export function EventLog({ log }: EventLogProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = rootRef.current?.querySelector("[data-slot='scroll-area-viewport']");
    el?.scrollTo({ top: el.scrollHeight });
  }, [log.length]);

  const time = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div ref={rootRef} className="h-full min-h-0">
      <ScrollArea className="h-full">
      <div className="flex flex-col gap-1.5 p-3 font-mono text-[11px] leading-snug">
        {log.length === 0 ? (
          <p className="text-muted-foreground">Waiting for events…</p>
        ) : (
          log.map((entry) => (
            <div key={entry.id} className={cn("break-words", severityStyles[entry.severity])}>
              <span className="mr-1.5 text-muted-foreground">{time(entry.ts)}</span>
              <span>{entry.text}</span>
            </div>
          ))
        )}
      </div>
      </ScrollArea>
    </div>
  );
}