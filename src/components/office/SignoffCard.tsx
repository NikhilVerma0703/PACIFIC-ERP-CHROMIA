"use client";

// One sign-off card, identical on both screens that carry it.
//
// Batch costing (admin) and Verify a batch (the two verifiers) used to show the
// state of a batch's sign-off in three different shapes: a read-only strip
// inside the materials panel, a block buried in the costing page's "batch
// data" drawer with its own Mark buttons, and two button rows at the foot of
// the verify page's evidence cards. Same facts, three renderings, and whether
// you could SIGN depended on which page you had opened. This card is the one
// rendering: the two halves — consumption and prices — each with every mark it
// carries (who, when, whether it still holds), the blockers that stand in the
// way of a mark, and the buttons for whoever may sign. It sits in the same
// place on both pages, directly under the batch picker.
//
// It loads itself from the verify API and lets the API decide everything
// that matters: who may sign (sign[]), what is still to enter (completeness),
// and whether a mark is accepted (the POST refuses an unfinished batch with the
// list of what is missing, shown here verbatim). A reader the API turns away
// sees no card at all rather than a card that says nothing.

import { useCallback, useEffect, useState } from "react";
import { Badge, Card } from "@/components/ui";
import { readJson } from "@/lib/readJson";

const API = "/api/office/batch-verify";

type Side = "WEIGHTS" | "COSTS";
interface Mark { status: "verified" | "stale"; by: string; at: string }
interface State {
  sign: Side[];
  me?: string;
  verification: Record<Side, Mark[]>;
  completeness?: { ok: boolean; blockers: string[] };
}

const SIDE: Record<Side, { label: string; confirms: string }> = {
  WEIGHTS: { label: "Consumption", confirms: "the quantities the batch actually consumed" },
  COSTS:   { label: "Prices",      confirms: "the rates the batch is costed at" },
};

const btn = "rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";
const btnGhost = "rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

export function SignoffCard({ batchKey, onChanged }: {
  batchKey: string;
  /** Called after a mark is placed or withdrawn — the page re-reads whatever
   *  else it shows, because a mark is a fact about the batch it displays. */
  onChanged?: () => void;
}) {
  const [state, setState] = useState<State | null | undefined>(undefined); // undefined = loading, null = not for this viewer
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`${API}?batchKey=${encodeURIComponent(batchKey)}`, { cache: "no-store" });
    const res = await readJson<State>(r);
    setState(res.ok && res.data ? res.data : null);
  }, [batchKey]);

  useEffect(() => { setState(undefined); setNote(null); void load(); }, [load]);

  const act = async (side: Side, withdraw: boolean) => {
    setBusy(side + (withdraw ? ":undo" : "")); setNote(null);
    try {
      const r = withdraw
        ? await fetch(`${API}?batchKey=${encodeURIComponent(batchKey)}&side=${side}`, { method: "DELETE" })
        : await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchKey, side }) });
      const res = await readJson<{ error?: string }>(r);
      if (!res.ok) { setNote({ text: res.error ?? `Failed (${res.status})`, ok: false }); return; }
      setNote({ text: withdraw ? `${SIDE[side].label} sign-off withdrawn.` : `${SIDE[side].label} marked correct.`, ok: true });
      await load();
      onChanged?.();
    } catch (e) {
      setNote({ text: e instanceof Error && e.message ? `Could not reach the server: ${e.message}` : "Could not reach the server.", ok: false });
    } finally { setBusy(""); }
  };

  if (state === null) return null;

  const gaps = state?.completeness && !state.completeness.ok ? state.completeness.blockers : null;
  const canSign = (state?.sign.length ?? 0) > 0;

  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Sign-off</h2>
        <p className="text-xs text-gray-400">
          {canSign
            ? "Each verifier marks both halves. A mark lapses by itself if the numbers change under it."
            : "Who has checked this batch. Marks lapse by themselves if the numbers change under them."}
        </p>
      </div>

      {state === undefined ? (
        <p className="text-sm text-gray-400">Reading the sign-off…</p>
      ) : (
        <>
          {/* The API's own answer to "why can I not mark this yet", verbatim —
              a screen that re-derived the rule would eventually disagree with
              the one that decides. */}
          {canSign && gaps && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
              <p className="text-xs font-semibold text-amber-800">
                Cannot be marked correct yet — still to finish in the materials panel below:
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-amber-700">
                {gaps.map((b) => <li key={b}>{b}</li>)}
              </ul>
            </div>
          )}

          <div className="divide-y divide-gray-100">
            {(["WEIGHTS", "COSTS"] as Side[]).map((side) => {
              const marks = state.verification[side] ?? [];
              const mine = state.me ? marks.find((m) => m.by === state.me) : undefined;
              const maySign = state.sign.includes(side);
              return (
                <div key={side} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 first:pt-0 last:pb-0">
                  <span className="w-28 shrink-0 text-sm font-medium text-gray-800">{SIDE[side].label}</span>
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    {marks.length === 0 && <Badge tone="amber">Not yet marked</Badge>}
                    {marks.map((m) => m.status === "verified" ? (
                      <span key={m.by} className="flex items-center gap-1.5">
                        <Badge tone="green">Correct</Badge>
                        <span className="text-xs text-gray-500">{m.by} · {when(m.at)}</span>
                      </span>
                    ) : (
                      <span key={m.by} className="flex items-center gap-1.5">
                        <Badge tone="amber">Changed since</Badge>
                        <span className="text-xs text-amber-700">{m.by} marked an earlier version · {when(m.at)}</span>
                      </span>
                    ))}
                  </span>
                  {maySign && (
                    <span className="flex items-center gap-2">
                      <button type="button" className={btn} disabled={busy !== "" || !!gaps}
                        title={`You are confirming ${SIDE[side].confirms}.`}
                        onClick={() => void act(side, false)}>
                        {busy === side ? "Saving…" : mine?.status === "verified" ? "Marked by you" : "Mark correct"}
                      </button>
                      {mine && (
                        <button type="button" className={btnGhost} disabled={busy !== ""}
                          onClick={() => void act(side, true)}>
                          {busy === side + ":undo" ? "…" : "Withdraw mine"}
                        </button>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {note && (
            <p className={`mt-2 text-xs ${note.ok ? "text-green-700" : "text-red-700"}`}>{note.text}</p>
          )}
        </>
      )}
    </Card>
  );
}
