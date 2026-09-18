"use client";
import { useEffect, useState } from "react";
import {
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  Flag,
  Star,
  Trash2,
} from "lucide-react";
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
import ProductInitiatives, { CreateInitiative } from "./initiatives";
import { useCommunityAction } from "./community-action";
export function ActionFeedback({
  action,
}: {
  action: ReturnType<typeof useCommunityAction>;
}) {
  return (
    <>
      {action.error ? (
        <p className="notice error" role="alert">
          {action.error}
        </p>
      ) : null}
      {action.notice ? (
        <p className="notice success" role="status">
          {action.notice}
        </p>
      ) : null}
      {action.pending ? (
        <div className="notice warning">
          An update is awaiting confirmation.{" "}
          <Button type="button" disabled={action.busy} onClick={action.retry}>
            Retry this update
          </Button>
        </div>
      ) : null}
    </>
  );
}
function Moderation({
  target,
  close,
  action,
}: {
  target: Row | null;
  close: () => void;
  action: ReturnType<typeof useCommunityAction>;
}) {
  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => {
        if (!o && !action.busy) close();
      }}
    >
      <DialogContent className="pilot-dialog">
        <DialogTitle>
          {target?.remove ? "Delete post" : "Report post"}
        </DialogTitle>
        <DialogDescription>
          {target?.remove
            ? "The post will be removed from member view. A moderation record will be kept."
            : "Tell the administrators what needs attention."}
        </DialogDescription>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (
              await action.send({
                action: target?.remove ? "removePost" : "report",
                kind: target?.kind,
                id: target?.id,
                version: target?.version,
                reason: String(f.get("reason")),
              })
            )
              close();
          }}
        >
          <fieldset disabled={action.busy || !!action.pending}>
            <Field label="Reason">
              <textarea name="reason" required minLength={5} maxLength={500} />
            </Field>
            <Button
              type="submit"
              variant={target?.remove ? "destructive" : "default"}
            >
              {target?.remove ? "Delete post" : "Send report"}
            </Button>
          </fieldset>
        </form>
        <ActionFeedback action={action} />
      </DialogContent>
    </Dialog>
  );
}
export default function CommunityBoard({
  member,
  admin,
}: {
  member: Row;
  admin: boolean;
}) {
  const shops = [
    ...(member.snacks || member.role === "admin" ? ["snacks"] : []),
    ...(member.gear || member.role === "admin" ? ["gear"] : []),
  ];
  const [shop, setShop] = useState(shops[0] || ""),
    [data, setData] = useState<Row>({ records: [] }),
    [error, setError] = useState(""),
    [editor, setEditor] = useState<Row | null>(null),
    [moderation, setModeration] = useState<Row | null>(null),
    [decision, setDecision] = useState<Row | null>(null),
    [initiative,setInitiative]=useState<Row|null>(null);
  async function refresh(cursor?: string) {
    if (!shop) return;
    const q = new URLSearchParams({
      kind: "requests",
      shop,
      ...(cursor ? { cursor } : {}),
    });
    const r = await fetch("/api/community?" + q, { cache: "no-store" }),
      j = (await r.json()) as Row;
    if (!r.ok) throw Error(j.error);
    setData((old) =>
      cursor ? { ...j, records: [...old.records, ...j.records] } : j,
    );
  }
  const action = useCommunityAction(member.id, () => refresh());
  useEffect(() => {
    let active = true;
    setError("");
    setData({ records: [] });
    fetch("/api/community?" + new URLSearchParams({ kind: "requests", shop }), {
      cache: "no-store",
    })
      .then(async (r) => {
        const j = (await r.json()) as Row;
        if (!r.ok) throw Error(j.error);
        if (active) setData(j);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [shop]);
  const disabled = action.busy || !!action.pending;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Made for the unit</span>
          <h1>What should we stock?</h1>
          <p>Suggest an item, weigh in, and follow the team’s decision.</p>
        </div>
        <Button
          disabled={!data.postingEnabled || disabled || !shop}
          onClick={() => setEditor({})}
        >
          <MessageSquare size={18} />
          Request an item
        </Button>
      </div>
      <div className="board-toolbar">
        <div className="inline-actions" role="group" aria-label="Request shop">
          {shops.map((s) => (
            <Button
              type="button"
              key={s}
              variant={shop === s ? "default" : "secondary"}
              aria-pressed={shop === s}
              onClick={() => setShop(s)}
            >
              {s === "snacks" ? "Snack bar" : "Unit gear"}
            </Button>
          ))}
        </div>
        <a className="text-link" href="mailto:snackbar@iyaayasfw.com">
          Need help?
        </a>
      </div>
      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}
      <ActionFeedback action={action} />
      {data.postingEnabled === false ? (
        <p className="notice">
          Posting is disabled for your account. You can still read requests and
          contact the store team.
        </p>
      ) : null}
      <ProductInitiatives key={shop} member={member} shop={shop} />
      <CreateInitiative request={initiative} close={()=>setInitiative(null)} refresh={()=>refresh()} />
      <div className="community-list">
        {data.records.map((r: Row) => (
          <article className="panel community-card" key={r.id}>
            <div className="section-title">
              <h2>{r.title}</h2>
              <span className={"status " + r.status}>
                {r.status === "open"
                  ? "Under consideration"
                  : r.status === "accepted"
                    ? "Accepted"
                    : "Not planned"}
              </span>
            </div>
            <p className="community-author">
              {r.author_name} · {date(r.created_at)}
            </p>
            {r.body ? <p className="community-body">{r.body}</p> : null}
            {r.decision_note ? (
              <div className="decision-note">
                <strong>From the store team</strong>
                <p>{r.decision_note}</p>
              </div>
            ) : null}
            <div className="community-actions">
              <div className="inline-actions">
                <Button
                  type="button"
                  variant="outline"
                  aria-label={"Like " + r.title}
                  aria-pressed={r.my_vote === 1}
                  disabled={disabled || !data.postingEnabled}
                  onClick={() =>
                    action.send({
                      action: "vote",
                      id: r.id,
                      value: r.my_vote === 1 ? 0 : 1,
                    })
                  }
                >
                  <ThumbsUp size={16} />
                  {r.likes}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  aria-label={"Dislike " + r.title}
                  aria-pressed={r.my_vote === -1}
                  disabled={disabled || !data.postingEnabled}
                  onClick={() =>
                    action.send({
                      action: "vote",
                      id: r.id,
                      value: r.my_vote === -1 ? 0 : -1,
                    })
                  }
                >
                  <ThumbsDown size={16} />
                  {r.dislikes}
                </Button>
                {r.member_id === member.id &&
                r.status === "open" &&
                data.postingEnabled ? (
                  <Button
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => setEditor(r)}
                  >
                    Edit
                  </Button>
                ) : null}
              </div>
              <div className="inline-actions">
                {admin ? (
                  <>
                    <Button variant="secondary" disabled={disabled || r.status==="denied" || !!r.initiative_id} onClick={()=>setInitiative(r)}>{r.initiative_id?"Linked product created":"Create trial / interest check"}</Button>
                    <Button
                      variant="secondary"
                      disabled={disabled}
                      onClick={() => setDecision(r)}
                    >
                      Set status
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={"Delete " + r.title}
                      disabled={disabled}
                      onClick={() =>
                        setModeration({ ...r, kind: "request", remove: true })
                      }
                    >
                      <Trash2 size={16} />
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => setModeration({ ...r, kind: "request" })}
                  >
                    <Flag size={15} />
                    Report
                  </Button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {!error && !data.records.length ? (
        <div className="panel empty">
          <MessageSquare size={30} />
          <h2>Make the first suggestion.</h2>
          <p>Requests for this shop will appear here.</p>
        </div>
      ) : null}
      {data.nextCursor ? (
        <Button
          variant="secondary"
          onClick={() =>
            refresh(data.nextCursor).catch((e) => setError(e.message))
          }
        >
          Load more requests
        </Button>
      ) : null}
      <Dialog
        open={!!editor}
        onOpenChange={(o) => {
          if (!o && !action.busy) setEditor(null);
        }}
      >
        <DialogContent className="pilot-dialog">
          <DialogTitle>
            {editor?.id ? "Edit request" : "Request an item"}
          </DialogTitle>
          <DialogDescription>
            Your request appears immediately to members with access to this
            shop.
          </DialogDescription>
          {editor ? (
            <form
              key={editor.id || "new"}
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                if (
                  await action.send({
                    action: editor.id ? "requestEdit" : "requestCreate",
                    id: editor.id,
                    version: editor.version,
                    shop,
                    title: String(f.get("title")),
                    body: String(f.get("body")),
                  })
                )
                  setEditor(null);
              }}
            >
              <fieldset disabled={disabled}>
                <Field label="Item name">
                  <Input
                    name="title"
                    defaultValue={editor.title}
                    minLength={5}
                    maxLength={100}
                    required
                  />
                </Field>
                <Field label="Details (optional)">
                  <textarea
                    name="body"
                    defaultValue={editor.body}
                    maxLength={2000}
                    placeholder="Brand, flavor, size, or why you would like it."
                  />
                </Field>
                <Button type="submit">
                  {editor.id ? "Save request" : "Post request"}
                </Button>
              </fieldset>
            </form>
          ) : null}
          <ActionFeedback action={action} />
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!decision}
        onOpenChange={(o) => {
          if (!o && !action.busy) setDecision(null);
        }}
      >
        <DialogContent className="pilot-dialog">
          <DialogTitle>Update request</DialogTitle>
          <DialogDescription>
            The status and explanation are visible to members.
          </DialogDescription>
          {decision ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                if (
                  await action.send({
                    action: "requestDecision",
                    id: decision.id,
                    version: decision.version,
                    status: String(f.get("status")),
                    note: String(f.get("note")),
                  })
                )
                  setDecision(null);
              }}
            >
              <fieldset disabled={disabled}>
                <Field label="Decision">
                  <NativeSelect name="status" defaultValue={decision.status}>
                    <option value="open">Under consideration</option>
                    <option value="accepted">Accepted</option>
                    <option value="denied">Not planned</option>
                  </NativeSelect>
                </Field>
                <Field label="Team explanation">
                  <textarea
                    name="note"
                    defaultValue={decision.decision_note}
                    minLength={5}
                    maxLength={500}
                    required
                  />
                </Field>
                <Button type="submit">Save decision</Button>
              </fieldset>
            </form>
          ) : null}
          <ActionFeedback action={action} />
        </DialogContent>
      </Dialog>
      <Moderation
        target={moderation}
        close={() => setModeration(null)}
        action={action}
      />
    </>
  );
}
export function Stars({ rating }: { rating: number }) {
  return (
    <span className="stars" aria-label={rating + " out of 5 stars"}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={16}
          aria-hidden="true"
          fill={n <= rating ? "currentColor" : "none"}
        />
      ))}
    </span>
  );
}
export function ProductReviews({
  productId,
  member,
}: {
  productId: string;
  member: Row;
}) {
  const [data, setData] = useState<Row>({ records: [] }),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(false),
    [moderation, setModeration] = useState<Row | null>(null);
  async function refresh(cursor?: string) {
    const r = await fetch(
        "/api/community?" +
          new URLSearchParams({
            kind: "reviews",
            productId,
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
  const action = useCommunityAction(member.id, () => refresh()),
    disabled = action.busy || !!action.pending;
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [productId]);
  return (
    <section className="panel product-reviews">
      <div className="section-title">
        <div>
          <h2>Member reviews</h2>
          <p className="fine">
            {data.summary?.count
              ? Number(data.summary.average).toFixed(1) +
                " out of 5 · " +
                data.summary.count +
                " reviews"
              : "No reviews yet"}
          </p>
        </div>
        {data.canReview ? (
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() => setEditing(!editing)}
          >
            {data.mine ? "Edit my review" : "Write a review"}
          </Button>
        ) : null}
      </div>
      {!data.canReview ? (
        <p className="fine">
          {data.postingEnabled === false
            ? "Posting is disabled for your account."
            : "Reviews are available to members with a recorded purchase of this item."}
        </p>
      ) : null}
      {error ? <p className="notice error">{error}</p> : null}
      <ActionFeedback action={action} />
      {editing && data.canReview ? (
        <form
          className="review-editor"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (
              await action.send({
                action: "reviewSave",
                productId,
                version: data.mine?.version,
                rating: Number(f.get("rating")),
                body: String(f.get("body")),
              })
            )
              setEditing(false);
          }}
        >
          <fieldset disabled={disabled}>
            <fieldset className="rating-input">
              <legend>Your rating</legend>
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n}>
                  <input
                    type="radio"
                    name="rating"
                    value={n}
                    required
                    defaultChecked={data.mine?.rating === n}
                  />
                  <span>
                    {n}
                    <Star size={16} />
                  </span>
                </label>
              ))}
            </fieldset>
            <Field label="Review (optional)">
              <textarea
                name="body"
                maxLength={2000}
                defaultValue={data.mine?.body}
                placeholder="What did you think?"
              />
            </Field>
            <div className="inline-actions">
              <Button type="submit">Publish review</Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </div>
          </fieldset>
        </form>
      ) : null}
      {data.records.map((r: Row) => (
        <article className="review" key={r.id}>
          <div className="section-title">
            <Stars rating={r.rating} />
            <small>{date(r.updated_at)}</small>
          </div>
          <p>
            <strong>{r.author_name}</strong>
            <span className="verified-purchase">Verified purchase</span>
          </p>
          {r.body ? <p className="community-body">{r.body}</p> : null}
          <div className="inline-actions">
            {data.admin ? (
              <Button
                variant="ghost"
                disabled={disabled}
                onClick={() =>
                  setModeration({ ...r, kind: "review", remove: true })
                }
              >
                <Trash2 size={15} />
                Delete review
              </Button>
            ) : r.member_id !== member.id ? (
              <Button
                variant="ghost"
                disabled={disabled}
                onClick={() => setModeration({ ...r, kind: "review" })}
              >
                <Flag size={15} />
                Report
              </Button>
            ) : null}
          </div>
        </article>
      ))}
      {data.nextCursor ? (
        <Button
          variant="secondary"
          onClick={() =>
            refresh(data.nextCursor).catch((e) => setError(e.message))
          }
        >
          Load more reviews
        </Button>
      ) : null}
      <Moderation
        target={moderation}
        close={() => setModeration(null)}
        action={action}
      />
    </section>
  );
}
