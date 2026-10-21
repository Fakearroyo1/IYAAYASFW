"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { money, date, type Row } from "./shared";
export default function MemberActivity({ memberId }: { memberId: string }) {
  const [kind, setKind] = useState("orders"),
    [records, setRecords] = useState<Row[]>([]),
    [cursor, setCursor] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load(next = "") {
    setBusy(true);
    try {
      const r = await fetch(
          "/api/history?" +
            new URLSearchParams({
              scope: "admin",
              dataset: kind,
              memberId,
              cursor: next,
            }),
          { cache: "no-store" },
        ),
        j = (await r.json()) as Row;
      if (!r.ok) throw Error(j.error);
      setRecords((old) => (next ? [...old, ...j.records] : j.records));
      setCursor(j.nextCursor || "");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, [kind, memberId]);
  return (
    <section className="wf-stack">
      <nav className="wf-toolbar" aria-label="Member activity">
        {[
          ["orders", "Purchases"],
          ["payments", "Payments"],
          ["ledger", "Balance history"],
        ].map(([id, label]) => (
          <Button
            key={id}
            variant={kind === id ? "default" : "outline"}
            onClick={() => setKind(id)}
          >
            {label}
          </Button>
        ))}
      </nav>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {records.map((r) => (
        <div className="wf-row" key={r.id}>
          <strong>
            {r.code || r.order_code || r.note || r.purpose || r.kind}
          </strong>
          <span>
            {date(r.created_at)} · {r.status || r.kind}
          </span>
          {kind === "ledger" ? (
            <span>
              Tab change {money(r.debt_delta)} · credit change{" "}
              {money(r.credit_delta)}
            </span>
          ) : (
            <span>
              {money(r.total ?? r.amount)} · {r.method}
            </span>
          )}
        </div>
      ))}
      {!records.length && !busy && <p>No records.</p>}
      {cursor && (
        <Button
          disabled={busy}
          variant="secondary"
          onClick={() => load(cursor)}
        >
          Load older records
        </Button>
      )}
    </section>
  );
}
