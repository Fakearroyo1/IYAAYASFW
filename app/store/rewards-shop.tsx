"use client";
import { useState } from "react";
import { Gift, Ticket, Wallet, Trophy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Field, money, date, type Row } from "./shared";
import { useRoadmap, RoadmapStatus, ActionForm, SelectField, CheckField, localDate } from "./roadmap-shared";
import { OperationsFeedback, roadmapRead } from "./operations-action";
import styles from "./rewards-shop.module.css";

type Action = ReturnType<typeof useRoadmap>["action"];
const count = (value: unknown) => Number(value || 0).toLocaleString();

const ticketRange = (e: Row) => e.ticket_start === e.ticket_end ? `#${e.ticket_start}` : `#${e.ticket_start}–${e.ticket_end}`;

export function RewardsShop({ admin = false, onChange }: { admin?: boolean; onChange?: () => Promise<unknown> }) {
  const [section, setSection] = useState("catalog"), [raffleId, setRaffleId] = useState(""), [historyOffset, setHistoryOffset] = useState(0), [entryOffset, setEntryOffset] = useState(0);
  const state = useRoadmap({ kind: "redemptions", ...(admin ? { admin: "true" } : {}), ...(raffleId ? { raffleId } : {}), offset: String(historyOffset), entryOffset: String(entryOffset) });
  const d = state.data;
  return <div className="road-stack">
    <RoadmapStatus state={state} />
    {d ? <>
      {admin ? <div className="road-tabs" aria-label="Reward management">
        {[["catalog", "Reward catalog"], ["raffles", "Raffles"], ["history", "Redemption activity"]].map(([id, label]) => <Button key={id} variant={section === id ? "default" : "secondary"} onClick={() => setSection(id)}>{label}</Button>)}
      </div> : <section className="panel road-stack">
        <div className={styles.toolbar}><h2>Make your Murley Bucks count.</h2><Gift aria-hidden size={24} /></div>
        <dl className={styles.metrics}>
          <div><dt>Available to spend</dt><dd>{count(d.wallet.available)}</dd></div>
          <div><dt>Historical earned</dt><dd>{count(d.wallet.earned)}</dd></div>
          <div><dt>Spent on rewards</dt><dd>{count(d.wallet.spent)}</dd></div>
        </dl>
        <p className="fine">Choose a reward when you want to spend. Your Support Board standing and profile unlocks use earned Murley Bucks, so redeeming keeps your recognition intact.</p>
        {d.wallet.frozen ? <p className="notice warning">Reward redemption is paused for your account. Contact an administrator for help.</p> : null}
        {d.wallet.available < 0 ? <p className="notice warning">A previous earning adjustment exceeded your remaining Murley Bucks. New earnings will cover this amount before you can redeem again.</p> : null}
      </section>}
      {section === "catalog" || !admin ? <Catalog data={d} action={state.action} admin={admin} onChange={onChange} /> : null}
      {admin && section === "raffles" ? <RaffleManager data={d} action={state.action} raffleId={raffleId} setRaffleId={(id) => { setRaffleId(id); setEntryOffset(0); }} entryOffset={entryOffset} setEntryOffset={setEntryOffset} /> : null}
      {!admin ? <MemberTickets data={d} offset={entryOffset} setOffset={setEntryOffset} /> : null}
      {section === "history" || !admin ? <RedemptionHistory data={d} admin={admin} offset={historyOffset} setOffset={setHistoryOffset} /> : null}
    </> : null}
  </div>;
}

