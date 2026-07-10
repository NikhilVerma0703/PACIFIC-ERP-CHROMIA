import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { canManageRm } from "@/lib/rbac";
import { RmBagEntry } from "@/components/RmBagEntry";
import { getBagFormOptions } from "@/app/store/actions";
import { RmBagUpload } from "@/components/RmBagUpload";

export const dynamic = "force-dynamic";

export default async function DirectBagPage() {
  if (!(await canManageRm())) notFound();
  const options = await getBagFormOptions();
  return (
    <Shell>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Add bag — direct to Assigned RM</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">For a bag that's physically in the store and ready to use — it goes straight into Assigned RM and the silo dump form. For bulk invoices use <Link href="/store/upload" className="font-medium text-brand hover:underline">Excel upload</Link> or <Link href="/store/entry" className="font-medium text-brand hover:underline">invoice-line entry</Link> + <Link href="/store/assign" className="font-medium text-brand hover:underline">Assignment</Link>.</p>
      </div>
      <RmBagEntry options={options} />
      <div className="mt-6"><RmBagUpload /></div>
    </Shell>
  );
}
