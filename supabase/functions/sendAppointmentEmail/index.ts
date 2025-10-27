// /supabase/functions/sendAppointmentEmail/index.ts
import { SMTPClient } from "https://deno.land/x/smtp/mod.ts";

const SMTP_HOST = Deno.env.get("SMTP_HOST");
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") || "465");
const SMTP_USER = Deno.env.get("SMTP_USER");
const SMTP_PASS = Deno.env.get("SMTP_PASS");
const SMTP_FROM = Deno.env.get("SMTP_FROM") || "Commerciale | Advisory+ <commerciale@advisoryplus.it>";
const SMTP_SECURE = (Deno.env.get("SMTP_SECURE") || "true").toLowerCase() === "true";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

// --- Genera file ICS Outlook/Google ---
function buildICS({ title, description, start, end, location }) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${Date.now()}@advisoryplus.it`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
    `DTSTART:${start.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
    `DTEND:${end.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description}`,
    location ? `LOCATION:${location}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = await req.json().catch(() => ({}));
    const {
      to_client_email,
      cc_advisor_email,
      cliente_nome,
      advisor_nome,
      ts_iso,
      durata_minuti = 60,
      modalita,
      note = "",
      location = ""
    } = body;

    if (!to_client_email || !ts_iso || !modalita) {
      return new Response(JSON.stringify({ error: "Parametri mancanti" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...cors },
      });
    }

    const start = new Date(ts_iso);
    const end = new Date(start.getTime() + durata_minuti * 60_000);
    const titoloICS = `Appuntamento Advisory+ con ${cliente_nome || "Cliente"}`;
    const descrizioneICS = `Modalità: ${modalita}\nNote: ${note}`;
    const ics = buildICS({ title: titoloICS, description: descrizioneICS, start, end, location });

    const subject = `Promemoria appuntamento – ${cliente_nome}`;
    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;color:#0f172a">
        <p>Gentile ${cliente_nome},</p>
        <p>Le ricordiamo l’appuntamento fissato per il giorno <b>${start.toLocaleDateString("it-IT")}</b> alle ore <b>${start.toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"})}</b> in modalità <b>${modalita}</b>.</p>
        <p><b>Note:</b> ${note || "-"}</p>
        <p>Cordiali saluti,<br>${advisor_nome}<br>Advisory+</p>
      </div>
    `;

    // 🔹 SMTP identico alla tua funzione "smtp_invite"
    const client = new SMTPClient({
      connection: {
        hostname: SMTP_HOST,
        port: SMTP_PORT,
        tls: SMTP_SECURE,
        auth: { username: SMTP_USER, password: SMTP_PASS },
      },
    });

    await client.send({
      from: SMTP_FROM,
      to: to_client_email,
      cc: cc_advisor_email,
      subject,
      content: html,
      html: true,
      attachments: [
        {
          filename: "appuntamento.ics",
          content: ics,
          contentType: "text/calendar; method=REQUEST",
        },
      ],
    });

    await client.close();

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...cors },
    });

  } catch (e) {
    console.error("Errore invio:", e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }
});