export function Catalog({ data: d, action: a, admin, onChange }: { data: Row; action: Action; admin: boolean; onChange?: () => Promise<unknown> }) {
  const [editing, setEditing] = useState<Row | null>(null), [selected, setSelected] = useState<Row | null>(null), [quantity, setQuantity] = useState(1), [success, setSuccess] = useState("");
  const available = Number(d.wallet.available), total = Number(selected?.points || 0) * quantity;
  const catalog = admin ? d.catalog : d.catalog.filter((r: Row) => r.active && (r.kind !== "raffle" || d.raffles.some((f: Row) => f.id === r.raffle_id && f.active && f.status === "open" && f.starts_at <= Date.now() && f.ends_at > Date.now())));
  return <div className="road-stack">
    <div className={styles.toolbar}>
      <div><h2>{admin ? "Reward catalog" : "Available rewards"}</h2><p className="fine">{admin ? "Members see only active rewards. Deactivate an option any time; past redemptions remain in history." : "New rewards appear here when your admins activate them."}</p></div>
      {admin ? <Button onClick={() => setEditing({ active: false, kind: "credit", points: 10, credit_cents: 100, ticket_quantity: 1, stock_limit: null, version: -1 })}>Create reward</Button> : null}
    </div>
    {success ? <p className="notice success" role="status">{success}</p> : null}
    {!catalog.length ? <p className="notice">{admin ? "Create a store credit reward or a raffle ticket reward to get started." : "No rewards are available right now. Your Murley Bucks stay in your account."}</p> : null}
    <div className={styles.grid}>
      {catalog.map((r: Row) => {
        const raffle = d.raffles.find((x: Row) => x.id === r.raffle_id);
        const soldOut = r.stock_limit != null && Number(r.issued_count) >= Number(r.stock_limit);
        const ready = r.kind !== "raffle" || (raffle?.active && raffle.status === "open" && Number(raffle.starts_at) <= Date.now() && Number(raffle.ends_at) > Date.now());
        return <article className={styles.card} key={r.id}>
          <div className={styles.toolbar}><span className={styles.cardIcon}>{r.kind === "credit" ? <Wallet aria-hidden size={22} /> : <Ticket aria-hidden size={22} />}</span>{admin ? <span className="status">{r.active ? "Active" : "Inactive"}</span> : null}</div>
          <h3>{r.name}</h3><p>{r.description}</p>
          <p className={styles.cost}>{count(r.points)}<small>Murley Bucks</small></p>
          <p className="fine">{r.kind === "credit" ? `${money(r.credit_cents)} account credit · available immediately for a tab or a new purchase` : `${count(r.ticket_quantity)} ${r.ticket_quantity === 1 ? "ticket" : "tickets"}${raffle ? " · " + raffle.name : ""}`}</p>
          {r.stock_limit != null ? <p className="fine">{Math.max(0, r.stock_limit - r.issued_count)} redemptions remaining</p> : null}
          {admin ? <div className="inline-actions"><Button variant="secondary" onClick={() => setEditing(r)}>Edit reward</Button><Button variant="secondary" disabled={a.busy || !!a.pending} onClick={() => a.send(rewardSaveBody(r, !r.active))}>{r.active ? "Deactivate" : "Activate"}</Button></div> : <Button disabled={a.busy || !!a.pending || !!d.wallet.frozen || soldOut || !ready || available < r.points} onClick={() => { setSelected(r); setQuantity(1); setSuccess(""); }}>{d.wallet.frozen ? "Redemption paused" : soldOut ? "Fully redeemed" : !ready ? "Raffle not open" : available < r.points ? `Need ${count(r.points - available)} more` : "Choose reward"}</Button>}
        </article>;
      })}
    </div>
    {editing ? <RewardEditor key={editing.id || "new"} reward={editing} raffles={d.raffles} action={a} close={() => setEditing(null)} /> : null}
    <Dialog open={!!selected} onOpenChange={(open) => { if (!open && !a.busy) setSelected(null); }}>
      <DialogContent className={styles.dialog}>
        <DialogHeader><DialogTitle>Redeem {selected?.name}</DialogTitle><DialogDescription>Review what you will receive before spending your Murley Bucks.</DialogDescription></DialogHeader>
        {selected ? <>
          <Field label="Quantity" type="number" min={1} max={Math.min(10, selected.stock_limit == null ? 10 : Math.max(1, selected.stock_limit - selected.issued_count))} step="1" value={quantity} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuantity(Number(e.target.value))} />
          <div className={styles.confirmation}>
            <p><strong>{count(total)} Murley Bucks</strong> to redeem</p>
            <p>{selected.kind === "credit" ? `${money(selected.credit_cents * quantity)} added to your account credit immediately.` : `${count(selected.ticket_quantity * quantity)} raffle tickets issued to you.`}</p>
            <p className="fine">Available after redemption: {count(available - total)} Murley Bucks. Earned recognition stays unchanged.</p>
          </div>
          <OperationsFeedback action={a} />
          <DialogFooter><Button variant="secondary" disabled={a.busy} onClick={() => setSelected(null)}>Cancel</Button><Button disabled={a.busy || !!a.pending || !!d.wallet.frozen || total > available || !Number.isInteger(quantity) || quantity < 1 || quantity > 10} onClick={async () => {
            const r = await a.send({ action: "rewardRedeem", rewardId: selected.id, version: selected.version, quantity });
            if (r) { setSuccess(selected.kind === "credit" ? `${money(selected.credit_cents * quantity)} has been added to your account credit. Choose when to use it at checkout or to settle your tab.` : "Your raffle tickets have been issued. Find your ticket numbers below."); setSelected(null); await onChange?.().catch(() => {}); }
          }}>{a.busy ? "Redeeming…" : "Confirm redemption"}</Button></DialogFooter>
        </> : null}
      </DialogContent>
    </Dialog>
  </div>;
}

