"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { createUser, setActive, resetPassword, setStation, setAltContext, signOutEverywhere, signOutEveryone } from "./actions";
// From the import-free modules, not lib/rbac / lib/branch: those import
// @/auth, and a "use client" import of them shipped next-auth, jose, bcryptjs,
// zod, a crypto polyfill and the Prisma browser stub to this page (≈240 kB
// gzipped, the largest route in the app) for four string tables.
import { STATION_LABEL, ROLE_RANK, roleLabelFor, type RoleName } from "@/lib/roles";
import { BRANCH_LABEL } from "@/lib/branchNames";
// Also import-free, and for the same reason: it is the module both edge gates
// share, so it cannot pull anything server-side into this bundle.
import { contextKey } from "@/lib/roleContext";
// The finished-goods rules module, NOT lib/inventory/access — same distinction
// as the two imports above. accessRules.ts imports nothing at all (it is the
// file node --test loads bare); access.ts next to it imports lib/rbac and would
// drag the whole auth chain into this bundle. This is the same sentence the
// server action checks, so the control is drawn exactly where the write is
// allowed.

export interface UserRow {
  id: string; email: string; name: string | null; role: string; station: string | null;
  branch?: string | null; active: boolean; createdAt: string; createdByName: string | null;
  // International Sales only (users.sales_role / sales_factory, scripts/0020)
  salesRole?: string | null; salesFactory?: string | null;
  // The SECOND job, for the few who hold two (users.alt_role / users.alt_branch,
  // scripts/0052). Both null for everybody else — and a row with only one of
  // them set is no grant at all, which is why they are always read together.
  altRole?: string | null; altBranch?: string | null;
  // THE FINISHED-GOODS VIEW GRANT (users.fg_view, scripts/0083): "may LOOK at
  // finished goods, whatever branch this login is on, and may change nothing in
  // it". False for everybody but the handful who hold it. Optional, because a
  // caller rendering a list built before the column existed passes nothing —
  // and absent reads as no grant, the same direction hasFgView() takes.
  fgView?: boolean | null;
}

/** One grantable second job: the pair's key (what the server matches against)
 *  and how to say it to an admin. Built in page.tsx from creatableRoles. */
export interface AltOption { key: string; label: string }

// International Sales duty labels — in sales context the Role dropdown offers
// DUTIES (stored in users.sales_role); the platform role is derived server-side.
const DUTY_LABEL: Record<string, string> = {
  SALESPERSON: "Salesperson", COMMERCIAL: "Commercial", ACCOUNTS: "Accounts",
  REPORTING_MANAGER: "Reporting Manager", SALES_ADMIN: "Sales Admin",
};
const FACTORY_LABEL: Record<string, string> = { QUARTZ: "Quartz", GRANITE: "Granite" };
// Only these duties take a factory scope (mirrors the page copy + create form).
const FACTORY_SCOPED = new Set(["COMMERCIAL", "ACCOUNTS"]);

const base = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

