import Link from "next/link";
import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { STATION_LABEL } from "@/lib/rbac";

export function NoAccess({ station }: { station?: string | null }) {
  return (
    <Shell>
      <Link href="/entry" className="mb-1 inline-flex items-center gap-1 text-sm text-brand hover:underline">← Data entry</Link>
      <Card className="mt-4 max-w-xl">
        <div className="text-sm font-semibold text-gray-900">This form isn&apos;t assigned to your station</div>
        <p className="mt-1 text-sm text-gray-500">
          {station
            ? <>Your station is <span className="font-medium text-gray-700">{STATION_LABEL[station] ?? station}</span> — you&apos;ll find your form under Data Entry.</>
            : <>No station is assigned to your login yet. Ask your incharge to set your machine in Users &amp; Roles.</>}
        </p>
      </Card>
    </Shell>
  );
}
