import Link from "next/link";
import { LoginForm } from "./LoginForm";
import { LoginScene } from "./LoginScene";

export const dynamic = "force-dynamic";

function BranchCard({ href, title, desc, icon }: { href: string; title: string; desc: string; icon: string }) {
  return (
    <Link
      href={href}
      className="group block w-72 rounded-2xl border border-pacific-mid/15 bg-white/5 p-7 text-left backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:border-pacific-mid/40 hover:bg-white/10"
    >
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-pacific-mid/20 bg-white/5 text-pacific-light transition group-hover:bg-white group-hover:text-pacific-dark">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={icon} /></svg>
      </div>
      <div className="text-lg font-medium tracking-tight text-white">{title}</div>
      <div className="mt-1.5 text-sm leading-relaxed text-pacific-mid">{desc}</div>
      <div className="mt-5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-pacific-mid/80 transition group-hover:text-white">
        Sign in
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="transition group-hover:translate-x-0.5"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </div>
    </Link>
  );
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const branch = sp.branch === "office" ? "OFFICE" : sp.branch === "shop" ? "SHOP_FLOOR" : null;

  if (branch) return <LoginForm branch={branch} />;

  return (
    <LoginScene>
      <div className="mb-12 text-center">
        <img src="/logo-white.png" alt="Pacific Surfaces" className="mx-auto mb-7 h-16 w-16 object-contain" />
        <div className="text-[11px] font-medium uppercase tracking-[0.34em] text-pacific-mid">Pacific Surfaces</div>
        <h1 className="mt-3 text-4xl font-light tracking-tight text-white sm:text-5xl">Production ERP</h1>
        <p className="mt-4 text-sm text-pacific-mid">Choose your branch to sign in</p>
      </div>
      <div className="flex flex-wrap items-stretch justify-center gap-5">
        <BranchCard
          href="/login?branch=shop"
          title="Shop Floor"
          desc="Machines, silos, batches and slabs — the production line."
          icon="M2 20h20M4 20V8l5 4V8l5 4V4l6 4v12"
        />
        <BranchCard
          href="/login?branch=office"
          title="Office"
          desc="Finance and dispatch — shipping, invoices, reports."
          icon="M3 21h18M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16M9 7h2M9 11h2M9 15h2M13 7h2M13 11h2M13 15h2"
        />
      </div>
    </LoginScene>
  );
}
