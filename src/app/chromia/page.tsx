import { redirect } from "next/navigation";
import { APP_ROUTES } from "@/lib/chromia/constants/app";

/**
 * /chromia has no screen of its own — the module opens on its dashboard, the
 * same way /robo/masters opens on Designs. Kept as a redirect so every link,
 * bookmark and middleware fallback to the bare module root lands somewhere real.
 */
export default function ChromiaIndexPage() {
  redirect(APP_ROUTES.dashboard);
}