function rewardSaveBody(r: Row, active = !!r.active) {
  return { action: "redemptionRewardSave", id: r.id, version: r.version, name: r.name, description: r.description, kind: r.kind, points: Number(r.points), creditCents: Number(r.credit_cents), ticketQuantity: Number(r.ticket_quantity), raffleId: r.raffle_id, active, stockLimit: r.stock_limit == null ? null : Number(r.stock_limit) };
}

function RewardEditor({ reward: r, raffles, action: a, close }: { reward: Row; raffles: Row[]; action: Action; close: () => void }) {
  const [v, set] = useState({ name: r.name || "", description: r.description || "", kind: r.kind || "credit", points: r.points || 10, credit: String((r.credit_cents || 100) / 100), ticketQuantity: r.ticket_quantity || 1, raffleId: r.raffle_id || "", active: !!r.active, stock: r.stock_limit == null ? "" : String(r.stock_limit), reason: "" });
  const changedTerms = Number(r.issued_count) > 0 && (Number(v.points) !== Number(r.points) || (v.kind === "credit" ? Math.round(Number(v.credit) * 100) !== Number(r.credit_cents) : Number(v.ticketQuantity) !== Number(r.ticket_quantity)));
  return <Dialog open onOpenChange={(open) => { if (!open && !a.busy) close(); }}><DialogContent className={styles.dialog}>
    <DialogHeader><DialogTitle>{r.id ? "Edit reward" : "Create a reward"}</DialogTitle><DialogDescription>Published terms apply to new redemptions. Historical rewards remain unchanged.</DialogDescription></DialogHeader>
    <form className="road-stack" onSubmit={async (e) => { e.preventDefault(); const saved = await a.send({ action: "redemptionRewardSave", ...(r.id ? { id: r.id } : {}), version: r.version, name: v.name, description: v.description, kind: v.kind, points: Number(v.points), creditCents: Math.round(Number(v.credit) * 100), ticketQuantity: Number(v.ticketQuantity), raffleId: v.raffleId, active: v.active, stockLimit: v.stock === "" ? null : Number(v.stock), reason: v.reason }); if (saved) close(); }}>
      <Field label="Reward name" required maxLength={100} value={v.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ ...v, name: e.target.value })} />
      <Field label="Description" required maxLength={1000} value={v.description} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ ...v, description: e.target.value })} />
      {!r.id ? <SelectField label="Reward type" value={v.kind} onChange={(kind) => set({ ...v, kind })} options={[["credit", "Account credit"], ["raffle", "Raffle tickets"]]} /> : <p className="fine">Type: {v.kind === "credit" ? "Account credit" : "Raffle tickets"}</p>}
      <Field label="Murley Bucks per redemption" type="number" min={1} max={100000} step="1" required value={v.points} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ ...v, points: Number(e.target.value) })} />
      {v.kind === "credit" ? <Field label="Account credit per redemption ($)" type="number" min="0.01" max="500" step="0.01" required value={v.credit} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ ...v, credit: e.target.value })} /> : <>
        <SelectField label="Raffle" value={v.raffleId} onChange={(raffleId) => set({ ...v, raffleId })} options={[["", "Choose a raffle"], ...raffles.filter((f) => f.status === "open" || f.id === r.raffle_id).map((f): [string, string] => [f.id, f.name])]} />
        <Field label="Tickets per redemption" type="number" min={1} max={100} step="1" required value={v.ticketQuantity} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ ...v, ticketQuantity: Number(e.target.value) })} />
        {!raffles.length ? <p className="notice">Create a raffle in the Raffles tab first.</p> : null}
      </>}
      <Field label="Total redemption limit (leave blank for unlimited)" type="number" min={Math.max(1, Number(r.issued_count || 0))} step="1" value={v.stock} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ ...v, stock: e.target.value })} />
      <CheckField label="Active — members can see and redeem this reward" checked={v.active} onChange={(active) => set({ ...v, active })} />
      {changedTerms ? <Field label="Reason for changing issued reward terms" required minLength={5} value={v.reason} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ ...v, reason: e.target.value })} /> : null}
      <OperationsFeedback action={a} />
      <DialogFooter><Button type="button" variant="secondary" disabled={a.busy} onClick={close}>Cancel</Button><Button type="submit" disabled={a.busy || !!a.pending || (v.kind === "raffle" && !v.raffleId)}>{a.busy ? "Saving…" : "Save reward"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

function MemberTickets({ data: d, offset, setOffset }: { data: Row; offset: number; setOffset: (n: number) => void }) {
  if (!d.entries.length && !offset) return null;
  return <section className="panel road-stack"><h2>Your raffle tickets</h2>{d.entries.map((e: Row) => <div className="road-item" key={e.id}><h3>{e.raffle_name || d.raffles.find((r: Row) => r.id === e.raffle_id)?.name || "Raffle entry"}</h3><p><span className={styles.ticket}>Tickets {ticketRange(e)}</span></p><p className="fine">{count(e.quantity)} {e.quantity === 1 ? "entry" : "entries"}{e.created_at ? " · " + date(e.created_at) : ""}</p></div>)}<Pages offset={offset} setOffset={setOffset} more={d.entriesMore} size={1000} /></section>;
}

function RedemptionHistory({ data: d, admin, offset, setOffset }: { data: Row; admin: boolean; offset: number; setOffset: (n: number) => void }) {
  return <section className="panel road-stack"><h2>{admin ? "Redemption activity" : "Your redeemed rewards"}</h2><p className="fine">Rewards already issued stay in this history, even after an option is deactivated.</p>
    {!d.redemptions.length ? <p className="fine">No redemptions yet.</p> : d.redemptions.map((r: Row) => <article className="road-item" key={r.id}><div className={styles.toolbar}><h3>{r.reward_name || r.name || "Reward"}</h3><span>{date(r.created_at)}</span></div>{admin && r.member_name ? <p>{r.member_name}</p> : null}<p><strong>{count(r.points_spent ?? r.points_total ?? r.points)} Murley Bucks spent</strong>{r.quantity > 1 ? ` · ${r.quantity} redemptions` : ""}</p><p className="fine">{r.kind === "credit" ? `${money(r.credit_cents)} account credit issued` : "Raffle tickets issued"} · Reference {r.id}</p></article>)}
    <Pages offset={offset} setOffset={setOffset} more={d.more} size={100} />
  </section>;
}

function Pages({ offset, setOffset, more, size }: { offset: number; setOffset: (n: number) => void; more: boolean; size: number }) {
  if (!offset && !more) return null;
  return <div className="inline-actions" aria-label="History pages"><Button variant="secondary" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - size))}>Previous</Button><Button variant="secondary" disabled={!more} onClick={() => setOffset(offset + size)}>Next</Button></div>;
}

