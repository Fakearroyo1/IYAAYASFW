type Row = Record<string, any>;
const dollars = (v: number | null) => (v == null ? "" : v / 100);
const utc = (v: number | null) => (v ? new Date(v).toISOString() : "");
export function exportRows(data: Row, kind: string, from = "", to = ""): Row[] {
  const a = data.admin,
    member = (id: string) => a.members.find((m: Row) => m.id === id);
  const start = from ? Date.parse(from + "T00:00:00Z") : -Infinity,
    end = to ? Date.parse(to + "T00:00:00Z") + 86400000 : Infinity;
  const included = (r: Row) => r.created_at >= start && r.created_at < end;
  const snapshot = new Date().toISOString();
  if(kind==='runItems')return a.runItems;
  if(kind==='receipts')return a.receipts.map((r:Row)=>({"Receipt line ID":r.id,"Receipt ID":r.receipt_id,"Run ID":r.run_id||'',"Product ID":r.product_id,"Purchased UTC":utc(r.created_at),"Source":r.source,"Supplier":r.supplier||'',"Packs":r.packs??'',"Units per pack":r.units_per_pack??'',"Quantity":r.qty,"Received units":r.received_qty,"Pack price USD":dollars(r.pack_price),"Allocated charges USD":dollars(r.allocated_charges),"Exact cost USD":dollars(r.total_cost),"Reference":r.reference}));
  if(kind==='purchaseCorrections')return a.purchaseCorrections.map((r:Row)=>({"Correction ID":r.id,"Receipt ID":r.receipt_id,"Line ID":r.purchase_line_id,"Product":r.product_name,"Kind":r.kind,"Quantity":r.qty,"Removed from stock":r.stock_qty,"Refund USD":dollars(r.refund),"Account":r.account_id||'',"Reason":r.reason,"Actor":r.actor,"Recorded UTC":utc(r.created_at)}));
  if (kind === "purchases")
    return a.orders
      .filter(included)
      .map((o: Row) => ({
        "Purchase ID": o.id,
        Reference: o.code,
        "Created UTC": utc(o.created_at),
        Payer: o.payer,
        "Member email": member(o.member_id)?.email || "",
        Method: o.method,
        Status: o.status,
        "Original total USD": dollars(o.original_total ?? o.total),
        "Corrections USD": dollars(o.adjusted_total || 0),
        "Total USD": dollars(o.status === "void" ? 0 : o.total),
        "Included tax USD": dollars(o.status === "void" ? 0 : o.tax),
        "Item cost USD": dollars(o.status === "void" ? 0 : o.cost),
        "Credit used USD": dollars(o.credit_used),
        "Tab added USD": dollars(o.tab_added),
      }));
  if (kind === "items")
    return a.items.flatMap((i: Row) => {
      const o = a.orders.find((o: Row) => o.id === i.order_id);
      return o && included(o)
        ? [
            {
              "Purchase ID": o.id,
              Reference: o.code,
              "Created UTC": utc(o.created_at),
              Payer: o.payer,
              Status: o.status,
              "Product ID": i.product_id,
              Product: i.name,
              "Original quantity": i.qty,
              Quantity: o.status === "void" ? 0 : (i.remaining_qty ?? i.qty),
              "Reversed quantity": i.corrected_qty || 0,
              "Size / color": i.variant_label || "",
              Personalization: i.personalization || "",
              "Pickup status": i.fulfillment || "untracked",
              "Unit price USD": dollars(i.price),
              "Line total USD": dollars(
                o.status === "void" ? 0 : i.price * (i.remaining_qty ?? i.qty),
              ),
              "Unit cost USD": dollars(i.cost),
              "Tax rate percent": i.tax_bp / 100,
              Preorder: !!i.preorder,
            },
          ]
        : [];
    });
  if (kind === "payments")
    return a.payments
      .filter(included)
      .map((p: Row) => ({
        "Payment ID": p.id,
        "Purchase ID": p.order_id || "",
        "Purchase reference": p.order_code || "",
        "Created UTC": utc(p.created_at),
        Member: p.member_name || p.payer || "Guest",
        "Member email": member(p.member_id)?.email || "",
        Purpose: p.purpose,
        Method: p.method,
        Status: p.status,
        "Originally reported USD": dollars(p.original_amount ?? p.amount),
        "Amount USD": dollars(p.amount),
        "External cash flow USD":
          p.status === "verified" && ["cash", "cashapp"].includes(p.method)
            ? dollars(p.purpose === "refund" ? -p.amount : p.amount)
            : 0,
        "Applied to tab USD": dollars(p.debt_applied),
        "Added to credit USD": dollars(p.credit_added),
        "Payment reference": p.reference || "",
        "Verified UTC": utc(p.verified_at),
        "Verified by": member(p.verified_by)?.name || p.verified_by || "",
      }));
  if (kind === "balances")
    return a.ledger
      .filter(included)
      .map((l: Row) => ({
        "Entry ID": l.id,
        "Created UTC": utc(l.created_at),
        "Member ID": l.member_id,
        Member: member(l.member_id)?.name || l.member_id,
        "Member email": member(l.member_id)?.email || "",
        Kind: l.kind,
        "Tab change USD": dollars(l.debt_delta),
        "Credit change USD": dollars(l.credit_delta),
        "Purchase ID": l.order_id || "",
        "Payment ID": l.payment_id || "",
        Actor: l.actor_name || l.actor,
        Note: l.note,
      }));
  if (kind === "corrections")
    return a.corrections
      .filter(included)
      .map((c: Row) => ({
        "Correction ID": c.id,
        "Purchase ID": c.order_id,
        "Purchase reference": c.order_code,
        "Created UTC": utc(c.created_at),
        Payer: c.payer,
        Actor: c.actor_name || c.actor,
        Reason: c.reason,
        "Sales reversed USD": dollars(c.total),
        "Tax reversed USD": dollars(c.tax),
        "Cost reversed USD": dollars(c.cost),
        "Tab reduced USD": dollars(c.debt_reduced),
        "Credit returned USD": dollars(c.credit_returned),
        "Unconfirmed payment cancelled USD": dollars(c.pending_reduced),
        "External refund USD": dollars(c.external_refund),
        "Refund method": c.refund_method,
      }));
  if (kind === "expenses")
    return a.expenses
      .filter(included)
      .map((e: Row) => ({
        "Expense ID": e.id,
        "Created UTC": utc(e.created_at),
        Type: e.kind,
        "Amount USD": dollars(e.amount),
        Description: e.description,
      }));
  if (kind === "members")
    return a.members.map((m: Row) => ({
      "Exported UTC": snapshot,
      "Member ID": m.id,
      Name: m.name,
      Email: m.email,
      Role: m.role,
      "Snack bar access": m.role === "admin" || !!m.snacks,
      "Gear access": m.role === "admin" || !!m.gear,
      Active: !!m.active,
      "Signed in": !!m.user_id,
      "Tab USD": dollars(m.debt),
      "Credit USD": dollars(m.credit),
      "Tab limit USD": dollars(m.tab_limit),
      "Community posting": m.posting_enabled !== 0,
      "Unpaid since UTC": utc(m.due_since),
    }));
  if (kind === "inventory")
    return data.products.map((p: Row) => ({
      "Exported UTC": snapshot,
      "Product ID": p.id,
      Name: p.name,
      Category: p.category,
      "Variety / size": p.detail,
      "Price USD": dollars(p.price),
      "Cost USD": dollars(p.cost),
      "Tax rate percent": p.tax_bp == null ? "" : p.tax_bp / 100,
      "On hand": p.stock,
      "Restock at": p.reorder,
      Active: !!p.active,
      Archived: !!p.archived,
      Preorder: !!p.preorder,
    }));
  if (kind === "options")
    return data.products.flatMap((p: Row) =>
      (p.variants || []).map((v: Row) => ({
        "Exported UTC": snapshot,
        "Product ID": p.id,
        Product: p.name,
        "Option ID": v.id,
        Option: v.label,
        Size: v.size,
        Color: v.color,
        "Effective price USD": dollars(v.price ?? p.price),
        "Effective cost USD": dollars(v.cost ?? p.cost),
        Stock: v.stock,
        Active: !!v.active,
        Preorder: !!v.preorder,
      })),
    );
  if (kind === "audit")
    return a.events
      .filter(included)
      .map((e: Row) => ({
        "Event ID": e.id,
        "Created UTC": utc(e.created_at),
        Actor: member(e.actor)?.name || e.actor,
        Action: e.kind,
        Target: e.target,
        Details: e.detail,
      }));
  throw Error("Choose a record type.");
}
export function toCsv(rows: Row[]) {
  const cell = (value: any) => {
    let text = String(value ?? "");
    if (typeof value === "string" && /^[\s]*[=+@-]/.test(text))
      text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  if (!rows.length)
    return '"Result"\r\n"No records in the selected period"\r\n';
  const keys = Object.keys(rows[0]);
  return (
    [
      keys.map(cell).join(","),
      ...rows.map((row) => keys.map((k) => cell(row[k])).join(",")),
    ].join("\r\n") + "\r\n"
  );
}
