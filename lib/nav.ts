/**
 * Single source of truth for navigation. Kept free of React/Next imports so it
 * can be validated in the node-only test environment and reused for page
 * titles without risking drift between the sidebar and the header.
 */

export type NavItem = { href: string; label: string; icon: string };
export type NavGroup = { section: string; items: NavItem[] };

/** The two experiences that stay visible at all times. */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/chat", label: "AI Chat", icon: "chat" },
  { href: "/image", label: "Images", icon: "image" },
];

/** Every other existing page, grouped like a folder of tools. Nothing is removed. */
export const EXPLORE_GROUPS: NavGroup[] = [
  { section: "Overview", items: [{ href: "/", label: "Dashboard", icon: "grid" }] },
  { section: "Laboratory", items: [
    { href: "/datasets", label: "Datasets", icon: "layers" },
    { href: "/architecture", label: "Architecture", icon: "cpu" },
    { href: "/training", label: "Training Lab", icon: "activity" },
    { href: "/internet-study", label: "Internet Study", icon: "globe" },
    { href: "/monitor", label: "AI Activity Monitor", icon: "monitor" },
    { href: "/evaluation", label: "Evaluation Lab", icon: "target" },
  ] },
  { section: "Learning", items: [
    { href: "/dictionary", label: "Dictionary", icon: "book" },
    { href: "/memory", label: "Memory", icon: "brain" },
    { href: "/learning", label: "Learning System", icon: "target" },
    { href: "/sandbox", label: "Sandbox", icon: "beaker" },
  ] },
  { section: "Workspace", items: [
    { href: "/checkpoints", label: "Checkpoints", icon: "save" },
    { href: "/experiments", label: "Experiments", icon: "flask" },
    { href: "/knowledge", label: "Knowledge Base", icon: "book" },
  ] },
  { section: "System", items: [{ href: "/settings", label: "AI Settings", icon: "settings" }] },
];

export const ALL_NAV_ITEMS: NavItem[] = [
  ...PRIMARY_NAV,
  ...EXPLORE_GROUPS.flatMap((group) => group.items),
];

/** Header titles are derived from the same data as the sidebar. */
export function getPageTitle(pathname: string): string {
  return ALL_NAV_ITEMS.find((item) => item.href === pathname)?.label ?? "DavidAI";
}

/** Whether a route belongs to the collapsible Explore folder. */
export function isExploreRoute(pathname: string): boolean {
  return EXPLORE_GROUPS.some((group) => group.items.some((item) => item.href === pathname));
}