export function RaffleManager({ data: d, action: a, raffleId, setRaffleId, entryOffset, setEntryOffset }: { data: Row; action: Action; raffleId: string; setRaffleId: (id: string) => void; entryOffset: number; setEntryOffset: (n: number) => void }) {
  const [editing, setEditing] = useState<Row | null>(null), [draw, setDraw] = useState<Row | null>(null), [winningTicket, setWinningTicket] = useState(""), [drawReason, setDrawReason] = useState(""), [exporting, setExporting] = useState(false), [exportError, setExportError] = useState("");
  const current = d.raffles.find((r: Row) => r.id === raffleId);
  const needsPause = current?.mode === "external" && current?.status === "open" && current?.active && current?.ends_at > Date.now();
  return <div className="road-stack">
    <div className={styles.toolbar}><div><h2>Raffles</h2><p className="fine">Run a website draw or export numbered tickets for an outside draw. Free member and visitor entries are supported.</p></div><Button onClick={() => setEditing({ name: "", description: "", mode: "internal", active: false, starts_at: Date.now(), ends_at: Date.now() + 7 * 86400000, version: -1 })}>Create raffle</Button></div>
    <div className={styles.grid}>{d.raffles.map((r: Row) => <article className={styles.card} key={r.id}><div className={styles.toolbar}><span className={styles.cardIcon}><Ticket size={22} aria-hidden /></span><span className="status">{r.status === "drawn" ? "Draw complete" : r.active ? "Active" : "Inactive"}</span></div><h3>{r.name}</h3><p>{r.description}</p><p className="fine">{r.mode === "internal" ? "Website draw" : "Outside draw"} · {count(r.ticket_count)} tickets<br />{date(r.starts_at)} to {date(r.ends_at)}</p>{r.winner ? <p className="notice success"><Trophy size={16} aria-hidden /> Winner: {r.winner.display_name} · ticket #{r.winner.ticket}</p> : null}<div className="inline-actions"><Button variant={raffleId === r.id ? "default" : "secondary"} onClick={() => setRaffleId(r.id)}>Manage entries</Button><Button variant="secondary" onClick={() => setEditing(r)}>Edit</Button></div></article>)}</div>
    {!d.raffles.length ? <p className="notice">Create your event, then add free entries or publish a ticket reward in the catalog.</p> : null}
    {current ? <section className="panel road-stack"><div className={styles.toolbar}><h2>{current.name} — entries</h2><Button variant="secondary" disabled={!current.ticket_count || exporting || needsPause} onClick={async () => { setExporting(true); setExportError(""); try { await exportTickets(current); } catch (e) { setExportError(e instanceof Error ? e.message : "Export failed."); } finally { setExporting(false); } }}><Download size={16} aria-hidden />{exporting ? "Preparing export…" : "Export all tickets"}</Button></div>
      <p className="fine">Tickets are numbered once and kept for review. No payment is needed when an admin adds an entry. Member winners receive a badge for the season in which the draw occurs.</p>
      {current.mode === "external" && current.status === "open" ? <div className="notice road-stack"><p>Pause entries, export the final ticket list, then record the winning ticket. Re-export the list if entries are reopened.</p>{current.active && current.ends_at > Date.now() ? <Button variant="secondary" disabled={a.busy || !!a.pending} onClick={() => a.send({ action: "raffleSave", id: current.id, version: current.version, name: current.name, description: current.description, mode: current.mode, active: false, startsAt: current.starts_at, endsAt: current.ends_at })}>Pause entries for the draw</Button> : <p className="fine">Entries are closed. The final ticket list is ready to export.</p>}</div> : null}
      {exportError ? <p className="notice error" role="alert">{exportError}</p> : null}
      {current.status === "open" ? <>{current.active && current.starts_at <= Date.now() && current.ends_at > Date.now() ? <FreeEntry key={current.id} raffle={current} members={d.members} action={a} /> : <p className="notice">Free entries can be added while this raffle is active and its entry window is open.</p>}<Button disabled={a.busy || !!a.pending || needsPause || !Number(current.ticket_count)} onClick={() => { setDraw(current); setWinningTicket(""); setDrawReason(""); }}>{current.mode === "internal" ? "Draw a winner…" : "Record outside winner…"}</Button></> : <p className="notice success">This draw is complete. The winner and issued tickets remain in the event record.</p>}
      <div className={styles.tableWrap}><table className={styles.table}><caption className="sr-only">Issued tickets for {current.name}</caption><thead><tr><th>Participant</th><th>Tickets</th><th>Count</th><th>Entry type</th></tr></thead><tbody>{d.entries.map((e: Row) => <tr key={e.id}><td>{e.name || e.member_name || e.visitor_name}</td><td>{ticketRange(e)}</td><td>{count(e.quantity)}</td><td>{e.member_id ? "Member" : "Visitor"}</td></tr>)}</tbody></table></div>
      {!d.entries.length ? <p className="fine">No entries yet.</p> : null}
      <Pages offset={entryOffset} setOffset={setEntryOffset} more={d.entriesMore} size={1000} />
    </section> : null}
    {editing ? <RaffleEditor key={editing.id || "new"} raffle={editing} action={a} close={() => setEditing(null)} /> : null}
    <Dialog open={!!draw} onOpenChange={(open) => { if (!open && !a.busy) setDraw(null); }}><DialogContent className={styles.dialog}><DialogHeader><DialogTitle>{draw?.mode === "internal" ? "Draw the winner?" : "Record the winning ticket"}</DialogTitle><DialogDescription>{draw?.mode === "internal" ? "One issued ticket will be selected at random. This closes the raffle and cannot be redrawn." : "Enter the winning ticket from your outside draw. This closes the raffle and keeps the result for review."}</DialogDescription></DialogHeader>{draw ? <form className="road-stack" onSubmit={async (e) => { e.preventDefault(); const result = await a.send({ action: draw.mode === "internal" ? "raffleDraw" : "raffleExternalResult", raffleId: draw.id, version: draw.version, confirmed: true, ...(draw.mode === "external" ? { winningTicket: Number(winningTicket), reason: drawReason } : {}) }); if (result) setDraw(null); }}><div className={styles.confirmation}><strong>{draw.name}</strong><p>{count(draw.ticket_count)} issued tickets · one winner</p><p className="fine">If the winner is a member, a winner badge is attached for the current season. Visitor winners remain in this event record.</p></div>{draw.mode === "external" ? <><Field label="Winning ticket number" type="number" min={1} step="1" required value={winningTicket} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWinningTicket(e.target.value)} /><Field label="Draw reference / result note" required minLength={5} maxLength={500} value={drawReason} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDrawReason(e.target.value)} /></> : null}<OperationsFeedback action={a} /><DialogFooter><Button type="button" variant="secondary" disabled={a.busy} onClick={() => setDraw(null)}>Cancel</Button><Button type="submit" disabled={a.busy || !!a.pending}>{a.busy ? "Confirming…" : draw.mode === "internal" ? "Draw and close raffle" : "Save winner and close"}</Button></DialogFooter></form> : null}</DialogContent></Dialog>
  </div>;
}

function RaffleEditor({ raffle: r, action: a, close }: { raffle: Row; action: Action; close: () => void }) {
  const locked = Number(r.ticket_count) > 0 || r.status === "drawn";
  return <Dialog open onOpenChange={(open) => { if (!open && !a.busy) close(); }}><DialogContent className={styles.dialog}><DialogHeader><DialogTitle>{r.id ? "Edit raffle" : "Create a raffle"}</DialogTitle><DialogDescription>Activate an event when it is ready. Only active ticket rewards appear to members.</DialogDescription></DialogHeader><ActionForm title="Event details" initial={{ name: r.name, description: r.description, mode: r.mode, active: !!r.active, starts: localDate(r.starts_at), ends: localDate(r.ends_at) }} fields={[{ key: "name", label: "Raffle name" }, { key: "description", label: "Event / prize description" }, ...(!locked ? [{ key: "mode", label: "How the winner is chosen", options: [["internal", "Website random draw"], ["external", "Outside draw + ticket export"]] as Array<[string, string]> }, { key: "starts", label: "Entry opens", type: "datetime-local" }, { key: "ends", label: "Entry closes", type: "datetime-local" }] : []), { key: "active", label: "Active event", type: "checkbox" }]} busy={a.busy || !!a.pending} submit={async (v) => { const saved = await a.send({ action: "raffleSave", ...(r.id ? { id: r.id } : {}), version: r.version, name: v.name, description: v.description, mode: locked ? r.mode : v.mode, active: v.active, startsAt: locked ? r.starts_at : new Date(v.starts).getTime(), endsAt: locked ? r.ends_at : new Date(v.ends).getTime() }); if (saved) close(); }} />{locked ? <p className="fine">The draw method and entry window are fixed once tickets have been issued.</p> : null}<OperationsFeedback action={a} /><Button variant="secondary" disabled={a.busy} onClick={close}>Cancel</Button></DialogContent></Dialog>;
}

function FreeEntry({ raffle: r, members, action: a }: { raffle: Row; members: Row[]; action: Action }) {
  const [kind, setKind] = useState("member"), [memberId, setMemberId] = useState(""), [name, setName] = useState(""), [quantity, setQuantity] = useState(1);
  return <form className="road-form" onSubmit={async (e) => { e.preventDefault(); const result = await a.send({ action: "raffleEntryAdd", raffleId: r.id, version: r.version, quantity, ...(kind === "member" ? { memberId } : { visitorName: name }) }); if (result) { setName(""); setMemberId(""); setQuantity(1); } }}><h3>Add a free entry</h3><div className="road-fields"><SelectField label="Participant" value={kind} onChange={setKind} options={[["member", "Site member"], ["visitor", "Visitor without an account"]]} />{kind === "member" ? <SelectField label="Member" value={memberId} onChange={setMemberId} options={[["", "Choose a member"], ...members.filter((m) => m.active).map((m): [string, string] => [m.id, m.name])]} /> : <Field label="Visitor name" required maxLength={100} value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />}<Field label="Number of tickets" type="number" min={1} max={1000} step="1" required value={quantity} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuantity(Number(e.target.value))} /></div><p className="fine">Visitor details stay in admin event records. This does not create a site account or record a purchase.</p><Button disabled={a.busy || !!a.pending || (kind === "member" && !memberId)}>Add free tickets</Button></form>;
}

