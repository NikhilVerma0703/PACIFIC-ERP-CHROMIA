import { contextKey, type RoleContext } from "@/lib/roleContext";
import { roleLabelFor } from "@/lib/roles";
import { BRANCH_LABEL } from "@/lib/branchNames";
import { switchRoleContext } from "@/app/actions";

/**
 * "Which job am I in?" — the two-option picker that sits with the name and role
 * in the sidebar.
 *
 * The owner's words: "at top left where they see their role and name we need 2
 * options... highlight in a nice way what they see." So: both jobs listed where
 * the person already looks to see who the ERP thinks they are, the live one
 * marked and inert, the other one click away. No dropdown to open, no dialog to
 * confirm, nothing to retype and no second sign-in.
 *
 * NOTHING AT ALL FOR EVERYBODY ELSE. A login with one job gets one context, and
 * this returns null before it renders a wrapper, a heading or a border — no
 * empty picker, no stray chrome, not one changed pixel. That is the whole
 * reason `contexts` is a list rather than a primary plus an optional alternate:
 * the "does this person have two jobs" question is answered once, in
 * lib/roleContext.ts's grantedContexts(), and this just draws what it is given.
 *
 * A SERVER COMPONENT, deliberately. Each option is a plain form posting to a
 * server action, so switching works with no client JavaScript, and neither
 * next-auth nor the role tables are dragged into a browser bundle. The labels
 * come from lib/roles.ts and lib/branchNames.ts — the import-free modules the
 * rest of the app uses for exactly this, and the reason the FABRICATION arm of
 * roleLabelFor reads "Fabrication Supervisor" here rather than "Incharge".
 *
 * `tone` follows the sidebar it sits in: the main Shell and the fabrication
 * manager/supervisor rail are white, the fabrication operator rail is dark.
 */
export function RoleSwitcher({
  contexts,
  activeKey,
  tone = "light",
}: {
  /** Every pair this login may run as, primary first (grantedContexts). */
  contexts: RoleContext[];
  /** contextKey of the pair the request is running as. */
  activeKey: string;
  tone?: "light" | "dark";
}) {
  if (contexts.length < 2) return null;

  const dark = tone === "dark";
  const heading = dark ? "text-slate-500" : "text-gray-400";
  const activeCls = dark
    ? "bg-brand text-white shadow-sm ring-1 ring-inset ring-white/20"
    : "bg-brand text-white shadow-sm";
  const idleCls = dark
    ? "border border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white"
    : "border border-gray-200 text-gray-600 hover:border-brand/40 hover:bg-brand/5 hover:text-brand";

  return (
    <div className="mb-2.5">
      <p className={`mb-1 px-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${heading}`}>
        Your roles
      </p>
      <div className="flex flex-col gap-1">
        {contexts.map((c) => {
          const key = contextKey(c.role, c.branch);
          const active = key === activeKey;
          const label = roleLabelFor(c.role, c.branch);
          const where = BRANCH_LABEL[c.branch] ?? c.branch;
          return (
            <form key={key} action={switchRoleContext}>
              <input type="hidden" name="context" value={key} />
              <button
                type="submit"
                // The live one is not a control. Clicking it would post a
                // switch to the context you are already in — harmless (it is a
                // granted pair, so it resolves to itself) but it would reload
                // the page for nothing and make the highlight look like a
                // button that does not work.
                disabled={active}
                aria-current={active ? "true" : undefined}
                title={active ? `Signed in as ${label}` : `Switch to ${label}`}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] font-medium leading-tight transition disabled:cursor-default ${
                  active ? activeCls : idleCls
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    active ? "bg-white" : dark ? "bg-slate-600" : "bg-gray-300"
                  }`}
                />
                <span className="min-w-0 flex-1 truncate">
                  {label}
                  <span className={active ? "text-white/70" : dark ? "text-slate-500" : "text-gray-400"}>
                    {" · "}
                    {where}
                  </span>
                </span>
                {active && <span className="shrink-0 text-[9px] uppercase tracking-wider text-white/80">Active</span>}
              </button>
            </form>
          );
        })}
      </div>
    </div>
  );
}
