import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getToken, streamUrl, type AuditEvent } from "./api";

type LiveState = { events: AuditEvent[]; state: "connecting" | "connected" | "reconnecting"; lastEventAt: Date | null };
const LiveContext = createContext<LiveState>({ events: [], state: "connecting", lastEventAt: null });

export function LiveProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [state, setState] = useState<LiveState["state"]>("connecting");
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null);
  useEffect(() => {
    let cancelled = false; let controller: AbortController | null = null; let retry: number | undefined;
    const connect = async () => {
      controller = new AbortController();
      try {
        const response = await fetch(streamUrl(), { headers: { Authorization: `Bearer ${getToken()}` }, signal: controller.signal });
        if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);
        setState("connected");
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
        while (!cancelled) {
          const chunk = await reader.read(); if (chunk.done) throw new Error("stream ended");
          buffer += decoder.decode(chunk.value, { stream: true });
          const packets = buffer.split("\n\n"); buffer = packets.pop() || "";
          for (const packet of packets) {
            const data = packet.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim();
            if (!data) continue;
            const event = JSON.parse(data) as AuditEvent;
            setEvents((items) => [event, ...items.filter((item) => item.seq !== event.seq)].slice(0, 200));
            setLastEventAt(new Date());
          }
        }
      } catch {
        if (!cancelled) { setState("reconnecting"); retry = window.setTimeout(connect, 1800); }
      }
    };
    void connect();
    return () => { cancelled = true; controller?.abort(); if (retry) window.clearTimeout(retry); };
  }, []);
  const value = useMemo(() => ({ events, state, lastEventAt }), [events, lastEventAt, state]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive() { return useContext(LiveContext); }
