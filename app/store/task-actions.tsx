"use client";
import { Button } from "@/components/ui/button";
import { money, date, type Row } from "./shared";

export const taskLabels: Record<string, string> = {
  payment: "Payments", tab: "Tabs", email: "Email changes", reset: "Password resets",
  stock: "Stock", report: "Moderation", request: "Item requests", team: "Team questions",
  pickup: "Gear fulfillment", trial: "Trial reviews", adjustment: "Adjustments",
  guest: "Guest fulfillment", profile: "Profile approvals", "profile-report": "Profile reports",
};
export function taskActionLabel(task: Row) {
  if (task.status === "resolved") return "View record";
  return ({
    payment: "Confirm payment", reset: task.recovery_expires_at > Date.now() ? "Replace recovery code" : "Issue recovery code",
    email: "Review email change", tab: "Manage member", stock: "Manage stock",
    pickup: "Update pickup", guest: "Fulfill order", report: "Review report",
    request: "Review request", team: "Answer question", trial: "Review trial",
    adjustment: "Review adjustment", profile: "Review profile", "profile-report": "Review report",
  } as Record<string, string>)[task.type] || "Open record";
}
export function TaskSummary({ task }: { task: Row }) {
  return <div className="task-summary">
    <strong>{task.person || task.title}</strong>
    <span>{task.title}{["payment", "tab"].includes(task.type) ? " · " + money(task.amount) : ""}</span>
    <small>{task.reference}{task.created_at > 0 ? " · " + date(task.created_at) : ""}</small>
    {task.type === "reset" && task.active ? <small className="task-next-step">{
      task.recovery_expires_at > Date.now()
        ? "Code issued · waiting for member until " + date(task.recovery_expires_at)
        : task.recovery_expires_at ? "Code expired · issue a new code" : "Verify the member, then issue a private code"
    }</small> : null}
    {task.snoozed_until ? <small>Snoozed until {date(task.snoozed_until)}</small> : null}
  </div>;
}
export function TaskQuickList({ records, onAction }: { records: Row[]; onAction: (task: Row) => void }) {
  return <div className="task-quick-list">{records.map(task => <article className="task-quick-row" key={task.task_key}>
    <TaskSummary task={task} />
    <Button type="button" onClick={() => onAction(task)}>{taskActionLabel(task)}</Button>
  </article>)}</div>;
}
