// supabase/functions/sendReminderEmail/index.ts
// Promemoria solo per l'advisor, con ICS allegato
// Strutturato come sendAppointmentEmail (stesso SMTP / stile / ICS)

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SMTP_HOST = Deno.env.get("SMTP_HOST") || "";
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") || "465");
const SMTP_USER = Deno.env.get("SMTP_USER") || "";
const SMTP_PASS = Deno.env.get("SMTP_PASS") || "";

const RAW_SMTP_FROM = Deno.env.get("SMTP_FROM") || SMTP_USER || "";
// denomailer vuole un indirizzo email puro nel FROM:
const SMTP_FROM =
  RAW_SMTP_FROM.match(/<([^>]+)>/)?.[1]?.trim() ?? RAW_SMTP_FROM.trim();

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function tsUTC(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

// Normalizza CRLF e rimuove spazi finali riga anche per HTML
function sanitizeHtmlCrlf(s: string) {
  return s.split("\n").map((l) => l.replace(/\s+$/, "")).join("\r\n");
}

// ICS conforme (CRLF obbligatori) – stesso schema di sendAppointmentEmail
function buildICS(opts: {
  title: string;
  description: string;
  start: Date;
  end: Date;
  location?: string;
  organizerEmail: string;
  organizerName?: string;
  attendees?: {
    email: string;
    name?: string;
    role?: "REQ-PARTICIPANT" | "OPT-PARTICIPANT";
  }[];
  uid?: string;
  sequence?: number;
}) {
  const {
    title,
    description,
    start,
    end,
    location = "",
    organizerEmail,
    organizerName = "Organizer",
    attendees = [],
    uid = `${Date.now()}@advisoryplus.it`,
    sequence = 0,
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
    ...attendees.map((a) => {
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
    "DESCRIPTION:Promemoria lead",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    if (
      !isNonEmptyString(SMTP_HOST) ||
      !isNonEmptyString(SMTP_USER) ||
      !isNonEmptyString(SMTP_PASS)
    ) {
      return new Response(
        JSON.stringify({
          error: "SMTP non configurato: SMTP_HOST/USER/PASS",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...cors },
        },
      );
    }

    const body = await req.json().catch(() => ({}));
    const {
      to_advisor_email,
      advisor_nome,
      cliente_nome,
      ts_iso,
      durata_minuti = 30,
      note = "",
      location = "",
      subject: subjectIn,
      title: titleIn,
      // opzionale, solo informativo / logging
      lead_id,
    } = body;

    if (!isNonEmptyString(to_advisor_email) || !isNonEmptyString(ts_iso)) {
      return new Response(
        JSON.stringify({
          error: "Parametri mancanti: to_advisor_email e ts_iso sono obbligatori.",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...cors },
        },
      );
    }

    const TO = to_advisor_email.trim();
    const ADVISOR = isNonEmptyString(advisor_nome)
      ? advisor_nome.trim()
      : "Advisor";
    const CLIENTE = isNonEmptyString(cliente_nome)
      ? cliente_nome.trim()
      : "Cliente";
    const NOTE = String(note ?? "").trim();
    const LOC = String(location ?? "").trim();

    const start = new Date(ts_iso);
    if (isNaN(start.getTime())) {
      return new Response(
        JSON.stringify({ error: "ts_iso non è una data valida (ISO 8601)." }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...cors },
        },
      );
    }
    const end = new Date(start.getTime() + Number(durata_minuti) * 60_000);

    const subject = isNonEmptyString(subjectIn)
      ? subjectIn
      : `Nuovo promemoria lead – ${CLIENTE}`;
    const title = isNonEmptyString(titleIn)
      ? titleIn
      : `Promemoria su lead ${CLIENTE}`;

    const dataStr = start.toLocaleDateString("it-IT");
    const oraStr = start.toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
    });

    // Corpo plain text
    const text =
      `Ciao ${ADVISOR},
è stato creato un promemoria sul lead ${CLIENTE} per il giorno ${dataStr} alle ore ${oraStr}.
Note: ${NOTE || "-"}${LOC ? `\nLuogo: ${LOC}` : ""}${
        lead_id ? `\nID lead: ${lead_id}` : ""
      }

Advisory+`;

    // Corpo HTML (stesso stile Century Gothic)
    const html =
      `<!doctype html>
<html>
  <body style="margin:0;padding:0;">
    <div style="font-family:'Century Gothic', CenturyGothic, AppleGothic, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; font-size:16px; line-height:1.45; color:#0f172a;">
      <p style="margin:0 0 12px 0;">Ciao ${ADVISOR},</p>
      <p style="margin:0 0 12px 0;">
        è stato creato un <b>promemoria</b> sul lead <b>${CLIENTE}</b> per il giorno
        <b>${dataStr}</b> alle ore <b>${oraStr}</b>.
      </p>
      <p style="margin:0 0 12px 0;"><b>Note:</b> ${NOTE || "-"}</p>
      ${
        LOC
          ? `<p style="margin:0 0 12px 0;"><b>Luogo:</b> ${LOC}</p>`
          : ""
      }
      ${
        lead_id
          ? `<p style="margin:0 0 12px 0;"><b>ID lead:</b> ${lead_id}</p>`
          : ""
      }
      <p style="margin:16px 0 0 0;">Advisory+</p>
    </div>
  </body>
</html>`;
    const html_safe = sanitizeHtmlCrlf(html);

    // ICS solo per l'advisor
    const organizerNameGuess =
      RAW_SMTP_FROM.replace(/<.+>/, "").trim() || "Advisory+";
    const attendees = [
      { email: TO, name: ADVISOR, role: "REQ-PARTICIPANT" as const },
    ];

    const ics = buildICS({
      title,
      description: `Promemoria lead ${CLIENTE}\nNote: ${NOTE || "-"}`,
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

    const message: Record<string, unknown> = {
      from: SMTP_FROM,
      to: TO, // SOLO ADVISOR
      subject,
      text,
      html: html_safe,
      headers: {
        "Content-Class": "urn:content-classes:calendarmessage",
      },
      attachments: [
        {
          filename: "promemoria.ics",
          content: ics,
          contentType:
            "text/calendar; method=REQUEST; charset=utf-8; name=promemoria.ics",
          disposition: "inline",
          contentId: "reminder-calendar",
        },
        {
          filename: "promemoria-lead.ics",
          content: ics,
          contentType: "application/ics; name=promemoria-lead.ics",
          disposition: "attachment",
        },
      ],
    };

    await client.send(message);
    await client.close();

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...cors },
    });
  } catch (e) {
    console.error("sendReminderEmail error:", e);
    return new Response(
      JSON.stringify({ error: String(e?.message || e) }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...cors },
      },
    );
  }
});
