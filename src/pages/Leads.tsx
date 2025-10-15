import React, { useMemo, useState } from "react";

// ===== Types =====
export type Role = "Admin" | "Team Lead" | "Advisor" | string;

export interface Advisor {
  user_id?: string;
  full_name?: string;
  email?: string;
  role?: Role;
}

export interface LeadStageFlags {
  working?: boolean; // In lavorazione
  contacted?: boolean; // Contattato
  appointment?: boolean; // Fissato/Fatto Appuntamento
  proposal?: boolean; // Presentata Proposta
  contract?: boolean; // Firmato Contratto
}

export interface Lead {
  id: string;
  name: string;
  company?: string;
  assignee_user_id?: string;
  stages?: LeadStageFlags;
  // Fallback fields (in caso il tuo schema sia diverso)
  status?: string; // e.g. "working", "contacted"...
  contactedAt?: string | null;
  appointmentAt?: string | null;
  proposalAt?: string | null;
  contractAt?: string | null;
}

// ===== Props =====
export interface LeadsProps {
  meRole: Role;
  advisors: Advisor[];
  leads: Lead[];
}

// ===== Utility CSS-in-JS (coerente con il blocco che hai condiviso) =====
const label: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#333",
  marginBottom: 4,
};

const ipt: React.CSSProperties = {
  height: 34,
  border: "1px solid #d0d7de",
  borderRadius: 8,
  padding: "0 10px",
  background: "#fff",
};

const BTN_BASE: React.CSSProperties = {
  height: 34,
  border: "1px solid #d0d7de",
  borderRadius: 8,
  padding: "0 10px",
  background: "#f7f8fa",
  cursor: "pointer",
  fontWeight: 600,
};

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        padding: "2px 8px",
        borderRadius: 999,
        border: "1px solid #e2e8f0",
        fontSize: 12,
        background: "#fafafa",
      }}
    >
      {children}
    </span>
  );
}

function getAssigneeName(advisors: Advisor[], user_id?: string) {
  if (!user_id) return "—";
  const a = advisors.find((x) => x.user_id === user_id);
  return a?.full_name || a?.email || "—";
}

// ===== Filtri helpers =====
function passWorking(l: Lead): boolean {
  const flag = l.stages?.working ?? (l.status === "working");
  return !!flag;
}

function passContacted(l: Lead): boolean {
  const flag = l.stages?.contacted ?? (l.status === "contacted") ?? !!l.contactedAt;
  return !!flag;
}

function passAppointment(l: Lead): boolean {
  const flag = l.stages?.appointment ?? (l.status === "appointment") ?? !!l.appointmentAt;
  return !!flag;
}

function passProposal(l: Lead): boolean {
  const flag = l.stages?.proposal ?? (l.status === "proposal") ?? !!l.proposalAt;
  return !!flag;
}

function passContract(l: Lead): boolean {
  const flag = l.stages?.contract ?? (l.status === "contract") ?? !!l.contractAt;
  return !!flag;
}

