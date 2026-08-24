import type { ReactNode } from "react";

/** Cinematic dark backdrop shared by the branch chooser and the sign-in form:
 * pacific-dark base, layered depth gradients, faint oversized logo watermark. */
export function LoginScene({ children }: { children: ReactNode }) {
  return (
    // min-h-svh where supported: Android Chrome's 100vh is the tallest viewport,
    // so the centred card re-centred every time the URL bar or keyboard came and
    // went. The footer hides on a short (landscape phone) viewport instead of
    // overlapping the card.
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-pacific-dark px-4 py-12 supports-[height:100svh]:min-h-svh">
      {/* depth — pacific-dark opacities only */}
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(1100px 700px at 80% -10%, rgba(255,255,255,0.05), transparent 60%), radial-gradient(900px 600px at -10% 110%, rgba(0,0,0,0.5), transparent 55%)" }} />
      {/* hairline grid */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.05]" style={{ backgroundImage: "linear-gradient(rgba(218,225,232,0.45) 1px, transparent 1px), linear-gradient(90deg, rgba(218,225,232,0.45) 1px, transparent 1px)", backgroundSize: "56px 56px" }} />
      {/* watermark mark */}
      <img src="/logo-white.png" alt="" aria-hidden className="pointer-events-none absolute -right-32 top-1/2 h-[34rem] w-[34rem] -translate-y-1/2 object-contain opacity-[0.04]" />
      <div className="relative z-10 w-full max-w-4xl">{children}</div>
      <div className="pointer-events-none absolute inset-x-0 bottom-5 text-center text-[10px] font-medium uppercase tracking-[0.3em] text-pacific-mid/40 [@media(max-height:480px)]:hidden">The Pacific Group</div>
    </main>
  );
}
