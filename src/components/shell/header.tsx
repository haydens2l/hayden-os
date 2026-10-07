"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { captureItem } from "@/lib/actions";

export function Header({ dateLabel }: { dateLabel: string }) {
  const params = useSearchParams();
  const query = params.get("q") ?? "";
  const captured = params.get("captured");
  const [mode, setMode] = useState<"ask" | "capture">(captured ? "capture" : "ask");

  return (
    <header className="top">
      <div className="top-row">
        <p className="wordmark">Hayden OS</p>
        <p className="today-date">{dateLabel}</p>
      </div>
      <div className="mode-switch" role="group" aria-label="Command mode">
        <button type="button" className={mode === "ask" ? "mode-on" : ""} aria-pressed={mode === "ask"} onClick={() => setMode("ask")}>
          Ask
        </button>
        <button
          type="button"
          className={mode === "capture" ? "mode-on" : ""}
          aria-pressed={mode === "capture"}
          onClick={() => setMode("capture")}
        >
          Capture
        </button>
      </div>
      {mode === "ask" ? (
        <form className="command-form" action="/" method="get">
          <label className="sr-only" htmlFor="q">
            Ask Hayden OS anything
          </label>
          <input id="q" name="q" key={query} defaultValue={query} placeholder="Ask Hayden OS anything…" autoComplete="off" />
        </form>
      ) : (
        <form className="command-form" action={captureItem}>
          <label className="sr-only" htmlFor="capture">
            Capture a task, idea, decision, project or note
          </label>
          <input id="capture" name="text" placeholder="Capture it and keep going…" autoComplete="off" />
          <button className="text-button" type="submit">
            Save
          </button>
        </form>
      )}
    </header>
  );
}
