"use client";
import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Field, type Row } from "./shared";
import {
  useOperations,
  OperationsFeedback,
  roadmapRead,
} from "./operations-action";
export function useRoadmap(query: Record<string, string>) {
  const [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    key = JSON.stringify(query),
    current = useRef(key),
    live = useRef(false);
  current.current = key;
  async function refresh() {
    try {
      const next = await roadmapRead(JSON.parse(key));
      if (live.current && current.current === key) {
        setData(next);
        setError("");
      }
      return next;
    } catch (e) {
      if (live.current && current.current === key)
        setError(e instanceof Error ? e.message : "Could not load.");
      throw e;
    }
  }
  useEffect(() => {
    live.current = true;
    setData(null);
    setError("");
    void refresh().catch(() => {});
    return () => {
      live.current = false;
    };
  }, [key]);
  const action = useOperations(refresh, "/api/roadmap");
  return { data, error, refresh, action };
}
export function RoadmapStatus({
  state,
}: {
  state: ReturnType<typeof useRoadmap>;
}) {
  return (
    <>
      <OperationsFeedback action={state.action} />
      {state.error ? (
        <div className="notice error" role="alert">
          {state.error}
          <Button
            variant="secondary"
            onClick={() => state.refresh().catch(() => {})}
          >
            Reload
          </Button>
        </div>
      ) : null}
      {!state.data && !state.error ? (
        <p className="notice" role="status">
          Loading…
        </p>
      ) : null}
    </>
  );
}
export function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <Field label={label}>
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}
export function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="road-check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
export function ActionForm({
  title,
  initial,
  fields,
  submit,
  label = "Save",
  busy = false,
}: {
  title: string;
  initial: Row;
  fields: Array<{
    key: string;
    label: string;
    type?: string;
    options?: Array<[string, string]>;
    optional?: boolean;
    min?: number;
    max?: number;
    step?: string;
  }>;
  submit: (value: Row) => Promise<unknown>;
  label?: string;
  busy?: boolean;
}) {
  const [v, set] = useState(initial);
  return (
    <form
      className="road-form"
      onSubmit={async (e) => {
        e.preventDefault();
        await submit(v);
      }}
    >
      <h3>{title}</h3>
      <div className="road-fields">
        {fields.map((f) =>
          f.type === "checkbox" ? (
            <CheckField
              key={f.key}
              label={f.label}
              checked={!!v[f.key]}
              onChange={(x) => set({ ...v, [f.key]: x })}
            />
          ) : f.options ? (
            <SelectField
              key={f.key}
              label={f.label}
              value={String(v[f.key] ?? "")}
              options={f.options}
              onChange={(x) => set({ ...v, [f.key]: x })}
            />
          ) : (
            <Field
              key={f.key}
              label={f.label}
              type={f.type || "text"}
              required={!f.optional}
              min={f.min}
              max={f.max}
              step={f.step}
              value={v[f.key] ?? ""}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                set({ ...v, [f.key]: e.target.value })
              }
            />
          ),
        )}
      </div>
      <Button type="submit" disabled={busy}>
        {label}
      </Button>
    </form>
  );
}
export const reasonField = { key: "reason", label: "Reason / review note" };
export const localDate = (t: number) => {
  const d = new Date(t);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
export const cents = (v: unknown) => Math.round(Number(v) * 100);
