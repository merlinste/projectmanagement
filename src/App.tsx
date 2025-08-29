import React, { useEffect, useMemo, useState } from "react";
import { createClient, SupabaseClient, Session } from "@supabase/supabase-js";

// ====== ENV / SUPABASE CLIENT ======
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON);

// ====== TYPES ======
export type Project = {
  id: string;
  code: string; // z. B. 2025-0007
  name: string; // Kunden-/Projektname
  status:
    | "planung"
    | "angebot"
    | "bestellt"
    | "montage"
    | "inbetriebnahme"
    | "abgeschlossen";
  notes: string | null;
  created_at: string;
  // NEW: Kundendaten & Planung
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  customer_address?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  planned_hours?: number | null;
};

export type DocumentCategory =
  | "angebot"
  | "einkauf"
  | "stundenzettel"
  | "inbetriebnahme"
  | "rechnung"
  | "fotos"
  | "sonstiges";

export type DocumentRow = {
  id: string;
  project_id: string;
  category: DocumentCategory;
  filename: string;
  storage_path: string; // <project_id>/<category>/<unique>-<name>
  file_url: string | null; // signed URL
  uploaded_at: string;
};

export type TimeEntry = {
  id: string;
  project_id: string;
  work_date: string; // ISO date
  hours: number;
  description: string | null;
  created_at: string;
};

export type Part = {
  id: string;
  project_id: string;
  name: string;
  qty: number;
  supplier: string | null;
  purchase_price: number | null;
  sale_price: number | null;
  ordered: boolean;
  delivered: boolean;
  installed: boolean;
  notes: string | null;
  created_at: string;
};

const DOC_CATEGORIES: { key: DocumentCategory; label: string }[] = [
  { key: "angebot", label: "Angebot" },
  { key: "einkauf", label: "Einkauf (Material/Ware)" },
  { key: "stundenzettel", label: "Stunden-Nachweis (CSV/PDF)" },
  { key: "inbetriebnahme", label: "Inbetriebnahme-Protokoll" },
  { key: "rechnung", label: "Rechnung" },
  { key: "fotos", label: "Fotos" },
  { key: "sonstiges", label: "Sonstiges" }
];

const STATUS_LABEL: Record<Project["status"], string> = {
  planung: "Planung",
  angebot: "Angebot",
  bestellt: "Bestellt",
  montage: "Montage",
  inbetriebnahme: "Inbetriebnahme",
  abgeschlossen: "Abgeschlossen"
};

// ====== UTIL ======
function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}
function formatDate(d?: string) {
  if (!d) return "–";
  const dt = new Date(d);
  return dt.toLocaleDateString("de-DE");
}
function sanitizeFileName(name: string) {
  const noMarks = name.normalize("NFKD").replace(/\p{M}+/gu, "");
  return noMarks
    .replace(/[^a-zA-Z0-9._ -]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[-–—]+/g, "-")
    .toLowerCase();
}
async function signedUrl(path: string) {
  const { data } = await supabase.storage.from("project-files").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

// ====== AUTH GATE ======
function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) return <div className="p-6">Lade…</div>;
  if (!session) return <Login />;
  return <>{children}</>;
}

function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin }
    });
    if (error) alert(error.message);
    else setSent(true);
  };
  return (
    <div className="min-h-screen grid place-items-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-blue-100 grid place-items-center">❄️</div>
          <h1 className="text-xl">Stellwag Klimatechnik – Login</h1>
        </div>
        {sent ? (
          <p>Magic-Link versendet. Bitte Posteingang prüfen.</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="E-Mail-Adresse"
              className="w-full border rounded-xl px-3 py-2"
              required
            />
            <button className="w-full rounded-xl px-3 py-2 bg-blue-600 text-white">Link zusenden</button>
          </form>
        )}
      </div>
    </div>
  );
}

