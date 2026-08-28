"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { Nav } from "./Nav";
import { RoleSwitcher } from "./RoleSwitcher";

export function MobileNav({
  contexts, activeKey, showAdmin = false, branch = "SHOP_FLOOR", role = "", fabTier = "", inventory = false, consumables = false, intlSales = false, salesDuty = "", batchVerify = false }: { showAdmin?: boolean; branch?: string; role?: string; fabTier?: string; inventory?: boolean; consumables?: boolean; intlSales?: boolean; salesDuty?: string; batchVerify?: boolean
  /** Same shape the desktop rail passes — grantedContexts(). */
  contexts?: React.ComponentProps<typeof RoleSwitcher>["contexts"];
  activeKey?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const path = usePathname();
  
  // Close the drawer on navigation
  useEffect(() => { setOpen(false); }, [path]);

  // Ensure Portal only runs on the client to prevent Next.js SSR errors
  useEffect(() => { setMounted(true); }, []);

  // The Teleported Drawer
  const drawerContent = open && mounted ? createPortal(
    <div className="fixed inset-0 z-[9999] md:hidden">
      
      {/* Dark, blurry backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" 
        onClick={() => setOpen(false)} 
      />
      
      {/* White Sidebar Drawer */}
      <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white px-4 py-5 shadow-2xl z-[10000]">
        
        {/* Drawer Header */}
        <div className="mb-5 flex items-center justify-between px-2 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900">
              <img src="/logo-white.png" alt="Pacific Surfaces" className="h-5 w-5 object-contain" />
            </div>
            <div className="text-sm font-semibold text-gray-900">Pacific ERP</div>
          </div>
          <button 
            type="button" 
            onClick={() => setOpen(false)} 
            aria-label="Close menu" 
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/* Navigation Links */}
        <div className="flex-1 overflow-y-auto pb-6">
          <Nav showAdmin={showAdmin} branch={branch} role={role} fabTier={fabTier} inventory={inventory} consumables={consumables} intlSales={intlSales} salesDuty={salesDuty} batchVerify={batchVerify} />
        </div>

        {/* THE SWITCHER, ON A PHONE OR A SHOP TABLET.
            Its only other mount is inside the desktop sidebar, which is
            `hidden md:flex` — so under 768px a dual-role user could switch INTO
            a context from a desktop and then have no way back out. One-way is
            worse than absent. Same component, same foot-of-the-rail placement
            as everywhere else; renders nothing for a single-job login. */}
        {contexts && contexts.length > 1 && (
          <div className="shrink-0 border-t border-gray-200 p-3">
            <RoleSwitcher contexts={contexts} activeKey={activeKey ?? ""} />
          </div>
        )}

      </div>
    </div>,
    document.body // This is the magic teleport destination
  ) : null;

  return (
    <>
      {/* Hamburger Toggle Button (Stays in its normal spot) */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 md:hidden"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Render the teleported drawer */}
      {drawerContent}
    </>
  );
}