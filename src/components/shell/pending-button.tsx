"use client";

import { useFormStatus } from "react-dom";

export function PendingButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="decision-button decision-approve" type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}