async function exportTickets(raffle: Row) {
  const entries: Row[] = [];
  for (let offset = 0; offset <= 100000; offset += 1000) {
    const page = await roadmapRead({ kind: "redemptions", admin: "true", raffleId: raffle.id, entryOffset: String(offset) });
    if (page.raffles.find((r: Row) => r.id === raffle.id)?.version !== raffle.version) throw Error("Raffle entries changed during export. Reload the raffle and export again.");
    entries.push(...page.entries);
    if (!page.entriesMore) break;
  }
  const safeCell = (v: unknown) => { const text = String(v ?? ""); return '"' + (/^[\s]*[=+@\-]|^[\t\r]/.test(text) ? "'" : "") + text.replaceAll('"', '""') + '"'; };
  const rows: unknown[][] = [["Raffle", "Ticket", "Participant", "Type", "Entry reference"]];
  for (const e of entries) for (let n = Number(e.ticket_start); n <= Number(e.ticket_end); n++) rows.push([raffle.name, n, e.name || e.member_name || e.visitor_name, e.member_id ? "Member" : "Visitor", e.id]);
  const blob = new Blob(["\uFEFF" + rows.map((row) => row.map(safeCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = "raffle-tickets-" + raffle.id + ".csv"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SpendingSettings({ earning, action }: { earning: Row; action: Action }) {
  const s = earning.settings;
  return <section className="panel road-stack"><h2>Purchase earning</h2><p>Members earn <strong>1 Murley Buck per {money(s.rateCents)}</strong> of eligible paid merchandise. Fractional dollars carry forward.</p><p className="fine">Includes snacks and gear. Tax, shipping, old purchases, and purchases funded by reward credit do not earn spending rewards. Returns reverse the associated earned points. Manual recognition and other enabled rules continue.</p><ActionForm key={s.version} title="Weekly spending limit" initial={{ weeklyCapPoints: s.weeklyCapPoints, reason: "" }} fields={[{ key: "weeklyCapPoints", label: "Maximum spending Murley Bucks per week (0 = no cap)", type: "number", min: 0, max: 100000, step: "1" }, { key: "reason", label: "Reason for changing the earning limit" }]} busy={action.busy || !!action.pending} submit={(v) => action.send({ action: "rewardEarningSettings", weeklyCapPoints: Number(v.weeklyCapPoints), version: s.version, reason: v.reason })} /><p className="fine">A cap change takes effect in each member’s next new earning week; it does not change a week already in progress. Earning started {date(s.startsAt)}.</p></section>;
}
