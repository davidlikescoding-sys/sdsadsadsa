"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { useModalFocus } from "@/lib/use-modal-focus";
import { estimateParams } from "@/engine/transformer";
import { EXPLORE_GROUPS, PRIMARY_NAV, getPageTitle, isExploreRoute, type NavItem } from "@/lib/nav";
import { formatNumber } from "./ui";
import { SystemStatus } from "./SystemStatus";
import { ToastHost } from "./ToastHost";

function BrandMark({ size = 28, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      className={animated ? "brand-emblem brand-emblem--loader" : "brand-emblem"}
    >
      <path d="M8 3h24l5 5v24l-5 5H8l-5-5V8l5-5Z" stroke="currentColor" strokeOpacity="0.42" />
      <path d="M13 12v16h8.5c4.7 0 8.5-3.6 8.5-8s-3.8-8-8.5-8H13Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M13 20h12" stroke="currentColor" strokeOpacity="0.5" />
      <circle cx="30" cy="10" r="1.5" fill="currentColor" />
    </svg>
  );
}

function Icon({ name }: { name: string }) {
  const common = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></>,
    layers: <><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></>,
    cpu: <><rect x="5" y="5" width="14" height="14" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4" /></>,
    activity: <><path d="M3 12h4l3-8 4 16 3-8h4" /></>,
    monitor: <><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4M6 9h3l2-3 3 6 2-3h2" /></>,
    chat: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.7 2.7 4 6 4 9s-1.3 6.3-4 9c-2.7-2.7-4-6-4-9s1.3-6.3 4-9Z" /></>,
    save: <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" /><path d="M17 21v-8H7v8M7 3v5h8" /></>,
    flask: <><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" /></>,
    beaker: <><path d="M9 3h6M10 3v6l-4.5 9A2 2 0 0 0 7.3 21h9.4a2 2 0 0 0 1.8-3L14 9V3" /><path d="M8 15h8M7 3h10" /></>,
    book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></>,
    brain: <><path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8V15a3 3 0 0 0 3 3h1V4Z" /><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 1 5.8V15a3 3 0 0 1-3 3h-1V4Z" /><path d="M9 8h2M13 8h2M12 12v6" /></>,
    target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
    folder: <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></>,
    chevron: <><path d="m9 6 6 6-6 6" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1A1.7 1.7 0 0 0 9 19.3a1.7 1.7 0 0 0-1.9.3l-.1.1-2.8-2.8.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3v-4h.1A1.7 1.7 0 0 0 4.7 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1L7.1 4.2l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.8 2.8-.1.1a1.7 1.7 0 0 0-.3 1.9V10a1.7 1.7 0 0 0 1.6 1H21v4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  };
  return <svg {...common}>{paths[name] ?? paths.grid}</svg>;
}