export default function Leads(p: Partial<LeadsProps> = {}) {
  // fallback sicuri se il canvas/preview non passa props
  const { meRole = "Advisor", advisors = [], leads = [] } = p;
  // ===== Stato filtri =====
  const [assigneeFilter, setAssigneeFilter] = useState<string>("");
  const [onlyWorking, setOnlyWorking] = useState<boolean>(false);
  const [onlyContacted, setOnlyContacted] = useState<boolean>(false);
  const [onlyAppointment, setOnlyAppointment] = useState<boolean>(false);
  const [onlyProposal, setOnlyProposal] = useState<boolean>(false);
  const [onlyContract, setOnlyContract] = useState<boolean>(false);

  // ===== Applica filtri =====
  const filteredLeads = useMemo(() => {
    return leads.filter((l) => {
      if (assigneeFilter && l.assignee_user_id !== assigneeFilter) return false;
      if (onlyWorking && !passWorking(l)) return false;
      if (onlyContacted && !passContacted(l)) return false;
      if (onlyAppointment && !passAppointment(l)) return false;
      if (onlyProposal && !passProposal(l)) return false;
      if (onlyContract && !passContract(l)) return false;
      return true;
    });
  }, [leads, assigneeFilter, onlyWorking, onlyContacted, onlyAppointment, onlyProposal, onlyContract]);

  return (
    <div style={{ padding: 16 }}>
      {/* === FILTRI (3 righe) === */}
      <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
        {/* Riga 1: Assegnatario + In Lavorazione */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              meRole === "Admin" || meRole === "Team Lead"
                ? "minmax(180px,1fr) 170px" // select più corto, bottone a destra
                : "1fr 170px",
            alignItems: "end",
            gap: 8,
          }}
        >
          {meRole === "Admin" || meRole === "Team Lead" ? (
            <div>
              <div style={label}>Assegnatario</div>
              <select
                style={{ ...ipt, width: "100%" }}
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value)}
              >
                <option value="">Tutti</option>
                {advisors
                  .filter((a) => a.role === "Junior" && a.user_id)
                  .map((a) => (
                    <option key={a.user_id!} value={a.user_id!}>
                      {a.full_name || a.email}
                    </option>
                  ))}
              </select>
            </div>
          ) : (
            <div /> /* se non Admin/TL, lasciamo spazio vuoto per mantenere l'allineamento */
          )}

          <div>
            <div style={{ visibility: "hidden", height: 14 }}>.</div>
            <button
              className="brand-btn"
              onClick={() => setOnlyWorking((v) => !v)}
              style={
                onlyWorking
                  ? { ...BTN_BASE, background: "var(--brand-primary-600, #0029ae)", color: "#fff" }
                  : BTN_BASE
              }
            >
              In Lavorazione
            </button>
          </div>
        </div>

        {/* Riga 2: Contattato + Fissato/Fatto Appuntamento */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button
            className="brand-btn"
            onClick={() => setOnlyContacted((v) => !v)}
            style={
              onlyContacted
                ? { ...BTN_BASE, background: "var(--brand-primary-600, #0029ae)", color: "#fff" }
                : BTN_BASE
            }
          >
            Contattato
          </button>
          <button
            className="brand-btn"
            onClick={() => setOnlyAppointment((v) => !v)}
            style={
              onlyAppointment
                ? { ...BTN_BASE, background: "var(--brand-primary-600, #0029ae)", color: "#fff" }
                : BTN_BASE
            }
          >
            Fissato/Fatto Appuntamento
          </button>
        </div>

        {/* Riga 3: Presentata Proposta + Firmato Contratto */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button
            className="brand-btn"
            onClick={() => setOnlyProposal((v) => !v)}
            style={
              onlyProposal
                ? { ...BTN_BASE, background: "var(--brand-primary-600, #0029ae)", color: "#fff" }
                : BTN_BASE
            }
          >
            Presentata Proposta
          </button>
          <button
            className="brand-btn"
            onClick={() => setOnlyContract((v) => !v)}
            style={
              onlyContract
                ? { ...BTN_BASE, background: "var(--brand-primary-600, #0029ae)", color: "#fff" }
                : BTN_BASE
            }
          >
            Firmato Contratto
          </button>
        </div>
      </div>

      {/* ===== Lista lead filtrati ===== */}
      <div style={{
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        overflow: "hidden",
      }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr style={{ background: "#f8fafc", textAlign: "left" }}>
              <th style={{ padding: 12, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>Lead</th>
              <th style={{ padding: 12, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>Azienda</th>
              <th style={{ padding: 12, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>Assegnatario</th>
              <th style={{ padding: 12, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>Stato</th>
            </tr>
          </thead>
          <tbody>
            {filteredLeads.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: 16, textAlign: "center", color: "#64748b" }}>
                  Nessun lead corrisponde ai filtri.
                </td>
              </tr>
            )}
            {filteredLeads.map((l, idx) => (
              <tr key={l.id} style={{ background: idx % 2 ? "#fff" : "#fcfcfd" }}>
                <td style={{ padding: 12, fontWeight: 600 }}>{l.name}</td>
                <td style={{ padding: 12 }}>{l.company || "—"}</td>
                <td style={{ padding: 12 }}>{getAssigneeName(advisors, l.assignee_user_id)}</td>
                <td style={{ padding: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {passWorking(l) && <Badge>In lavorazione</Badge>}
                  {passContacted(l) && <Badge>Contattato</Badge>}
                  {passAppointment(l) && <Badge>Appuntamento</Badge>}
                  {passProposal(l) && <Badge>Proposta</Badge>}
                  {passContract(l) && <Badge>Contratto</Badge>}
                  {!passWorking(l) && !passContacted(l) && !passAppointment(l) && !passProposal(l) && !passContract(l) && (
                    <span style={{ color: "#64748b" }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
