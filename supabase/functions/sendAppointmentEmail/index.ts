// /supabase/functions/sendAppointmentEmail/index.ts
// Invio email appuntamento con anteprima meeting in Outlook Classic (inline) + allegato ICS
// Fix: elimina artefatti '=20' (forza 7bit via MIME raw), orari corretti (Europe/Rome + VTIMEZONE)
// Deno v2 – denomailer

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SMTP_HOST = Deno.env.get("SMTP_HOST") || "";
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") || "465");
const SMTP_USER = Deno.env.get("SMTP_USER") || "";
const SMTP_PASS = Deno.env.get("SMTP_PASS") || "";

const RAW_SMTP_FROM = Deno.env.get("SMTP_FROM") || SMTP_USER || "";
const SMTP_FROM = RAW_SMTP_FROM.match(/<([^>]+)>/)?.[1]?.trim() ?? RAW_SMTP_FROM.trim();

const TZID = "Europe/Rome";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function formatDateRome(d: Date) {
  const date = new Intl.DateTimeFormat("it-IT", { timeZone: TZID, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const time = new Intl.DateTimeFormat("it-IT", { timeZone: TZID, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return { date, time };
}

function tsLocalICS(d: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZID, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).formatToParts(d).reduce((acc, p) => (acc[p.type] = p.value, acc), {} as Record<string, string>);
  return `${parts["year"]}${parts["month"]}${parts["day"]}T${parts["hour"]}${parts["minute"]}${parts["second"]}`;
}

// VTIMEZONE Europe/Rome
const VTIMEZONE_EUROPE_ROME = [
  "BEGIN:VTIMEZONE",
  `TZID:${TZID}`,
  "X-LIC-LOCATION:Europe/Rome",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
].join("\r\n");

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
    VTIMEZONE_EUROPE_ROME,
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `SEQUENCE:${sequence}`,
    `DTSTAMP:${tsLocalICS(new Date())}`,
    `DTSTART;TZID=${TZID}:${tsLocalICS(start)}`,
    `DTEND;TZID=${TZID}:${tsLocalICS(end)}`,
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
    "X-MICROSOFT-CDO-ALARMON:TRUE",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}

function buildRawMIME(opts: {
  from: string;
  to: string;
  cc?: string | null;
  subject: string;
  text: string;
  html: string;
  icsContent: string;
}) {
  const boundaryMixed = "mixed_" + crypto.randomUUID();
  const boundaryAlt = "alt_" + crypto.randomUUID();

  const headersTop = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    opts.cc ? `Cc: ${opts.cc}` : null,
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    "Content-Class: urn:content-classes:calendarmessage",
    `Content-Type: multipart/mixed; boundary="${boundaryMixed}"`,
  ].filter(Boolean).join("\r\n");

  const altParts = [
    `--${boundaryAlt}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    opts.text,
    `--${boundaryAlt}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    opts.html,
    `--${boundaryAlt}`,
    'Content-Type: text/calendar; method=REQUEST; charset="utf-8"; name="invite.ics"',
    'Content-Disposition: inline; filename="invite.ics"',
    "Content-Transfer-Encoding: 7bit",
    "",
    opts.icsContent,
    `--${boundaryAlt}--`,
  ].join("\r\n");

  const mixed = [
    `--${boundaryMixed}`,
    `Content-Type: multipart/alternative; boundary="${boundaryAlt}"`,
    "",
    altParts,
    `--${boundaryMixed}`,
    'Content-Type: application/ics; name="appuntamento.ics"',
    'Content-Disposition: attachment; filename="appuntamento.ics"',
    "Content-Transfer-Encoding: 7bit",
    "",
    opts.icsContent,
    `--${boundaryMixed}--`,
    ""
  ].join("\r\n");

  return headersTop + "\r\n\r\n" + mixed;
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
      return new Response(JSON.stringify({ error: "Parametri mancanti: to_client_email, ts_iso, modalita sono obbligatori." }), {
        status: 400, headers: { "Content-Type": "application/json", ...cors } });
    }

    const TO = to_client_email.trim();
    const CC = isNonEmptyString(cc_advisor_email) ? cc_advisor_email.trim() : null;
    const CLIENTE = isNonEmptyString(cliente_nome) ? cliente_nome.trim() : "Cliente";
    const ADVISOR = isNonEmptyString(advisor_nome) ? advisor_nome.trim() : "Advisory+";
    const MODE = modalita.trim();
    const NOTE = String(note ?? "").trim();
    const LOC = String(location ?? "").trim();

    // Parsing robusto: se manca il timezone nell'input, assume Europe/Rome
    let start = new Date(ts_iso);
    if (isNaN(start.getTime())) {
      return new Response(JSON.stringify({ error: "ts_iso non è una data valida (ISO 8601)." }), { status: 400, headers: { "Content-Type": "application/json", ...cors } });
    }
    const tzMissing = !/[zZ]|[+-]\d{2}:?\d{2}$/.test(ts_iso);
    if (tzMissing) {
      const m = ts_iso.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
      if (m) {
        const [, y, mo, da, h, mi, s] = m;
        const asUTC = new Date(Date.UTC(Number(y), Number(mo)-1, Number(da), Number(h), Number(mi), Number(s||"00")));
        const romeHour = new Intl.DateTimeFormat("en-GB", { timeZone: TZID, hour: "2-digit", minute: "2-digit", hour12: false }).format(asUTC);
        const utcHour = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false }).format(asUTC);
        const [rh, rm] = romeHour.split(":").map(Number);
        const [uh, um] = utcHour.split(":").map(Number);
        const offsetMin = (rh*60+rm) - (uh*60+um);
        start = new Date(asUTC.getTime() - offsetMin*60_000);
      }
    }

    const end = new Date(start.getTime() + Number(durata_minuti) * 60_000);

    const subject = isNonEmptyString(subjectIn) ? subjectIn : `Promemoria appuntamento – ${CLIENTE}`;
    const title = isNonEmptyString(titleIn) ? titleIn : `Appuntamento Advisory+ con ${CLIENTE}`;
    const { date: dataStr, time: oraStr } = formatDateRome(start);

    const text = [
      `Gentile ${CLIENTE},`,
      `Le ricordiamo l’appuntamento fissato per il giorno ${dataStr} alle ore ${oraStr} in modalità ${MODE}.`,
      `Note: ${NOTE || "-"}`,
      LOC ? `Luogo: ${LOC}` : "",
      "",
      "Cordiali saluti,",
      `${ADVISOR}`,
      "Advisory+"
    ].filter(Boolean).map(s => s.replace(/[ \t]+$/g, "")).join("\r\n");

    const html = (
      `<!doctype html><html><body style="margin:0;padding:0;">` +
      `<div style="font-family:'Century Gothic',CenturyGothic,AppleGothic,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.45;color:#0f172a;">` +
      `<p style="margin:0 0 12px 0;">Gentile ${CLIENTE},</p>` +
      `<p style="margin:0 0 12px 0;">Le ricordiamo l’appuntamento fissato per il giorno <b>${dataStr}</b> alle ore <b>${oraStr}</b> in modalità <b>${MODE}</b>.</p>` +
      `<p style="margin:0 0 12px 0;"><b>Note:</b> ${NOTE || "-"}</p>` +
      (LOC ? `<p style="margin:0 0 12px 0;"><b>Luogo:</b> ${LOC}</p>` : ``) +
      `<p style="margin:16px 0 0 0;">Cordiali saluti,<br/>${ADVISOR}<br/>Advisory+</p>` +
      `</div></body></html>`
    ).replace(/[ \t]+$/g, "");

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

    const raw = buildRawMIME({
      from: SMTP_FROM, to: TO, cc: CC, subject, text, html, icsContent: ics,
    });

    const client = new SMTPClient({
      connection: {
        hostname: SMTP_HOST,
        port: SMTP_PORT,
        tls: true,
        auth: { username: SMTP_USER, password: SMTP_PASS },
      },
    });

    await client.send({ raw });
    await client.close();

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json", ...cors } });
  } catch (e) {
    console.error("sendAppointmentEmail error:", e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { "Content-Type": "application/json", ...cors } });
  }
});
