"use client";
import "./experience.css";

export const adminGroups = [
  {
    title: "Start here",
    items: [
      ["overview", "Dashboard"],
      ["attention", "Needs attention"],
    ],
  },
  {
    title: "Money",
    items: [
      ["payments", "Confirm payments"],
      ["transactions", "Transactions & corrections"],
      ["month", "Month close"],
    ],
  },
  {
    title: "Products & orders",
    items: [
      ["inventory", "Products & stock"],
      ["planning", "Restock & counts"],
      ["pricing", "Pricing"],
      ["pickups", "Fulfillment"],
      ["guest", "Guest campaigns"],
      ["trials", "Trials & interest"],
    ],
  },
  {
    title: "Members & community",
    items: [
      ["members", "Members & access"],
      ["access", "Email changes"],
      ["rewards", "Murley Bucks & profiles"],
      ["community", "Community moderation"],
    ],
  },
  {
    title: "Store operations",
    items: [
      ["team", "Team board"],
      ["activity", "Activity history"],
      ["settings", "Store settings"],
    ],
  },
] as const;

export default function AdminNavigation({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const groups = adminGroups;
  return (
    <nav className="management-nav wf-admin-nav" aria-label="Store management">
      {[
        ["overview", "Overview"],
        ["inventory", "Products"],
        ["planning", "Restock"],
        ["money", "Money"],
        ["members", "Members"],
      ].map(([id, label]) => (
        <button
          type="button"
          key={id}
          aria-current={value === id ? "page" : undefined}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
      <details>
        <summary>More tools</summary>
        <div>
          {groups.map((group) => (
            <div className="management-group" key={group.title}>
              <span>{group.title}</span>
              {group.items
                .filter(
                  ([id]) =>
                    !["overview", "inventory", "planning", "members"].includes(
                      id,
                    ),
                )
                .map(([id, label]) => (
                  <button
                    type="button"
                    key={id}
                    aria-current={value === id ? "page" : undefined}
                    onClick={(e) => {
                      onChange(id);
                      const menu = e.currentTarget.closest("details");
                      menu?.removeAttribute("open");
                      menu?.querySelector("summary")?.focus();
                    }}
                  >
                    {label}
                  </button>
                ))}
            </div>
          ))}
        </div>
      </details>
    </nav>
  );
}
