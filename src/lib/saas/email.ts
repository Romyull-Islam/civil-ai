/**
 * Transactional email, first configured option wins:
 *  1. SMTP (Gmail works: SMTP_HOST=smtp.gmail.com SMTP_PORT=465 SMTP_USER=you@gmail.com SMTP_PASS=<16-char App Password>; ~500 mails/day free, 2,000 on Workspace)
 *  2. Resend API (RESEND_API_KEY, 3,000/month free)   3. Brevo API (BREVO_API_KEY, 300/day free)
 * Without any, codes are logged to the server console (development only).
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<{ delivered: boolean; via: string }> {
  const from = process.env.EMAIL_FROM || (process.env.SMTP_USER ? `Civil AI <${process.env.SMTP_USER}>` : "Civil AI <no-reply@example.com>");
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const nodemailer = await import("nodemailer");
    const port = Number(process.env.SMTP_PORT ?? 465);
    const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
    try { await transport.sendMail({ from, to, subject, text }); return { delivered: true, via: "smtp" }; } catch (e) { console.error("SMTP send failed:", e instanceof Error ? e.message : e); return { delivered: false, via: "smtp" }; }
  }
  if (process.env.RESEND_API_KEY) {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to, subject, text }) });
    return { delivered: r.ok, via: "resend" };
  }
  if (process.env.BREVO_API_KEY) {
    const m = /^(.*)<(.+)>$/.exec(from);
    const r = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ sender: { name: m?.[1]?.trim() || "Civil AI", email: m?.[2] ?? from }, to: [{ email: to }], subject, textContent: text }) });
    return { delivered: r.ok, via: "brevo" };
  }
  console.log(`[email → ${to}] ${subject}\n${text}`);
  return { delivered: false, via: "console" };
}
export const emailConfigured = () => !!((process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) || process.env.RESEND_API_KEY || process.env.BREVO_API_KEY);
