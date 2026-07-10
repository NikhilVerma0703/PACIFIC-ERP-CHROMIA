import { salesAuth as auth } from "@/lib/sales/session";
import { getSpTransport } from "@/lib/sales/mailer";

export async function POST() {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const uid = (session.user as any).id as string;

  try {
    const { transport, from } = await getSpTransport(uid);
    const user = session.user as any;
    await transport.sendMail({
      from,
      to: user.email,
      subject: "Pacific ERP — SMTP Test",
      html: `<p>Your SMTP is working. Emails will be sent from <strong>${from}</strong>.</p>`,
    });
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
