import Link from "next/link";
import { ArrowUpRight, ShieldCheck, Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { shortenAddress, timeAgo, formatGen } from "@/lib/utils";
import type { CovenantMeta } from "@/lib/sentinel-abi";

export function CovenantCard({ meta }: { meta: CovenantMeta }) {
  return (
    <Link
      href={`/covenants/${meta.address}`}
      className="card-surface card-surface-hover group flex flex-col gap-4 p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <Badge variant="red">
          <ShieldCheck className="h-3 w-3" /> {formatGen(meta.min_bond)} GEN bond
        </Badge>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-fg-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-red" />
      </div>

      <div>
        <h3 className="line-clamp-2 text-lg font-semibold leading-snug text-fg">{meta.service_name}</h3>
        <p className="mt-1.5 line-clamp-1 text-sm text-fg-secondary">{meta.endpoint_url}</p>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg-muted">
        <span className="flex items-center gap-1">
          <Globe className="h-3.5 w-3.5" /> {shortenAddress(meta.seller)}
        </span>
        <span>{timeAgo(meta.created_at)}</span>
      </div>
    </Link>
  );
}