// ====== DATA HELPERS ======
async function fetchProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select(
      "id, code, name, status, notes, created_at, customer_name, customer_phone, customer_email, customer_address, start_date, end_date, planned_hours"
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as Project[];
}
async function createProject(payload: { name: string; notes?: string }) {
  const { data, error } = await supabase
    .from("projects")
    .insert({ name: payload.name, notes: payload.notes ?? null })
    .select()
    .single();
  if (error) throw error;
  return data as Project;
}
async function updateProjectStatus(id: string, status: Project["status"]) {
  const { error } = await supabase.from("projects").update({ status }).eq("id", id);
  if (error) throw error;
}
async function updateProjectMeta(id: string, patch: Partial<Project>) {
  const allowed = (({
    customer_name,
    customer_phone,
    customer_email,
    customer_address,
    start_date,
    end_date,
    planned_hours
  }) => ({
    customer_name,
    customer_phone,
    customer_email,
    customer_address,
    start_date,
    end_date,
    planned_hours
  }))(patch as any);
  const { data, error } = await supabase.from("projects").update(allowed).eq("id", id).select().single();
  if (error) throw error;
  return data as Project;
}

async function fetchDocuments(projectId: string): Promise<DocumentRow[]> {
  const { data, error } = await supabase
    .from("documents")
    .select("id, project_id, category, filename, storage_path, uploaded_at")
    .eq("project_id", projectId)
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  const rows = (data as DocumentRow[]) || [];
  return Promise.all(rows.map(async (d) => ({ ...d, file_url: await signedUrl(d.storage_path) })));
}
async function uploadDocument(projectId: string, category: DocumentCategory, file: File) {
  const safe = sanitizeFileName(file.name);
  const unique = `${Date.now()}-${crypto.randomUUID()}`;
  const path = `${projectId}/${category}/${unique}-${safe}`;
  const { error: upErr } = await supabase.storage
    .from("project-files")
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
  if (upErr) throw upErr;
  const { data, error } = await supabase
    .from("documents")
    .insert({ project_id: projectId, category, filename: file.name, storage_path: path })
    .select()
    .single();
  if (error) throw error;
  return data as DocumentRow;
}
async function deleteDocumentRow(doc: DocumentRow) {
  await supabase.storage.from("project-files").remove([doc.storage_path]);
  await supabase.from("documents").delete().eq("id", doc.id);
}

async function fetchTime(projectId: string): Promise<TimeEntry[]> {
  const { data, error } = await supabase
    .from("time_entries")
    .select("id, project_id, work_date, hours, description, created_at")
    .eq("project_id", projectId)
    .order("work_date", { ascending: false });
  if (error) throw error;
  return data as TimeEntry[];
}
async function addTime(projectId: string, entry: { work_date: string; hours: number; description?: string }) {
  const { error } = await supabase
    .from("time_entries")
    .insert({ project_id: projectId, work_date: entry.work_date, hours: entry.hours, description: entry.description ?? null });
  if (error) throw error;
}
async function deleteTimeEntry(id: string) {
  const { error } = await supabase.from("time_entries").delete().eq("id", id);
  if (error) throw error;
}

async function fetchParts(projectId: string): Promise<Part[]> {
  const { data, error } = await supabase
    .from("project_parts")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as Part[];
}
async function addPart(projectId: string, p: Partial<Part>) {
  const { data, error } = await supabase
    .from("project_parts")
    .insert({ project_id: projectId, ...p, qty: p.qty ?? 1 })
    .select()
    .single();
  if (error) throw error;
  return data as Part;
}
async function updatePart(id: string, patch: Partial<Part>) {
  const { error } = await supabase.from("project_parts").update(patch).eq("id", id);
  if (error) throw error;
}
async function deletePart(id: string) {
  const { error } = await supabase.from("project_parts").delete().eq("id", id);
  if (error) throw error;
}

