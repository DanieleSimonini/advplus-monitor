// /supabase/functions/sendAppointmentEmail/index.ts
// Email appuntamento che Outlook Classic apre come invito (inline) + allegato .ics
// Deno v2 compatibile – usa denomailer (SMTPS 465)

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

// ---- CONFIG (prese da Supabase Secrets) ----
const SMTP_HOST = Deno.env.get("SMTP_HOST") || "";
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") || "465"); // 465
const SMTP_USER = Deno.env.get("SMTP_USER") || "";
const SMTP_PASS = Deno.env.get("SMTP_PASS") || "";

// denomailer richiede che FROM sia un indirizzo puro (niente "Nome <...>"):
const RAW_SMTP_FROM = Deno.env.get("SMTP_FROM") || SMTP_USER || "";
const SMTP_FROM = RAW_SMTP_FROM.match(/<([^>]+)>/)?.[1]?.trim() ?? RAW_SMTP_FROM.trim();

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// ---- HELPERS ----
function tsUTC(d: Date) {
  // YYYYMMDDTHHMMSSZ (RFC5545)
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function escapeHtmlForXAltDesc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * ICS conforme a Outlook Classic (PRODID Outlook, METHOD:REQUEST, ORGANIZER/ATTENDEE,
 * X-ALT-DESC HTML + DESCRIPTION plain, CRLF, ecc.)
 */
function buildICS(opts: {
  title: string;                 // SUMMARY
  htmlDescription: string;       // X-ALT-DESC (HTML)
  textDescription: string;       // DESCRIPTION (plain)
  start: Date;                   // UTC
  end: Date;                     // UTC
  location?: string;
  organizerEmail: string;        // MAILTO:
  organizerName?: string;        // CN
  attendeeEmail: string;         // destinatario principale
  attendeeName?: string;         // CN
  sequence?: number;             // default 0
  uid?: string;                  // default uuid senza '-'
  lastModified?: Date;           // default now
}) {
  const {
    title,
    htmlDescription,
    textDescription,
    start,
    end,
    location = "",
    organizerEmail,
    organizerName = "Organizer",
    attendeeEmail,
    attendeeName = "Partecipante",
    sequence = 0,
    uid = (crypto?.randomUUID?.() ?? `${Date.now()}`).replace(/-/g, ""),
    lastModified = new Date(),
  } = opts;

  const L = (arr: string[]) => arr.filter(Boolean).join("\r\n");
  return L([
    "BEGIN:VCALENDAR",
    "PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN",
    "CALSCALE:GREGORIAN",
    "VERSION:2.0",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `ORGANIZER;CN="${organizerName}":MAILTO:${organizerEmail}`,
    // NB: lo spazio dopo '=' in RSVP è voluto per replicare formati Outlook diffusi
    `ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP= FALSE;CN=${attendeeName}:mailto:${attendeeEmail}`,
    `LAST-MODIFIED:${tsUTC(lastModified)}`,
    `UID:${uid}`,
    `DTSTAMP:${tsUTC(lastModified)}`,
    `DTSTART:${tsUTC(start)}`,
    `DTEND:${tsUTC(end)}`,
    "TRANSP:OPAQUE",
    `SEQUENCE:${sequence}`,
    `SUMMARY:${title.replace(/\r?\n/g, " ")}`,
    location ? `LOCATION:${location.replace(/\r?\n/g, " ")}` : "",
    `X-ALT-DESC;FMTTYPE=text/html:${escapeHtmlForXAltDesc(htmlDescription)}`,
    `DESCRIPTION:${textDescription}`,
    "CLASS:PUBLIC",
    "STATUS:CONFIRMED",
    "PRIORITY:5",
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Reminder",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ]) + "\r\n";
}

// ---- EDGE FUNCTION ----
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // Config minima
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
      // opzionale: url videocall da inserire nelle descrizioni
      meeting_url,
    } = body;

    // Obbligatori
    if (!isNonEmptyString(to_client_email) || !isNonEmptyString(ts_iso) || !isNonEmptyString(modalita)) {
      return new Response(JSON.stringify({
        error: "Parametri mancanti: to_client_email, ts_iso, modalita sono obbligatori."
      }), { status: 400, headers: { "Content-Type": "application/json", ...cors } });
    }

    // Normalizzazioni
    const TO = to_client_email.trim();
    const CC = isNonEmptyString(cc_advisor_email) ? cc_advisor_email.trim() : null;
    const CLIENTE = isNonEmptyString(cliente_nome) ? cliente_nome.trim() : "Cliente";
    const ADVISOR = isNonEmptyString(advisor_nome) ? advisor_nome.trim() : "Advisory+";
    const MODE = modalita.trim();
    const NOTE = String(note ?? "").trim();
    const LOC = String(location ?? "").trim();

    // Date
    const start = new Date(ts_iso);
    if (isNaN(start.getTime())) {
      return new Response(JSON.stringify({ error: "ts_iso non è una data valida (ISO 8601)." }), {
        status: 400, headers: { "Content-Type": "application/json", ...cors }
      });
    }
    const end = new Date(start.getTime() + Number(durata_minuti) * 60_000);

    // Testi
    const subject = isNonEmptyString(subjectIn) ? subjectIn : `Promemoria appuntamento – ${CLIENTE}`;
    const title = isNonEmptyString(titleIn) ? titleIn : `Appuntamento Advisory+ con ${CLIENTE}`;
    const dataStr = start.toLocaleDateString("it-IT");
    const oraStr = start.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

    const extraLine = meeting_url ? (MODE.toLowerCase().includes("remoto") || MODE.toLowerCase().includes("online") ? `\nLink: ${meeting_url}` : "") : "";

    const text =
`Gentile ${CLIENTE},
Le ricordiamo l’appuntamento fissato per il giorno ${dataStr} alle ore ${oraStr} in modalità ${MODE}.
Note: ${NOTE || "-"}${LOC ? `\nLuogo: ${LOC}` : ""}${extraLine}
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
      ${meeting_url ? `<p style="margin:0 0 12px 0;"><b>Link:</b> <a href="${meeting_url}">${meeting_url}</a></p>` : ""}
      <p style="margin:16px 0 0 0;">Cordiali saluti,<br/>${ADVISOR}<br/>Advisory+</p>
    </div>
  </body>
</html>`;

    // ICS in formato "Outlook Classic"
    const organizerNameGuess = RAW_SMTP_FROM.replace(/<.+>/, "").trim() || "Advisory+";
    const htmlDesc = html; // usiamo il corpo HTML come X-ALT-DESC
    const textDesc = text; // e il plain come DESCRIPTION
    const ics = buildICS({
      title,
      htmlDescription: htmlDesc,
      textDescription: textDesc,
      start,
      end,
      location: LOC,
      organizerEmail: SMTP_FROM,
      organizerName: organizerNameGuess,
      attendeeEmail: TO,
      attendeeName: CLIENTE,
      sequence: 0,
      lastModified: new Date(),
    });

    // --- INVIO (TLS implicito 465) ---
    const client = new SMTPClient({
      connection: {
        hostname: SMTP_HOST,
        port: SMTP_PORT,
        tls: true,
        auth: { username: SMTP_USER, password: SMTP_PASS },
      },
    });

    // multipart/alternative (text + html) + parte calendar INLINE (per bottoni Accetta/Rifiuta)
    const message: Record<string, unknown> = {
      from: SMTP_FROM,
      to: TO,
      ...(CC ? { cc: CC } : {}),
      subject,
      text,     // plain
      html,     // html
      headers: {
        "Content-Class": "urn:content-classes:calendarmessage",
      },
      attachments: [
        {
          // Parte inline: fa comparire il form meeting in Outlook Classic
          filename: "invite.ics",
          content: ics,
          contentType: "text/calendar; method=REQUEST; charset=utf-8; name=invite.ics",
          disposition: "inline",
        },
        {
          // Copia come allegato classico (utile per altri client)
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
