import type { ReactNode } from "react";

export type AppIconName = "affiliate" | "campaign" | "chart" | "check" | "click" | "commission" | "content" | "copy" | "loyalty" | "order" | "shield" | "sparkles";

type AppIconProps = { name: AppIconName; size?: number; className?: string };

const paths: Record<AppIconName, ReactNode> = {
  affiliate: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></>,
  campaign: <><path d="m3 11 18-5v12L3 14v-3Z" /><path d="M11.6 16 10 21H6l1.3-6M21 9v6" /></>,
  chart: <><path d="M4 19V9M10 19V5M16 19v-7M22 19V3M2 19h20" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  click: <><path d="m4 4 7 17 2.4-7.6L21 11 4 4Z" /><path d="m14 14 5 5" /></>,
  commission: <><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5c-.8-.7-1.9-1-3.2-1-1.8 0-3.3.9-3.3 2.4 0 3.7 6.5 1.5 6.5 5.1 0 1.5-1.4 2.5-3.4 2.5-1.4 0-2.7-.4-3.6-1.2M12 5.5v13" /></>,
  content: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M7 8h10M7 12h10M7 16h6" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  loyalty: <><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" /><path d="M12 9v6M9 12h6" /></>,
  order: <><path d="M6 3h12l2 4v14H4V7l2-4ZM4 7h16M9 11a3 3 0 0 0 6 0" /></>,
  shield: <><path d="M12 22s8-3.6 8-10V5l-8-3-8 3v7c0 6.4 8 10 8 10Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
  sparkles: <><path d="m12 3 1.4 3.6L17 8l-3.6 1.4L12 13l-1.4-3.6L7 8l3.6-1.4L12 3ZM5 14l.9 2.1L8 17l-2.1.9L5 20l-.9-2.1L2 17l2.1-.9L5 14ZM19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z" /></>,
};

export function AppIcon({ name, size = 20, className }: AppIconProps) {
  return <svg aria-hidden="true" className={className} fill="none" focusable="false" height={size} viewBox="0 0 24 24" width={size}><g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7">{paths[name]}</g></svg>;
}
