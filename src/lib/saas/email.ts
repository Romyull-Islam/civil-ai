/**
 * Transactional email. Every configured transport is tried in turn until one delivers:
 *  1. Brevo API (BREVO_API_KEY, 300/day free; a single verified sender address is enough, no domain needed)
 *  2. Resend API (RESEND_API_KEY, 3,000/month free; needs a verified domain to mail other people)
 *  3. SMTP (company mail server or Gmail App Password: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)
 * HTTPS APIs come first because some hosts (Render's free plan) block outbound SMTP ports, which made SMTP hang for about
 * two minutes. Every attempt has a short timeout. Without any transport, codes are logged to the server console.
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<{ delivered: boolean; via: string }> {
  const from = process.env.EMAIL_FROM || (process.env.SMTP_USER ? `CivilMate <${process.env.SMTP_USER}>` : "CivilMate <no-reply@example.com>");
  const tried: string[] = [];
  if (process.env.BREVO_API_KEY) {
    try {
      const m = /^(.*)<(.+)>$/.exec(from);
      const r = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", signal: AbortSignal.timeout(15000), headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ sender: { name: m?.[1]?.trim() || "CivilMate", email: m?.[2]?.trim() ?? from }, to: [{ email: to }], subject, textContent: text }) });
      if (r.ok) return { delivered: true, via: "brevo" };
      console.error("Brevo send failed:", r.status, (await r.text().catch(() => "")).slice(0, 300));
    } catch (e) { console.error("Brevo send failed:", e instanceof Error ? e.message : e); }
    tried.push("brevo");
  }
  if (process.env.RESEND_API_KEY) {
    try {
      const r = await fetch("https://api.resend.com/emails", { method: "POST", signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to, subject, text }) });
      if (r.ok) return { delivered: true, via: "resend" };
      console.error("Resend send failed:", r.status, (await r.text().catch(() => "")).slice(0, 300));
    } catch (e) { console.error("Resend send failed:", e instanceof Error ? e.message : e); }
    tried.push("resend");
  }
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const nodemailer = await import("nodemailer");
    const port = Number(process.env.SMTP_PORT ?? 465);
    const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000 });
    try { await transport.sendMail({ from, to, subject, text }); return { delivered: true, via: "smtp" }; } catch (e) { console.error("SMTP send failed (outbound SMTP ports may be blocked by the host; use BREVO_API_KEY):", e instanceof Error ? e.message : e); }
    tried.push("smtp");
  }
  if (!tried.length) console.log(`[email → ${to}] ${subject}\n${text}`);
  return { delivered: false, via: tried.join(",") || "console" };
}
export const emailConfigured = () => !!((process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) || process.env.RESEND_API_KEY || process.env.BREVO_API_KEY);
