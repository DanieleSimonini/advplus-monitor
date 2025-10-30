// /supabase/functions/sendAppointmentEmail/index.ts
// Email appuntamento che Outlook Classic apre come invito (inline) + HTML Century Gothic
// Deno v2 compatibile – denomailer

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SMTP_HOST = Deno.env.get("SMTP_HOST") || "";
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") || "465");
const SMTP_USER = Deno.env.get("SMTP_USER") || "";
const SMTP_PASS = Deno.env.get("SMTP_PASS") || "";

const RAW_SMTP_FROM = Deno.env.get("SMTP_FROM") || SMTP_USER || "";
// denomailer vuole un indirizzo email puro nel FROM:
const SMTP_FROM = RAW_SMTP_FROM.match(/<([^>]+)>/)?.[1]?.trim() ?? RAW_SMTP_FROM.trim();

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function tsUTC(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

// Normalizza CRLF e rimuove spazi finali riga anche per HTML
function sanitizeHtmlCrlf(s: string) {
  return s.split('\n').map(l => l.replace(/\s+$/, '')).join('\r\n');
}

// ICS conforme (CRLF obbligatori)
function buildICS(opts: {
  title: string;
  description: string;
  start: Date;
  end: Date;
  location?: string;
  organizerEmail: string;
  organizerName?: string;
  attendees?: { email: string; name?: string; role?: "REQ-PARTICIPANT" | "OPT-PARTICIPANT" }[];
  uid?: string;
  sequence?: number;
}) {
  const {
    title, description, start, end,
    location = "", organizerEmail, organizerName = "Organizer",
    attendees = [], uid = `${Date.now()}@advisoryplus.it`, sequence = 0,
  } = opts;

  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//AdvisoryPlus//CRM//IT",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `SEQUENCE:${sequence}`,
    `DTSTAMP:${tsUTC(new Date())}`,
    `DTSTART:${tsUTC(start)}`,
    `DTEND:${tsUTC(end)}`,
    `SUMMARY:${title.replace(/\r?\n/g, " ")}`,
    `DESCRIPTION:${description.replace(/\r?\n/g, "\\n")}`,
    location ? `LOCATION:${location.replace(/\r?\n/g, " ")}` : "",
    `ORGANIZER;CN=${organizerName}:MAILTO:${organizerEmail}`,
    ...attendees.map(a => {
      const cn = a.name ? `;CN=${a.name}` : "";
      const role = a.role ? `;ROLE=${a.role}` : ";ROLE=REQ-PARTICIPANT";
      return `ATTENDEE${cn}${role}:MAILTO:${a.email}`;
    }),
    "TRANSP:OPAQUE",
    "CLASS:PUBLIC",
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Promemoria appuntamento",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    if (!isNonEmptyString(SMTP_HOST) || !isNonEmptyString(SMTP_USER) || !isNonEmptyString(SMTP_PASS)) {
      return new Response(JSON.stringify({ error: "SMTP non configurato: SMTP_HOST/USER/PASS" }), {
        status: 500, headers: { "Content-Type": "application/json", ...cors }
      });
    }

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
      location = "",
      subject: subjectIn,
      title: titleIn,
    } = body;

    if (!isNonEmptyString(to_client_email) || !isNonEmptyString(ts_iso) || !isNonEmptyString(modalita)) {
      return new Response(JSON.stringify({
        error: "Parametri mancanti: to_client_email, ts_iso, modalita sono obbligatori."
      }), { status: 400, headers: { "Content-Type": "application/json", ...cors } });
    }

    const TO = to_client_email.trim();
    const CC = isNonEmptyString(cc_advisor_email) ? cc_advisor_email.trim() : null;
    const CLIENTE = isNonEmptyString(cliente_nome) ? cliente_nome.trim() : "Cliente";
    const ADVISOR = isNonEmptyString(advisor_nome) ? advisor_nome.trim() : "Advisory+";
    const MODE = modalita.trim();
    const NOTE = String(note ?? "").trim();
    const LOC = String(location ?? "").trim();

    const start = new Date(ts_iso);
    if (isNaN(start.getTime())) {
      return new Response(JSON.stringify({ error: "ts_iso non è una data valida (ISO 8601)." }), {
        status: 400, headers: { "Content-Type": "application/json", ...cors }
      });
    }
    const end = new Date(start.getTime() + Number(durata_minuti) * 60_000);

    const subject = isNonEmptyString(subjectIn) ? subjectIn : `Promemoria appuntamento – ${CLIENTE}`;
    const title = isNonEmptyString(titleIn) ? titleIn : `Appuntamento Advisory+ con ${CLIENTE}`;
    const dataStr = start.toLocaleDateString("it-IT");
    const oraStr = start.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

    // Corpo plain + HTML (Century Gothic)
    const text =
