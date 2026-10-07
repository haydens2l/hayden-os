"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Command" },
  { href: "/today", label: "Today" },
  { href: "/businesses", label: "Businesses" },
  { href: "/projects", label: "Projects" },
  { href: "/team", label: "Team" },
  { href: "/decisions", label: "Decisions" },
  { href: "/intelligence", label: "Intelligence" },
  { href: "/operations", label: "Operations" },
  { href: "/production", label: "Content" },
  { href: "/work", label: "Work" },
  { href: "/agents", label: "Agents" },
  { href: "/settings", label: "Settings" },
  { href: "/help", label: "How to use" },
];

function active(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="rail">
      <p className="rail-mark">Operating system</p>
      <nav className="nav" aria-label="Primary">
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href} data-active={active(pathname, link.href)} aria-current={active(pathname, link.href) ? "page" : undefined}>
            {link.label}
          </Link>
        ))}
      </nav>
      <p className="rail-foot">Local memory stays on this Mac. Google Drive is read-only when connected.</p>
    </aside>
  );
}
