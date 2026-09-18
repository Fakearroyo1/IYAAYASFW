"use client";
import { Plus, Minus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cartIssue, canAddLine } from "@/lib/pilot/cart";
import { money, type Row } from "./shared";
export default function BagItems({
  lines,
  busy,
  onQuantity,
  onRemove,
  onPrice,
}: {
  lines: Row[];
  busy: boolean;
  onQuantity?: (key: string, delta: number) => void;
  onRemove?: (key: string) => void;
  onPrice?: (p: Row) => void;
}) {
  return (
    <div className="bag-lines">
      {lines.map((p) => {
        const issue = cartIssue(p, lines);
        return (
          <div className="bag-item" key={p.key}>
            <div className="bag-line">
              <div>
                <strong>{p.name}</strong>
                {p.variantLabel ? <small>{p.variantLabel}</small> : null}
                {p.personalization ? (
                  <small>Personalization: {p.personalization}</small>
                ) : null}
                <small>
                  {p.qty} × {money(p.price)}
                  {p.preorder ? " · Preorder" : ""}
                </small>
              </div>
              <div className="bag-right">
                <strong>{money(p.price * p.qty)}</strong>
                {onQuantity ? (
                  <div className="stepper">
                    <button
                      type="button"
                      aria-label={
                        "Remove one " +
                        p.name +
                        (p.variantLabel ? " " + p.variantLabel : "")
                      }
                      disabled={busy}
                      onClick={() => onQuantity(p.key, -1)}
                    >
                      <Minus size={16} />
                    </button>
                    <span aria-live="polite">{p.qty}</span>
                    <button
                      type="button"
                      aria-label={
                        "Add one " +
                        p.name +
                        (p.variantLabel ? " " + p.variantLabel : "")
                      }
                      disabled={busy || !canAddLine(p, lines)}
                      onClick={() => onQuantity(p.key, 1)}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            {issue ? (
              <p className="bag-issue" role="status">
                {issue}
              </p>
            ) : null}
            <div className="bag-item-actions">
              {onRemove ? (
                <button
                  className="text-link"
                  type="button"
                  disabled={busy}
                  onClick={() => onRemove(p.key)}
                >
                  <Trash2 size={14} />
                  Remove
                </button>
              ) : null}
              {issue && !p.unavailable && p.category === "Gear" ? (
                <a
                  className="text-link"
                  href={"/products/" + encodeURIComponent(p.id)}
                >
                  Review options
                </a>
              ) : null}
              {onPrice &&
              p.active &&
              !p.missingOption &&
              p.currentPrice > 0 &&
              p.currentPrice !== p.price ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => onPrice(p)}
                >
                  Use {money(p.currentPrice)} price
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