function NavLink({ item, active, onNavigate, compact = false }: {
  item: NavItem; active: boolean; onNavigate?: () => void; compact?: boolean;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`focus-ring flex items-center gap-3 rounded-md border px-2.5 py-2 text-[13px] transition-colors ${
        compact ? "py-1.5 text-[12px]" : ""
      } ${
        active ? "border-[var(--border-strong)] bg-[var(--gold-soft)] text-[var(--gold)]" : "border-transparent text-[var(--muted)] hover:bg-[var(--gold-faint)] hover:text-[var(--ivory)]"
      }`}
    >
      <Icon name={item.icon} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {active && <span className="h-1 w-1 shrink-0 rounded-full bg-[var(--gold)]" />}
    </Link>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { modelReady, config, training, hydrated, wordModelReady, wordParams, wordSteps } = useStore();
  const exploreActive = isExploreRoute(pathname);
  const [exploreOpen, setExploreOpen] = useState(exploreActive);

  // Deep links into a tool page open the folder so the active item is visible.
  useEffect(() => {
    if (exploreActive) setExploreOpen(true);
  }, [exploreActive]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-3 border-b hairline px-5">
        <div className="brand-tile"><BrandMark size={24} /></div>
        <div>
          <div className="font-display text-[15px] font-semibold tracking-tight">DavidAI</div>
          <div className="mono-label mt-0.5 text-[9px] text-[var(--gold)]">PERSONAL INTELLIGENCE</div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col overflow-y-auto px-3 py-5">
        <div className="mono-label mb-2 px-2">Primary</div>
        <div className="space-y-1">
          {PRIMARY_NAV.map((item) => (
            <NavLink key={item.href} item={item} active={pathname === item.href} onNavigate={onNavigate} />
          ))}
        </div>

        <div className="mt-auto pt-6">
          <button
            type="button"
            onClick={() => setExploreOpen((open) => !open)}
            aria-expanded={exploreOpen}
            aria-controls="explore-davidai-menu"
            className={`focus-ring flex w-full items-center gap-3 rounded-md border px-2.5 py-2 text-left text-[13px] transition-colors ${
              exploreActive ? "border-[var(--border-strong)] bg-[var(--gold-soft)] text-[var(--gold)]" : "border-transparent text-[var(--platinum)] hover:bg-[var(--gold-faint)] hover:text-[var(--ivory)]"
            }`}
          >
            <Icon name="folder" />
            <span className="min-w-0 flex-1 truncate font-medium">Explore DavidAI</span>
            <span aria-hidden="true" className="text-[12px]">📁</span>
            <span aria-hidden="true" className={`transition-transform ${exploreOpen ? "rotate-90" : ""}`}><Icon name="chevron" /></span>
          </button>
          <div id="explore-davidai-menu" hidden={!exploreOpen} className="mt-2 space-y-3 border-l hairline pl-3">
            {EXPLORE_GROUPS.map((group) => (
              <div key={group.section}>
                <div className="mono-label mb-1 px-2">{group.section}</div>
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <NavLink key={item.href} item={item} active={pathname === item.href} onNavigate={onNavigate} compact />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </nav>

      <div className="border-t hairline p-4">
        <div className="rounded-md border hairline bg-[var(--panel-soft)] p-3">
          <div className="flex items-center justify-between">
            <span className="mono-label">Word model</span>
            <span className={`h-2 w-2 rounded-full ${!hydrated ? "bg-[var(--warning)]" : modelReady || wordModelReady ? "bg-[var(--gold)] pulse-dot" : "bg-[var(--muted-dim)]"}`} />
          </div>
          <div className="mt-2 font-mono text-xs text-[var(--platinum)]">{!hydrated ? "LOADING…" : modelReady || wordModelReady ? "WORD MODEL READY" : "NOT TRAINED"}</div>
          <div className="mt-1 font-mono text-[10px] text-[var(--muted)]">
            {!hydrated ? "Restoring local state"
              : wordModelReady ? `${formatNumber(wordParams)} params · step ${wordSteps}`
              : modelReady ? `Legacy · ${formatNumber(estimateParams(config))} params · step ${training.step}`
              : "Chat uses local Qwen · train in Training Lab"}
          </div>
          {wordModelReady && modelReady && (
            <div className="mt-0.5 font-mono text-[9px] text-slate-600">Legacy: {formatNumber(estimateParams(config))} params · step {training.step}</div>
          )}
        </div>
        <div className="mt-3 px-1 font-mono text-[9px] text-slate-600">LOCAL DATA · LOCAL INFERENCE</div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const { settings, training, modelReady, hydrated } = useStore();
  useModalFocus(mobileOpen, drawerRef, () => setMobileOpen(false));

  useEffect(() => {
    // The pre-hydration script has already applied the persisted preference.
    // Applying defaults before hydration would flash the wrong theme.
    if (!hydrated) return;
    document.documentElement.setAttribute("data-theme", settings.theme);
    document.documentElement.setAttribute("data-density", settings.density);
  }, [hydrated, settings.theme, settings.density]);

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)]">
        <div className="text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-xl border border-[var(--border-strong)] bg-[var(--gold-soft)]"><BrandMark size={34} animated /></div>
          <div className="mono-label text-[var(--gold)]">Restoring your private workspace…</div>
          <div className="luxe-track mx-auto mt-4 h-0.5 w-40 overflow-hidden rounded">
            <div className="luxe-fill h-full w-1/2 rounded" />
          </div>
        </div>
        <ToastHost />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="app-sidebar fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r hairline lg:block">
        <SidebarContent />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-black/70" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />
          <aside
            ref={drawerRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Navigation"
            className="app-sidebar relative h-full w-[260px] border-r hairline"
          >
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="min-w-0 flex-1 lg:pl-[248px]">
        <header className="app-header sticky top-0 z-20 flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 border-b hairline px-4 py-2 sm:px-6">
          <button className="focus-ring rounded-md border hairline p-2 text-[var(--muted)] lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{getPageTitle(pathname)}</div>
            <div className="mono-label mt-0.5 hidden text-[9px] sm:block">davidai / {pathname === "/" ? "overview" : pathname.slice(1)}</div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <SystemStatus />
            <div className="hidden items-center gap-2 rounded-md border hairline bg-[var(--panel-soft)] px-2.5 py-1.5 sm:flex">
              <span className={`h-1.5 w-1.5 rounded-full ${training.status === "running" ? "bg-[var(--gold)] pulse-dot" : modelReady ? "bg-[var(--gold)]" : "bg-[var(--muted-dim)]"}`} />
              <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">{training.status}</span>
            </div>
            <div className="rounded-md border hairline bg-[var(--panel-soft)] px-2.5 py-1.5 font-mono text-[10px] text-[var(--muted)]">LOCAL ENGINE</div>
          </div>
        </header>
        <main className="app-main mx-auto max-w-[1500px] px-4 py-7 sm:px-6 lg:px-8">{children}</main>
      </div>
      <ToastHost />
    </div>
  );
}