`Gentile ${CLIENTE},
Le ricordiamo l’appuntamento fissato per il giorno ${dataStr} alle ore ${oraStr} in modalità ${MODE}.
Note: ${NOTE || "-"}${LOC ? `\nLuogo: ${LOC}` : ""}
Cordiali saluti,
${ADVISOR}
Advisory+`;

    const html =
`<!doctype html>
<html>
  <body style="margin:0;padding:0;">
    <div style="font-family:'Century Gothic', CenturyGothic, AppleGothic, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; font-size:16px; line-height:1.45; color:#0f172a;">
      <p style="margin:0 0 12px 0;">Gentile ${CLIENTE},</p>
      <p style="margin:0 0 12px 0;">Le ricordiamo l’appuntamento fissato per il giorno <b>${dataStr}</b> alle ore <b>${oraStr}</b> in modalità <b>${MODE}</b>.</p>
      <p style="margin:0 0 12px 0;"><b>Note:</b> ${NOTE || "-"}</p>
      ${LOC ? `<p style="margin:0 0 12px 0;"><b>Luogo:</b> ${LOC}</p>` : ""}
      <p style="margin:16px 0 0 0;">Cordiali saluti,<br/>${ADVISOR}<br/>Advisory+</p>
    </div>
  </body>
</html>`;
    const html_safe = sanitizeHtmlCrlf(html);


    // ICS per invito inline
    const organizerNameGuess = RAW_SMTP_FROM.replace(/<.+>/, "").trim() || "Advisory+";
    const attendees = [
      { email: TO, name: CLIENTE, role: "REQ-PARTICIPANT" as const },
      ...(CC ? [{ email: CC, name: ADVISOR, role: "OPT-PARTICIPANT" as const }] : []),
    ];
    const ics = buildICS({
      title,
      description: `Modalità: ${MODE}\nNote: ${NOTE || "-"}`,
      start,
      end,
      location: LOC,
      organizerEmail: SMTP_FROM,
      organizerName: organizerNameGuess,
      attendees,
      sequence: 0,
    });

    // INVIO – TLS implicito 465
    const client = new SMTPClient({
      connection: {
        hostname: SMTP_HOST,
        port: SMTP_PORT,
        tls: true,
        auth: { username: SMTP_USER, password: SMTP_PASS },
      },
    });

    // Messaggio "multipart/alternative" + parte calendar inline
    const message: Record<string, unknown> = {
      from: SMTP_FROM,
      to: TO,
      ...(CC ? { cc: CC } : {}),
      subject,
      html: html_safe,                  // html → rendering corretto
      headers: {
        // suggerisce a Outlook che è un calendar message
        "Content-Class": "urn:content-classes:calendarmessage",
      },
      // Parte calendar INLINE: Outlook mostra il meeting form
      attachments: [
        {
          // parte inline che abilita i bottoni Accetta/Rifiuta
          filename: "invite.ics",
          content: ics,
          contentType: "text/calendar; method=REQUEST; charset=utf-8; name=invite.ics",
          disposition: "inline",
          contentId: "calendar-invite", // facoltativo, aiuta alcuni client
        },
        // (Opzionale) anche come allegato separato, utile per altri client
        {
          filename: "appuntamento.ics",
          content: ics,
          contentType: "application/ics; name=appuntamento.ics",
          disposition: "attachment",
        },
      ],
    };

    await client.send(message);
    await client.close();

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { "Content-Type": "application/json", ...cors }
    });
  } catch (e) {
    console.error("sendAppointmentEmail error:", e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { "Content-Type": "application/json", ...cors }
    });
  }
});
