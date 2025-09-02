import React, { useEffect, useMemo, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ---- Supabase Client --------------------------------------------------------
// Falls du bereits einen Client in z.B. ./lib/supabaseClient exportierst,
// kannst du die beiden Zeilen unten auskommentieren und stattdessen importieren:
//   import { supabase } from "./lib/supabaseClient"
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

// ---- Typen ------------------------------------------------------------------
export type Project = {
  id: string;
  code: string;
  name: string;
  status: string | null; // frei, damit dein bestehendes Enum/Union weiterhin passt
  notes: string | null;
  created_at: string;

  // Neu: Kundendaten
  customer_address: string | null;
  customer_email: string | null;
  customer_phone: string | null;
};

type NewProject = {
  code: string;
  name: string;
  status: string | null;
  notes: string | null;
};

// ---- Hilfen -----------------------------------------------------------------
const formatDate = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString();
};

// Du kannst hier deine bevorzugten Stati pflegen – frei wählbar
const STATUS_OPTIONS = ["neu", "in_bearbeitung", "pausiert", "abgeschlossen"] as const;

// ---- Datenfunktionen --------------------------------------------------------
async function fetchProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select(
      `
      id, code, name, status, notes, created_at,
      customer_address, customer_email, customer_phone
    `
    )
    .order("created_at", { ascending: false });

  if (error) throw error;
  // safety: cast – Supabase liefert die Felder typisch passend
  return (data ?? []) as Project[];
}

async function insertProject(p: NewProject): Promise<Project> {
  const { data, error } = await supabase
    .from("projects")
    .insert({
      code: p.code,
      name: p.name,
      status: p.status,
      notes: p.notes,
    })
    .select(
      `
      id, code, name, status, notes, created_at,
      customer_address, customer_email, customer_phone
    `
    )
    .single();

  if (error) throw error;
  return data as Project;
}

async function updateProject(id: string, patch: Partial<Project>): Promise<Project> {
  const { data, error } = await supabase
    .from("projects")
    .update(patch)
    .eq("id", id)
    .select(
      `
      id, code, name, status, notes, created_at,
      customer_address, customer_email, customer_phone
    `
    )
    .single();

  if (error) throw error;
  return data as Project;
}

// ---- App-Komponente ---------------------------------------------------------
export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const data = await fetchProjects();
        if (mounted) setProjects(data);
      } catch (e: any) {
        console.error(e);
        setErrorMsg(e?.message ?? "Unbekannter Fehler beim Laden der Projekte.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  const handleCreated = (p: Project) => {
    setProjects((prev) => [p, ...prev]);
  };

  const handleUpdated = (p: Project) => {
    setProjects((prev) => prev.map((x) => (x.id === p.id ? p : x)));
  };

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 bg-white/75 backdrop-blur border-b border-slate-200">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <h1 className="text-lg md:text-xl font-medium">Stellwag PM</h1>
          <div className="text-sm text-slate-500">Projektmanagement</div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {errorMsg && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {errorMsg}
          </div>
        )}

        {selectedProject ? (
          <ProjectDetail
            key={selectedProject.id}
            project={selectedProject}
            onBack={() => setSelectedProjectId(null)}
            onProjectUpdated={handleUpdated}
          />
        ) : (
          <HomeDashboard
            projects={projects}
            loading={loading}
            onSelect={(id) => setSelectedProjectId(id)}
            onCreated={handleCreated}
          />
        )}
      </main>
    </div>
  );
}

// ---- Startseite: oben Projekte + „Neues Projekt“; unten Fälligkeiten + Kalender
function HomeDashboard(props: {
  projects: Project[];
  loading: boolean;
  onSelect: (id: string) => void;
  onCreated: (p: Project) => void;
}) {
  const { projects, loading, onSelect, onCreated } = props;

  return (
    <div className="space-y-8">
      {/* Aktuelle Projekte */}
      <section>
        <div className="mb-3 text-base text-slate-600">Aktuelle Projekte</div>
        <ProjectsTable projects={projects} loading={loading} onSelect={onSelect} />
      </section>

      {/* Neues Projekt anlegen */}
      <section>
        <div className="mb-3 text-base text-slate-600">Neues Projekt anlegen</div>
        <CreateProjectForm onCreated={onCreated} />
      </section>

      {/* Fälligkeiten + Kalender unten */}
      <section className="grid gap-6 md:grid-cols-2">
        <DueWidget projects={projects} />
        <CalendarWidget />
      </section>
    </div>
  );
}

