// SINK ASSIGNMENT — merged into the slab board, so this route is a redirect.
//
// It used to be its own screen: the whole project's piece rows in one column,
// clicked or dragged across to a Sink column, decided in a sitting of its own.
// The board itself was right and is unchanged — it now lives in
// components/fab/SinkBoard.tsx and is embedded under each slab's pieces on
// /fab/supervisor/slabs.
//
// WHY IT MOVED. The supervisor does not decide sinks for a project, he decides
// them for the pieces he is about to cut out of the slab in front of him. The
// owner's words: "the supervisor send to cutting slab wise, once after
// assigning pieces and sink for pieces then he send to cutting." Two screens
// meant the sink decision happened at a different time from the cut it belongs
// to, and nothing on either screen said whether the other had been done.
//
// WHY IT IS A REDIRECT AND NOT A DELETION. This path is in the sidebar history
// of every tablet on the floor and in whatever bookmarks the supervisors made.
// Deleting the route turns all of them into a 404 on a shift where the work has
// not changed; sending them to the merged screen puts them where the same board
// now is.

import { redirect } from "next/navigation";

export default function FabSinkBoardPage() {
  redirect("/fab/supervisor/slabs");
}
