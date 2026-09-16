"use client";
import { useEffect, useState } from "react";
import { MessageSquare, Pin, CheckCircle2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Field, date, type Row } from "./shared";
import { useCommunityAction } from "./community-action";
import { ActionFeedback } from "./community";
export default function TeamBoard({ memberId }: { memberId: string }) {
  const [data, setData] = useState<Row>({ records: [], replies: [] }),
    [threadId, setThreadId] = useState(""),
    [creating, setCreating] = useState(false),
    [filter, setFilter] = useState("all"),
    [error, setError] = useState("");
  async function refresh(cursor?: string) {
    const r = await fetch(
        "/api/community?" +
          new URLSearchParams({
            kind: "team",
            threadId,
            ...(cursor ? { cursor } : {}),
          }),
        { cache: "no-store" },
      ),
      j = (await r.json()) as Row;
    if (!r.ok) throw Error(j.error);
    setData((old) =>
      cursor ? { ...j, records: [...old.records, ...j.records] } : j,
    );
  }
  const action = useCommunityAction(memberId, () => refresh()),
    disabled = action.busy || !!action.pending;
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [threadId]);
  const messages = [...data.records]
    .filter(
      (r: Row) =>
        filter === "all" ||
        (filter === "notes" ? r.kind === "note" : r.status === filter),
    )
    .sort(
      (a: Row, b: Row) => b.pinned - a.pinned || b.created_at - a.created_at,
    );
  return (
    <>
      <section className="panel">
        <div className="section-title">
          <div>
            <h2>Team board</h2>
            <p className="fine">
              Private notes and questions for verified administrators.
            </p>
          </div>
          <Button disabled={disabled} onClick={() => setCreating(true)}>
            <Plus size={17} />
            New message
          </Button>
        </div>
        <div className="board-toolbar">
          <Field label="Show">
            <NativeSelect
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All messages</option>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="notes">Team notes</option>
            </NativeSelect>
          </Field>
        </div>
        <ActionFeedback action={action} />
        {error ? <p className="notice error">{error}</p> : null}
        <div className="team-list">
          {messages.map((r: Row) => (
            <button
              className="team-message"
              type="button"
              key={r.id}
              onClick={() => setThreadId(r.id)}
            >
              <span className="team-message-icon">
                {r.pinned ? (
                  <Pin size={20} />
                ) : r.status === "resolved" ? (
                  <CheckCircle2 size={20} />
                ) : (
                  <MessageSquare size={20} />
                )}
              </span>
              <span>
                <strong>{r.title}</strong>
                <small>
                  {r.author_name} · {date(r.created_at)}
                </small>
                <span className="team-excerpt">{r.body}</span>
              </span>
              <span className="team-message-meta">
                <span className={"status " + r.status}>
                  {r.kind === "note"
                    ? "Team note"
                    : r.status === "resolved"
                      ? "Resolved"
                      : "Open"}
                </span>
                <small>{r.reply_count} replies</small>
              </span>
            </button>
          ))}
        </div>
        {!messages.length ? (
          <p className="fine">No messages in this view.</p>
        ) : null}
        {data.nextCursor ? (
          <Button
            variant="secondary"
            onClick={() =>
              refresh(data.nextCursor).catch((e) => setError(e.message))
            }
          >
            Load older messages
          </Button>
        ) : null}
      </section>
      <Dialog
        open={creating}
        onOpenChange={(o) => {
          if (!disabled) setCreating(o);
        }}
      >
        <DialogContent className="pilot-dialog">
          <DialogTitle>Message the team</DialogTitle>
          <DialogDescription>
            Only verified administrators can view this conversation.
          </DialogDescription>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (
                await action.send({
                  action: "teamCreate",
                  title: String(f.get("title")),
                  body: String(f.get("body")),
                  kind: String(f.get("kind")),
                  pinned: f.has("pinned"),
                })
              )
                setCreating(false);
            }}
          >
            <fieldset disabled={disabled}>
              <Field label="Type">
                <NativeSelect name="kind">
                  <option value="question">Question / follow-up</option>
                  <option value="note">Team note</option>
                </NativeSelect>
              </Field>
              <Field label="Title">
                <Input name="title" minLength={3} maxLength={120} required />
              </Field>
              <Field label="Message">
                <textarea name="body" maxLength={4000} required />
              </Field>
              <label className="toggle">
                <input type="checkbox" name="pinned" />
                <span>Pin for attention</span>
              </label>
              <Button type="submit">Post message</Button>
            </fieldset>
          </form>
          <ActionFeedback action={action} />
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!threadId}
        onOpenChange={(o) => {
          if (!o && !disabled) setThreadId("");
        }}
      >
        <DialogContent className="pilot-dialog team-dialog">
          <DialogTitle>
            {data.thread?.id === threadId
              ? data.thread.title
              : "Team conversation"}
          </DialogTitle>
          <DialogDescription>
            Administrator discussion and follow-up.
          </DialogDescription>
          {data.thread?.id === threadId ? (
            <>
              <p className="community-author">
                {data.thread.author_name} · {date(data.thread.created_at)}
              </p>
              <p className="community-body">{data.thread.body}</p>
              <div className="inline-actions">
                <Button
                  variant="secondary"
                  disabled={disabled}
                  onClick={() =>
                    action.send({
                      action: "teamUpdate",
                      id: threadId,
                      version: data.thread.version,
                      status:
                        data.thread.status === "resolved" ? "open" : "resolved",
                      pinned: !!data.thread.pinned,
                    })
                  }
                >
                  {data.thread.status === "resolved"
                    ? "Reopen"
                    : "Mark resolved"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={disabled}
                  onClick={() =>
                    action.send({
                      action: "teamUpdate",
                      id: threadId,
                      version: data.thread.version,
                      status: data.thread.status,
                      pinned: !data.thread.pinned,
                    })
                  }
                >
                  <Pin size={16} />
                  {data.thread.pinned ? "Unpin" : "Pin message"}
                </Button>
              </div>
              <div className="team-replies">
                {data.replies.map((r: Row) => (
                  <div className="team-reply" key={r.id}>
                    <small>
                      <strong>{r.author_name}</strong> · {date(r.created_at)}
                    </small>
                    <p className="community-body">{r.body}</p>
                  </div>
                ))}
              </div>
              {data.replies.length < 100 ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const form = e.currentTarget,
                      f = new FormData(form);
                    if (
                      await action.send({
                        action: "teamReply",
                        id: threadId,
                        body: String(f.get("body")),
                      })
                    )
                      form.reset();
                  }}
                >
                  <fieldset disabled={disabled}>
                    <Field label="Reply">
                      <textarea name="body" required maxLength={2000} />
                    </Field>
                    <Button type="submit">Add reply</Button>
                  </fieldset>
                </form>
              ) : (
                <p className="fine">
                  This thread has reached 100 replies. Start a new follow-up
                  message.
                </p>
              )}
            </>
          ) : (
            <p>Loading conversation…</p>
          )}
          <ActionFeedback action={action} />
        </DialogContent>
      </Dialog>
    </>
  );
}
export function ModerationQueue({
  memberId,
  onMember,
}: {
  memberId: string;
  onMember: (name: string) => void;
}) {
  const [data, setData] = useState<Row>({ records: [] }),
    [error, setError] = useState("");
  async function refresh() {
    const r = await fetch("/api/community?kind=reports", { cache: "no-store" }),
      j = (await r.json()) as Row;
    if (!r.ok) throw Error(j.error);
    setData(j);
  }
  const action = useCommunityAction(memberId, refresh),
    disabled = action.busy || !!action.pending;
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
  return (
    <section className="panel">
      <div className="section-title">
        <div>
          <h2>Community moderation</h2>
          <p className="fine">
            Review reports. Posting permissions are controlled from each
            member’s profile.
          </p>
        </div>
      </div>
      <ActionFeedback action={action} />
      {error ? <p className="notice error">{error}</p> : null}
      {data.records.map((r: Row) => (
        <article className="moderation-report" key={r.id}>
          <h3>{r.title || "Removed post"}</h3>
          <p className="community-body">{r.body}</p>
          <div className="decision-note">
            <strong>Reported by {r.reporter_name}</strong>
            <p>{r.reason}</p>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget),
                remove = f.get("decision") === "remove";
              await action.send(
                remove
                  ? {
                      action: "removePost",
                      id: r.target,
                      kind: r.kind,
                      version: r.post_version,
                      reason: String(f.get("note")),
                    }
                  : {
                      action: "resolveReport",
                      id: r.id,
                      note: String(f.get("note")),
                    },
              );
            }}
          >
            <fieldset disabled={disabled}>
              <div className="form-grid">
                <Field label="Action">
                  <NativeSelect name="decision">
                    <option value="resolve">
                      Keep post and resolve report
                    </option>
                    <option value="remove" disabled={r.removed}>
                      Delete post and resolve report
                    </option>
                  </NativeSelect>
                </Field>
                <Field label="Moderation note">
                  <Input name="note" minLength={5} maxLength={500} required />
                </Field>
              </div>
              <div className="inline-actions">
                <Button type="submit">Save moderation</Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onMember(r.author_name || "")}
                >
                  Manage member posting
                </Button>
              </div>
            </fieldset>
          </form>
        </article>
      ))}
      {!data.records.length ? (
        <div className="empty">
          <CheckCircle2 size={30} />
          <h3>No open reports.</h3>
          <p>Member reports will appear here for review.</p>
        </div>
      ) : null}
    </section>
  );
}
