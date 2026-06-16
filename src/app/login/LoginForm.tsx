"use client";

import { useActionState } from "react";
import { authenticate } from "./actions";
import { LoginScene } from "./LoginScene";

const inputCls =
  "mt-1.5 w-full rounded-lg border border-pacific-mid/25 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder-pacific-mid/40 transition focus:border-pacific-light/60 focus:bg-white/10 focus:outline-none";

export function LoginForm({ branch }: { branch: "SHOP_FLOOR" | "OFFICE" }) {
  const [errorMessage, formAction, isPending] = useActionState(authenticate, undefined);

  return (
    <LoginScene>
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/logo-white.png" alt="Pacific Surfaces" className="mx-auto mb-6 h-14 w-14 object-contain" />
          <div className="text-[11px] font-medium uppercase tracking-[0.34em] text-pacific-mid">Pacific Surfaces</div>
          <h1 className="mt-2 text-3xl font-light tracking-tight text-white">Production ERP</h1>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-pacific-mid/25 bg-white/5 px-3.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-pacific-light">
            {branch === "OFFICE" ? "Office" : "Shop Floor"}
          </div>
        </div>

        <div className="relative rounded-2xl border border-pacific-mid/15 bg-white/5 p-7 backdrop-blur-sm">
          <form action={formAction} className="space-y-5">
            <input type="hidden" name="branch" value={branch} />
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-[0.18em] text-pacific-mid">Email</label>
              <input name="email" type="email" required autoComplete="username" placeholder="you@thepacific.group" className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-[0.18em] text-pacific-mid">Password</label>
              <input name="password" type="password" required autoComplete="current-password" placeholder="••••••••" className={inputCls} />
            </div>

            {errorMessage && (
              <div className="flex items-start gap-2 rounded-lg border border-pacific-mid/30 bg-white/10 px-3.5 py-2.5 text-sm text-pacific-light">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="mt-0.5 shrink-0"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
                {errorMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={isPending}
              className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-lg bg-white px-3 py-2.5 text-sm font-medium text-pacific-dark transition hover:bg-pacific-light disabled:opacity-80"
            >
              {isPending && (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                </svg>
              )}
              {isPending ? "Signing you in…" : "Sign in"}
            </button>
          </form>

          {/* authenticating overlay */}
          {isPending && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-pacific-dark/70 backdrop-blur-[2px]">
              <div className="flex flex-col items-center gap-4">
                <img src="/logo-white.png" alt="" className="h-12 w-12 animate-pulse object-contain" />
                <div className="flex items-center gap-2 text-sm font-medium text-pacific-light">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                  </svg>
                  Signing you in…
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 text-center">
          <a href="/login" className="text-xs font-medium uppercase tracking-[0.18em] text-pacific-mid/70 transition hover:text-white">← switch branch</a>
        </div>
      </div>
    </LoginScene>
  );
}
