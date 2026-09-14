import { useEffect, useState } from "react";
import { Plug, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createHook, deleteHook, listHooks } from "@/lib/api";
import type { ModuleAction, ModuleDomain, WireWebhookBinding } from "@/lib/types";
import { KNOWN_ACTIONS, KNOWN_DOMAINS } from "@/lib/types";
import { cn } from "@/lib/utils";

export function WebhooksPanel() {
  const [hooks, setHooks] = useState<WireWebhookBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    source: "",
    provider: "generic" as "github" | "generic",
    action: "auto" as ModuleAction | "auto",
    domain: "auto" as ModuleDomain | "auto",
    secretEnv: "",
  });

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listHooks();
      setHooks(res.hooks);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const submit = async () => {
    if (!form.source.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createHook({
        source: form.source.trim(),
        provider: form.provider,
        ...(form.action !== "auto" ? { action: form.action } : {}),
        ...(form.domain !== "auto" ? { domain: form.domain } : {}),
        ...(form.secretEnv.trim() ? { secretEnv: form.secretEnv.trim() } : {}),
      });
      setForm({ ...form, source: "", secretEnv: "" });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteHook(id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Plug className="size-3.5" /> Webhooks
          <button
            type="button"
            title="Reload"
            onClick={() => void reload()}
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={cn("size-3", loading && "animate-spin")} />
          </button>
        </CardTitle>
        <CardDescription>POST /hooks — ingress → pipeline via entrypoint node</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5 pt-0">
        <div className="space-y-1.5">
          <Label htmlFor="hook-source">Source</Label>
          <Input
            id="hook-source"
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
            placeholder="e.g. github / my-crm / trello"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Provider</Label>
          <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v as "github" | "generic" })}>
            <SelectTrigger className="w-full h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="generic">generic</SelectItem>
              <SelectItem value="github">github</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Action</Label>
            <Select value={form.action} onValueChange={(v) => setForm({ ...form, action: v as ModuleAction | "auto" })}>
              <SelectTrigger className="w-full h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">auto</SelectItem>
                {KNOWN_ACTIONS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Domain</Label>
            <Select value={form.domain} onValueChange={(v) => setForm({ ...form, domain: v as ModuleDomain | "auto" })}>
              <SelectTrigger className="w-full h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">auto</SelectItem>
                {KNOWN_DOMAINS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hook-secretEnv">secretEnv (optional)</Label>
          <Input
            id="hook-secretEnv"
            value={form.secretEnv}
            onChange={(e) => setForm({ ...form, secretEnv: e.target.value })}
            placeholder="e.g. GITHUB_WEBHOOK_SECRET"
          />
        </div>
        <Button className="w-full" onClick={submit} disabled={busy || !form.source.trim()}>
          {busy ? "Working…" : "Create hook"}
        </Button>
        {error && <p className="text-[11px] text-red-600">{error}</p>}
        <div className="pt-1">
          <ScrollArea className="h-40 pr-2">
            {loading && hooks.length === 0 ? (
              <p className="py-4 text-center text-[11px] text-muted-foreground">Loading hooks…</p>
            ) : hooks.length === 0 ? (
              <p className="py-4 text-center text-[11px] text-muted-foreground">No hooks yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {hooks.map((hook) => (
                  <li
                    key={hook.id}
                    className="rounded-lg border px-2.5 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          hook.enabled ? "bg-emerald-500" : "bg-muted-foreground/40"
                        )}
                        title={hook.enabled ? "enabled" : "disabled"}
                      />
                      <span className="truncate text-xs font-semibold">{hook.source}</span>
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {hook.provider}
                      </span>
                      <button
                        type="button"
                        title={`Delete ${hook.id}`}
                        disabled={busy}
                        onClick={() => void remove(hook.id)}
                        className="ml-auto text-muted-foreground hover:text-red-600 disabled:opacity-50"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {hook.action && (
                        <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] ring-1 ring-border">{hook.action}</span>
                      )}
                      {hook.domain && (
                        <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] ring-1 ring-border">{hook.domain}</span>
                      )}
                      {hook.secretEnv && (
                        <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] ring-1 ring-border" title="secretEnv">
                          {hook.secretEnv}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-[10px] text-muted-foreground" title={hook.id}>
                      /hooks/{hook.id}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
}