export function UserAdmin({ users, creatable, creatableByBranch = {}, stations, office = false, sales = false, salesCreatable = [], showGlobal = false, myRole = "", myId = "", branches = [], altGrantable = [] }: { users: UserRow[]; creatable: RoleName[]; creatableByBranch?: Record<string, RoleName[]>; stations: string[]; office?: boolean; sales?: boolean; salesCreatable?: string[]; showGlobal?: boolean; myRole?: string; myId?: string; branches?: string[];
  /** Second-role options this admin may hand out. Empty in sales context, which
   *  has its own duty model and is excluded from dual-role logins entirely. */
  altGrantable?: AltOption[] }) {
  const [msg, action, pending] = useActionState(createUser, undefined);
  const [branch, setBranch] = useState<string>(branches[0] ?? "");
  // Roles on offer depend on which Department is selected — Fabrication
  // shares the OPERATOR/INCHARGE/LINE_MANAGER hierarchy with Shop Floor but
  // only exposes those 3 (see lib/rbac.ts creatableRoles), not the Shop
  // Floor superset (Store/Maintenance/Robo). Falls back to the flat
  // `creatable` union when no per-branch map was passed (sales mode, or
  // callers not yet updated).
  const roleOptions: string[] = sales ? salesCreatable : (creatableByBranch[branch] ?? creatable);
  const [role, setRole] = useState<string>(sales ? (salesCreatable[salesCreatable.length - 1] ?? "") : (creatable[creatable.length - 1] ?? ""));
  // `role` can go stale when Department changes (e.g. it held "STORE" and
  // Fabrication doesn't offer that) — re-derive a value that's always one of
  // the currently rendered options instead of resetting state in an effect.
  const effectiveRole = roleOptions.includes(role) ? role : (roleOptions[roleOptions.length - 1] ?? "");
  // Fabrication machine assignment happens later at /fab/session (a cookie
  // picked at login time), not via the Shop Floor `station` column — so the
  // Shop Floor machine/station field below neither applies nor should be
  // required for a Fabrication Machine Operator.
  const isFabrication = !sales && branch === "FABRICATION";
  const [globalPending, startGlobal] = useTransition();
  const [globalNote, setGlobalNote] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="space-y-8">
      {/* Create */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="mb-1 text-sm font-semibold text-gray-800">Create a login</h2>
        <p className="mb-4 text-xs text-gray-500">You can create: {(sales ? salesCreatable.map((r) => DUTY_LABEL[r] ?? r) : roleOptions.map((r) => roleLabelFor(r, branch))).join(", ") || "—"}.</p>
        <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Email</span>
            <input name="email" type="email" required className={base} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Name</span>
            <input name="name" className={base} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Temp password</span>
            <input name="password" type="text" minLength={8} required placeholder="min 8 chars" className={base} /></label>
          {branches.length > 1 && <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Department</span>
            <select name="branch" value={branch} onChange={(e) => setBranch(e.target.value)} className={base}>
              {branches.map((b) => <option key={b} value={b}>{BRANCH_LABEL[b] ?? b}</option>)}
            </select></label>}
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">{sales ? "Role (sales duty)" : "Role"}</span>
            <select name="role" value={effectiveRole} onChange={(e) => setRole(e.target.value)} className={base}>
              {sales
                ? salesCreatable.map((r) => <option key={r} value={r}>{DUTY_LABEL[r] ?? r}</option>)
                : roleOptions.map((r) => <option key={r} value={r}>{roleLabelFor(r, branch)}</option>)}
            </select></label>
          {!office && !sales && !isFabrication && <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Machine / station {effectiveRole === "OPERATOR" ? "(required)" : "(operators only)"}</span>
            <select name="station" disabled={effectiveRole !== "OPERATOR"} className={`${base} disabled:bg-gray-50 disabled:text-gray-400`}>
              <option value="">—</option>
              {stations.map((s) => <option key={s} value={s}>{STATION_LABEL[s] ?? s}</option>)}
            </select></label>}
          {sales && <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Factory scope {FACTORY_SCOPED.has(effectiveRole) ? "(optional)" : "(Commercial & Accounts only)"}</span>
            <select name="salesFactory" disabled={!FACTORY_SCOPED.has(effectiveRole)} className={`${base} disabled:bg-gray-50 disabled:text-gray-400`}>
              <option value="">— both factories</option>
              <option value="QUARTZ">Quartz</option>
              <option value="GRANITE">Granite</option>
            </select></label>}
          <div className="flex items-end">
            <button disabled={pending} className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60">
              {pending ? "Creating…" : "Create login"}
            </button>
          </div>
        </form>
        {msg && <div className={`mt-3 text-sm ${msg === "ok" ? "text-green-600" : "text-red-600"}`}>{msg === "ok" ? "✓ Login created." : msg}</div>}
      </div>

      {/* List */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-800">Users · {users.length}</h2>
          {showGlobal && (
            <div className="flex items-center gap-2">
              {globalNote && <span className="text-xs text-gray-500">{globalNote}</span>}
              <button
                disabled={globalPending}
                onClick={() => {
                  if (!window.confirm("Sign EVERYONE out of every device — phones, tablets, PCs (including you)? Each person simply logs in again.")) return;
                  startGlobal(async () => { const r = await signOutEveryone(); setGlobalNote(r.message); if (r.ok) router.refresh(); });
                }}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >{globalPending ? "Working…" : "Sign everyone out everywhere"}</button>
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-2 pr-4">User</th>
                <th className="py-2 pr-4">{sales ? "Duty" : "Role"}</th>
                {!sales && <th className="py-2 pr-4">Machine</th>}
                {sales && <th className="py-2 pr-4">Factory</th>}
                {!sales && <th className="py-2 pr-4">Department</th>}
                {/* One person, two jobs, one login. Empty for everybody who
                    holds one — which is everybody but a handful. */}
                {!sales && <th className="py-2 pr-4">Second role</th>}
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Created by</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => <Row key={u.id} u={u} stations={stations} sales={sales} myRole={myRole} myId={myId} altGrantable={altGrantable} onChange={() => router.refresh()} />)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Row({ u, stations, sales = false, myRole, myId, altGrantable = [], onChange }: { u: UserRow; stations: string[]; sales?: boolean; myRole: string; myId: string; altGrantable?: AltOption[]; onChange: () => void }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  const act = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => { const r = await fn(); setNote(r.message); if (r.ok) onChange(); });

  // Mirror the server rules: manage only roles BELOW yours; password/sign-out
  // also allowed on yourself.
  //
  // RANKED BY THE HIGHEST ROLE THEY CAN WEAR, not their primary — the same
  // change made to canManageTarget() in actions.ts, kept in step here so the
  // buttons are not rendered for an account the server will refuse. Reading the
  // primary alone made a login with a senior SECOND job look junior, and drew
  // Reset password / Deactivate / Sign out devices next to it.
  const self = u.id === myId;
  const targetRank = Math.max(ROLE_RANK[u.role] ?? 0, u.altRole ? (ROLE_RANK[u.altRole] ?? 0) : 0);
  const manageable = !self && targetRank < (ROLE_RANK[myRole] ?? 0);
  const canPassword = manageable || self;

  // The pair currently granted, in the same key format the server matches on.
  // Both halves or neither: a half-filled grant is not a grant (lib/roleContext).
  const altKey = u.altRole && u.altBranch ? contextKey(u.altRole, u.altBranch) : "";
  const altLabel = altKey
    ? `${roleLabelFor(u.altRole as string, u.altBranch)} · ${BRANCH_LABEL[u.altBranch as string] ?? u.altBranch}`
    : "";
  // Sales logins are excluded from second jobs server-side, so the control is
  // not offered for them either — and only where this admin has something to
  // hand out or something to revoke.
  const canGrantAlt = manageable && !sales && (altGrantable.length > 0 || altKey !== "");


  return (
    <tr className={`border-t border-gray-100 align-top ${u.active ? "" : "opacity-60"}`}>
      <td className="py-2 pr-4">
        <div className="font-medium text-gray-900">{u.name || u.email}</div>
        {u.name && <div className="text-xs text-gray-400">{u.email}</div>}
      </td>
      <td className="py-2 pr-4">{sales && u.salesRole ? (DUTY_LABEL[u.salesRole] ?? u.salesRole) : roleLabelFor(u.role, u.branch)}</td>
      {!sales && <td className="py-2 pr-4">
        {u.role === "OPERATOR" && u.branch !== "FABRICATION" && u.branch !== "CHROMIA" ? (
          <select defaultValue={u.station ?? ""} disabled={pending}
            onChange={(e) => act(() => setStation(u.id, e.target.value || null))}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs">
            <option value="">—</option>
            {stations.map((s) => <option key={s} value={s}>{STATION_LABEL[s] ?? s}</option>)}
          </select>
        ) : <span className="text-gray-400">—</span>}
      </td>}
      {sales && <td className="py-2 pr-4 text-gray-600">{u.salesFactory ? (FACTORY_LABEL[u.salesFactory] ?? u.salesFactory) : "—"}</td>}
      {!sales && <td className="py-2 pr-4 text-gray-600">{BRANCH_LABEL[u.branch ?? "SHOP_FLOOR"] ?? u.branch ?? "—"}</td>}
      {/* SECOND ROLE — the cell this column was missing.
          The header has always rendered "Second role"; the body never did, so
          every column from Status rightwards sat one place left of its heading
          AND setAltContext had no call site anywhere in the app, which left the
          whole switcher ungrantable except by hand-written SQL. Both are this
          one cell. */}
      {!sales && <td className="py-2 pr-4">
        {canGrantAlt ? (
          <select value={altKey} disabled={pending}
            onChange={(e) => act(() => setAltContext(u.id, e.target.value))}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs max-w-[13rem]">
            <option value="">— none —</option>
            {/* A grant made by a more senior admin may sit outside what THIS
                admin can hand out. Listing it keeps the control honest: without
                it the select would render blank and read as "no second role". */}
            {altKey && !altGrantable.some((o) => o.key === altKey) && (
              <option value={altKey}>{altLabel} (granted above your level)</option>
            )}
            {altGrantable.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        ) : (
          <span className={altKey ? "text-gray-600" : "text-gray-400"}>{altKey ? altLabel : "—"}</span>
        )}
      </td>}
      <td className="py-2 pr-4">{u.active ? <span className="text-green-600">Active</span> : <span className="text-gray-400">Disabled</span>}</td>
      <td className="py-2 pr-4 text-gray-500">{u.createdByName ?? "—"}</td>
      <td className="py-2">
        <div className="flex flex-wrap items-center gap-2">
          {manageable && <button disabled={pending} onClick={() => act(() => setActive(u.id, !u.active))}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50">
            {u.active ? "Deactivate" : "Reactivate"}
          </button>}
          {canPassword && <button disabled={pending} onClick={() => {
            const pw = window.prompt(self ? "Your new password (min 8 chars) — you'll sign in again:" : `New password for ${u.email} (min 8 chars):`);
            if (pw) act(() => resetPassword(u.id, pw));
          }} className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50">
            {self ? "Change my password" : "Reset password"}
          </button>}
          {canPassword && <button disabled={pending} onClick={() => {
            if (!window.confirm(self ? "Sign yourself out of ALL devices?" : `Sign ${u.email} out of ALL devices?`)) return;
            act(() => signOutEverywhere(u.id));
          }} className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50">
            Sign out devices
          </button>}
          {!manageable && !self && <span className="text-xs text-gray-400">role above yours — view only</span>}
          {note && <span className="text-xs text-gray-500">{note}</span>}
        </div>
      </td>
    </tr>
  );
}