// ---- Tabelle „Aktuelle Projekte“ -------------------------------------------
function ProjectsTable(props: {
  projects: Project[];
  loading: boolean;
  onSelect: (id: string) => void;
}) {
  const { projects, loading, onSelect } = props;

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        Lädt …
      </div>
    );
  }

  if (!projects.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        Noch keine Projekte angelegt.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-4 py-3 text-left">Code</th>
            <th className="px-4 py-3 text-left">Name</th>
            <th className="px-4 py-3 text-left">Status</th>
            <th className="px-4 py-3 text-left">Angelegt</th>
            <th className="px-4 py-3 text-left">Kunde (E-Mail / Telefon)</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr
              key={p.id}
              className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
              onClick={() => onSelect(p.id)}
              title="Details öffnen"
            >
              <td className="px-4 py-2">{p.code}</td>
              <td className="px-4 py-2">{p.name}</td>
              <td className="px-4 py-2">{p.status ?? ""}</td>
              <td className="px-4 py-2">{formatDate(p.created_at)}</td>
              <td className="px-4 py-2">
                <div className="flex flex-col">
                  <span className="truncate">{p.customer_email ?? "—"}</span>
                  <span className="text-slate-500">{p.customer_phone ?? ""}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Neues Projekt ----------------------------------------------------------
function CreateProjectForm(props: { onCreated: (p: Project) => void }) {
  const { onCreated } = props;
  const [form, setForm] = useState<NewProject>({
    code: "",
    name: "",
    status: STATUS_OPTIONS[0],
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canSubmit = form.code.trim() && form.name.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;

    try {
      setErrorMsg(null);
      setSubmitting(true);
      const created = await insertProject(form);
      onCreated(created);

      // Formular zurücksetzen
      setForm({
        code: "",
        name: "",
        status: STATUS_OPTIONS[0],
        notes: "",
      });
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message ?? "Konnte Projekt nicht anlegen.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-slate-200 bg-white p-4 md:p-6 space-y-4"
    >
      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {errorMsg}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-sm text-slate-600">Code</label>
          <input
            className="rounded-xl border border-slate-300 px-3 py-2"
            value={form.code}
            onChange={(e) => setForm((s) => ({ ...s, code: e.target.value }))}
            placeholder="z. B. PRJ‑2025‑001"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm text-slate-600">Name</label>
          <input
            className="rounded-xl border border-slate-300 px-3 py-2"
            value={form.name}
            onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
            placeholder="Projektname"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm text-slate-600">Status</label>
          <select
            className="rounded-xl border border-slate-300 px-3 py-2"
            value={form.status ?? ""}
            onChange={(e) => setForm((s) => ({ ...s, status: e.target.value }))}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 md:col-span-2">
          <label className="text-sm text-slate-600">Notizen</label>
          <textarea
            className="rounded-xl border border-slate-300 px-3 py-2"
            rows={3}
            value={form.notes ?? ""}
            onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
            placeholder="Kurzbeschreibung, Ziele, Besonderheiten …"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="rounded-xl bg-blue-600 px-3 py-2 text-white disabled:opacity-50"
        >
          {submitting ? "Wird angelegt …" : "Projekt anlegen"}
        </button>
      </div>
    </form>
  );
}

// ---- Projekt-Details inkl. Kundendaten -------------------------------------
function ProjectDetail(props: {
  project: Project;
  onBack: () => void;
  onProjectUpdated: (p: Project) => void;
}) {
  const { project, onBack, onProjectUpdated } = props;
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [base, setBase] = useState({
    name: project.name,
    code: project.code,
    status: project.status ?? "",
    notes: project.notes ?? "",
  });

  const [cust, setCust] = useState({
    customer_address: project.customer_address ?? "",
    customer_email: project.customer_email ?? "",
    customer_phone: project.customer_phone ?? "",
  });

  const hasChanges =
    base.name !== project.name ||
    base.code !== project.code ||
    (base.status ?? "") !== (project.status ?? "") ||
    (base.notes ?? "") !== (project.notes ?? "") ||
    (cust.customer_address ?? "") !== (project.customer_address ?? "") ||
    (cust.customer_email ?? "") !== (project.customer_email ?? "") ||
    (cust.customer_phone ?? "") !== (project.customer_phone ?? "");

  const handleSave = async () => {
    try {
      setErrorMsg(null);
      setSaving(true);
      const patch: Partial<Project> = {
        name: base.name,
        code: base.code,
        status: base.status,
        notes: base.notes,
        customer_address: cust.customer_address || null,
        customer_email: cust.customer_email || null,
        customer_phone: cust.customer_phone || null,
      };
      const updated = await updateProject(project.id, patch);
      onProjectUpdated(updated);
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message ?? "Konnte Änderungen nicht speichern.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          ← Zur Übersicht
        </button>
        <h2 className="text-base text-slate-600">Projektdetails</h2>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {errorMsg}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Linke Spalte: Basisdaten */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 md:p-6 space-y-4">
          <div className="text-sm text-slate-600">Basisdaten</div>
          <div className="grid gap-3">
            <Field label="Name">
              <input
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
                value={base.name}
                onChange={(e) => setBase((s) => ({ ...s, name: e.target.value }))}
              />
            </Field>
            <Field label="Code">
              <input
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
                value={base.code}
                onChange={(e) => setBase((s) => ({ ...s, code: e.target.value }))}
              />
            </Field>
            <Field label="Status">
              <select
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
                value={base.status}
                onChange={(e) => setBase((s) => ({ ...s, status: e.target.value }))}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Notizen">
              <textarea
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
                rows={4}
                value={base.notes}
                onChange={(e) => setBase((s) => ({ ...s, notes: e.target.value }))}
              />
            </Field>
            <div className="text-xs text-slate-500">
              Angelegt am {formatDate(project.created_at)}
            </div>
          </div>
        </div>

        {/* Rechte Spalte: Kundendaten */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 md:p-6 space-y-4">
          <div className="text-sm text-slate-600">Kundendaten</div>
          <div className="grid gap-3">
            <Field label="Adresse">
              <input
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
                placeholder="Straße Hausnr., PLZ Ort"
                value={cust.customer_address}
                onChange={(e) =>
                  setCust((s) => ({ ...s, customer_address: e.target.value }))
                }
              />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="E‑Mail">
                <input
                  type="email"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  placeholder="kunde@example.com"
                  value={cust.customer_email}
                  onChange={(e) =>
                    setCust((s) => ({ ...s, customer_email: e.target.value }))
                  }
                />
              </Field>
              <Field label="Telefon">
                <input
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  placeholder="+49 …"
                  value={cust.customer_phone}
                  onChange={(e) =>
                    setCust((s) => ({ ...s, customer_phone: e.target.value }))
                  }
                />
              </Field>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          className="rounded-xl bg-blue-600 px-3 py-2 text-white disabled:opacity-50"
          onClick={handleSave}
          disabled={!hasChanges || saving}
        >
          {saving ? "Speichern …" : "Änderungen speichern"}
        </button>
        {!hasChanges && (
          <span className="text-sm text-slate-500">Keine ungespeicherten Änderungen</span>
        )}
      </div>
    </div>
  );
}

// ---- Kleine Helfer-Komponente für Felder -----------------------------------
function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-slate-600">{props.label}</span>
      {props.children}
    </label>
  );
}

// ---- „Fälligkeiten“ (einfacher Platzhalter; du kannst hier deine Logik ergänzen)
function DueWidget(props: { projects: Project[] }) {
  const { projects } = props;

  // Wenn du Deadlines/Fälligkeiten in einer anderen Tabelle pflegst,
  // kannst du hier eine eigene Abfrage ergänzen. Aktuell zeigen wir nur
  // eine einfache Info an.
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 md:p-6">
      <div className="mb-2 text-sm text-slate-600">Fälligkeiten</div>
      <div className="text-sm text-slate-500">
        Keine individuellen Fälligkeiten konfiguriert. Ergänze hier deine Logik (Tasks,
        Deadlines etc.), falls vorhanden.
      </div>
      {!!projects.length && (
        <ul className="mt-3 space-y-1 text-sm text-slate-700">
          {projects.slice(0, 3).map((p) => (
            <li key={p.id} className="truncate">
              • {p.name} – Status: {p.status ?? "—"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- „Kalender“ (Platzhalter – optional später durch echtes Widget ersetzen)
function CalendarWidget() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 md:p-6">
      <div className="mb-2 text-sm text-slate-600">Kalender</div>
      <div className="text-sm text-slate-500">
        Hier kann ein Kalender oder eine Timeline eingebunden werden (z. B. externe
        Komponente oder iCal).
      </div>
    </div>
  );
}
