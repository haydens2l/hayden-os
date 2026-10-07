import Link from "next/link";

export function HowLink({ href }: { href: string }) {
  return (
    <p className="how-link">
      <Link href={href}>How do I use this?</Link>
    </p>
  );
}