async function deleteProjectFull(project: Project) {
  // Storage: alle Kategorien durchgehen und Dateien entfernen
  const cats: DocumentCategory[] = [
    "angebot",
    "einkauf",
    "stundenzettel",
    "inbetriebnahme",
    "rechnung",
    "fotos",
    "sonstiges"
  ];
  for (const c of cats) {
    let offset = 0;
    while (true) {
      const { data, error } = await supabase.storage
        .from("project-files")
        .list(`${project.id}/${c}`, { limit: 100, offset });
      if (error || !data || data.length === 0) break;
      const keys = data.map((o) => `${project.id}/${c}/${o.name}`);
      await supabase.storage.from("project-files").remove(keys);
      if (data.length < 100) break;
      offset += 100;
    }
  }
  // DB: dank ON DELETE CASCADE werden Kinder (documents/time_entries/parts) mitgelöscht
  const { error } = await supabase.from("projects").delete().eq("id", project.id);
  if (error) throw error;
}

// ====== UI ======
export default function App() {
  return (
    <AuthGate>
      <Shell />
    </AuthGate>
  );
}

function Shell() {
  const [view, setView] = useState<"list" | "detail">("list");
  const [selected, setSelected] = useState<Project | null>(null);
  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <main className="max-w-6xl mx-auto p-4 md:p-6">
        {view === "list" && (
          <ProjectList
            onOpen={(p) => {
              setSelected(p);
              setView("detail");
            }}
          />
        )}
        {view === "detail" && selected && (
          <ProjectDetail
            project={selected}
            onBack={() => setView("list")}
            onProjectUpdated={(p) => setSelected(p)}
          />
        )}
      </main>
    </div>
  );
}

function Header() {
  const brand = import.meta.env.VITE_BRAND_NAME || "Stellwag Klimatechnik";
  const logoUrl = (import.meta.env.VITE_LOGO_URL as string | undefined) || undefined;
  return (
    <header className="bg-white border-b">
      <div className="max-w-6xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" className="h-8" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-blue-100 grid place-items-center">❄️</div>
          )}
          <div className="text-lg">{brand} – Projekte</div>
        </div>
        <button
          className="text-sm text-slate-600 hover:text-slate-900"
          onClick={async () => {
            await supabase.auth.signOut();
          }}
        >
          Abmelden
        </button>
      </div>
    </header>
  );
}

function ProjectList({ onOpen }: { onOpen: (p: Project) => void }) {
  const [items, setItems] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [tab, setTab] = useState<"laufend" | "abgeschlossen">(
    (localStorage.getItem("spm_list_tab") as "laufend" | "abgeschlossen") || "laufend"
  );

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchProjects();
      setItems(data);
    } catch (e: any) {
      alert(e.message || "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const p = await createProject({ name, notes });
      setName("");
      setNotes("");
      setItems((xs) => [p as Project, ...xs]);
    } catch (e: any) {
      alert(e.message || "Fehler beim Anlegen");
    } finally {
      setCreating(false);
    }
  };

  const filtered = items.filter((p) =>
    tab === "abgeschlossen" ? p.status === "abgeschlossen" : p.status !== "abgeschlossen"
  );

  return (
    <div className="space-y-6">
      {/* CREATE */}
      <div className="bg-white rounded-2xl shadow p-4">
        <h2 className="text-lg mb-3">Neues Projekt anlegen</h2>
        <form onSubmit={onCreate} className="grid md:grid-cols-3 gap-3">
          <input
            className="border rounded-xl px-3 py-2"
            placeholder="Projekt-/Kundenname"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="border rounded-xl px-3 py-2 md:col-span-2"
            placeholder="Notizen (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="md:col-span-3">
            <button className="rounded-xl px-4 py-2 bg-blue-600 text-white" disabled={creating}>
              {creating ? "Speichere…" : "Projekt anlegen"}
            </button>
          </div>
        </form>
      </div>

      {/* LIST */}
      <div className="bg-white rounded-2xl shadow">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-lg">Projekte</h2>
          <button className="text-sm underline" onClick={load}>
            Aktualisieren
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 p-2 border-b">
          <button
            className={clsx(
              "px-3 py-2 rounded-xl",
              tab === "laufend" ? "bg-slate-900 text-white" : "hover:bg-slate-100"
            )}
            onClick={() => {
              setTab("laufend");
              localStorage.setItem("spm_list_tab", "laufend");
            }}
          >
            Laufende Projekte
          </button>
          <button
            className={clsx(
              "px-3 py-2 rounded-xl",
              tab === "abgeschlossen" ? "bg-slate-900 text-white" : "hover:bg-slate-100"
            )}
            onClick={() => {
              setTab("abgeschlossen");
              localStorage.setItem("spm_list_tab", "abgeschlossen");
            }}
          >
            Abgeschlossene Projekte
          </button>
        </div>

        <div className="p-0 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left p-3">Nr.</th>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Angelegt</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="p-4" colSpan={5}>
                    Lädt…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td className="p-4" colSpan={5}>
                    Keine Projekte im Tab „{tab}“.
                  </td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="p-3 whitespace-nowrap font-medium">{p.code}</td>
                    <td className="p-3">{p.name}</td>
                    <td className="p-3">
                      <StatusBadge value={p.status} />
                    </td>
                    <td className="p-3 whitespace-nowrap">{formatDate(p.created_at)}</td>
                    <td className="p-3 text-right">
                      <button className="text-blue-600 underline" onClick={() => onOpen(p)}>
                        Öffnen
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ value }: { value: Project["status"] }) {
  const map: Record<Project["status"], string> = {
    planung: "bg-slate-100 text-slate-700",
    angebot: "bg-amber-100 text-amber-800",
    bestellt: "bg-sky-100 text-sky-800",
    montage: "bg-indigo-100 text-indigo-800",
    inbetriebnahme: "bg-emerald-100 text-emerald-800",
    abgeschlossen: "bg-green-100 text-green-800"
  };
  return <span className={clsx("px-2 py-1 rounded-full text-xs", map[value])}>{STATUS_LABEL[value]}</span>;
}

