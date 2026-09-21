"use client";
import {secureFetch} from "@/lib/identity/client";
import {IdentityLinks} from './store/identity-links';
import IdentityPage from './identity/page';
import { useEffect, useRef, useState } from "react";
import {
  ShoppingBag,
  Plus,
  Minus,
  Search,
  Wallet,
  Shirt,
  SlidersHorizontal,
  ArrowUpRight,
  Check,
  RefreshCw,
  LockKeyhole,
  Package,
  ArrowLeft,
  ChevronRight,
  CircleHelp,
  ReceiptText,
  Download,
  Medal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import HistoryPager from "./store/history-pager";
import {
  productAvailability as availability,
  productReady as readyForSale,
  loadCart,
  saveCart,
  cartLines,
  canAddLine,
  productPrice,
  gearKey,
} from "@/lib/pilot/cart";
import PricingHub from "./store/pricing-hub";
import GearManager from "./store/gear-manager";
import GuestManager from "./store/guest-manager";
import InventoryAutopilot, {MonthClose} from "./store/inventory-autopilot";
import Rewards from "./store/rewards";
import AdminNavigation from "./store/admin-navigation";
import AdminDashboard from "./store/admin-dashboard";
import { AccountProfileCard } from "./store/member-flair";
import PickupBoard from "./store/pickup-board";
import Checkout from "./store/checkout";
import BagItems from "./store/bag-items";
import InstallGuide from "./store/install-guide";
import CommunityBoard from "./store/community";
import TaskInbox from "./store/task-inbox";
import EmailChanges from "./store/email-changes";
import ProductInitiatives from "./store/initiatives";
import TeamBoard, { ModerationQueue } from "./store/team-board";
import TransactionHub from "./store/transaction-hub";
import { PaymentConfirmation, TabPayment, CashAppHandoff } from "./store/payment-forms";
import { clearPaymentDraft } from "@/lib/cashapp";
import { ThemeToggle, ThemePicker, BrandMark } from "./store/appearance";
import { MessageSquare } from "lucide-react";
import { ReceiveFields } from "./store/cost-inputs";
type Row = Record<string, any>;
const money = (v: number | null | undefined) =>
  v == null
    ? "Not set"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(v / 100);
const date = (v: number) =>
  new Date(v).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const labels: Row = {
  cash: "Cash",
  cashapp: "Cash App",
  tab: "Member tab",
  credit: "Prepaid credit",
  purchase: "Purchase",
  settlement: "Tab payment",
  topup: "Credit deposit",
  pending: "Awaiting confirmation",
  verified: "Confirmed",
  paid: "Paid",
  void: "Voided",
  rejected: "Rejected",
  refund: "Refund",
};
function Field({
  label,
  name,
  value,
  type = "text",
  required = false,
  step,
  min,
  children,
}: {
  label: string;
  name?: string;
  value?: any;
  type?: string;
  required?: boolean;
  step?: string;
  min?: string;
  children?: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children || (
        <Input
          name={name}
          type={type}
          defaultValue={value ?? ""}
          required={required}
          step={step}
          min={min}
        />
      )}
    </label>
  );
}
function Toggle({
  name,
  label,
  checked = false,
}: {
  name: string;
  label: string;
  checked?: boolean;
}) {
  return (
    <label className="toggle">
      <input type="checkbox" name={name} defaultChecked={checked} />
      <span>{label}</span>
    </label>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <Package size={28} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function Status({ value }: { value: string }) {
  return <span className={"status " + value}>{labels[value] || value}</span>;
}
export default function Pilot() {
  const [data, setData] = useState<Row>({
    products: [],
    settings: {
      enabled: 0,
      cashtag: "",
      cash_instructions: "",
      reminder_days: 7,
    },
    member: null,
    signedIn: false,
    orders: [],
    payments: [],
  });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [view, setView] = useState("account"),
    [tab, setTab] = useState("overview"),
    [category, setCategory] = useState("All"),
    [search, setSearch] = useState(""),
    [cart, setCart] = useState<Record<string, number>>({}),
    [modal, setModal] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Row | null>(null),
    [receipt, setReceipt] = useState<Row | null>(null);
  const [inventorySearch, setInventorySearch] = useState(""),
    [inventoryCategory, setInventoryCategory] = useState("All"),
    [memberSearch, setMemberSearch] = useState(""),
    [memberFilter, setMemberFilter] = useState("all"),
    [uploading, setUploading] = useState(false);
  const [paymentFilter, setPaymentFilter] = useState("pending");
  const [emailTarget,setEmailTarget]=useState<Row|null>(null);
  const [inboxType,setInboxType]=useState("");
  const [identityContext,setIdentityContext]=useState<Row|null>(null);
  const [memberWorkspace,setMemberWorkspace]=useState<'roster'|'identity'>('roster');
  const [identityMemberId,setIdentityMemberId]=useState<string|undefined>();
  function showMemberSignIn(id?:string){setIdentityMemberId(id);setMemberWorkspace('identity');setTab('members');}
  const [taskTarget,setTaskTarget]=useState({type:"",id:""});
  const [gearRevision, setGearRevision] = useState(0);
  const [gearId, setGearId] = useState(""),
    [pricingId, setPricingId] = useState(""),
    [showArchived, setShowArchived] = useState(false);
  const busyRef = useRef(false),
    readSequence = useRef(0);
  const member = data.member,
    admin = member?.role === "admin",
    owner = !!member?.isOwner;
  async function refresh() {
    const sequence = ++readSequence.current;
    try {
      const requested = loading
        ? new URLSearchParams(window.location.search).get("view") || "snacks"
        : view;
      const q = new URLSearchParams({
        view:
          requested === "admin"
            ? "admin"
            : requested === "account"
              ? "account"
              : "catalog",
        section: tab,
        search: memberSearch,
        filter:
          tab === "members"
            ? memberFilter
            : tab === "payments"
              ? paymentFilter
              : "all",
      });
      const r = await secureFetch("/api/pilot?" + q, { cache: "no-store" });
      const j = (await r.json()) as Row;
      if (r.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (!r.ok) throw Error(j.error);
      if (sequence !== readSequence.current) return;
      setData(j);
      setView((current) => {
        const requested = loading
            ? new URLSearchParams(window.location.search).get("view") ||
              "snacks"
            : current,
          preferred = [
            "snacks",
            "gear",
            "account",
            "admin",
            "requests",
            "recognition",
          ].includes(requested)
            ? requested
            : "snacks";
        const admin = j.member.role === "admin";
        return preferred === "snacks" && !admin && !j.member.snacks
          ? j.member.gear
            ? "gear"
            : "account"
          : preferred === "gear" && !admin && !j.member.gear
            ? j.member.snacks
              ? "snacks"
              : "account"
            : preferred === "admin" && !admin
              ? "account"
              : preferred;
      });
      setLoading(false);
    } catch (e) {
      if (sequence !== readSequence.current) return;
      setLoading(false);
      setError(e instanceof Error ? e.message : "The store could not load.");
    }
  }
  useEffect(() => {
    setCart(loadCart());
    const params=new URLSearchParams(window.location.search),section=params.get('section');
    if(section==='identity'||section==='members'){setTab('members');if(section==='identity'||params.get('workspace')==='identity')setMemberWorkspace('identity');}
    void fetch('/identity/api',{cache:'no-store'}).then(r=>r.json() as Promise<Row>).then(c=>{setIdentityContext(c);}).catch(()=>{});
    try {
      const p = JSON.parse(sessionStorage.getItem("supply-pending") || "null");
      if (p) setPending(p);
    } catch {}
  }, []);
  useEffect(() => {
    saveCart(cart);
  }, [cart]);
  useEffect(() => {
    const timer = setTimeout(() => {
      void refresh();
    }, 200);
    return () => clearTimeout(timer);
  }, [view, tab, memberSearch, memberFilter, paymentFilter]);
  function historyControl(dataset: string, management = false) {
    const source = management ? data.admin : data;
    return (
      <HistoryPager
        cursor={source?.pages?.[dataset]}
        dataset={dataset}
        admin={management}
        filter={
          dataset === "members"
            ? memberFilter
            : dataset === "payments" && management
              ? paymentFilter
              : ""
        }
        search={dataset === "members" ? memberSearch : ""}
        onPage={(page) =>
          setData((old) => {
            const target = management ? old.admin : old,
              existing = new Set((target[dataset] || []).map((r: Row) => r.id)),
              next = {
                ...target,
                [dataset]: [
                  ...(target[dataset] || []),
                  ...page.records.filter((r: Row) => !existing.has(r.id)),
                ],
                pages: { ...target.pages, [dataset]: page.nextCursor },
              };
            return management ? { ...old, admin: next } : next;
          })
        }
      />
    );
  }
  const navigate = (v: string) => {
    if(v==='admin'&&identityContext?.management?.href&&new URL(identityContext.management.href).origin!==window.location.origin){window.location.assign(identityContext.management.href);return;}
    if(v!=='admin'&&identityContext?.host==='admin'){window.location.assign(identityContext.origins.member+'/?view='+encodeURIComponent(v));return;}
    window.history.replaceState(null, "", "/?view=" + v);
    setView(v);
    setError("");
    setNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const products = data.products as Row[],
    readyProducts = products.filter((p) => readyForSale(p as any)),
    lines = cartLines(cart, products),
    count = lines.reduce((s, p) => s + p.qty, 0),
    total = lines.reduce((s, p) => s + (p.price || 0) * p.qty, 0);
  function qty(key: string, n: number) {
    if (busyRef.current || pending) return;
    const line = lines.find((p) => p.key === key),
      p = line || products.find((p) => p.id === key);
    if (!p) return;
    if (
      n > 0 &&
      (!data.settings.enabled || !p.active || p.archived || p.price === null)
    )
      return;
    if (n > 0) {
      const candidate = line || {
        ...p,
        key,
        qty: 0,
        currentPrice: p.price,
        stockKey: p.id,
      };
      const quantity = candidate.qty + n;
      if (
        quantity > 30 ||
        (line
          ? !canAddLine(line, lines)
          : !readyForSale(p as any) || (!p.preorder && p.stock < quantity))
      )
        return;
    }
    setCart((c) => {
      const q = Math.max(0, Math.min(30, (c[key] || 0) + n));
      const next = { ...c };
      if (q) next[key] = q;
      else delete next[key];
      return next;
    });
  }
  function removeLine(key: string) {
    if (busyRef.current || pending) return;
    setCart((c) => {
      const next = { ...c };
      delete next[key];
      return next;
    });
  }
  function acceptPrice(p: Row) {
    if (busyRef.current || pending || !p.currentPrice || p.missingOption)
      return;
    const key = gearKey(
      p.id,
      p.variantId || "",
      p.personalization || "",
      p.currentPrice,
    );
    if ((cart[key] || 0) + p.qty > 30) {
      setError(
        "Reduce this option to 30 units before accepting the new price.",
      );
      return;
    }
    setCart((c) => {
      const next = { ...c };
      delete next[p.key];
      next[key] = (next[key] || 0) + p.qty;
      return next;
    });
  }
  async function send(payload: Row, retry = false) {
    if (busyRef.current) return;
    if (pending && !retry) {
      setError("Resolve the pending action before starting another.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const request = retry
      ? payload
      : { ...payload, requestId: crypto.randomUUID() };
    if (
      ["order", "payment", "creditSettlement"].includes(request.action) &&
      !request.id
    )
      request.id = request.requestId;
    setPending(request);
    try {
      sessionStorage.setItem("supply-pending", JSON.stringify(request));
    } catch {}
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const r = await secureFetch("/api/pilot", {
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
            sessionStorage.removeItem("supply-pending");
          } catch {}
        }
        throw Error(j.error || "The request could not be confirmed.");
      }
      setPending(null);
      try {
        sessionStorage.removeItem("supply-pending");
      } catch {}
      setModal(null);
      if (j.order) {
        if (request.action === "order")
          setCart((current) => {
            const next = { ...current };
            for (const item of request.items || []) {
              const key =
                item.cartKey ||
                cartLines(current, products).find(
                  (p) =>
                    p.id === item.id &&
                    (p.variantId || "") === (item.variantId || "") &&
                    (p.personalization || "") === (item.personalization || ""),
                )?.key;
              if (key) {
                const remaining = (next[key] || 0) - item.qty;
                if (remaining > 0) next[key] = remaining;
                else delete next[key];
              }
            }
            return next;
          });
        setReceipt({ kind: "order", ...j.order });
      } else if (j.payment) {
        clearPaymentDraft("supply-tab-payment:" + member.id, j.payment.id);
        setReceipt({ kind: "payment", ...j.payment });
      }
      else
        setNotice(
          j.reference
            ? "Confirmed · receipt " + j.reference
            : j.roleChanged
              ? "Access updated. This member can sign in again with their existing password."
              : request.action === "shop"
                ? request.enabled
                  ? "Shop is open. Members can check out."
                  : "Shop is paused."
                : "Saved.",
        );
      try {
        await refresh();
      } catch {
        setError(
          "Saved successfully. Refresh the page to load the latest records.",
        );
      }
      if (j.created && j.memberId) {
        if(identityContext?.enabled===false){
          setModal({kind:"setup",id:j.memberId,name:request.name,email:request.email});
          setNotice("Member added. Generate a private setup code for their First Time sign-in.");
        }else{
          setModal(null);
          if(identityContext?.owner)showMemberSignIn(j.memberId);
          setNotice("Member added to the whitelist. The owner can now share a private invitation from Members & access.");
        }
      }
      if (request.action === "saveGear") {
        setGearId(request.id);
        setGearRevision((n) => n + 1);
      }
      return j;
    } catch (e) {
      setError(
        e instanceof Error && e.name !== "AbortError"
          ? e.message
          : "Confirmation did not arrive. Retry the pending action; it will not be recorded twice.",
      );
      return false;
    } finally {
      clearTimeout(timeout);
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function authAction(
    action: string,
    memberId?: string,
    password?: string,
    currentPassword?: string,
    identityVerified = false,
  ) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await secureFetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          memberId,
          password,
          currentPassword,
          identityVerified,
        }),
      });
      const j = (await r.json()) as Row;
      if (!r.ok) throw Error(j.error || "Could not update access.");
      if (action === "logout" || j.signedOut) {
        sessionStorage.removeItem("supply-pending");
        sessionStorage.removeItem("supply-bag-v2");
        window.location.replace("/login");
        return;
      }
      if (j.code)
        setModal((m) => ({ ...m, code: j.code, expiresAt: j.expiresAt }));
      else setModal(null);
      setNotice(
        action === "changePassword"
          ? "Password changed. Your other devices were signed out."
          : ["issueSetup", "issueRecovery"].includes(action)
            ? "Private code generated. Share it only with the verified member."
            : action === "resolveReset"
              ? "Reset request resolved."
              : action === "password"
                ? "Password replaced. Previous device sessions were signed out."
                : "All devices signed out.",
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function open(kind: string, row: Row = {}) {
    setError("");
    if (kind === "product" && row.category === "Gear") {
      setGearId(row.id);
      setTab("inventory");
      return;
    }
    setModal({ ...row, kind });
  }
  function checkout() {
    open("checkout");
  }
  const openedBag = useRef(false);
  useEffect(() => {
    if (
      !loading &&
      !openedBag.current &&
      new URLSearchParams(window.location.search).get("bag") === "1"
    ) {
      openedBag.current = true;
      setModal({ kind: "checkout" });
      window.history.replaceState(null, "", "/?view=" + view);
    }
  }, [loading]);
  const basket = (
    <>
      <div className="section-title">
        <h2>Your bag</h2>
        <span className="muted">{count} items</span>
      </div>
      {!count ? (
        <Empty
          title="Ready when you are."
          text="Add the items you're taking."
        />
      ) : (
        <BagItems
          lines={lines}
          busy={busy || !!pending}
          onQuantity={qty}
          onRemove={removeLine}
          onPrice={acceptPrice}
        />
      )}

      <div className="bag-total">
        <span>Total</span>
        <strong>{money(total)}</strong>
      </div>
      <p className="fine">Prices include any configured tax.</p>
      <p className="bag-credit">
        <strong>{money(member?.credit || 0)} credit available</strong>
        <small>Choose whether to spend it at checkout.</small>
      </p>
    </>
  );
  const memberGate = (
    <section className="gate panel">
      <LockKeyhole size={30} />
      <h2>A little more for members.</h2>
      <p>
        Use your invited account for unit gear, prepaid credit, and a running
        tab.
      </p>
      {!data.signedIn ? (
        <Button asChild>
          <a href="/" target="_top">
            Sign in for member access
          </a>
        </Button>
      ) : (
        <p className="notice">
          Your signed-in email has not been added to the unit member list yet.
        </p>
      )}
      <Button variant="ghost" onClick={() => navigate("snacks")}>
        Return to snacks
      </Button>
    </section>
  );
  function overdue(m: Row) {
    return (
      m.debt > 0 &&
      m.due_since &&
      Date.now() - m.due_since >= data.settings.reminder_days * 86400000
    );
  }
  const filteredProducts = products.filter(
    (p) =>
      (showArchived || !p.archived) &&
      (inventoryCategory === "All" || p.category === inventoryCategory) &&
      p.name.toLowerCase().includes(inventorySearch.trim().toLowerCase()),
  );
  const filteredMembers = (data.admin?.members || []).filter(
    (m: Row) =>
      (m.name + " " + m.email)
        .toLowerCase()
        .includes(memberSearch.trim().toLowerCase()) &&
      {
        all: true,
        active: !!m.active,
        inactive: !m.active,
        invited: !!m.active && !m.user_id,
        owing: m.debt > 0,
        overdue: overdue(m),
        credit: m.credit > 0,
        admins: m.role === "admin",
        password: !m.password_set,
        gearOnly: !m.snacks && !!m.gear,
      }[memberFilter],
  );
  async function copyEmail(m: Row) {
    try {
      await navigator.clipboard.writeText(m.email);
      setNotice("Email address copied for " + m.name + ".");
    } catch {
      open("contact", m);
    }
  }
  function reminderLink(m: Row) {
    return (
      "mailto:" +
      encodeURIComponent(m.email) +
      "?subject=" +
      encodeURIComponent("Unit Supply — balance reminder") +
      "&body=" +
      encodeURIComponent(
        "Hi " +
          m.name +
          ",\n\nYour Unit Supply tab currently has a balance of " +
          money(m.debt) +
          ". Please review your account and arrange payment when you can:\n" +
          window.location.origin +
          "\n\nIf you have already paid, please reply with your payment reference so we can reconcile it.\n\nThank you.",
      )
    );
  }
  async function uploadImage(file: File | undefined) {
    if (!file) return;
    setError("");
    if (file.size > 5 * 1024 * 1024) {
      setError("Choose an image smaller than 5 MB.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.set("image", file);
      const response = await secureFetch("/api/product-images", {
        method: "POST",
        body: form,
      });
      const result = (await response.json()) as Row;
      if (!response.ok) throw Error(result.error);
      setModal((m) =>
        m?.kind === "product" ? { ...m, image: result.image } : m,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Image upload failed. Try again.",
      );
    } finally {
      setUploading(false);
    }
  }
  function exportData(f: FormData) {
    const kind = String(f.get("dataset")),
      from = String(f.get("from") || ""),
      to = String(f.get("to") || "");
    if (from && to && from > to) {
      setError("The start date must be on or before the end date.");
      return;
    }
    const q = new URLSearchParams({ dataset: kind, from, to });
    const link = document.createElement("a");
    link.href = "/api/export?" + q;
    link.target = "_blank";
    link.rel = "noopener";
    link.click();
    setModal(null);
    setNotice(
      "Export requested. All matching records are included, including older pages.",
    );
  }
  function ordersTable(list: Row[]) {
    return list.length ? (
      <div className="table-wrap">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Purchase</TableHead>
              <TableHead>Member / payer</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((o) => (
              <TableRow key={o.id}>
                <TableCell>
                  <strong>{o.code}</strong>
                  <small>{date(o.created_at)}</small>
                </TableCell>
                <TableCell>{o.payer}</TableCell>
                <TableCell>{labels[o.method]}</TableCell>
                <TableCell>
                  {money(o.status === "void" ? 0 : o.total)}
                  {o.adjusted_total > 0 ? (
                    <small>
                      {money(o.original_total)} originally · corrected
                    </small>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Status value={o.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    ) : (
      <Empty
        title="No purchases yet"
        text="Recorded purchases will appear here."
      />
    );
  }
  function overview() {
    const a = data.admin,
      { sales, received, owed, credits, tax, costs, morale } = a.summary,
      sold = Object.fromEntries(
        a.summary.sold.map((r: Row) => [r.name, r.qty]),
      );
    return (
      <>
        <AdminDashboard onNavigate={setTab} onInbox={type=>{setInboxType(type);setTab("attention")}} />
        <div className="stats">
          <div className="stat">
            <small>Recorded sales</small>
            <b>{money(sales)}</b>
            <span>Includes unpaid purchases</span>
          </div>
          <div className="stat">
            <small>Confirmed payments</small>
            <b>{money(received)}</b>
            <span>External receipts, less cash refunds</span>
          </div>
          <div className="stat">
            <small>Awaiting confirmation</small>
            <b>{a.summary.pending}</b>
            <button type="button" onClick={() => setTab("payments")}>
              Review payments <ChevronRight size={15} />
            </button>
          </div>
          <div className="stat">
            <small>Member tabs</small>
            <b>{money(owed)}</b>
            <span>Outstanding balances</span>
          </div>
        </div>
        <div className="two-col">
          <section className="panel">
            <div className="section-title">
              <h2>Moving off the shelf</h2>
              <span className="fine">Units taken · all time</span>
            </div>
            {Object.keys(sold).length ? (
              Object.entries(sold)
                .sort((a: any, b: any) => b[1] - a[1])
                .slice(0, 6)
                .map(([name, n]: any) => (
                  <div className="rank" key={name}>
                    <span>{name}</span>
                    <strong>{n}</strong>
                  </div>
                ))
            ) : (
              <Empty
                title="Your first insights start here"
                text="Each recorded item contributes to your sales history."
              />
            )}
          </section>
          <section className="panel">
            <div className="section-title">
              <h2>Funds & obligations</h2>
            </div>
            <dl className="numbers">
              <div>
                <dt>Prepaid credit held</dt>
                <dd>{money(credits)}</dd>
              </div>
              <div>
                <dt>Recorded tax</dt>
                <dd>{money(tax)}</dd>
              </div>
              <div>
                <dt>Item cost</dt>
                <dd>{costs === null ? "Costs incomplete" : money(costs)}</dd>
              </div>
              <div>
                <dt>Morale spending</dt>
                <dd>{money(morale)}</dd>
              </div>
              <div>
                <dt>Contribution before payment fees</dt>
                <dd>
                  {costs === null
                    ? "Costs incomplete"
                    : money(sales - tax - costs - morale)}
                </dd>
              </div>
            </dl>
            <p className="fine">
              Contribution includes unpaid sales and unfulfilled preorders. It
              is not available cash. No bank account is connected.
            </p>
            <div className="inline-actions">
              <Button variant="secondary" onClick={() => open("expense")}>
                Record expense
              </Button>
              <Button variant="secondary" onClick={() => open("cashcount")}>
                Count cash
              </Button>
            </div>
          </section>
        </div>
        <section className="panel">
          <div className="section-title">
            <h2>Recent purchases</h2>
            <Button variant="ghost" onClick={() => setTab("activity")}>
              View all
            </Button>
          </div>
          {ordersTable(a.orders.slice(0, 8))}
        </section>
      </>
    );
  }
  function adminView() {
    return (
      <>
        <div className="page-heading">
          <div>
            <span className="eyebrow">Store management</span>
            <h1>Manage your store.</h1>
            <IdentityLinks/>
            <p>Money, products, and people. Everything in its place.</p>
          </div>
          <div className="inline-actions">
            <a className="text-link" href={identityContext?.host==='admin'?'/identity':'/api/admin/access'}>
              Verify access
            </a>
            <Button variant="secondary" onClick={() => open("export")}>
              <Download size={17} />
              Export CSV
            </Button>
          </div>
        </div>
        <div className="management-workspace">
        <AdminNavigation value={tab} onChange={next=>{setInboxType("");setTaskTarget({type:"",id:""});setTab(next)}} />
        <div className="admin-content">
          {["overview", "settings"].includes(tab) ? shopControls() : null}
          {data.admin.resetCount ? (
            <div className="notice reset-notice">
              <strong>
                {data.admin.resetCount} password reset{" "}
                {data.admin.resets.length === 1 ? "request" : "requests"}
              </strong>
              <Button variant="secondary" onClick={() => setTab("members")}>
                Review requests
              </Button>
            </div>
          ) : null}
          {tab === "attention" ? (
            <TaskInbox key={inboxType} initialType={inboxType} member={member} onAction={(destination,target,person,type,reference)=>{
              if(destination==="requests"){navigate("requests");return}
              setTaskTarget({type,id:target});setTab(destination);
              if(type==="payment"){setPaymentFilter("all");open("verify",{id:target,amount:0,member_name:person,order_code:reference.startsWith("P-")?undefined:reference});}
              if(destination==="members")setMemberSearch(person);
              if(destination==="inventory"){const p=products.find(p=>p.id===target);if(p?.category==="Gear")setGearId(target);else setInventorySearch(p?.name||person)}
            }}/>
          ) : tab === "access" ? (
            <EmailChanges member={member} admin targetMember={emailTarget||undefined}/>
          ) : tab === "trials" ? (
            <ProductInitiatives member={member} admin onProduct={id=>{const p=products.find(p=>p.id===id);if(p?.category==="Gear"){setGearId(id);setTab("inventory")}else if(p){setTab("inventory");open("product",p)}else{setInventorySearch("");setTab("inventory");refresh()}}}/>
          ) : tab === "guest" ? (
            <GuestManager key={taskTarget.type+":"+taskTarget.id} initialOrderId={taskTarget.type==="guest"?taskTarget.id:""} onProduct={id=>{setGearId(id);setTab("inventory")}} onPayments={()=>setTab("payments")} onTransactions={()=>setTab("transactions")} onPickups={()=>setTab("pickups")}/>
          ) : tab === "planning" ? (
            <InventoryAutopilot/>
          ) : tab === "month" ? (
            <MonthClose/>
          ) : tab === "rewards" ? (
            <Rewards key={taskTarget.type+":"+taskTarget.id} admin initialProfileId={taskTarget.type==="profile"?taskTarget.id:""} initialReportId={taskTarget.type==="profile-report"?taskTarget.id:""}/>
          ) : tab === "overview" ? (
            overview()
          ) : tab === "transactions" ? (
            <TransactionHub
              data={data}
              send={send}
              busy={busy || !!pending}
              error={error}
              retry={pending ? () => send(pending, true) : undefined}
              running={busy}
            />
          ) : tab === "team" ? (
            <TeamBoard memberId={member.id} />
          ) : tab === "community" ? (
            <ModerationQueue
              memberId={member.id}
              onMember={(name) => {
                setMemberSearch(name);
                setTab("members");
              }}
            />
          ) : tab === "pricing" ? (
            <PricingHub
              key={pricingId}
              onGear={(id) => {
                setGearId(id);
                setTab("inventory");
              }}
              data={{
                ...data,
                products: pricingId
                  ? [
                      ...products.filter((p) => p.id === pricingId),
                      ...products.filter((p) => p.id !== pricingId),
                    ]
                  : products,
              }}
              send={send}
              busy={busy || !!pending}
            />
          ) : tab === "pickups" ? (
            <PickupBoard data={data} send={send} busy={busy || !!pending} />
          ) : tab === "inventory" &&
            gearId &&
            (gearId === "new" || products.some((p) => p.id === gearId)) ? (
            <GearManager
              key={gearId + ":" + gearRevision}
              p={
                products.find((p) => p.id === gearId) || {
                  category: "Gear",
                  variants: [],
                }
              }
              data={data}
              send={send}
              open={open}
              busy={busy || !!pending}
              onBack={() => setGearId("")}
            />
          ) : tab === "inventory" ? (
            <section className="panel">
              <div className="section-title">
                <div>
                  <h2>Inventory</h2>
                  <p className="fine">
                    Manage snack stock here and snack prices in the Pricing hub.
                    Gear details, prices, and options live in the Gear Manager.
                  </p>
                </div>
                <div className="inline-actions">
                  <Button variant="outline" onClick={() => open("product")}>
                    Add snack item
                  </Button>
                  <Button onClick={() => setGearId("new")}>
                    New gear item
                  </Button>
                </div>
              </div>
              <div className="admin-filters">
                <Field label="Search inventory">
                  <Input
                    placeholder="Search product names"
                    value={inventorySearch}
                    onChange={(e) => setInventorySearch(e.target.value)}
                  />
                </Field>
                <Field label="Category">
                  <NativeSelect
                    value={inventoryCategory}
                    onChange={(e) => setInventoryCategory(e.target.value)}
                  >
                    {["All", "Drinks", "Snacks", "Frozen", "Gear"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </NativeSelect>
                </Field>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(e) => setShowArchived(e.target.checked)}
                  />
                  Include archived
                </label>
                <span className="fine" role="status">
                  {filteredProducts.length} of {products.length} products
                </span>
              </div>
              {!filteredProducts.length ? (
                <Empty
                  title="No matching products"
                  text="Try a different name or category."
                />
              ) : null}
              <div className="table-wrap">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {["Product", "Price", "On hand", "Status", ""].map(
                        (h, i) => (
                          <TableHead key={i}>{h}</TableHead>
                        ),
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProducts.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className="inventory-product">
                            {p.image ? (
                              <img src={p.image} alt="" />
                            ) : (
                              <span className="image-placeholder">
                                <Package size={22} />
                              </span>
                            )}
                            <div>
                              <strong>{p.name}</strong>
                              <small>
                                {p.category} · {p.detail}
                              </small>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{money(p.price)}</TableCell>
                        <TableCell>
                          {p.variants?.length
                            ? p.variants.reduce(
                                (n: number, v: Row) => n + v.stock,
                                0,
                              ) +
                              " allocated · " +
                              p.stock +
                              " unassigned"
                            : p.preorder
                              ? "Preorder"
                              : p.stock}
                          {!p.variants?.length &&
                          !p.preorder &&
                          p.active &&
                          p.stock <= p.reorder ? (
                            <small className="warning-text">Restock soon</small>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <span
                            className={
                              "status " +
                              (readyForSale(p as any) ? "verified" : "pending")
                            }
                          >
                            {availability(p as any)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="inline-actions">
                            <Button
                              variant="ghost"
                              onClick={() =>
                                p.category === "Gear"
                                  ? setGearId(p.id)
                                  : open("product", p)
                              }
                            >
                              {p.category === "Gear"
                                ? "Manage gear"
                                : "Edit item"}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => {
                                if (p.category === "Gear") setGearId(p.id);
                                else {
                                  setPricingId(p.id);
                                  setTab("pricing");
                                }
                              }}
                            >
                              Price
                            </Button>
                            {!p.preorder &&
                            !p.variants?.length &&
                            !p.archived ? (
                              <Button
                                variant="secondary"
                                onClick={() => open("receive", p)}
                              >
                                Receive
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              onClick={() => open("archive", p)}
                            >
                              {p.archived ? "Restore" : "Archive"}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          ) : tab === "payments" ? (
            <section className="panel">
              <div className="section-title">
                <div>
                  <h2>Payment confirmation</h2>
                  <NativeSelect
                    aria-label="Payment status"
                    value={paymentFilter}
                    onChange={(e) => setPaymentFilter(e.target.value)}
                  >
                    <option value="pending">Awaiting confirmation</option>
                    <option value="verified">Confirmed</option>
                    <option value="rejected">Rejected</option>
                    <option value="all">All payments</option>
                  </NativeSelect>
                  <p className="fine">
                    Confirm against Cash App or cash received. Reporting a
                    payment does not mark it paid.
                  </p>
                </div>
              </div>
              {data.admin.payments.length ? (
                data.admin.payments.map((p: Row) => (
                  <div className="payment-row" key={p.id}>
                    <div className="payment-icon">
                      <ReceiptText size={22} />
                    </div>
                    <div className="grow">
                      <strong>
                        {money(p.amount)}{" "}
                        <span className="muted">· {labels[p.method]}</span>
                      </strong>
                      <p>
                        {p.order_code ||
                          "PAY-" + p.id.slice(0, 8).toUpperCase()}{" "}
                        · {p.member_name || p.payer || "Guest"} ·{" "}
                        {labels[p.purpose]}
                      </p>
                      <small>
                        {date(p.created_at)}
                        {p.reference ? " · " + p.reference : ""}
                      </small>
                    </div>
                    <Status value={p.status} />
                    {p.status === "pending" ? (
                      <div className="inline-actions">
                        <Button onClick={() => open("verify", p)}>
                          Confirm
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => open("reject", p)}
                        >
                          Review / void
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <Empty
                  title="All clear"
                  text="Cash and Cash App reports will appear here for confirmation."
                />
              )}
              {historyControl("payments", true)}
            </section>
          ) : tab === "members" ? (
            <section className="panel">
              <div className="section-title">
                <div>
                  <h2>Members &amp; access</h2>
                  <p className="fine">
                    Manage purchasing access, sign-in methods, and private invitations.
                  </p>
                </div>
                <Button onClick={() => open("member")}>Add member</Button>
              </div>
              {identityContext?.owner&&<nav className="identity-choices" aria-label="Members and access sections"><Button variant={memberWorkspace==='roster'?'default':'outline'} aria-current={memberWorkspace==='roster'?'page':undefined} onClick={()=>setMemberWorkspace('roster')}>Members &amp; permissions</Button><Button variant={memberWorkspace==='identity'?'default':'outline'} aria-current={memberWorkspace==='identity'?'page':undefined} onClick={()=>showMemberSignIn()}>Sign-in, invitations &amp; CSV</Button></nav>}
              {(!identityContext?.owner||memberWorkspace==='roster')&&<>
              <div className="admin-filters">
                <Field label="Search members">
                  <Input
                    placeholder="Name or email address"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                  />
                </Field>
                <Field label="Show members">
                  <NativeSelect
                    value={memberFilter}
                    onChange={(e) => setMemberFilter(e.target.value)}
                  >
                    {Object.entries({
                      all: "All members",
                      active: "Active",
                      inactive: "Inactive",
                      invited: "Awaiting first sign-in",
                      password: "Needs password",
                      admins: "Administrators",
                      gearOnly: "Gear only",
                      owing: "Outstanding tab",
                      overdue: "Overdue tab",
                      credit: "Prepaid credit",
                    }).map(([v, t]) => (
                      <option key={v} value={v}>
                        {t}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <span className="fine" role="status">
                  {filteredMembers.length} shown ·{" "}
                  {data.admin.summary.memberCount} total members
                </span>
              </div>
              {resetQueue()}
              <p className="fine">
                Overdue means an outstanding tab at least{" "}
                {data.settings.reminder_days} days old.
              </p>
              {!filteredMembers.length ? (
                <Empty
                  title="No matching members"
                  text="Try another name or filter."
                />
              ) : null}
              {filteredMembers.map((m: Row) => (
                <div className="member-row" key={m.id}>
                  <span className="avatar" aria-hidden="true">
                    {m.name.slice(0, 1)}
                  </span>
                  <div className="grow member-identity">
                    <strong>{m.name}</strong>
                    <small>{m.email}</small>
                    <div className="member-badges">
                      <span className="status">
                        {m.isOwner
                          ? "Owner"
                          : m.role === "admin"
                            ? "Administrator"
                            : "Member"}
                      </span>
                      {!m.active ? (
                        <span className="status rejected">Access disabled</span>
                      ) : !m.password_set ? (
                        <span className="status pending">{identityContext?.enabled===false?'First Time setup':'No password set'}</span>
                      ) : null}
                      {m.role !== "admin" ? (
                        <span className="status">
                          {m.snacks && m.gear
                            ? "Both shops"
                            : m.gear
                              ? "Gear only"
                              : m.snacks
                                ? "Snack bar only"
                                : "Purchasing disabled"}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="member-balances">
                    <strong>{money(m.debt)} tab</strong>
                    <small>{money(m.credit)} credit</small>
                    {overdue(m) ? (
                      <span className="status pending">Overdue</span>
                    ) : null}
                  </div>
                  <div className="inline-actions member-actions">
                    {owner || m.role !== "admin" || m.id === member.id ? (
                      <>
                        <Button
                          variant="secondary"
                          onClick={() => open("member", m)}
                        >
                          Edit member
                        </Button>
                        {!m.isOwner && (owner || m.role!=="admin")?<Button variant="ghost" onClick={()=>{setEmailTarget(m);setTab("access")}}>Change email</Button>:null}
                        {identityContext?.owner&&<Button variant="outline" onClick={()=>showMemberSignIn(m.id)}>Sign-in &amp; invitations</Button>}
                        {(m.password_set||identityContext?.enabled===false)&&<Button
                          variant="outline"
                          onClick={() => open(m.password_set ? "password" : "setup", m)}
                        >
                          {m.password_set ? "Recovery code" : "Setup code"}
                        </Button>}
                      </>
                    ) : (
                      <span className="fine">Managed by owner</span>
                    )}
                  </div>
                </div>
              ))}
              {historyControl("members", true)}
              </>}
              {identityContext?.owner&&memberWorkspace==='identity'&&<IdentityPage key={identityMemberId||'all-members'} embedded initialMemberId={identityMemberId}/>}
            </section>
          ) : tab === "activity" ? (
            <>
              <section className="panel">
                <h2>All purchases</h2>
                {ordersTable(data.admin.orders)}
                {historyControl("orders", true)}
              </section>
              <section className="panel">
                <h2>Change history</h2>
                {data.admin.events.length ? (
                  data.admin.events.map((e: Row) => (
                    <details className="audit-row" key={e.id}>
                      <summary>
                        {e.kind.replaceAll("_", " ")}{" "}
                        <span>{date(e.created_at)}</span>
                      </summary>
                      <p>Recorded by: {e.actor_name || e.actor}</p>
                      <pre>{JSON.stringify(JSON.parse(e.detail), null, 2)}</pre>
                    </details>
                  ))
                ) : (
                  <p className="muted">
                    Administrative changes and consumption records appear here.
                  </p>
                )}
                {historyControl("events", true)}
              </section>
            </>
          ) : tab === "settings" ? settingsView() : null}
        </div>
        </div>
      </>
    );
  }
  function resetQueue() {
    return data.admin.resets?.length ? (
      <div className="reset-queue">
        <h3>Password reset requests</h3>
        {data.admin.resets.map((r: Row) => {
          const target: Row = { ...r, id: r.member_id };
          return (
            <div className="payment-row" key={r.id}>
              <div className="grow">
                <strong>{r.name}</strong>
                <small>
                  {r.email} · {date(r.created_at)}
                </small>
              </div>
              {owner || target?.role !== "admin" || target?.id === member.id ? (
                <div className="inline-actions">
                  <Button onClick={() => open("password", target)}>
                    Issue recovery code
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => open("resolveReset", target)}
                  >
                    Dismiss
                  </Button>
                </div>
              ) : (
                <span className="fine">Owner action required</span>
              )}
            </div>
          );
        })}
        {historyControl("resets", true)}
      </div>
    ) : null;
  }
  function shopControls() {
    return (
      <section className="shop-controls" aria-label="Shop controls">
        <div>
          <span
            className={
              "status " + (data.settings.enabled ? "verified" : "pending")
            }
          >
            {data.settings.enabled ? "Shop open" : "Shop paused"}
          </span>
          <p>
            {readyProducts.length}{" "}
            {readyProducts.length === 1 ? "product" : "products"} ready for
            checkout
          </p>
        </div>
        <div className="inline-actions">
          <Button variant="secondary" onClick={() => setTab("inventory")}>
            Manage inventory
          </Button>
          <Button
            disabled={busy || !!pending}
            onClick={() => open("shop", { enabled: !data.settings.enabled })}
          >
            {data.settings.enabled ? "Pause shop" : "Open shop"}
          </Button>
        </div>
      </section>
    );
  }
  function settingsView() {
    return (
      <div className="two-col">
        <section className="panel">
          <h2>Payment & account settings</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              send({
                action: "settings",
                cashtag: f.get("cashtag"),
                cashInstructions: f.get("instructions"),
                reminderDays: Number(f.get("days")),
              });
            }}
          >
            <fieldset disabled={busy || !!pending}>
              <Field
                label="Snack bar Cash App tag"
                name="cashtag"
                value={data.settings.cashtag}
              />
              <p className="fine">
                Verify this is the snack bar’s receiving account before opening
                checkout.
              </p>
              <Field
                label="Cash instructions"
                name="instructions"
                value={data.settings.cash_instructions}
                required
              />
              <Field
                label="In-app tab reminder after (days)"
                name="days"
                type="number"
                min="1"
                value={data.settings.reminder_days}
                required
              />
              <Button type="submit">Save settings</Button>
            </fieldset>
          </form>
        </section>
        <section className="panel">
          <h2>Payment automation</h2>
          <span className="status pending">Not connected</span>
          <p>
            Cash and Cash App payments are confirmed by an administrator.
            Members explicitly pay their tab; stored cards are never
            automatically charged.
          </p>
          <ol className="roadmap">
            <li>
              <strong>Today</strong>
              <span>Record consumption and reconcile payments separately.</span>
            </li>
            <li>
              <strong>Connect a processor</strong>
              <span>
                Add hosted checkout for purchases, tab payments, and credit
                deposits.
              </span>
            </li>
            <li>
              <strong>Confirm automatically</strong>
              <span>
                Verify payment notifications and match each payment once to its
                existing record.
              </span>
            </li>
          </ol>
          <p className="fine">
            No processor subscription or card collection is enabled in this
            site. Provider setup and sandbox testing are still required.
          </p>
        </section>
      </div>
    );
  }
  function account() {
    const pendingAmount = data.pendingSettlement || 0,
      due =
        member.debt > 0 &&
        member.due_since &&
        Date.now() - member.due_since >= data.settings.reminder_days * 86400000;
    return (
      <>
        <div className="page-heading">
          <div>
            <span className="eyebrow">{member.name}</span>
            <h1>My account.</h1>
            <IdentityLinks/>
            <p>Your tab, credit, purchases, and preferences.</p>
          </div>
          <a
            className="text-link"
            href="mailto:snackbar@iyaayasfw.com?subject=Unit%20Supply%20help"
          >
            Email the store team
          </a>
        </div>
        <AccountProfileCard onCustomize={()=>navigate("recognition")} />
        <InstallGuide />
        <div className="balance-grid">
          <section className="balance-card">
            <span>Running tab</span>
            <strong>{money(member.debt)}</strong>
            <p>
              {money(Math.max(0, member.tab_limit - member.debt))} available
              before your {money(member.tab_limit)} limit.
            </p>
            <Button
              disabled={
                member.debt <= 0 ||
                (member.debt <= pendingAmount && member.credit <= 0)
              }
              onClick={() =>
                open("payment", {
                  purpose: "settlement",
                  creditFirst: member.debt <= pendingAmount,
                })
              }
            >
              Settle my tab
            </Button>
            {pendingAmount > 0 ? (
              <small>
                {money(pendingAmount)} reported, awaiting confirmation.
              </small>
            ) : null}
          </section>
          <section className="balance-card light">
            <span>Available credit</span>
            <strong>{money(member.credit)}</strong>
            <p>Use it for new purchases, even while you have a tab.</p>
            <Button
              variant="secondary"
              disabled={member.credit <= 0 || member.debt <= 0}
              onClick={() =>
                open("payment", { purpose: "settlement", creditFirst: true })
              }
            >
              Apply credit to my tab
            </Button>
            <small>
              Credit and overpayments are confirmed by an administrator.
            </small>
          </section>
        </div>
        {member.debt >= data.settings.tabReminder ? (
          <p className="notice warning">
            Your tab has reached the {money(data.settings.tabReminder)} reminder
            level. Settle when you can; further tab purchases stop at{" "}
            {money(member.tab_limit)}.
          </p>
        ) : due ? (
          <p className="notice warning">
            Your tab has an unpaid balance at least{" "}
            {data.settings.reminder_days} days old. Please settle it when you
            can.
          </p>
        ) : null}
        <section className="panel account-security">
          <div>
            <h2>Password & security</h2>
            <p className="fine">{member.email}</p>
            <p>Change your password and sign out other devices.</p>
          </div>
          {admin && !data.adminVerified ? (
            <Button asChild>
              <a href="/api/admin/access">Verify administrator access</a>
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => open("changePassword")}>
              Change password
            </Button>
          )}
        </section>
        <EmailChanges member={member}/>
        <section className="panel">
          <ThemePicker />
        </section>
        {admin || member.gear ? <PickupBoard data={data} own /> : null}
        <section className="panel">
          <h2>My purchases</h2>
          {ordersTable(data.orders)}
          {historyControl("orders")}
        </section>
        <section className="panel">
          <h2>My payments</h2>
          {data.payments.length ? (
            data.payments.map((p: Row) => (
              <div className="rank" key={p.id}>
                <div>
                  <strong>
                    {labels[p.purpose] || p.purpose} · {money(p.amount)}
                  </strong>
                  <small>
                    {labels[p.method]} · {date(p.created_at)}
                  </small>
                  {p.reference ? (
                    <small className="receipt-reference">{p.reference}</small>
                  ) : null}
                  {p.credit_added > 0 ? (
                    <small>{money(p.credit_added)} added to credit</small>
                  ) : null}
                </div>
                <Status value={p.status} />
              </div>
            ))
          ) : (
            <p className="muted">
              Confirmed payments and payment reports appear here.
            </p>
          )}
          {historyControl("payments")}
        </section>
        <section className="panel">
          <h2>Balance history</h2>
          {(data.ledger || []).map((l: Row) => (
            <div className="history-entry" key={l.id}>
              <div>
                <strong>{l.note || l.kind.replaceAll("_", " ")}</strong>
                <small>{date(l.created_at)}</small>
              </div>
              <div>
                {l.debt_delta ? (
                  <small>
                    Tab {l.debt_delta > 0 ? "+" : ""}
                    {money(l.debt_delta)}
                  </small>
                ) : null}
                {l.credit_delta ? (
                  <small>
                    Credit {l.credit_delta > 0 ? "+" : ""}
                    {money(l.credit_delta)}
                  </small>
                ) : null}
              </div>
            </div>
          ))}
          {!(data.ledger || []).length ? (
            <p className="fine">Balance updates will appear here.</p>
          ) : null}
          {historyControl("ledger")}
        </section>
      </>
    );
  }
  function formSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (modal?.kind === "export") {
      exportData(f);
      return;
    }
    const v = (k: string) => String(f.get(k) || ""),
      n = (k: string) => Number(f.get(k)),
      c = (k: string) => (v(k) === "" ? null : Math.round(Number(v(k)) * 100)),
      yes = (k: string) => f.has(k),
      r = modal!;
    if (r.kind === "changePassword") {
      if (v("password") !== v("confirm")) {
        setError("The new passwords do not match.");
        return;
      }
      authAction(
        "changePassword",
        undefined,
        v("password"),
        v("currentPassword"),
      );
      return;
    }
    if (r.kind === "setup") {
      if (r.code) {
        setModal(null);
        return;
      }
      authAction("issueSetup", r.id);
      return;
    }
    if (r.kind === "resolveReset") {
      authAction("resolveReset", r.id);
      return;
    }
    if (r.kind === "archive") {
      send({
        action: "archive",
        id: r.id,
        version: r.version,
        archived: !r.archived,
      });
      return;
    }
    if (r.kind === "allocate") {
      send({
        action: "allocate",
        id: r.id,
        version: r.version,
        variantId: v("variantId"),
        qty: n("qty"),
        reason: v("reason"),
      });
      return;
    }
    if (["variantStock", "gearStock"].includes(r.kind)) {
      send({
        action: r.kind,
        id: r.id,
        variantId: r.id,
        version: r.version,
        previousStock: r.stock,
        stock: n("stock"),
        reason: v("reason"),
      });
      return;
    }
    if (r.kind === "password") {
      if (r.code) {
        setModal(null);
        return;
      }
      authAction(
        "issueRecovery",
        r.id,
        undefined,
        undefined,
        yes("identityVerified"),
      );
      return;
    }
    if (r.kind === "revoke") {
      authAction("revoke", r.id);
      return;
    }
    if (r.kind === "shop") {
      send({
        action: "shop",
        enabled: r.enabled,
        previousEnabled: !!data.settings.enabled,
      });
      return;
    }
    if (r.kind === "product") {
      send({
        action: "product",
        id: r.id,
        image: r.image || null,
        name: v("name"),
        category: v("category"),
        detail: v("detail"),
        stock: n("stock"),
        previousStock: r.stock ?? 0,
        version: r.version ?? 0,
        reorder: n("reorder"),
        active: yes("active"),
        preorder: yes("preorder"),
        reason: v("reason"),
      });
      return;
    }
    if (r.kind === "member") {
      send({
        action: "member",
        id: r.id,
        role: r.isOwner ? "admin" : owner ? v("role") : r.role || "member",
        previousRole: r.role || "member",
        name: v("name"),
        email: v("email"),
        debt: c("debt"),
        credit: c("credit"),
        tabLimit: c("limit"),
        previousDebt: r.debt ?? 0,
        previousCredit: r.credit ?? 0,
        active: r.isOwner ? true : yes("active"),
        snacks: yes("snacks"),
        gear: yes("gear"),
        postingEnabled: yes("posting"),
        controlsVersion: r.controls_version,
        reason: v("reason"),
      });
      return;
    }
    if (r.kind === "receive") {
      send({
        action: "receive",
        id: r.id,
        variantId: r.variantId || v("variantId") || undefined,
        qty: n("qty"),
        amount: c("amount"),
        reference: v("reference"),
      });
      return;
    }
    if (r.kind === "verify") {
      send({
        action: "verify",
        id: r.id,
        reference: v("reference"),
        confirmed: yes("confirmed"),
      });
      return;
    }
    if (r.kind === "reject") {
      send({
        action: "reject",
        id: r.id,
        reason: v("reason"),
        returned: yes("returned"),
      });
      return;
    }
    if (r.kind === "payment") {
      send({
        action: "payment",
        purpose: r.purpose,
        method: v("method"),
        amount: c("amount"),
      });
      return;
    }
    send({
      action: r.kind,
      amount: c("amount"),
      description: v("description"),
    });
  }
  const modalNames: Row = {
    changePassword: "Change my password",
    setup: "First Time setup code",
    resolveReset: "Resolve reset request",
    archive: modal?.archived ? "Restore product" : "Archive product",
    allocate: "Allocate existing stock",
    variantStock: "Adjust option stock",
    gearStock: "Adjust gear stock",
    shop: modal?.enabled ? "Open the shop" : "Pause the shop",
    password: "Private recovery code",
    revoke: "Sign out member devices",
    export: "Export records to Excel",
    contact: "Member email",
    checkout: "Review your bag",
    product: modal?.id ? "Edit product" : "Add product",
    member: modal?.id ? "Edit member" : "Add member",
    receive: "Receive stock",
    verify: "Confirm payment received",
    reject: "Review payment report",
    payment:
      modal?.purpose === "settlement" ? "Pay your tab" : "Add prepaid credit",
    expense: "Record morale expense",
    cashcount: "Record cash count",
  };
  return (
    <div className={"app" + (count && view !== "admin" ? " has-bag" : "")}>
      <a href="#main" className="skip">
        Skip to content
      </a>
      <header className="header">
        <button
          type="button"
          className="brand"
          onClick={() =>
            navigate(
              admin || member?.snacks
                ? "snacks"
                : member?.gear
                  ? "gear"
                  : "account",
            )
          }
        >
          <BrandMark />
          <span>
            IYAAYASFW<span className="brand-sub">Unit Supply</span>
          </span>
        </button>
        <nav aria-label="Store navigation" className="main-nav">
          {[
            ...(admin || member?.snacks
              ? [["snacks", "Snack bar", ShoppingBag]]
              : []),
            ...(admin || member?.gear ? [["gear", "Unit gear", Shirt]] : []),
            ...(admin || member?.snacks || member?.gear
              ? [["requests", "Requests", MessageSquare]]
              : []),
            ["account", "My account", Wallet],
            ["recognition", "Recognition", Medal],
            ...(admin || identityContext?.management ? [["admin", "Manage", SlidersHorizontal]] : []),
          ].map(([v, label, Icon]: any) => (
            <button
              type="button"
              key={v}
              className={view === v ? "selected" : ""}
              onClick={() => navigate(v)}
              aria-current={view === v ? "page" : undefined}
            >
              <Icon size={19} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="header-end">
          <ThemeToggle />
          <button
            type="button"
            className="fine"
            disabled={busy}
            onClick={() => authAction("logout")}
          >
            Sign out
          </button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh store"
            onClick={refresh}
            disabled={busy}
          >
            <RefreshCw size={18} />
          </Button>
        </div>
      </header>
      <IdentityLinks compact/>
      <main id="main" className="main">
        {loading ? (
          <div className="notice" role="status">
            Loading your shared store…
          </div>
        ) : null}
        {error ? (
          <div className="notice error" role="alert">
            {error}
          </div>
        ) : null}
        {pending ? (
          <div className="notice warning">
            <strong>An action is awaiting confirmation.</strong> Retry the same
            request to check whether it was recorded.
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => send(pending, true)}
            >
              {busy ? "Checking…" : "Retry pending action"}
            </Button>
          </div>
        ) : null}
        {notice ? (
          <div className="notice success" role="status">
            {notice}
          </div>
        ) : null}
        {loading ? null : view === "admin" && admin ? (
          data.admin ? (
            adminView()
          ) : (
            <section className="panel gate">
              <LockKeyhole size={30} />
              <h1>Administrator verification</h1>
              <p>Verify your identity before opening store controls.</p>
              <Button asChild>
                <a href="/api/admin/access">Continue with Cloudflare Access</a>
              </Button>
            </section>
          )
        ) : view === "requests" ? (
          <CommunityBoard member={member} admin={!!data.adminVerified} />
        ) : view === "recognition" ? (
          <Rewards/>
        ) : view === "account" ? (
          member ? (
            account()
          ) : (
            memberGate
          )
        ) : view === "gear" && !member ? (
          memberGate
        ) : (
          <>
            <div className="page-heading">
              <div>
                <span className="eyebrow">
                  {view === "gear" ? "For the unit" : "The snack bar"}
                </span>
                <h1>
                  {view === "gear"
                    ? "Unit gear."
                    : "A quick stop. Then back to it."}
                </h1>
                <p>
                  {view === "gear"
                    ? "Members only. Unit pickup."
                    : "Pick what you’re taking. We’ll keep track."}
                </p>
              </div>
              <div className="shop-heading-actions">
                <span
                  className={
                    "status " + (data.settings.enabled ? "verified" : "pending")
                  }
                >
                  {data.settings.enabled ? "Shop open" : "Shop paused"}
                </span>
                {admin && data.adminVerified ? (
                  <Button
                    variant="secondary"
                    disabled={busy || !!pending || loading}
                    onClick={() =>
                      open("shop", { enabled: !data.settings.enabled })
                    }
                  >
                    {data.settings.enabled ? "Pause shop" : "Open shop"}
                  </Button>
                ) : !data.settings.enabled ? (
                  <small>Checkout will return when the shop reopens.</small>
                ) : null}
              </div>
            </div>
            <div className="shopping-balance">
              {view === "snacks" ? (
                <>
                  <span>
                    <Wallet size={17} />
                    Tab <strong>{money(member?.debt || 0)}</strong>
                  </span>
                  <span>
                    <strong>
                      {money(
                        Math.max(
                          0,
                          (member?.tab_limit ?? 3000) - (member?.debt || 0),
                        ),
                      )}
                    </strong>{" "}
                    left before your limit
                  </span>
                </>
              ) : (
                <span>Pickup only · Cash, Cash App, or confirmed credit</span>
              )}
              <span>
                Available credit <strong>{money(member?.credit || 0)}</strong>
              </span>
              <button
                type="button"
                className="text-link"
                onClick={() => navigate("account")}
              >
                {view === "snacks" && member?.debt > 0
                  ? "Settle my tab"
                  : "My account"}
              </button>
            </div>
            {view === "snacks" && member?.debt >= data.settings.tabReminder ? (
              <p className="notice warning">
                Your tab has reached {money(data.settings.tabReminder)}. Please
                settle it soon. Tab purchases stop at {money(member.tab_limit)}.
              </p>
            ) : null}
            <div className="store-layout">
              <section>
                {view === "snacks" &&
                !search &&
                category === "All" &&
                data.buyAgain?.length ? (
                  <section className="buy-again" aria-label="Buy again">
                    <div className="section-title">
                      <div>
                        <h2>Buy again</h2>
                        <p className="fine">
                          Your recent picks, at today’s prices.
                        </p>
                      </div>
                    </div>
                    <div className="repeat-items">
                      {data.buyAgain
                        .map((id: string) => products.find((p) => p.id === id))
                        .filter(Boolean)
                        .map((p: Row) => (
                          <article className="repeat-item" key={p.id}>
                            {p.image ? (
                              <img src={p.image} alt="" loading="lazy" />
                            ) : (
                              <Package size={28} />
                            )}
                            <div>
                              <strong>{p.name}</strong>
                              <small>
                                {readyForSale(p)
                                  ? money(p.price)
                                  : availability(p)}
                              </small>
                            </div>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              aria-label={"Add one " + p.name + " again"}
                              disabled={
                                busy ||
                                !!pending ||
                                !data.settings.enabled ||
                                !readyForSale(p) ||
                                (cart[p.id] || 0) >=
                                  Math.min(30, p.preorder ? 30 : p.stock)
                              }
                              onClick={() => qty(p.id, 1)}
                            >
                              <Plus size={15} />
                              {cart[p.id] ? cart[p.id] + " in bag" : "Add"}
                            </Button>
                          </article>
                        ))}
                    </div>
                  </section>
                ) : null}
                <div className="store-tools">
                  {view !== "gear" ? (
                    <Tabs value={category} onValueChange={setCategory}>
                      <TabsList className="category-tabs">
                        {["All", "Drinks", "Snacks", "Frozen"].map((c) => (
                          <TabsTrigger key={c} value={c}>
                            {c}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                  ) : (
                    <span className="fine">
                      Preorders must be paid before the supplier order.
                    </span>
                  )}
                  <label className="search">
                    <Search size={18} />
                    <Input
                      aria-label="Search products"
                      placeholder="Find something"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                </div>
                <div className="products">
                  {products
                    .filter(
                      (p) =>
                        p.active &&
                        !p.archived &&
                        (view === "gear"
                          ? p.category === "Gear"
                          : p.category !== "Gear" &&
                            (category === "All" || category === p.category)) &&
                        p.name.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((p: Row) => (
                      <article
                        className={
                          "product " + (!p.image ? "text-product" : "")
                        }
                        key={p.id}
                      >
                        <div className="product-visual">
                          <a
                            className="product-image-link"
                            href={"/products/" + encodeURIComponent(p.id)}
                            aria-label={"View " + p.name}
                          />
                          {p.image ? (
                            <img
                              src={p.image}
                              alt={p.name + " · representative packaging"}
                              loading="lazy"
                            />
                          ) : (
                            <span className="product-type">{p.category}</span>
                          )}
                          {availability(p) === "Preorder" ? (
                            <span className="product-badge">Preorder</span>
                          ) : null}
                        </div>
                        <div className="product-info">
                          <span className="product-category">{p.category}</span>
                          <h2>
                            <a href={"/products/" + encodeURIComponent(p.id)}>
                              {p.name}
                            </a>
                          </h2>
                          <p>{p.detail}</p>
                          <a
                            className="review-link"
                            href={
                              "/products/" +
                              encodeURIComponent(p.id) +
                              "#reviews"
                            }
                          >
                            Details & reviews
                          </a>
                          <div className="product-bottom">
                            <span
                              className={
                                productPrice(p).price === null
                                  ? "unset-price"
                                  : "price"
                              }
                            >
                              {productPrice(p).price === null
                                ? "Price unavailable"
                                : (productPrice(p).varies ? "From " : "") +
                                  money(productPrice(p).price)}
                            </span>
                            {p.category === "Gear" ? (
                              <Button variant="secondary" asChild>
                                <a
                                  href={"/products/" + encodeURIComponent(p.id)}
                                >
                                  View details
                                  <ChevronRight size={16} />
                                </a>
                              </Button>
                            ) : cart[p.id] ? (
                              <div className="stepper">
                                <button
                                  type="button"
                                  aria-label={"Remove one " + p.name}
                                  onClick={() => qty(p.id, -1)}
                                  disabled={busy || !!pending}
                                >
                                  <Minus size={16} />
                                </button>
                                <span>{cart[p.id]}</span>
                                <button
                                  type="button"
                                  aria-label={"Add one " + p.name}
                                  onClick={() => qty(p.id, 1)}
                                  disabled={
                                    busy ||
                                    !!pending ||
                                    !data.settings.enabled ||
                                    !readyForSale(p as any) ||
                                    (cart[p.id] || 0) >=
                                      Math.min(30, p.preorder ? 30 : p.stock)
                                  }
                                >
                                  <Plus size={16} />
                                </button>
                              </div>
                            ) : (
                              <Button
                                size="icon"
                                className="add"
                                aria-label={"Add " + p.name}
                                disabled={
                                  loading ||
                                  !data.settings.enabled ||
                                  !readyForSale(p as any) ||
                                  busy ||
                                  !!pending
                                }
                                onClick={() => qty(p.id, 1)}
                              >
                                <Plus size={17} />
                                <span>Add</span>
                              </Button>
                            )}
                          </div>
                          {!readyForSale(p as any) ? (
                            <small className="product-availability">
                              {availability(p as any)}
                            </small>
                          ) : null}
                        </div>
                      </article>
                    ))}
                </div>
                {!products.some(
                  (p) =>
                    p.active &&
                    !p.archived &&
                    (view === "gear"
                      ? p.category === "Gear"
                      : p.category !== "Gear" &&
                        (category === "All" || category === p.category)) &&
                    p.name.toLowerCase().includes(search.toLowerCase()),
                ) ? (
                  <Empty
                    title="Nothing here yet"
                    text="Try another category or search."
                  />
                ) : null}
                <p className="catalog-note">
                  Thank you for supporting the unit.
                </p>
              </section>
              <aside className="bag panel">
                {basket}
                <Button
                  className="full"
                  disabled={!count || !!pending || busy}
                  onClick={checkout}
                >
                  Review bag <ChevronRight size={17} />
                </Button>
                <p className="fine">No automatic charges.</p>
                {member ? (
                  <button
                    type="button"
                    className="balance-link"
                    onClick={() => navigate("account")}
                  >
                    <Wallet size={18} />
                    <span>
                      My tab<strong>{money(member.debt)}</strong>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="balance-link"
                    onClick={() => navigate("account")}
                  >
                    <Wallet size={18} />
                    <span>Have a member tab?</span>
                    <ChevronRight size={16} />
                  </button>
                )}
              </aside>
            </div>
          </>
        )}
        <footer>
          <span>IYAAYASFW · Unit Supply</span>
          <a className="text-link" href="https://iyaayasfw.com/about">About the app</a>
          <a className="text-link" href="https://iyaayasfw.com/privacy">Privacy policy</a>
          <a
            className="text-link"
            href="mailto:snackbar@iyaayasfw.com?subject=Unit%20Supply%20help"
          >
            Email the store team
          </a>
        </footer>
      </main>
      {count && view !== "admin" ? (
        <div className="mobile-bag">
          <Button onClick={checkout} disabled={busy || !!pending}>
            <ShoppingBag size={19} />
            Review bag · {count} {count === 1 ? "item" : "items"}
            <span>{money(total)}</span>
            <ChevronRight size={18} />
          </Button>
        </div>
      ) : null}
      <Dialog
        open={!!modal}
        onOpenChange={(o) => {
          if (!o && !busy && !uploading) setModal(null);
        }}
      >
        <DialogContent className="pilot-dialog">
          <DialogTitle>{modalNames[modal?.kind || ""]}</DialogTitle>
          <DialogDescription>
            {modal?.kind === "checkout"
              ? "Confirm what you are taking. Stock updates when you record this purchase."
              : modal?.kind === "verify"
                ? "Only confirm money you have actually received."
                : modal?.kind === "cashcount"
                  ? "A cash count is an audit record. It does not confirm individual payments."
                  : "Changes are saved to the shared store."}
          </DialogDescription>
          {pending ? (
            <p className="notice warning" role="status">
              Confirmation is still pending.{" "}
              <Button
                type="button"
                disabled={busy}
                onClick={() => send(pending, true)}
              >
                Retry safely
              </Button>
            </p>
          ) : null}
          {error ? (
            <p className="notice error" role="alert">
              {error}
            </p>
          ) : null}
          {modal?.kind === "checkout" ? (
            <Checkout
              key={modal.kind}
              lines={lines}
              member={member}
              settings={data.settings}
              preferredShop={view === "gear" ? "gear" : "snacks"}
              busy={busy || !!pending}
              send={send}
              onQuantity={qty}
              onRemove={removeLine}
              onPrice={acceptPrice}
            />
          ) : modal?.kind === "verify" ? (
            <PaymentConfirmation
              payment={modal}
              send={send}
              busy={busy || !!pending}
            />
          ) : modal?.kind === "payment" ? (
            <TabPayment
              member={member}
              pendingAmount={data.pendingSettlement || 0}
              settings={data.settings}
              send={send}
              busy={busy || !!pending}
              creditFirst={modal.creditFirst}
            />
          ) : null}
          {modal && !["checkout", "verify", "payment"].includes(modal.kind) ? (
            <form onSubmit={formSubmit}>
              <fieldset disabled={busy || !!pending || uploading}>
                {modal.kind === "shop" ? (
                  <>
                    <p>
                      {modal.enabled
                        ? "Members will be able to purchase available products using the existing prices and payment methods."
                        : "Members can still view their accounts and report payments. New purchases will be paused."}
                    </p>
                    <p className="fine">
                      {readyProducts.length} products ready for checkout.
                      Inventory and balances stay as recorded.
                    </p>
                    {modal.enabled && !readyProducts.length ? (
                      <p className="notice warning">
                        Add a price, tax rate, and stock to at least one
                        available product before opening.
                      </p>
                    ) : null}
                    <Button
                      type="submit"
                      disabled={modal.enabled && !readyProducts.length}
                    >
                      {modal.enabled ? "Open shop" : "Pause shop"}
                    </Button>
                  </>
                ) : null}
                {modal.kind === "export" ? (
                  <>
                    <Field label="Records">
                      <NativeSelect name="dataset">
                        {Object.entries({
                          purchases: "Purchases",
                          items: "Itemized sales",
                          payments: "Payments",
                          expenses: "Expenses",
                          members: "Member balances (current)",
                          inventory: "Inventory (current)",
                          options: "Gear options (current)",
                          audit: "Change history",
                          balances: "Balance ledger",
                          corrections: "Corrections & refunds",
                        }).map(([v, t]) => (
                          <option key={v} value={v}>
                            {t}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <div className="form-grid">
                      <Field label="From (optional)" name="from" type="date" />
                      <Field label="Through (optional)" name="to" type="date" />
                    </div>
                    <p className="fine">
                      CSV opens in Excel. Dates use UTC and include the full
                      selected days. Leave dates blank for all history. Current
                      inventory and member balances are snapshots and ignore
                      date filters. Purchases include unpaid and voided records;
                      payments are exported separately to avoid counting
                      receipts as sales.
                    </p>
                    <Button type="submit">
                      <Download size={17} />
                      Download CSV
                    </Button>
                  </>
                ) : null}
                {modal.kind === "contact" ? (
                  <>
                    <p className="fine">
                      Select and copy this address, or open your email app.
                    </p>
                    <Input
                      aria-label="Member email address"
                      readOnly
                      value={modal.email}
                      onFocus={(e) => e.target.select()}
                    />
                    <Button asChild>
                      <a href={"mailto:" + encodeURIComponent(modal.email)}>
                        Open email app
                      </a>
                    </Button>
                  </>
                ) : null}
                {modal.kind === "product" ? (
                  <>
                    <div className="image-editor">
                      {modal.image ? (
                        <img src={modal.image} alt="Product preview" />
                      ) : (
                        <span className="image-placeholder">
                          <Package size={30} />
                        </span>
                      )}
                      <div>
                        <Field
                          label={
                            modal.image
                              ? "Replace product image"
                              : "Add product image"
                          }
                        >
                          <Input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={(e) => {
                              uploadImage(e.target.files?.[0]);
                              e.target.value = "";
                            }}
                          />
                        </Field>
                        <p className="fine">
                          JPG, PNG, or WebP · up to 5 MB. Save the product to
                          apply.
                        </p>
                        {modal.image ? (
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() =>
                              setModal((m) => ({ ...m, image: null }))
                            }
                          >
                            Remove image
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {uploading ? <p role="status">Uploading image…</p> : null}
                    <Field
                      name="name"
                      label="Product name"
                      value={modal.name}
                      required
                    />
                    <div className="form-grid">
                      <Field label="Category">
                        <NativeSelect
                          name="category"
                          defaultValue={modal.category || "Snacks"}
                        >
                          {["Drinks", "Snacks", "Frozen"].map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </NativeSelect>
                      </Field>
                      <Field
                        label="Variety / size"
                        name="detail"
                        value={modal.detail}
                      />
                      <Field
                        label="On hand"
                        name="stock"
                        type="number"
                        min="0"
                        value={modal.stock ?? 0}
                        required
                      />
                      <Field
                        label="Restock at"
                        name="reorder"
                        type="number"
                        min="0"
                        value={modal.reorder ?? 5}
                        required
                      />
                    </div>
                    <p className="fine">
                      Set selling price, unit cost, and tax treatment in the
                      separate Pricing hub. New items can be saved as hidden
                      until pricing is ready.
                    </p>
                    <Field label="Stock adjustment reason" name="reason" />
                    <Toggle
                      name="active"
                      label="Make available for purchase"
                      checked={!!modal.active}
                    />
                    <Button type="submit">Save product</Button>
                  </>
                ) : null}
                {modal.kind === "member" ? (
                  <>
                    <Field
                      label="Member name"
                      name="name"
                      value={modal.name}
                      required
                    />
                    <Field label="Approved email address">
                      <Input
                        name="email"
                        type="email"
                        defaultValue={modal.email || ""}
                        readOnly={!!modal.id}
                        required
                        autoComplete="off"
                      />
                    </Field>
                    {modal.isOwner ? (
                      <p className="access-note">
                        <LockKeyhole size={18} />
                        Owner · permanent administrator access
                      </p>
                    ) : owner ? (
                      <>
                        <Field label="Access level">
                          <NativeSelect
                            name="role"
                            defaultValue={modal.role || "member"}
                            onChange={(e) =>
                              setModal((m) => ({
                                ...m,
                                requestedRole: e.target.value,
                              }))
                            }
                          >
                            <option value="member">Member</option>
                            <option value="admin">Administrator</option>
                          </NativeSelect>
                        </Field>
                        <p className="fine">
                          {(modal.requestedRole || modal.role) === "admin"
                            ? "Administrators can manage inventory, payments, reports, and regular member accounts. Only the owner can grant administrator access."
                            : "Members can shop, view their own purchases, and manage their tab."}
                        </p>
                        {modal.id &&
                        modal.requestedRole &&
                        modal.requestedRole !== modal.role ? (
                          <p className="notice">
                            Changing access signs out this member’s devices.
                            They can sign in again with the same password.
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <p className="fine">
                        Access level:{" "}
                        {modal.role === "admin" ? "Administrator" : "Member"}.
                        Only the owner can change administrator access.
                      </p>
                    )}
                    <div className="member-purchasing">
                      <h3>Purchasing access</h3>
                      <Toggle
                        name="snacks"
                        label="Snack bar"
                        checked={modal.snacks !== 0}
                      />
                      <Toggle
                        name="gear"
                        label="Unit gear"
                        checked={modal.gear !== 0}
                      />
                      <p className="fine">
                        Gear-only members cannot see or purchase snack bar
                        items. All administrators retain access to both shops.
                      </p>
                    </div>
                    {!modal.isOwner ? (
                      <Toggle
                        name="active"
                        label="Allow sign-in"
                        checked={modal.active !== 0}
                      />
                    ) : null}
                    <details className="member-finances">
                      <summary>Balances & tab limit</summary>
                      <p className="fine">
                        Members receive a reminder at $20. The hard limit cannot
                        exceed $30.
                      </p>
                      <div className="form-grid">
                        <Field
                          label="Amount owed ($)"
                          name="debt"
                          type="number"
                          min="0"
                          step="0.01"
                          value={(modal.debt ?? 0) / 100}
                          required
                        />
                        <Field
                          label="Prepaid credit ($)"
                          name="credit"
                          type="number"
                          min="0"
                          step="0.01"
                          value={(modal.credit ?? 0) / 100}
                          required
                        />
                        <Field
                          label="Tab limit ($)"
                          name="limit"
                          type="number"
                          min="0"
                          step="0.01"
                          value={(modal.tab_limit ?? 3000) / 100}
                          required
                        />
                      </div>
                      <Field
                        label="Reason for balance adjustment"
                        name="reason"
                      />
                    </details>
                    <Toggle
                      name="posting"
                      label="Allow requests, votes, and product reviews"
                      checked={modal.posting_enabled !== 0}
                    />
                    <p className="fine">
                      Disabling posting preserves access to shopping and
                      existing records.
                    </p>
                    <p className="fine">
                      {modal.id
                        ? "Disabling sign-in revokes every remembered device."
                        : identityContext?.enabled===false?"Next, generate a private setup code. The member uses First Time to choose their own password.":"This adds the member to the whitelist. Next, the owner can share a private invitation from Members & access."}
                    </p>
                    <Button type="submit">
                      {modal.id ? "Save member" : "Add member"}
                    </Button>
                    {modal.id ? (
                      <div className="member-tools">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => copyEmail(modal)}
                        >
                          Copy email
                        </Button>
                        <Button type="button" variant="ghost" asChild>
                          <a
                            href={
                              modal.debt > 0
                                ? reminderLink(modal)
                                : "mailto:" + encodeURIComponent(modal.email)
                            }
                          >
                            {modal.debt > 0 ? "Draft reminder" : "Email member"}
                          </a>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => open("revoke", modal)}
                        >
                          Sign out devices
                        </Button>
                      </div>
                    ) : null}
                  </>
                ) : null}
                {modal.kind === "receive" ? (
                  <>
                    <h3>
                      {modal.name}
                      {modal.variantLabel ? " · " + modal.variantLabel : ""}
                    </h3>
                    {!modal.variantId && modal.variants?.length ? (
                      <Field label="Stock for">
                        <NativeSelect name="variantId">
                          <option value="">Unassigned stock</option>
                          {modal.variants
                            .filter((v: Row) => !v.preorder)
                            .map((v: Row) => (
                              <option key={v.id} value={v.id}>
                                {v.label}
                              </option>
                            ))}
                        </NativeSelect>
                      </Field>
                    ) : null}
                    <ReceiveFields />
                    <Button type="submit">Receive stock</Button>
                  </>
                ) : null}
                {modal.kind === "archive" ? (
                  <>
                    <p>
                      {modal.archived
                        ? "Restore " + modal.name + " to the catalog?"
                        : "Archive " +
                          modal.name +
                          "? Members will no longer see or purchase it."}
                    </p>
                    <p className="fine">
                      Stock, prices, and past purchases stay recorded. You can
                      restore an archived product later.
                    </p>
                    <Button type="submit">
                      {modal.archived ? "Restore product" : "Archive product"}
                    </Button>
                  </>
                ) : null}
                {["variantStock", "gearStock"].includes(modal.kind) ? (
                  <>
                    <h3>
                      {modal.name} · {modal.label}
                    </h3>
                    <Field
                      label="Actual on-hand quantity"
                      name="stock"
                      type="number"
                      min="0"
                      value={modal.stock}
                      required
                    />
                    <Field
                      label="Reason for stock adjustment"
                      name="reason"
                      required
                    />
                    <p className="fine">
                      Use Receive for a new purchase and Allocate for existing
                      unassigned stock.
                    </p>
                    <Button type="submit">Save count</Button>
                  </>
                ) : null}
                {modal.kind === "allocate" ? (
                  <>
                    <p>
                      {modal.name} has {modal.stock} unassigned units.
                    </p>
                    <Field label="Move stock into">
                      <NativeSelect name="variantId" required>
                        {modal.variants?.map((v: Row) => (
                          <option key={v.id} value={v.id}>
                            {v.label}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field
                      label="Quantity to move"
                      name="qty"
                      type="number"
                      min="1"
                      required
                    />
                    <Field label="Allocation note" name="reason" required />
                    <Button type="submit">Allocate stock</Button>
                  </>
                ) : null}
                {modal.kind === "changePassword" ? (
                  <>
                    <Field label="Current password">
                      <Input
                        name="currentPassword"
                        type="password"
                        autoComplete="current-password"
                        maxLength={128}
                        required
                      />
                    </Field>
                    <Field label="New password">
                      <Input
                        name="password"
                        type="password"
                        autoComplete="new-password"
                        minLength={15}
                        maxLength={128}
                        required
                      />
                    </Field>
                    <Field label="Confirm new password">
                      <Input
                        name="confirm"
                        type="password"
                        autoComplete="new-password"
                        minLength={15}
                        maxLength={128}
                        required
                      />
                    </Field>
                    <p className="fine">
                      Use 15–128 characters. Your other devices will be signed
                      out; this device stays signed in.
                    </p>
                    <Button type="submit">Change password</Button>
                  </>
                ) : null}
                {modal.kind === "setup" ? (
                  <>
                    <p>
                      First Time setup for <strong>{modal.name}</strong> (
                      {modal.email}).
                    </p>
                    {modal.code ? (
                      <>
                        <Field label="Private setup code">
                          <Input
                            readOnly
                            value={modal.code}
                            onFocus={(e) => e.target.select()}
                          />
                        </Field>
                        <p>
                          Share this code privately with the member. They should
                          open{" "}
                          <strong>
                            {typeof window !== "undefined"
                              ? window.location.origin
                              : ""}
                          </strong>
                          , select First Time, and enter their approved email.
                        </p>
                        <p className="fine">
                          Expires {date(modal.expiresAt)}. The code is shown
                          only here and can be used once. Generate another code
                          if it is lost.
                        </p>
                        <Button type="submit">Done</Button>
                      </>
                    ) : (
                      <>
                        <p>
                          A setup code confirms this is the intended member. It
                          expires after seven days. Generating a new code
                          replaces any previous one.
                        </p>
                        <Button type="submit">Generate setup code</Button>
                      </>
                    )}
                  </>
                ) : null}
                {modal.kind === "resolveReset" ? (
                  <>
                    <p>
                      Mark the password reset request for {modal.name} as
                      resolved? This does not change their password.
                    </p>
                    <Button type="submit">Resolve request</Button>
                  </>
                ) : null}
                {modal.kind === "reject" ? (
                  <>
                    <p>
                      {money(modal.amount)} · {labels[modal.purpose]}
                    </p>
                    <Field label="Reason" name="reason" required />
                    {modal.purpose === "purchase" ? (
                      <Toggle
                        name="returned"
                        label="The goods were not taken or have been returned to stock."
                      />
                    ) : null}
                    <p className="fine">
                      {modal.purpose === "purchase"
                        ? "Voiding restores the recorded stock. If the goods were consumed, leave the payment pending until it is collected."
                        : "Rejecting this report leaves the member’s balance unchanged."}
                    </p>
                    <Button type="submit" variant="destructive">
                      {modal.purpose === "purchase"
                        ? "Void purchase and restore stock"
                        : "Reject payment report"}
                    </Button>
                  </>
                ) : null}
                {["expense", "cashcount"].includes(modal.kind) ? (
                  <>
                    <Field
                      label={
                        modal.kind === "expense"
                          ? "Expense amount ($)"
                          : "Physical cash counted ($)"
                      }
                      name="amount"
                      type="number"
                      step="0.01"
                      min="0"
                      required
                    />
                    <Field
                      label={
                        modal.kind === "expense"
                          ? "Purpose and payment reference"
                          : "Counter names and notes"
                      }
                      name="description"
                      required
                    />
                    <Button type="submit">Save record</Button>
                  </>
                ) : null}
              </fieldset>
              {busy ? <p role="status">Saving…</p> : null}
              {error ? (
                <p className="notice error" role="alert">
                  {error}
                </p>
              ) : null}
              {pending && !busy ? (
                <Button
                  variant="secondary"
                  onClick={() => send(pending, true)}
                  type="button"
                >
                  Retry pending action
                </Button>
              ) : null}
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!receipt}
        onOpenChange={(o) => {
          if (!o) setReceipt(null);
        }}
      >
        <DialogContent className="pilot-dialog">
          <DialogTitle>
            {receipt?.status === "paid" || receipt?.status === "verified"
              ? "Confirmed"
              : receipt?.method === "tab"
                ? "Added to tab"
                : "Payment recorded"}
          </DialogTitle>
          <DialogDescription>
            {receipt?.kind === "order"
              ? "Your purchase has been recorded."
              : "Your payment has been recorded."}
          </DialogDescription>
          {receipt ? (
            <>
              <div className="receipt-mark">
                <Check size={28} />
              </div>
              <div className="confirmation-amount">
                {money(receipt.total ?? receipt.amount)}
              </div>
              <p className="receipt-code">
                {receipt.code ||
                  receipt.reference ||
                  "PAY-" + receipt.id.slice(0, 8).toUpperCase()}
              </p>
              {receipt.kind === "order" ? (
                <dl className="checkout-totals">
                  {receipt.credit_used > 0 ? (
                    <div>
                      <dt>Confirmed credit used</dt>
                      <dd>{money(receipt.credit_used)}</dd>
                    </div>
                  ) : null}
                  {receipt.tab_added > 0 ? (
                    <div>
                      <dt>Added to tab</dt>
                      <dd>{money(receipt.tab_added)}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
              {receipt.status === "pending" ? (
                <>
                  <p className="notice">
                    {receipt.kind === "payment"
                      ? "Your payment report is saved."
                      : receipt.method === "cash"
                        ? "Place the cash in the cash box, labeled with your name and this reference."
                        : "Send your Cash App payment with this reference in the note."}{" "}
                    An administrator will confirm receipt.
                  </p>
                  {receipt.method === "cashapp" && receipt.kind === "order" ? (
                    <CashAppHandoff cashtag={data.settings.cashtag} amount={receipt.cash_due ?? receipt.amount} reference={receipt.code || receipt.reference || "PAY-" + receipt.id.slice(0, 8).toUpperCase()} />
                  ) : receipt.kind === "payment" ? (
                    <p className="fine">Payment reported. Wait for administrator confirmation; do not send it again.</p>
                  ) : (
                    <p className="fine">Cash due: {money(receipt.cash_due ?? receipt.amount)}</p>
                  )}
                </>
              ) : (
                <p className="notice success">
                  {receipt.method === "tab"
                    ? "Pay your tab from My account when it reaches $20."
                    : "This amount is confirmed. No further payment is needed."}
                </p>
              )}
              <Button
                className="full"
                variant="secondary"
                onClick={() => setReceipt(null)}
              >
                Done
              </Button>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
