"use client";
import { useEffect, useRef, useState } from "react";
import { secureFetch } from "@/lib/identity/client";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Field, type Row } from "./shared";
import "./workflows.css";
export const cents = (v: string) =>
  v.trim() === "" ? null : Math.round(Number(v) * 100);
export const localTime = (n = Date.now()) =>
  new Date(n - new Date(n).getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 19);
export function useDraft<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial),
    [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("workflow:draft:" + key);
      if (saved) setValue(JSON.parse(saved));
    } catch {}
    setReady(true);
  }, [key]);
  useEffect(() => {
    if (ready)
      try {
        sessionStorage.setItem("workflow:draft:" + key, JSON.stringify(value));
      } catch {}
  }, [key, value, ready]);
  return [
    value,
    setValue,
    () => {
      setValue(initial);
      try {
        sessionStorage.removeItem("workflow:draft:" + key);
      } catch {}
    },
  ] as const;
}
export function useWorkflow(query: string, scope: string) {
  const [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Row | null>(null),
    lock = useRef(false),
    current = useRef<Row | null>(null);
  const storage = "workflow:pending:" + scope;
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    addEventListener("online", update);
    addEventListener("offline", update);
    return () => {
      removeEventListener("online", update);
      removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    try {
      const v = sessionStorage.getItem(storage);
      if (v) {
        current.current = JSON.parse(v);
        setPending(current.current);
      }
    } catch {}
  }, [storage]);
  const load = async () => {
    const r = await secureFetch("/api/workflows?" + query, {
        cache: "no-store",
      }),
      j = (await r.json()) as Row;
    if (!r.ok) throw Error(j.error || "Unable to load records.");
    setData(j);
    return j;
  };
  useEffect(() => {
    let live = true;
    fetch("/api/workflows?" + query, { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json()) as Row;
        if (!r.ok) throw Error(j.error);
        if (live) setData(j);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [query]);
  const send = async (body: Row, retry = false): Promise<Row | null> => {
    if (!navigator.onLine) {
      setError("You are offline. Reconnect to submit the saved draft.");
      return null;
    }
    if (lock.current || (current.current && !retry)) return null;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const request = retry
      ? current.current!
      : { ...body, requestId: crypto.randomUUID() };
    current.current = request;
    setPending(request);
    try {
      sessionStorage.setItem(storage, JSON.stringify(request));
    } catch {}
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const r = await secureFetch("/api/workflows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: controller.signal,
        }),
        j = (await r.json()) as Row;
      if (!r.ok) {
        if (
          r.status >= 400 &&
          r.status < 500 &&
          r.status !== 401 &&
          r.status !== 429
        ) {
          current.current = null;
          setPending(null);
          sessionStorage.removeItem(storage);
        }
        throw Error(j.error || "Unable to confirm this action.");
      }
      current.current = null;
      setPending(null);
      sessionStorage.removeItem(storage);
      setNotice("Saved.");
      await load();
      return j;
    } catch (e) {
      setError(
        controller.signal.aborted
          ? "The response timed out. Retry the saved action to confirm its result."
          : (e as Error).message,
      );
      return null;
    } finally {
      clearTimeout(timeout);
      lock.current = false;
      setBusy(false);
    }
  };
  return {
    data,
    error,
    notice,
    busy,
    pending,
    offline,
    send,
    load: () =>
      load().catch((e) => {
        setError(e.message);
        return null;
      }),
    setError,
  };
}
export function WorkflowStatus({
  state,
}: {
  state: ReturnType<typeof useWorkflow>;
}) {
  return (
    <>
      {state.offline && (
        <p className="notice warning" role="status">
          Offline · drafts stay saved in this browser tab. Reconnect before
          posting changes.
        </p>
      )}
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}{" "}
          <button type="button" onClick={() => state.load()}>
            Refresh records
          </button>
        </p>
      )}
      {state.pending && (
        <div className="notice warning">
          <p>
            This action is awaiting confirmation. Your input is saved in this
            browser tab.
          </p>
          <Button
            disabled={state.busy}
            onClick={() => state.send(state.pending!, true)}
          >
            Retry the same action
          </Button>{" "}
          <a href="/identity" target="_blank" rel="noopener">
            Verify access in another tab
          </a>
        </div>
      )}
      {state.notice && (
        <p role="status" className="fine">
          {state.notice}
        </p>
      )}
    </>
  );
}
export function Select({
  label,
  value,
  onChange,
  options,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[][];
  required?: boolean;
}) {
  return (
    <Field label={label}>
      <NativeSelect
        aria-label={label}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}
export function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (b: boolean) => void;
}) {
  return (
    <label className="wf-check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
