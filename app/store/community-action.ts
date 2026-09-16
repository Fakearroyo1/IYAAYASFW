"use client";
import { useEffect, useRef, useState } from "react";
import type { Row } from "./shared";
export function useCommunityAction(
  memberId: string,
  onSuccess: () => Promise<unknown>,
) {
  const key = "supply-community-pending:" + memberId;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [pending, setPending] = useState<Row | null>(null),
    [notice, setNotice] = useState("");
  const locked = useRef(false);
  useEffect(() => {
    try {
      setPending(JSON.parse(sessionStorage.getItem(key) || "null"));
    } catch {}
  }, [key]);
  async function send(body: Row, retry = false) {
    if (locked.current || (pending && !retry)) return false;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const request = retry ? body : { ...body, requestId: crypto.randomUUID() };
    setPending(request);
    try {
      sessionStorage.setItem(key, JSON.stringify(request));
    } catch {}
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const r = await fetch("/api/community", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      const j = (await r.json()) as Row;
      if (!r.ok) {
        if (r.status < 500) {
          setPending(null);
          try {
            sessionStorage.removeItem(key);
          } catch {}
        }
        throw Error(j.error || "The update could not be confirmed.");
      }
      setPending(null);
      try {
        sessionStorage.removeItem(key);
      } catch {}
      setNotice("Saved.");
      try {
        await onSuccess();
      } catch {
        setNotice("Saved. Refresh the board to see the latest version.");
      }
      return true;
    } catch (e) {
      setError(
        e instanceof Error && e.name !== "AbortError"
          ? e.message
          : "Confirmation did not arrive. Retry the same action.",
      );
      return false;
    } finally {
      clearTimeout(timeout);
      setBusy(false);
      locked.current = false;
    }
  }
  return {
    busy,
    error,
    notice,
    pending,
    send,
    retry: () => (pending ? send(pending, true) : Promise.resolve(false)),
  };
}
