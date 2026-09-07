import Link from "next/link";
import { ShieldCheck } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-border bg-bg-subtle">
      <div className="mx-auto max-w-7xl px-6 py-14">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-2">
            <Link href="/" className="flex items-center gap-2 text-lg font-semibold text-fg">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red text-white">
                <ShieldCheck className="h-4 w-4" />
              </span>
              Sentinel
            </Link>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-fg-secondary">
              Live SLA truth-bonds for the agent economy. GenLayer independently audits a live
              endpoint against its own advertised spec — a sustained streak of confirmed
              violations slashes the seller&apos;s bond for the buyers who were relying on it.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Product</p>
            <ul className="mt-3 space-y-2 text-sm text-fg-secondary">
              <li><Link href="/covenants" className="hover:text-fg">Browse covenants</Link></li>
              <li><Link href="/create" className="hover:text-fg">Post a covenant</Link></li>
              <li><Link href="/agents" className="hover:text-fg">Agent SDK</Link></li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Protocol</p>
            <ul className="mt-3 space-y-2 text-sm text-fg-secondary">
              <li>
                <a href="https://docs.genlayer.com" target="_blank" rel="noreferrer" className="hover:text-fg">
                  GenLayer Docs
                </a>
              </li>
              <li>
                <a href="https://github.com/Fortune9thx/sentinel" target="_blank" rel="noreferrer" className="hover:text-fg">
                  GitHub
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border pt-6 text-xs text-fg-muted md:flex-row">
          <p>© {new Date().getFullYear()} Sentinel. Built on GenLayer.</p>
          <p>Trust, audited continuously.</p>
        </div>
      </div>
    </footer>
  );
}
