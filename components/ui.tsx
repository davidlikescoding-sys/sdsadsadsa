"use client";

import React, { useRef } from "react";
import { useModalFocus } from "@/lib/use-modal-focus";

export function Card({ children, className = "", title, subtitle, action }: {
  children: React.ReactNode; className?: string; title?: string; subtitle?: string; action?: React.ReactNode;
}) {
  return (
    <section className={`surface luxe-card rounded-lg ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b hairline px-4 py-3">
          <div>
            {title && <h2 className="font-display text-sm font-semibold tracking-tight">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-[var(--muted)]">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md";
  loading?: boolean;
};

export function Button({ variant = "secondary", size = "md", loading, className = "", children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`focus-ring luxe-button luxe-button--${variant} inline-flex items-center justify-center gap-2 ${size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm"} ${className}`}
    >
      {loading && <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`focus-ring luxe-field ${props.className ?? ""}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`focus-ring luxe-field ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`focus-ring luxe-field ${props.className ?? ""}`} />;
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "cyan" | "green" | "amber" | "red" }) {
  const tones: Record<string, string> = {
    neutral: "luxe-badge--neutral",
    cyan: "luxe-badge--gold",
    green: "luxe-badge--success",
    amber: "luxe-badge--warning",
    red: "luxe-badge--danger",
  };
  return <span className={`luxe-badge inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${tones[tone]}`}>{children}</span>;
}

export function PageHeader({ eyebrow, title, description, actions }: {
  eyebrow: string; title: string; description?: string; actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="mono-label mb-2 text-[var(--gold)]">{eyebrow}</div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-[var(--muted)]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, suffix, tone }: { label: string; value: React.ReactNode; suffix?: string; tone?: string }) {
  return (
    <div className="surface luxe-card rounded-lg px-4 py-3">
      <div className="mono-label">{label}</div>
      <div className={`mt-2 font-mono text-xl font-semibold tracking-tight ${tone ?? "text-[var(--ivory)]"}`}>
        {value}{suffix && <span className="ml-1 text-xs font-normal text-[var(--muted)]">{suffix}</span>}
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed hairline bg-[var(--gold-faint)] px-6 py-12 text-center">
      <div className="brand-emblem mb-3 font-mono text-2xl">◇</div>
      <h3 className="font-display text-sm font-medium text-[var(--platinum)]">{title}</h3>
      <p className="mt-1.5 max-w-md text-xs text-[var(--muted)]">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="block">
      <span className="mb-1.5 block text-xs font-medium text-[var(--platinum)]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-[var(--muted)]">{hint}</span>}
    </div>
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="luxe-error rounded-md px-3 py-2 text-xs" role="alert">
      {message}
    </div>
  );
}

export function ConfirmDialog({ open, title, description, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false, onConfirm, onCancel }: {
  open: boolean; title: string; description?: string; confirmLabel?: string; cancelLabel?: string;
  danger?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, dialogRef, onCancel);

  if (!open) return null;
  return (
    <div className="luxe-backdrop fixed inset-0 z-[100] flex items-center justify-center p-4" onMouseDown={onCancel}>
      <div
        ref={dialogRef} tabIndex={-1}
        role="dialog" aria-modal="true" aria-labelledby="confirm-title"
        className="surface luxe-card w-full max-w-md rounded-lg shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b hairline px-5 py-4">
          <h2 id="confirm-title" className="font-display text-sm font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">{description}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4">
          <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? "Progress"} className="luxe-track h-2 w-full overflow-hidden rounded-full">
      <div className="luxe-fill h-full rounded-full transition-[width] duration-200" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
