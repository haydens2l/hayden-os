import { Suspense, type ReactNode } from "react";
import { Header } from "@/components/shell/header";
import { Sidebar } from "@/components/shell/sidebar";
import { formatLongDate } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function OsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="os">
      <Sidebar />
      <div className="main">
        <Suspense fallback={<header className="top"><p className="wordmark">Hayden OS</p></header>}>
          <Header dateLabel={formatLongDate()} />
        </Suspense>
        <div className="canvas">{children}</div>
      </div>
    </div>
  );
}
