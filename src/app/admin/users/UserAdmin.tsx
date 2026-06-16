"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { createUser, setActive, resetPassword, setStation, signOutEverywhere, signOutEveryone } from "./actions";
import { STATION_LABEL, ROLE_LABEL, ROLE_RANK, type RoleName } from "@/lib/rbac";

export interface UserRow {
  id: string; email: string; name: string | null; role: string; station: string | null;
  active: boolean; createdAt: string; createdByName: string | null;
}

const base = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

export function UserAdmin({ users, creatable, stations, office = false, showGlobal = false, myRole = "", myId = "" }: { users: UserRow[]; creatable: RoleName[]; stations: string[]; office?: boolean; showGlobal?: boolean; myRole?: string; myId?: string }) {
  const [msg, action, pending] = useActionState(createUser, undefined);
  const [role, setRole] = useState<string>(creatable[creatable.length - 1] ?? "");
  const [globalPending, startGlobal] = useTransition();
  const [globalNote, setGlobalNote] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="space-y-8">
      {/* Create */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="mb-1 text-sm font-semibold text-gray-800">Create a login</h2>
        <p className="mb-4 text-xs text-gray-500">You can create: {creatable.map((r) => ROLE_LABEL[r]).join(", ") || "—"}.</p>
        <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Email</span>
            <input name="email" type="email" required className={base} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Name</span>
            <input name="name" className={base} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Temp password</span>
            <input name="password" type="text" minLength={8} required placeholder="min 8 chars" className={base} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Role</span>
            <select name="role" value={role} onChange={(e) => setRole(e.target.value)} className={base}>
              {creatable.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select></label>
          {!office && <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Machine / station {role === "OPERATOR" ? "(required)" : "(operators only)"}</span>
            <select name="station" disabled={role !== "OPERATOR"} className={`${base} disabled:bg-gray-50 disabled:text-gray-400`}>
              <option value="">—</option>
              {stations.map((s) => <option key={s} value={s}>{STATION_LABEL[s] ?? s}</option>)}
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
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Machine</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Created by</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => <Row key={u.id} u={u} stations={stations} myRole={myRole} myId={myId} onChange={() => router.refresh()} />)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Row({ u, stations, myRole, myId, onChange }: { u: UserRow; stations: string[]; myRole: string; myId: string; onChange: () => void }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  const act = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => { const r = await fn(); setNote(r.message); if (r.ok) onChange(); });

  // mirror the server rules: manage only roles BELOW yours; password/sign-out also allowed on yourself
  const self = u.id === myId;
  const manageable = !self && (ROLE_RANK[u.role] ?? 0) < (ROLE_RANK[myRole] ?? 0);
  const canPassword = manageable || self;

  return (
    <tr className={`border-t border-gray-100 align-top ${u.active ? "" : "opacity-60"}`}>
      <td className="py-2 pr-4">
        <div className="font-medium text-gray-900">{u.name || u.email}</div>
        {u.name && <div className="text-xs text-gray-400">{u.email}</div>}
      </td>
      <td className="py-2 pr-4">{ROLE_LABEL[u.role] ?? u.role}</td>
      <td className="py-2 pr-4">
        {u.role === "OPERATOR" ? (
          <select defaultValue={u.station ?? ""} disabled={pending}
            onChange={(e) => act(() => setStation(u.id, e.target.value || null))}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs">
            <option value="">—</option>
            {stations.map((s) => <option key={s} value={s}>{STATION_LABEL[s] ?? s}</option>)}
          </select>
        ) : <span className="text-gray-400">—</span>}
      </td>
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