function ProjectDetail({
  project,
  onBack,
  onProjectUpdated
}: {
  project: Project;
  onBack: () => void;
  onProjectUpdated: (p: Project) => void;
}) {
  const [active, setActive] = useState<"overview" | "details" | "docs" | "parts" | "time">("overview");
  const [status, setStatus] = useState<Project["status"]>(project.status);
  useEffect(() => setStatus(project.status), [project.id]);

  const saveStatus = async () => {
    try {
      await updateProjectStatus(project.id, status);
      onProjectUpdated({ ...project, status });
    } catch (e: any) {
      alert(e.message || "Fehler beim Speichern");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button className="text-sm underline" onClick={onBack}>
            Zurück zur Übersicht
          </button>
          <button
            className="text-red-600 underline"
            onClick={async () => {
              if (confirm(`Projekt ${project.code} wirklich löschen?`)) {
                await deleteProjectFull(project);
                onBack();
              }
            }}
          >
            Projekt löschen
          </button>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold">{project.name}</div>
          <div className="text-slate-500">Projekt {project.code}</div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow">
        <div className="flex gap-2 p-2 border-b">
          <TabButton active={active === "overview"} onClick={() => setActive("overview")}>
            Übersicht
          </TabButton>
          <TabButton active={active === "details"} onClick={() => setActive("details")}>
            Details
          </TabButton>
          <TabButton active={active === "docs"} onClick={() => setActive("docs")}>
            Dokumente
          </TabButton>
          <TabButton active={active === "parts"} onClick={() => setActive("parts")}>
            Teile
          </TabButton>
          <TabButton active={active === "time"} onClick={() => setActive("time")}>
            Stunden
          </TabButton>
        </div>
        <div className="p-4">
          {active === "overview" && (
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <div className="text-sm text-slate-600 mb-1">Status</div>
                <div className="flex gap-2 items-center">
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as Project["status"])}
                    className="border rounded-xl px-3 py-2"
                  >
                    {Object.entries(STATUS_LABEL).map(([val, label]) => (
                      <option key={val} value={val}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button className="rounded-xl px-3 py-2 bg-blue-600 text-white" onClick={saveStatus}>
                    Speichern
                  </button>
                </div>
              </div>
              <div>
                <div className="text-sm text-slate-600 mb-1">Angelegt</div>
                <div>{formatDate(project.created_at)}</div>
              </div>
            </div>
          )}
          {active === "details" && (
            <DetailsPanel
              project={project}
              onSaved={(p) => onProjectUpdated(p)}
            />
          )}
          {active === "docs" && <DocumentsPanel projectId={project.id} />}
          {active === "parts" && <PartsPanel projectId={project.id} />}
          {active === "time" && <TimePanel projectId={project.id} />}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={clsx("px-3 py-2 rounded-xl", active ? "bg-slate-900 text-white" : "hover:bg-slate-100")}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function DetailsPanel({ project, onSaved }: { project: Project; onSaved: (p: Project) => void }) {
  const [form, setForm] = useState({
    customer_name: project.customer_name || "",
    customer_phone: project.customer_phone || "",
    customer_email: project.customer_email || "",
    customer_address: project.customer_address || "",
    start_date: project.start_date || "",
    end_date: project.end_date || "",
    planned_hours: project.planned_hours ?? ""
  });
  const onChange = (k: keyof typeof form, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    try {
      const p = await updateProjectMeta(project.id, {
        ...form,
        planned_hours: form.planned_hours === "" ? null : Number(form.planned_hours)
      } as any);
      onSaved(p);
      alert("Gespeichert");
    } catch (e: any) {
      alert(e.message || "Fehler beim Speichern");
    }
  };
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="space-y-2">
        <div className="text-sm text-slate-600">Kunde</div>
        <input className="border rounded-xl px-3 py-2 w-full" placeholder="Name"
          value={form.customer_name} onChange={(e) => onChange("customer_name", e.target.value)} />
        <input className="border rounded-xl px-3 py-2 w-full" placeholder="Telefon"
          value={form.customer_phone} onChange={(e) => onChange("customer_phone", e.target.value)} />
        <input className="border rounded-xl px-3 py-2 w-full" placeholder="E-Mail"
          value={form.customer_email} onChange={(e) => onChange("customer_email", e.target.value)} />
        <textarea className="border rounded-xl px-3 py-2 w-full" placeholder="Adresse"
          value={form.customer_address} onChange={(e) => onChange("customer_address", e.target.value)} />
      </div>
      <div className="space-y-2">
        <div className="text-sm text-slate-600">Zeitplanung</div>
        <div className="grid grid-cols-2 gap-3">
          <input type="date" className="border rounded-xl px-3 py-2"
            value={form.start_date || ""} onChange={(e) => onChange("start_date", e.target.value)} />
          <input type="date" className="border rounded-xl px-3 py-2"
            value={form.end_date || ""} onChange={(e) => onChange("end_date", e.target.value)} />
        </div>
        <input type="number" step="0.25" min="0" className="border rounded-xl px-3 py-2"
          placeholder="geplante Arbeitszeit (Std.)"
          value={form.planned_hours as any}
          onChange={(e) => onChange("planned_hours", e.target.value)} />
        <button className="rounded-xl px-4 py-2 bg-blue-600 text-white" onClick={save}>Speichern</button>
      </div>
    </div>
  );
}

function DocumentsPanel({ projectId }: { projectId: string }) {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [cat, setCat] = useState<DocumentCategory>("angebot");

  const load = async () => {
    setLoading(true);
    try {
      setDocs(await fetchDocuments(projectId));
    } catch (e: any) {
      alert(e.message || "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => void load(), [projectId]);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    try {
      for (const f of files) {
        const d = await uploadDocument(projectId, cat, f);
        const url = await signedUrl(d.storage_path);
        setDocs((xs) => [{ ...(d as any), file_url: url }, ...xs]);
      }
    } catch (e: any) {
      alert(e.message || "Upload fehlgeschlagen");
    } finally {
      setUploading(false);
      e.currentTarget.value = "";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-2 md:items-center">
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value as DocumentCategory)}
          className="border rounded-xl px-3 py-2 w-full md:w-64"
        >
          {DOC_CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>

        <label className="inline-flex items-center gap-2 whitespace-nowrap">
          <div className="rounded-xl bg-blue-600 text-white px-3 py-1.5 text-sm cursor-pointer">
            Datei hochladen
          </div>
          <input type="file" className="hidden" onChange={onUpload} disabled={uploading} multiple />
        </label>

        <button className="md:ml-auto underline text-sm" onClick={load}>
          Aktualisieren
        </button>
      </div>

      <div className="border rounded-2xl overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left p-3">Kategorie</th>
              <th className="text-left p-3">Datei</th>
              <th className="text-left p-3">Hochgeladen</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="p-4" colSpan={4}>
                  Lädt…
                </td>
              </tr>
            ) : docs.length === 0 ? (
              <tr>
                <td className="p-4" colSpan={4}>
                  Noch keine Dokumente.
                </td>
              </tr>
            ) : (
              docs.map((d) => (
                <tr key={d.id} className="border-t">
                  <td className="p-3">{DOC_CATEGORIES.find((c) => c.key === d.category)?.label || d.category}</td>
                  <td className="p-3">{d.filename}</td>
                  <td className="p-3">{formatDate(d.uploaded_at)}</td>
                  <td className="p-3 text-right flex gap-3 justify-end">
                    {d.file_url ? (
                      <a className="text-blue-600 underline" href={d.file_url} target="_blank" rel="noreferrer">
                        Öffnen
                      </a>
                    ) : (
                      <span className="text-slate-400">kein Link</span>
                    )}
                    <button
                      className="text-red-600 underline"
                      onClick={async () => {
                        if (confirm("Dokument löschen?")) {
                          await deleteDocumentRow(d);
                          setDocs((xs) => xs.filter((x) => x.id !== d.id));
                        }
                      }}
                    >
                      Löschen
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PartsPanel({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", qty: 1, supplier: "", purchase_price: "", sale_price: "" });

  const load = async () => {
    setLoading(true);
    try {
      setRows(await fetchParts(projectId));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => void load(), [projectId]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const rec = await addPart(projectId, {
      name: form.name,
      qty: Number(form.qty) || 1,
      supplier: form.supplier || null,
      purchase_price: form.purchase_price ? Number(form.purchase_price) : null,
      sale_price: form.sale_price ? Number(form.sale_price) : null
    });
    setRows((xs) => [rec, ...xs]);
    setForm({ name: "", qty: 1, supplier: "", purchase_price: "", sale_price: "" });
  };

  const sumPurchase = rows.reduce((s, r) => s + (Number(r.purchase_price || 0) * Number(r.qty || 1)), 0);
  const sumSale = rows.reduce((s, r) => s + (Number(r.sale_price || 0) * Number(r.qty || 1)), 0);

  const toggle = async (row: Part, key: "ordered" | "delivered" | "installed") => {
    const next = { ...row, [key]: !row[key] } as Part;
    setRows((xs) => xs.map((x) => (x.id === row.id ? next : x)));
    await updatePart(row.id, { [key]: next[key] } as any);
  };

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="grid md:grid-cols-6 gap-3 bg-slate-50 p-3 rounded-2xl">
        <input
          className="border rounded-xl px-3 py-2 md:col-span-2"
          placeholder="Teil / Bezeichnung"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
        <input
          type="number"
          min="0"
          step="0.01"
          className="border rounded-xl px-3 py-2"
          placeholder="Menge"
          value={form.qty}
          onChange={(e) => setForm({ ...form, qty: Number(e.target.value) })}
        />
        <input
          className="border rounded-xl px-3 py-2"
          placeholder="Bezugsquelle"
          value={form.supplier}
          onChange={(e) => setForm({ ...form, supplier: e.target.value })}
        />
        <input
          type="number"
          min="0"
          step="0.01"
          className="border rounded-xl px-3 py-2"
          placeholder="EK"
          value={form.purchase_price}
          onChange={(e) => setForm({ ...form, purchase_price: e.target.value })}
        />
        <input
          type="number"
          min="0"
          step="0.01"
          className="border rounded-xl px-3 py-2"
          placeholder="VK"
          value={form.sale_price}
          onChange={(e) => setForm({ ...form, sale_price: e.target.value })}
        />
        <button className="rounded-xl px-4 py-2 bg-blue-600 text-white">Hinzufügen</button>
      </form>

      <div className="border rounded-2xl overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-3 text-left">Teil</th>
              <th className="p-3 text-left">Menge</th>
              <th className="p-3 text-left">Bezugsquelle</th>
              <th className="p-3 text-left">EK</th>
              <th className="p-3 text-left">VK</th>
              <th className="p-3 text-left">Bestellt</th>
              <th className="p-3 text-left">Geliefert</th>
              <th className="p-3 text-left">Montiert</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="p-4" colSpan={9}>
                  Lädt…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="p-4" colSpan={9}>
                  Noch keine Teile.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-3">{r.name}</td>
                  <td className="p-3">{r.qty}</td>
                  <td className="p-3">{r.supplier}</td>
                  <td className="p-3">{r.purchase_price ?? ""}</td>
                  <td className="p-3">{r.sale_price ?? ""}</td>
                  <td className="p-3"><input type="checkbox" checked={r.ordered} onChange={() => toggle(r, "ordered")} /></td>
                  <td className="p-3"><input type="checkbox" checked={r.delivered} onChange={() => toggle(r, "delivered")} /></td>
                  <td className="p-3"><input type="checkbox" checked={r.installed} onChange={() => toggle(r, "installed")} /></td>
                  <td className="p-3 text-right">
                    <button
                      className="text-red-600 underline"
                      onClick={async () => {
                        if (confirm("Teil löschen?")) {
                          await deletePart(r.id);
                          setRows((xs) => xs.filter((x) => x.id !== r.id));
                        }
                      }}
                    >
                      Löschen
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t bg-slate-50">
              <td className="p-3 font-medium" colSpan={3}>
                Summe
              </td>
              <td className="p-3 font-medium">{sumPurchase.toFixed(2)}</td>
              <td className="p-3 font-medium">{sumSale.toFixed(2)}</td>
              <td colSpan={4}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function TimePanel({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState(1);
  const [desc, setDesc] = useState("");
  const total = useMemo(() => entries.reduce((s, e) => s + (Number(e.hours) || 0), 0), [entries]);

  const load = async () => {
    setLoading(true);
    try {
      setEntries(await fetchTime(projectId));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => void load(), [projectId]);

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    await addTime(projectId, { work_date: date, hours: Number(hours), description: desc });
    setDesc("");
    setHours(1);
    await load();
  };

  return (
    <div className="space-y-4">
      <form onSubmit={onAdd} className="grid md:grid-cols-5 gap-3 bg-slate-50 p-3 rounded-2xl">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border rounded-xl px-3 py-2" />
        <input
          type="number"
          step="0.25"
          min="0"
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
          className="border rounded-xl px-3 py-2"
          placeholder="Stunden"
        />
        <input
          className="border rounded-xl px-3 py-2 md:col-span-2"
          placeholder="Beschreibung (optional)"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />
        <button className="rounded-xl px-4 py-2 bg-blue-600 text-white">Hinzufügen</button>
      </form>

      <div className="border rounded-2xl overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left p-3">Datum</th>
              <th className="text-left p-3">Stunden</th>
              <th className="text-left p-3">Beschreibung</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="p-4" colSpan={4}>
                  Lädt…
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td className="p-4" colSpan={4}>
                  Keine Einträge vorhanden.
                </td>
              </tr>
            ) : (
              entries.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="p-3">{formatDate(e.work_date)}</td>
                  <td className="p-3">{e.hours}</td>
                  <td className="p-3">{e.description}</td>
                  <td className="p-3 text-right">
                    <button
                      className="text-red-600 underline"
                      onClick={async () => {
                        if (confirm("Eintrag löschen?")) {
                          await deleteTimeEntry(e.id);
                          setEntries((xs) => xs.filter((x) => x.id !== e.id));
                        }
                      }}
                    >
                      Löschen
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t bg-slate-50">
              <td className="p-3 font-medium">Summe</td>
              <td className="p-3 font-medium">{total.toFixed(2)}</td>
              <td></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
