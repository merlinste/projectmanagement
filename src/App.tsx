import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient, SupabaseClient, Session } from "@supabase/supabase-js";

/* ============================ Supabase Client ============================= */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

/* ================================= Typen ================================= */
export type Project = {
  id: string;
  code: string;
  name: string;
  status: string | null;
  notes: string | null;
  created_at: string;
  // Kundendaten
  customer_address: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  // Finanz
  quote_total_net: number | null;
  hourly_rate: number | null;
  hours_planned: number | null;
  hours_actual: number | null;
  other_costs: number | null;
  invoiced_net: number | null;
  payments_received: number | null;
};

type NewProject = {
  code: string;
  name: string;
  status: string | null;
  notes: string | null;
};

type BomItem = {
  id: string;
  project_id: string;
  item: string;
  unit: string | null;
  qty: number | null;
  unit_price_net: number | null;
  notes: string | null;
  created_at: string | null;
};

type TimeEntry = {
  id: string;
  project_id: string;
  work_date: string;
  person: string | null;
  description: string | null;
  hours: number | null;
  billable: boolean | null;
  hourly_rate: number | null;
  created_at: string | null;
};

type FileEntry = { name: string; path: string; size: number; updated_at?: string };

type Task = {
  id: string;
  project_id: string;
  title: string;
  due_at: string | null; // ISO
  is_done: boolean | null;
  assigned_to: string | null;
  notes: string | null;
  created_at: string | null;
};

type Quote = {
  id: string;
  project_id: string;
  number: string | null;
  date: string | null;        // YYYY-MM-DD
  valid_until: string | null; // YYYY-MM-DD
  tax_rate: number | null;    // %
  notes: string | null;
  created_at: string | null;
};

type QuoteItem = {
  id: string;
  quote_id: string;
  pos: number | null;
  item: string;
  description: string | null;
  unit: string | null;
  qty: number | null;
  unit_price_net: number | null;
  discount_pct: number | null;
  created_at: string | null;
};

/* =============================== Konstanten ============================== */
const STATUS_OPTIONS = [
  "Neu",
  "Angebot",
  "Beauftragt",
  "Montage",
  "Abgerechnet",
  "Abgeschlossen",
  "Nicht Beauftragt",
] as const;

/* ==== Firmenblock / AGB-Pfad ==== */
const COMPANY = {
  name: "Stellwag Klimatechnik",
  addressLines: ["Am Eschbachtal 15", "60437 Frankfurt"],
  email: "info@stellwag-klimatechnik.de",
  logoPath: "/logo_small.png",
};
const AGB_PDF_PATH = "/AGB_Stellwag_Klimatechnik_v2.pdf";

/* ==== wichtiger Hinweis (deutlich hervorheben) ==== */
const IMPORTANT_NOTE =
  "Stromversorgung bauseits gemäß Herstellervorgaben. Keine Arbeiten an der ortsfesten Elektroinstallation durch Stellwag Klimatechnik.";

/* ==== Runtime-Loader für CDN-Skripte (html2canvas + pdf-lib) ==== */
async function loadScriptOnce(src: string): Promise<void> {
  if (document.querySelector(`script[src="${src}"]`)) return;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

const isArchived = (status?: string | null) => {
  const s = String(status ?? "").toLowerCase();
  return s === "abgeschlossen" || s === "nicht beauftragt";
};

/* ================================= Utils ================================= */
const money = (n: number) =>
  (isFinite(n) ? n : 0).toLocaleString(undefined, { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

const num = (v: any, fallback = 0) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return isFinite(n) ? n : fallback;
};

const formatDate = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString();
};

const toDatetimeLocalValue = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const fromDatetimeLocalValue = (local: string) => {
  if (!local) return null;
  const d = new Date(local);
  return d.toISOString(); // speichert in UTC, Anzeige erfolgt wieder lokal
};

/* =========================== Datenfunktionen: Projekte ==================== */
async function fetchProjects(): Promise<Project[]> {
  const { data, error } = await supabase.from("projects").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Project[];
}

async function insertProject(p: NewProject): Promise<Project> {
  const { data, error } = await supabase.from("projects").insert(p).select("*").single();
  if (error) throw error;
  return data as Project;
}

async function updateProject(id: string, patch: Partial<Project>): Promise<Project> {
  const { data, error } = await supabase.from("projects").update(patch).eq("id", id).select("*").single();
  if (error) throw error;
  return data as Project;
}

/* ============================ Datenfunktionen: BOM ======================== */
async function fetchBom(projectId: string): Promise<BomItem[]> {
  const { data, error } = await supabase.from("bom_items").select("*").eq("project_id", projectId).order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as BomItem[];
}
async function addBomItem(projectId: string, position?: Partial<BomItem>): Promise<BomItem> {
  const { data, error } = await supabase
    .from("bom_items")
    .insert({
      project_id: projectId,
      item: position?.item ?? "",
      unit: position?.unit ?? null,
      qty: position?.qty ?? 1,
      unit_price_net: position?.unit_price_net ?? 0,
      notes: position?.notes ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as BomItem;
}
async function updateBomItem(id: string, patch: Partial<BomItem>): Promise<BomItem> {
  const { data, error } = await supabase.from("bom_items").update(patch).eq("id", id).select("*").single();
  if (error) throw error;
  return data as BomItem;
}
async function deleteBomItem(id: string) {
  const { error } = await supabase.from("bom_items").delete().eq("id", id);
  if (error) throw error;
}

/* ======================= Datenfunktionen: Storage ========================= */
async function listBucket(bucket: "files" | "photos", projectId: string): Promise<FileEntry[]> {
  const prefix = `projects/${projectId}/`;
  const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 100, sortBy: { column: "updated_at", order: "desc" } });
  if (error) throw error;
  return (data ?? []).map((o) => ({ name: o.name, path: `${prefix}${o.name}`, size: o.metadata?.size ?? 0, updated_at: o.updated_at ?? undefined }));
}
async function uploadToBucket(bucket: "files" | "photos", projectId: string, file: File) {
  const path = `projects/${projectId}/${file.name}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
  if (error) throw error;
  return path;
}
async function removeFromBucket(bucket: "files" | "photos", path: string) {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw error;
}
async function signedUrl(bucket: "files" | "photos", path: string, expiresInSec = 3600): Promise<string> {
  if (bucket === "photos") {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSec);
  if (error) throw error;
  return data.signedUrl;
}

/* --------------- Datenfunktionen: Zeit (Stundenerfassung) ----------------- */
async function fetchTimeEntries(projectId: string): Promise<TimeEntry[]> {
  const { data, error } = await supabase
    .from("time_entries")
    .select("*")
    .eq("project_id", projectId)
    .order("work_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as TimeEntry[];
}
async function addTimeEntry(project: Project, preset?: Partial<TimeEntry>): Promise<TimeEntry> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("time_entries")
    .insert({
      project_id: project.id,
      work_date: preset?.work_date ?? today,
      person: preset?.person ?? "",
      description: preset?.description ?? "",
      hours: preset?.hours ?? 1,
      billable: preset?.billable ?? true,
      hourly_rate: preset?.hourly_rate ?? project.hourly_rate ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as TimeEntry;
}
async function updateTimeEntry(id: string, patch: Partial<TimeEntry>): Promise<TimeEntry> {
  const { data, error } = await supabase.from("time_entries").update(patch).eq("id", id).select("*").single();
  if (error) throw error;
  return data as TimeEntry;
}
async function deleteTimeEntry(id: string) {
  const { error } = await supabase.from("time_entries").delete().eq("id", id);
  if (error) throw error;
}

/* -------------------------- Datenfunktionen: Tasks ------------------------- */
async function fetchTasks(projectId: string): Promise<Task[]> {
  const { data, error } = await supabase.from("tasks").select("*").eq("project_id", projectId).order("is_done", { ascending: true }).order("due_at", { ascending: true }).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Task[];
}
async function fetchUpcomingTasks(limit = 8): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("is_done", false)
    .order("due_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Task[];
}
async function addTask(projectId: string, preset?: Partial<Task>): Promise<Task> {
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      project_id: projectId,
      title: preset?.title ?? "",
      due_at: preset?.due_at ?? null,
      is_done: preset?.is_done ?? false,
      assigned_to: preset?.assigned_to ?? "",
      notes: preset?.notes ?? "",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Task;
}
async function updateTask(id: string, patch: Partial<Task>): Promise<Task> {
  const { data, error } = await supabase.from("tasks").update(patch).eq("id", id).select("*").single();
  if (error) throw error;
  return data as Task;
}
async function deleteTask(id: string) {
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw error;
}

/* ------------------------ Datenfunktionen: Angebot ------------------------ */
async function getOrCreateQuote(projectId: string): Promise<Quote> {
  const found = await supabase.from("quotes").select("*").eq("project_id", projectId).maybeSingle();
  if (found.error) throw found.error;
  if (found.data) return found.data as Quote;
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("quotes")
    .insert({
      project_id: projectId,
      number: null,
      date: today,
      valid_until: null,
      tax_rate: 19,
      notes: "",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Quote;
}
async function updateQuote(id: string, patch: Partial<Quote>): Promise<Quote> {
  const { data, error } = await supabase.from("quotes").update(patch).eq("id", id).select("*").single();
  if (error) throw error;
  return data as Quote;
}
async function fetchQuoteItems(quoteId: string): Promise<QuoteItem[]> {
  const { data, error } = await supabase.from("quote_items").select("*").eq("quote_id", quoteId).order("pos", { ascending: true }).order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as QuoteItem[];
}
async function addQuoteItem(quoteId: string, preset?: Partial<QuoteItem>): Promise<QuoteItem> {
  const { data, error } = await supabase
    .from("quote_items")
    .insert({
      quote_id: quoteId,
      pos: preset?.pos ?? null,
      item: preset?.item ?? "",
      description: preset?.description ?? "",
      unit: preset?.unit ?? "",
      qty: preset?.qty ?? 1,
      unit_price_net: preset?.unit_price_net ?? 0,
      discount_pct: preset?.discount_pct ?? 0,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as QuoteItem;
}
async function updateQuoteItem(id: string, patch: Partial<QuoteItem>): Promise<QuoteItem> {
  const { data, error } = await supabase.from("quote_items").update(patch).eq("id", id).select("*").single();
  if (error) throw error;
  return data as QuoteItem;
}
async function deleteQuoteItem(id: string) {
  const { error } = await supabase.from("quote_items").delete().eq("id", id);
  if (error) throw error;
}

/* ===================== Projektcode (YYYY-XXX) Vorschlag =================== */
async function getNextProjectCode(): Promise<string> {
  const year = new Date().getFullYear();
  const { data, error } = await supabase.from("projects").select("code").ilike("code", `${year}-%`).limit(1000);
  if (error) return `${year}-001`;
  let maxN = 0;
  for (const r of data ?? []) {
    const code = String(r.code ?? "");
    if (code.startsWith(`${year}-`)) {
      const rest = code.slice(5);
      const n = parseInt(rest, 10);
      if (Number.isFinite(n)) maxN = Math.max(maxN, n);
    }
  }
  return `${year}-${String(maxN + 1).padStart(3, "0")}`;
}

/* ================================== App =================================== */
export default function App() {
  // Auth
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Projekte
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled) {
        setSession(data.session);
        setAuthLoading(false);
      }
    })();
    const { data: listener } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s));
    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!session) {
        setProjects([]);
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const data = await fetchProjects();
        if (mounted) setProjects(data);
      } catch (e: any) {
        console.error(e);
        setErrorMsg(e?.message ?? "Fehler beim Laden der Projekte.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [session]);

  const selectedProject = useMemo(() => projects.find((p) => p.id === selectedProjectId) ?? null, [projects, selectedProjectId]);

  const handleCreated = (p: Project) => setProjects((prev) => [p, ...prev]);
  const handleUpdated = (p: Project) => setProjects((prev) => prev.map((x) => (x.id === p.id ? p : x)));

  if (authLoading) {
    return <div className="min-h-dvh flex items-center justify-center text-slate-600">Lädt …</div>;
  }

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 bg-white/75 backdrop-blur border-b border-slate-200">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo_small.png" alt="Stellwag Klimatechnik" className="h-7 w-auto" />
            <div className="text-sm text-slate-500">Projektmanagement</div>
          </div>
          {session && (
            <div className="flex items-center gap-3">
              <span className="hidden sm:inline text-sm text-slate-500 truncate max-w-[200px]">{session.user.email}</span>
              <button onClick={async () => { await supabase.auth.signOut(); }} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">Abmelden</button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {errorMsg && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{errorMsg}</div>}

        {!session ? (
          <AuthView />
        ) : selectedProject ? (
          <ProjectDetail key={selectedProject.id} project={selectedProject} onBack={() => setSelectedProjectId(null)} onProjectUpdated={handleUpdated} />
        ) : (
          <HomeDashboard projects={projects} loading={loading} onSelect={setSelectedProjectId} onCreated={handleCreated} />
        )}
      </main>
    </div>
  );
}

/* ================================ Home ==================================== */
function HomeDashboard(props: { projects: Project[]; loading: boolean; onSelect: (id: string) => void; onCreated: (p: Project) => void }) {
  const { projects, loading, onSelect, onCreated } = props;
  const [projTab, setProjTab] = useState<"active" | "archive">("active");
  const activeProjects = projects.filter((p) => !isArchived(p.status));
  const archivedProjects = projects.filter((p) => isArchived(p.status));

  return (
    <div className="space-y-8">
      {/* Projekte */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-base text-slate-600">Projekte</div>
          <div className="flex gap-2">
            <TabButton active={projTab === "active"} onClick={() => setProjTab("active")}>Aktive ({activeProjects.length})</TabButton>
            <TabButton active={projTab === "archive"} onClick={() => setProjTab("archive")}>Archiv ({archivedProjects.length})</TabButton>
          </div>
        </div>
        <ProjectsTable projects={projTab === "active" ? activeProjects : archivedProjects} loading={loading} onSelect={onSelect} />
      </section>

      {/* Neues Projekt */}
      <section>
        <div className="mb-3 text-base text-slate-600">Neues Projekt anlegen</div>
        <CreateProjectForm onCreated={onCreated} />
      </section>

      {/* Nächste Fälligkeiten (Tasks) */}
      <section className="grid gap-6 md:grid-cols-2">
        <NextTasksWidget projects={projects} onSelectProject={onSelect} />
        <CalendarWidget />
      </section>
    </div>
  );
}

/* ============================= ProjectsTable ============================== */
function ProjectsTable(props: { projects: Project[]; loading: boolean; onSelect: (id: string) => void }) {
  const { projects, loading, onSelect } = props;

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Lädt …</div>;
  if (!projects.length) return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Keine Projekte in diesem Tab.</div>;

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
            <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => onSelect(p.id)} title="Details öffnen">
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

/* ============================== CreateProject ============================= */
function CreateProjectForm(props: { onCreated: (p: Project) => void }) {
  const { onCreated } = props;
  const [form, setForm] = useState<NewProject>({ code: "", name: "", status: "Neu", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCodeBusy(true);
      const next = await getNextProjectCode();
      if (!cancelled) setForm((s) => ({ ...s, code: next }));
      setCodeBusy(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const canSubmit = form.code.trim() && form.name.trim();

  const recalcCode = async () => {
    setCodeBusy(true);
    const next = await getNextProjectCode();
    setForm((s) => ({ ...s, code: next }));
    setCodeBusy(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    try {
      setErrorMsg(null);
      setSubmitting(true);
      const created = await insertProject(form);
      onCreated(created);
      const next = await getNextProjectCode();
      setForm({ code: next, name: "", status: "Neu", notes: "" });
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message ?? "Konnte Projekt nicht anlegen.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-4 md:p-6 space-y-4">
      {errorMsg && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{errorMsg}</div>}

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Code">
          <div className="flex items-center gap-2">
            <input className="flex-1 rounded-xl border border-slate-300 px-3 py-2" value={form.code} onChange={(e) => setForm((s) => ({ ...s, code: e.target.value }))} required />
            <button type="button" onClick={recalcCode} className="rounded-xl border border-slate-300 px-2 py-1 text-sm" title="Code neu berechnen" disabled={codeBusy}>{codeBusy ? "…" : "↻"}</button>
          </div>
        </Field>
        <Field label="Name">
          <input className="rounded-xl border border-slate-300 px-3 py-2" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} required />
        </Field>
        <Field label="Status">
          <select className="rounded-xl border border-slate-300 px-3 py-2" value={form.status ?? ""} onChange={(e) => setForm((s) => ({ ...s, status: e.target.value }))}>
            {STATUS_OPTIONS.map((s) => (<option key={s} value={s}>{s}</option>))}
          </select>
        </Field>
        <Field label="Notizen" className="md:col-span-2">
          <textarea className="rounded-xl border border-slate-300 px-3 py-2" rows={3} value={form.notes ?? ""} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} />
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={!canSubmit || submitting} className="rounded-xl bg-blue-600 px-3 py-2 text-white disabled:opacity-50">
          {submitting ? "Wird angelegt …" : "Projekt anlegen"}
        </button>
      </div>
    </form>
  );
}

/* =========================== Projektdetails + Tabs ========================= */
function ProjectDetail(props: { project: Project; onBack: () => void; onProjectUpdated: (p: Project) => void }) {
  const { project, onBack, onProjectUpdated } = props;
  const [active, setActive] = useState<"overview" | "profit" | "bom" | "files" | "photos" | "time" | "tasks" | "quote">("overview");

  const [bom, setBom] = useState<BomItem[]>([]);
  const [bomLoading, setBomLoading] = useState(true);
  const reloadBom = async () => { setBomLoading(true); try { setBom(await fetchBom(project.id)); } finally { setBomLoading(false); } };
  useEffect(() => { reloadBom(); /* eslint-disable-next-line */ }, [project.id]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">← Zur Übersicht</button>
        <h2 className="text-base text-slate-600">Projektdetails</h2>
      </div>

      <div className="flex gap-2 overflow-x-auto">
        <TabButton active={active === "overview"} onClick={() => setActive("overview")}>Übersicht</TabButton>
        <TabButton active={active === "profit"}   onClick={() => setActive("profit")}>Profitabilität</TabButton>
        <TabButton active={active === "bom"}      onClick={() => setActive("bom")}>Stückliste</TabButton>
        <TabButton active={active === "files"}    onClick={() => setActive("files")}>Dateien</TabButton>
        <TabButton active={active === "photos"}   onClick={() => setActive("photos")}>Fotos</TabButton>
        <TabButton active={active === "time"}     onClick={() => setActive("time")}>Zeit</TabButton>
        <TabButton active={active === "tasks"}    onClick={() => setActive("tasks")}>Aufgaben</TabButton>
        <TabButton active={active === "quote"}    onClick={() => setActive("quote")}>Angebot</TabButton>
      </div>

      {active === "overview" && <OverviewPanel project={project} onProjectUpdated={onProjectUpdated} />}
      {active === "profit"   && <ProfitabilityPanel project={project} bom={bom} refreshingBom={bomLoading} onProjectUpdated={onProjectUpdated} />}
      {active === "bom"      && <BomPanel project={project} items={bom} loading={bomLoading} onChange={setBom} onReload={reloadBom} />}
      {active === "files"    && <FilesPanel project={project} />}
      {active === "photos"   && <PhotosPanel project={project} />}
      {active === "time"     && <TimePanel project={project} />}
      {active === "tasks"    && <TasksPanel project={project} />}
      {active === "quote"    && <QuotePanel project={project} onProjectUpdated={onProjectUpdated} />}
    </div>
  );
}

function TabButton(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={props.onClick} className={"px-3 py-2 rounded-xl text-sm border " + (props.active ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50")}>
      {props.children}
    </button>
  );
}

/* ====================== Übersicht (Basis + Kundendaten) =================== */
function OverviewPanel(props: { project: Project; onProjectUpdated: (p: Project) => void }) {
  const { project, onProjectUpdated } = props;
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [base, setBase] = useState({ name: project.name ?? "", code: project.code ?? "", status: project.status ?? "", notes: project.notes ?? "" });
  const [cust, setCust] = useState({ customer_address: project.customer_address ?? "", customer_email: project.customer_email ?? "", customer_phone: project.customer_phone ?? "" });

  useEffect(() => {
    setBase({ name: project.name ?? "", code: project.code ?? "", status: project.status ?? "", notes: project.notes ?? "" });
    setCust({ customer_address: project.customer_address ?? "", customer_email: project.customer_email ?? "", customer_phone: project.customer_phone ?? "" });
  }, [project.id]); // resync on project switch

  const hasChanges =
    base.name !== (project.name ?? "") || base.code !== (project.code ?? "") || (base.status ?? "") !== (project.status ?? "") || (base.notes ?? "") !== (project.notes ?? "") ||
    (cust.customer_address ?? "") !== (project.customer_address ?? "") || (cust.customer_email ?? "") !== (project.customer_email ?? "") || (cust.customer_phone ?? "") !== (project.customer_phone ?? "");

  const handleSave = async () => {
    try {
      setErrorMsg(null); setSaving(true);
      const patch: Partial<Project> = {
        name: base.name, code: base.code, status: base.status, notes: base.notes,
        customer_address: cust.customer_address || null, customer_email: cust.customer_email || null, customer_phone: cust.customer_phone || null,
      };
      const updated = await updateProject(project.id, patch);
      onProjectUpdated(updated);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Konnte Änderungen nicht speichern.");
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      {errorMsg && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{errorMsg}</div>}

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 md:p-6 space-y-4">
          <div className="text-sm text-slate-600">Basisdaten</div>
          <div className="grid gap-3">
            <Field label="Name"><input className="w-full rounded-xl border border-slate-300 px-3 py-2" value={base.name} onChange={(e) => setBase((s) => ({ ...s, name: e.target.value }))} /></Field>
            <Field label="Code"><input className="w-full rounded-xl border border-slate-300 px-3 py-2" value={base.code} onChange={(e) => setBase((s) => ({ ...s, code: e.target.value }))} /></Field>
            <Field label="Status">
              <select className="w-full rounded-xl border border-slate-300 px-3 py-2" value={base.status} onChange={(e) => setBase((s) => ({ ...s, status: e.target.value }))}>
                {STATUS_OPTIONS.map((s) => (<option key={s} value={s}>{s}</option>))}
              </select>
            </Field>
            <Field label="Notizen"><textarea className="w-full rounded-xl border border-slate-300 px-3 py-2" rows={4} value={base.notes} onChange={(e) => setBase((s) => ({ ...s, notes: e.target.value }))} /></Field>
            <div className="text-xs text-slate-500">Angelegt am {formatDate(project.created_at)}</div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 md:p-6 space-y-4">
          <div className="text-sm text-slate-600">Kundendaten</div>
          <div className="grid gap-3">
            <Field label="Adresse"><input className="w-full rounded-xl border border-slate-300 px-3 py-2" placeholder="Straße Hausnr., PLZ Ort" value={cust.customer_address} onChange={(e) => setCust((s) => ({ ...s, customer_address: e.target.value }))} /></Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="E‑Mail"><input type="email" className="w-full rounded-xl border border-slate-300 px-3 py-2" placeholder="kunde@example.com" value={cust.customer_email} onChange={(e) => setCust((s) => ({ ...s, customer_email: e.target.value }))} /></Field>
              <Field label="Telefon"><input className="w-full rounded-xl border border-slate-300 px-3 py-2" placeholder="+49 …" value={cust.customer_phone} onChange={(e) => setCust((s) => ({ ...s, customer_phone: e.target.value }))} /></Field>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button className="rounded-xl bg-blue-600 px-3 py-2 text-white disabled:opacity-50" onClick={handleSave} disabled={!hasChanges || saving}>{saving ? "Speichern …" : "Änderungen speichern"}</button>
        {!hasChanges && <span className="text-sm text-slate-500">Keine ungespeicherten Änderungen</span>}
      </div>
    </div>
  );
}

/* ============================= Profitabilität ============================= */
function ProfitabilityPanel(props: { project: Project; bom: BomItem[]; refreshingBom: boolean; onProjectUpdated: (p: Project) => void }) {
  const { project, bom, refreshingBom, onProjectUpdated } = props;
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [fin, setFin] = useState({
    quote_total_net: project.quote_total_net ?? 0,
    hourly_rate: project.hourly_rate ?? 0,
    hours_planned: project.hours_planned ?? 0,
    hours_actual: project.hours_actual ?? 0,
    other_costs: project.other_costs ?? 0,
    invoiced_net: project.invoiced_net ?? 0,
    payments_received: project.payments_received ?? 0,
  });
  useEffect(() => {
    setFin({
      quote_total_net: project.quote_total_net ?? 0,
      hourly_rate: project.hourly_rate ?? 0,
      hours_planned: project.hours_planned ?? 0,
      hours_actual: project.hours_actual ?? 0,
      other_costs: project.other_costs ?? 0,
      invoiced_net: project.invoiced_net ?? 0,
      payments_received: project.payments_received ?? 0,
    });
  }, [project.id, project.quote_total_net, project.hourly_rate, project.hours_planned, project.hours_actual, project.other_costs, project.invoiced_net, project.payments_received]);

  const [timeSum, setTimeSum] = useState<{ hours: number; cost: number }>({ hours: 0, cost: 0 });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const entries = await fetchTimeEntries(project.id);
        const hours = entries.reduce((s, e) => s + num(e.hours), 0);
        const cost = entries.reduce((s, e) => s + num(e.hours) * num(e.hourly_rate ?? project.hourly_rate), 0);
        if (!cancelled) setTimeSum({ hours, cost });
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [project.id, project.hourly_rate]);

  const bomTotal = useMemo(() => bom.reduce((s, it) => s + num(it.qty) * num(it.unit_price_net), 0), [bom]);
  const plannedCost   = num(fin.hours_planned) * num(fin.hourly_rate) + num(bomTotal) + num(fin.other_costs);
  const actualCost    = num(timeSum.cost) + num(bomTotal) + num(fin.other_costs);
  const plannedProfit = num(fin.quote_total_net) - plannedCost;
  const actualProfit  = num(fin.invoiced_net) - actualCost;
  const plannedMargin = num(fin.quote_total_net) ? (plannedProfit / num(fin.quote_total_net)) * 100 : 0;
  const actualMargin  = num(fin.invoiced_net)    ? (actualProfit  / num(fin.invoiced_net)) * 100 : 0;

  useEffect(() => { if (!saved) return; const t = setTimeout(() => setSaved(false), 1500); return () => clearTimeout(t); }, [saved]);

  const handleSave = async () => {
    try {
      setErr(null); setSaving(true);
      const patch: Partial<Project> = {
        quote_total_net: num(fin.quote_total_net), hourly_rate: num(fin.hourly_rate), hours_planned: num(fin.hours_planned),
        hours_actual: num(fin.hours_actual), other_costs: num(fin.other_costs), invoiced_net: num(fin.invoiced_net), payments_received: num(fin.payments_received),
      };
      const updated = await updateProject(project.id, patch);
      onProjectUpdated(updated);
      setSaved(true);
    } catch (e: any) {
      setErr(e?.message ?? "Konnte Finanzdaten nicht speichern.");
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>}

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 md:p-6 space-y-4">
          <div className="text-sm text-slate-600">Plan / IST</div>
          <div className="grid gap-3">
            <Field label="Angebot (netto)"><NumberInput value={fin.quote_total_net} onChange={(v) => setFin((s) => ({ ...s, quote_total_net: v }))} /></Field>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Stundensatz"><NumberInput value={fin.hourly_rate} onChange={(v) => setFin((s) => ({ ...s, hourly_rate: v }))} /></Field>
              <Field label="Stunden geplant"><NumberInput value={fin.hours_planned} onChange={(v) => setFin((s) => ({ ...s, hours_planned: v }))} /></Field>
              <Field label="Stunden IST (manuell)"><NumberInput value={fin.hours_actual} onChange={(v) => setFin((s) => ({ ...s, hours_actual: v }))} /></Field>
            </div>
            <Field label="Sonstige Kosten"><NumberInput value={fin.other_costs} onChange={(v) => setFin((s) => ({ ...s, other_costs: v }))} /></Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Rechnungen (netto)"><NumberInput value={fin.invoiced_net} onChange={(v) => setFin((s) => ({ ...s, invoiced_net: v }))} /></Field>
              <Field label="Zahlungseingänge"><NumberInput value={fin.payments_received} onChange={(v) => setFin((s) => ({ ...s, payments_received: v }))} /></Field>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 md:p-6 space-y-3">
          <div className="text-sm text-slate-600 flex items-center gap-2">
            Kennzahlen {refreshingBom && <span className="text-xs text-slate-500">Stückliste wird aktualisiert …</span>}
          </div>
          <KPI label="Zeit aus Erfassung (h)">{num(timeSum.hours).toFixed(2)}</KPI>
          <KPI label="Zeitkosten (Erfassung)">{money(timeSum.cost)}</KPI>
          <KPI label="BOM (Material)">{money(bomTotal)}</KPI>
          <KPI label="Plan-Kosten (Std geplant + BOM + sonst.)">{money(plannedCost)}</KPI>
          <KPI label="IST-Kosten (ZE + BOM + sonst.)">{money(actualCost)}</KPI>
          <KPI label="Plan-Gewinn">{money(plannedProfit)}</KPI>
          <KPI label="Plan-Marge">{isFinite(plannedMargin) ? plannedMargin.toFixed(1) + " %" : "—"}</KPI>
          <KPI label="IST-Gewinn">{money(actualProfit)}</KPI>
          <KPI label="IST-Marge">{isFinite(actualMargin) ? actualMargin.toFixed(1) + " %" : "—"}</KPI>
          <KPI label="Offen (Rechnung − Zahlung)">{money(num(fin.invoiced_net) - num(fin.payments_received))}</KPI>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button className="rounded-xl bg-blue-600 px-3 py-2 text-white disabled:opacity-50" onClick={handleSave} disabled={saving}>{saving ? "Speichern …" : "Speichern"}</button>
        {saved && <span className="text-sm text-slate-500">Gespeichert</span>}
      </div>
    </div>
  );
}

/* =============================== Stückliste =============================== */
function BomPanel(props: { project: Project; items: BomItem[]; loading: boolean; onChange: (items: BomItem[]) => void; onReload: () => void }) {
  const { project, items, loading, onChange, onReload } = props;
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const total = items.reduce((s, it) => s + num(it.qty) * num(it.unit_price_net), 0);

  const create = async () => {
    try { const created = await addBomItem(project.id, { item: "", qty: 1, unit_price_net: 0 }); onChange([...items, created]); }
    catch (e: any) { setErrorMsg(e?.message ?? "Konnte Position nicht anlegen."); }
  };

  const patch = async (id: string, p: Partial<BomItem>) => {
    const optimistic = items.map((x) => (x.id === id ? ({ ...x, ...p } as BomItem) : x)); onChange(optimistic);
    try { const updated = await updateBomItem(id, p); onChange(items.map((x) => (x.id === id ? updated : x))); } catch { onReload(); }
  };

  const remove = async (id: string) => {
    const optimistic = items.filter((x) => x.id !== id); onChange(optimistic);
    try { await deleteBomItem(id); } catch { onReload(); }
  };

  return (
    <div className="space-y-4">
      {errorMsg && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{errorMsg}</div>}

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 text-left">Pos.</th>
              <th className="px-4 py-3 text-left">Bezeichnung</th>
              <th className="px-4 py-3 text-left">Einheit</th>
              <th className="px-4 py-3 text-right">Menge</th>
              <th className="px-4 py-3 text-right">Einzelpreis (netto)</th>
              <th className="px-4 py-3 text-right">Summe</th>
              <th className="px-4 py-3 text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-3 text-slate-500" colSpan={7}>Lädt …</td></tr>
            ) : items.length ? (
              items.map((it, idx) => {
                const rowSum = num(it.qty) * num(it.unit_price_net);
                return (
                  <tr key={it.id} className="border-t border-slate-100">
                    <td className="px-4 py-2">{idx + 1}</td>
                    <td className="px-4 py-2"><input className="w-full rounded-xl border border-slate-300 px-2 py-1" value={it.item ?? ""} onChange={(e) => patch(it.id, { item: e.target.value })} placeholder="Artikel / Leistung" /></td>
                    <td className="px-4 py-2"><input className="w-full rounded-xl border border-slate-300 px-2 py-1" value={it.unit ?? ""} onChange={(e) => patch(it.id, { unit: e.target.value })} placeholder="Stk, m, h …" /></td>
                    <td className="px-4 py-2 text-right"><NumberInput small value={num(it.qty)} onChange={(v) => patch(it.id, { qty: v })} /></td>
                    <td className="px-4 py-2 text-right"><NumberInput small value={num(it.unit_price_net)} onChange={(v) => patch(it.id, { unit_price_net: v })} /></td>
                    <td className="px-4 py-2 text-right">{money(rowSum)}</td>
                    <td className="px-4 py-2 text-right"><button className="text-red-600 hover:underline" onClick={() => remove(it.id)}>löschen</button></td>
                  </tr>
                );
              })
            ) : (
              <tr><td className="px-4 py-3 text-slate-500" colSpan={7}>Keine Positionen angelegt.</td></tr>
            )}
          </tbody>
          {items.length > 0 && (
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50">
                <td className="px-4 py-2" colSpan={5}>Summe</td>
                <td className="px-4 py-2 text-right">{money(total)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="flex items-center gap-3">
        <button className="rounded-xl bg-blue-600 px-3 py-2 text-white" onClick={create}>Position hinzufügen</button>
        <button className="rounded-xl border border-slate-300 px-3 py-2" onClick={onReload}>Aktualisieren</button>
      </div>
    </div>
  );
}

/* ================================= Dateien ================================ */
function FilesPanel(props: { project: Project }) {
  const { project } = props;
  const [items, setItems] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => { setLoading(true); try { const data = await listBucket("files", project.id); setItems(data); } finally { setLoading(false); } };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [project.id]);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files?.length) return;
    for (const f of Array.from(files)) await uploadToBucket("files", project.id, f);
    await reload(); e.currentTarget.value = "";
  };
  const onDelete = async (path: string) => { await removeFromBucket("files", path); await reload(); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-600">Dateien</div>
        <label className="cursor-pointer rounded-xl bg-blue-600 px-3 py-2 text-white">Dateien hochladen<input type="file" className="hidden" multiple onChange={onUpload} /></label>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        {loading ? <div className="text-sm text-slate-500">Lädt …</div> : items.length ? (
          <ul className="divide-y divide-slate-100">
            {items.map((f) => (
              <li key={f.path} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm">{f.name}</div>
                  <div className="text-xs text-slate-500">{f.size} B • {formatDate(f.updated_at)}</div>
                </div>
                <div className="flex items-center gap-3">
                  <a className="text-blue-600 hover:underline text-sm" href="#" onClick={async (ev) => { ev.preventDefault(); const url = await signedUrl("files", f.path); window.open(url, "_blank"); }}>öffnen</a>
                  <button className="text-red-600 hover:underline text-sm" onClick={() => onDelete(f.path)}>löschen</button>
                </div>
              </li>
            ))}
          </ul>
        ) : <div className="text-sm text-slate-500">Noch keine Dateien.</div>}
      </div>
    </div>
  );
}

/* ================================== Fotos ================================= */
function PhotosPanel(props: { project: Project }) {
  const { project } = props;
  const [items, setItems] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => { setLoading(true); try { const data = await listBucket("photos", project.id); setItems(data); } finally { setLoading(false); } };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [project.id]);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files?.length) return;
    for (const f of Array.from(files)) await uploadToBucket("photos", project.id, f);
    await reload(); e.currentTarget.value = "";
  };
  const onDelete = async (path: string) => { await removeFromBucket("photos", path); await reload(); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-600">Foto‑Galerie</div>
        <label className="cursor-pointer rounded-xl bg-blue-600 px-3 py-2 text-white">Fotos hochladen<input type="file" accept="image/*" className="hidden" multiple onChange={onUpload} /></label>
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">Lädt …</div>
      ) : items.length ? (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          {items.map((f) => (<PhotoThumb key={f.path} bucket="photos" entry={f} onDelete={() => onDelete(f.path)} />))}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">Noch keine Fotos vorhanden.</div>
      )}
    </div>
  );
}
function PhotoThumb(props: { bucket: "files" | "photos"; entry: FileEntry; onDelete: () => void }) {
  const { bucket, entry, onDelete } = props;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false; (async () => { const u = await signedUrl(bucket, entry.path, 3600); if (!cancelled) setUrl(u); })();
    return () => { cancelled = true; };
  }, [bucket, entry.path]);

  return (
    <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-white">
      {url ? (<a href={url} target="_blank" rel="noreferrer"><img src={url} alt={entry.name} className="w-full h-40 object-cover" /></a>) : (<div className="h-40 flex items-center justify-center text-sm text-slate-500">Lädt …</div>)}
      <div className="absolute top-2 right-2"><button className="rounded-lg bg-white/90 px-2 py-1 text-xs text-red-600" onClick={onDelete}>löschen</button></div>
      <div className="p-2 text-xs text-slate-600 truncate">{entry.name}</div>
    </div>
  );
}

/* =============================== Zeit (Erfassung) ========================= */
function TimePanel(props: { project: Project }) {
  const { project } = props;
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const reload = async () => { setLoading(true); try { const data = await fetchTimeEntries(project.id); setEntries(data); } catch (e: any) { setErr(e?.message ?? "Konnte Zeitbuchungen nicht laden."); } finally { setLoading(false); } };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [project.id]);

  const add = async () => { const created = await addTimeEntry(project, { hourly_rate: project.hourly_rate ?? undefined }); setEntries((prev) => [created, ...prev]); };
  const patch = async (id: string, p: Partial<TimeEntry>) => {
    const optimistic = entries.map((x) => (x.id === id ? ({ ...x, ...p } as TimeEntry) : x)); setEntries(optimistic);
    try { const updated = await updateTimeEntry(id, p); setEntries((prev) => prev.map((x) => (x.id === id ? updated : x))); } catch { reload(); }
  };
  const remove = async (id: string) => { const optimistic = entries.filter((x) => x.id !== id); setEntries(optimistic); try { await deleteTimeEntry(id); } catch { reload(); } };

  const totalHours = entries.reduce((s, e) => s + num(e.hours), 0);
  const totalCost = entries.reduce((s, e) => s + num(e.hours) * num(e.hourly_rate ?? project.hourly_rate), 0);

  return (
    <div className="space-y-4">
      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>}
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-600">Stundenerfassung</div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-slate-600">Summe: {totalHours.toFixed(2)} h • Kosten: {money(totalCost)}</div>
          <button className="rounded-xl bg-blue-600 px-3 py-2 text-white" onClick={add}>Buchung hinzufügen</button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 text-left">Datum</th>
              <th className="px-4 py-3 text-left">Person</th>
              <th className="px-4 py-3 text-left">Beschreibung</th>
              <th className="px-4 py-3 text-right">Stunden</th>
              <th className="px-4 py-3 text-right">Stundensatz</th>
              <th className="px-4 py-3 text-left">billable</th>
              <th className="px-4 py-3 text-right">Kosten</th>
              <th className="px-4 py-3 text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-3 text-slate-500" colSpan={8}>Lädt …</td></tr>
            ) : entries.length ? (
              entries.map((e) => {
                const cost = num(e.hours) * num(e.hourly_rate ?? project.hourly_rate);
                return (
                  <tr key={e.id} className="border-t border-slate-100">
                    <td className="px-4 py-2"><input type="date" className="rounded-xl border border-slate-300 px-2 py-1" value={e.work_date ?? ""} onChange={(ev) => patch(e.id, { work_date: ev.target.value })} /></td>
                    <td className="px-4 py-2"><input className="w-full rounded-xl border border-slate-300 px-2 py-1" value={e.person ?? ""} onChange={(ev) => patch(e.id, { person: ev.target.value })} placeholder="Name" /></td>
                    <td className="px-4 py-2"><input className="w-full rounded-xl border border-slate-300 px-2 py-1" value={e.description ?? ""} onChange={(ev) => patch(e.id, { description: ev.target.value })} placeholder="Tätigkeit" /></td>
                    <td className="px-4 py-2 text-right"><NumberInput small value={num(e.hours)} onChange={(v) => patch(e.id, { hours: v })} /></td>
                    <td className="px-4 py-2 text-right"><NumberInput small value={num(e.hourly_rate ?? project.hourly_rate)} onChange={(v) => patch(e.id, { hourly_rate: v })} /></td>
                    <td className="px-4 py-2"><input type="checkbox" checked={!!e.billable} onChange={(ev) => patch(e.id, { billable: ev.target.checked })} /></td>
                    <td className="px-4 py-2 text-right">{money(cost)}</td>
                    <td className="px-4 py-2 text-right"><button className="text-red-600 hover:underline" onClick={() => remove(e.id)}>löschen</button></td>
                  </tr>
                );
              })
            ) : (
              <tr><td className="px-4 py-3 text-slate-500" colSpan={8}>Noch keine Zeitbuchungen.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3"><button className="rounded-xl border border-slate-300 px-3 py-2" onClick={reload}>Aktualisieren</button></div>
    </div>
  );
}

/* =============================== Aufgaben (Tasks) ========================= */
function TasksPanel(props: { project: Project }) {
  const { project } = props;
  const [items, setItems] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    try { setItems(await fetchTasks(project.id)); } catch (e: any) { setErr(e?.message ?? "Konnte Aufgaben nicht laden."); } finally { setLoading(false); }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [project.id]);

  const create = async () => {
    const created = await addTask(project.id, { title: "", due_at: null });
    setItems((prev) => [...prev, created]);
  };
  const patch = async (id: string, p: Partial<Task>) => {
    const optimistic = items.map((x) => (x.id === id ? ({ ...x, ...p } as Task) : x)); setItems(optimistic);
    try { const updated = await updateTask(id, p); setItems((prev) => prev.map((x) => (x.id === id ? updated : x))); } catch { reload(); }
  };
  const remove = async (id: string) => {
    const optimistic = items.filter((x) => x.id !== id); setItems(optimistic);
    try { await deleteTask(id); } catch { reload(); }
  };

  return (
    <div className="space-y-4">
      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>}

      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-600">Aufgaben / Termine</div>
        <button className="rounded-xl bg-blue-600 px-3 py-2 text-white" onClick={create}>Aufgabe hinzufügen</button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 text-left">Offen</th>
              <th className="px-4 py-3 text-left">Titel</th>
              <th className="px-4 py-3 text-left">Fällig am</th>
              <th className="px-4 py-3 text-left">Zuständig</th>
              <th className="px-4 py-3 text-left">Notizen</th>
              <th className="px-4 py-3 text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-3 text-slate-500" colSpan={6}>Lädt …</td></tr>
            ) : items.length ? (
              items.map((t) => (
                <tr key={t.id} className="border-t border-slate-100">
                  <td className="px-4 py-2">
                    <input type="checkbox" checked={!!t.is_done} onChange={(e) => patch(t.id, { is_done: e.target.checked })} />
                  </td>
                  <td className="px-4 py-2">
                    <input className="w-full rounded-xl border border-slate-300 px-2 py-1" value={t.title} onChange={(e) => patch(t.id, { title: e.target.value })} placeholder="Aufgabe / Termin" />
                  </td>
                  <td className="px-4 py-2">
                    <input type="datetime-local" className="rounded-xl border border-slate-300 px-2 py-1" value={toDatetimeLocalValue(t.due_at)} onChange={(e) => patch(t.id, { due_at: fromDatetimeLocalValue(e.target.value) })} />
                  </td>
                  <td className="px-4 py-2">
                    <input className="w-full rounded-xl border border-slate-300 px-2 py-1" value={t.assigned_to ?? ""} onChange={(e) => patch(t.id, { assigned_to: e.target.value })} placeholder="Name" />
                  </td>
                  <td className="px-4 py-2">
                    <input className="w-full rounded-xl border border-slate-300 px-2 py-1" value={t.notes ?? ""} onChange={(e) => patch(t.id, { notes: e.target.value })} placeholder="Notizen" />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button className="text-red-600 hover:underline" onClick={() => remove(t.id)}>löschen</button>
                  </td>
                </tr>
              ))
            ) : (
              <tr><td className="px-4 py-3 text-slate-500" colSpan={6}>Noch keine Aufgaben.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* =========================== Startseite: Tasks Widget ===================== */
function NextTasksWidget(props: { projects: Project[]; onSelectProject: (id: string) => void }) {
  const { projects, onSelectProject } = props;
  const [items, setItems] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => { setLoading(true); try { setItems(await fetchUpcomingTasks(8)); } finally { setLoading(false); } };
  useEffect(() => { reload(); }, []);

  const markDone = async (t: Task) => {
    const optimistic = items.map((x) => (x.id === t.id ? { ...x, is_done: true } : x)); setItems(optimistic);
    try { await updateTask(t.id, { is_done: true }); } catch { reload(); }
  };

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 md:p-6">
      <div className="mb-2 text-sm text-slate-600">Nächste Fälligkeiten</div>
      {loading ? (
        <div className="text-sm text-slate-500">Lädt …</div>
      ) : items.length ? (
        <ul className="space-y-2">
          {items.map((t) => {
            const p = projectById.get(t.project_id);
            const overdue = t.due_at ? new Date(t.due_at).getTime() < Date.now() : false;
            return (
              <li key={t.id} className={"flex items-center justify-between gap-3 rounded-lg border px-3 py-2 " + (overdue ? "border-red-200 bg-red-50" : "border-slate-200")}>
                <div className="min-w-0">
                  <div className="text-sm truncate">{t.title || "Ohne Titel"}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {t.due_at ? new Date(t.due_at).toLocaleString() : "ohne Termin"} • {p ? `${p.code} – ${p.name}` : t.project_id}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {p && (
                    <button className="text-blue-600 hover:underline text-sm" onClick={() => onSelectProject(p.id)}>
                      öffnen
                    </button>
                  )}
                  <button className="text-slate-600 hover:underline text-sm" onClick={() => markDone(t)}>
                    erledigt
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="text-sm text-slate-500">Keine offenen Tasks.</div>
      )}
    </div>
  );
}

/* =============================== Angebot (Quote) ========================== */
function QuotePanel(props: { project: Project; onProjectUpdated: (p: Project) => void }) {
  const { project, onProjectUpdated } = props;
  const [quote, setQuote] = useState<Quote | null>(null);
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Unsichtbarer (aber renderbarer) Bereich für HTML→Bild→PDF
  const printableRef = useRef<HTMLDivElement>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const q = await getOrCreateQuote(project.id);
      setQuote(q);
      const it = await fetchQuoteItems(q.id);
      setItems(it.map((x, i) => ({ ...x, pos: x.pos ?? i + 1 })));
    } catch (e: any) {
      setErr(e?.message ?? "Konnte Angebot nicht laden.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [project.id]);

  const totals = useMemo(() => {
    const sumNet = items.reduce((s, it) => {
      const line = num(it.qty) * (num(it.unit_price_net) * (1 - num(it.discount_pct) / 100));
      return s + line;
    }, 0);
    const taxRate = num(quote?.tax_rate ?? 19);
    const vat = (sumNet * taxRate) / 100;
    const gross = sumNet + vat;
    return { sumNet, vat, gross, taxRate };
  }, [items, quote?.tax_rate]);

  const patchHeader = async (p: Partial<Quote>) => {
    if (!quote) return;
    const updated = await updateQuote(quote.id, p);
    setQuote(updated);
  };

  const createItem = async () => {
    if (!quote) return;
    const created = await addQuoteItem(quote.id, {
      pos: (items[items.length - 1]?.pos ?? 0) + 1,
      item: "",
      qty: 1,
      unit_price_net: 0,
      discount_pct: 0,
    });
    setItems((prev) => [...prev, created]);
  };

  const patchItem = async (id: string, p: Partial<QuoteItem>) => {
    const optimistic = items.map((x) => (x.id === id ? ({ ...x, ...p } as QuoteItem) : x));
    setItems(optimistic);
    try {
      const updated = await updateQuoteItem(id, p);
      setItems((prev) => prev.map((x) => (x.id === id ? updated : x)));
    } catch {
      reload();
    }
  };

  const removeItem = async (id: string) => {
    const optimistic = items.filter((x) => x.id !== id);
    setItems(optimistic);
    try { await deleteQuoteItem(id); } catch { reload(); }
  };

  const saveAndSync = async () => {
    try {
      setErr(null);
      const updatedProject = await updateProject(project.id, { quote_total_net: totals.sumNet });
      onProjectUpdated(updatedProject);
    } catch (e: any) {
      setErr(e?.message ?? "Konnte Angebotssumme nicht ins Projekt übernehmen.");
    }
  };

  /* -------------------------- Druck: schönes A4 --------------------------- */
  const printOffer = () => {
    const win = window.open("", "PRINT", "height=900,width=700");
    if (!win) return;

    const rows = items.map((it, i) => {
      const line = num(it.qty) * (num(it.unit_price_net) * (1 - num(it.discount_pct) / 100));
      return `<tr>
        <td>${it.pos ?? i + 1}</td>
        <td><div><strong>${escapeHtml(it.item)}</strong></div><div class="muted">${escapeHtml(it.description ?? "")}</div></td>
        <td>${escapeHtml(it.unit ?? "")}</td>
        <td class="r">${num(it.qty).toLocaleString()}</td>
        <td class="r">${money(num(it.unit_price_net))}</td>
        <td class="r">${num(it.discount_pct)}%</td>
        <td class="r">${money(line)}</td>
      </tr>`;
    }).join("");

    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Angebot ${project.code}</title>
      <style>
        @page { size: A4; margin: 16mm; }
        body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color:#0f172a; }
        .head { display:flex; gap:16px; align-items:center; margin-bottom:10px; }
        .head img { height: 42px; }
        .head .meta { font-size:12px; color:#475569; line-height:1.35; }
        h1 { margin: 6px 0 12px; font-size: 22px; }
        .muted { color:#64748b; font-size: 12px; }
        .note { border-left: 4px solid #ef4444; background:#fff1f2; padding:8px 12px; margin:12px 0; font-size:12px; }
        table { width:100%; border-collapse:collapse; margin-top:12px; }
        th, td { border:1px solid #e2e8f0; padding:6px 8px; font-size:12px; vertical-align:top; }
        th { background:#f8fafc; text-align:left; }
        td.r, th.r { text-align:right; }
        .totals { margin-top:10px; width: 60%; margin-left:auto; }
        .totals td { border:none; font-size:12px; padding:4px 0; }
        .totals .line td { border-top:2px solid #334155; }
        .block { margin-top:12px; }
        .block h3 { margin:0 0 6px; font-size: 14px; }
        footer { position:fixed; bottom:0; left:0; right:0; color:#94a3b8; font-size:10px; }
      </style>
    </head><body>
      <div class="head">
        <img src="${COMPANY.logoPath}" alt="${COMPANY.name}">
        <div class="meta">
          <div><strong>${COMPANY.name}</strong></div>
          <div>${COMPANY.addressLines.join(" • ")}</div>
          <div>${COMPANY.email}</div>
        </div>
      </div>

      <h1>Angebot</h1>
      <div class="muted">${escapeHtml(project.code)} — ${escapeHtml(project.name)}</div>
      <div class="muted">Datum: ${quote?.date ?? ""} • Gültig bis: ${quote?.valid_until ?? ""} • Angebots‑Nr.: ${quote?.number ?? ""}</div>

      <div class="block">
        <h3>Kunde</h3>
        <div class="muted">${escapeHtml(project.customer_address ?? "")}</div>
        <div class="muted">${escapeHtml(project.customer_email ?? "")} • ${escapeHtml(project.customer_phone ?? "")}</div>
      </div>

      <div class="note"><strong>WICHTIG:</strong> ${escapeHtml(IMPORTANT_NOTE)}</div>

      <table>
        <thead>
          <tr>
            <th>Pos.</th><th>Bezeichnung / Beschreibung</th><th>Einheit</th>
            <th class="r">Menge</th><th class="r">EP netto</th><th class="r">Rabatt %</th><th class="r">Summe netto</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <table class="totals">
        <tr><td>Zwischensumme (netto)</td><td class="r">${money(totals.sumNet)}</td></tr>
        <tr><td>MwSt (${totals.taxRate.toFixed(0)} %)</td><td class="r">${money(totals.vat)}</td></tr>
        <tr class="line"><td><strong>Gesamt (brutto)</strong></td><td class="r"><strong>${money(totals.gross)}</strong></td></tr>
      </table>

      <div class="block">
        <h3>Zahlungsbedingungen</h3>
        <div>50 % bei Auftragserteilung, 50 % nach Fertigstellung.</div>
      </div>

      ${quote?.notes ? `<div class="block"><h3>Hinweise</h3><div class="muted">${escapeHtml(quote.notes)}</div></div>` : ""}

      <div class="block muted">Es gelten die beiliegenden Allgemeinen Geschäftsbedingungen (AGB).</div>

      <footer>${COMPANY.name} • ${COMPANY.addressLines.join(" • ")} • ${COMPANY.email}</footer>
    </body></html>`);
    win.document.close();
    win.focus();
    win.print();
    win.close();

    function escapeHtml(s: string) {
      return s.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]!));
    }
  };

  /* ----------------- PDF inkl. AGB: html2canvas + pdf-lib ----------------- */
  const exportPdfWithAgb = async () => {
    try {
      // libs nur bei Bedarf laden (CDN)
      await loadScriptOnce("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js");
      await loadScriptOnce("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js");

      const html2canvas = (window as any).html2canvas;
      const PDFLib = (window as any).PDFLib as typeof import("pdf-lib");
      if (!html2canvas || !PDFLib) throw new Error("PDF/Canvas-Bibliotheken konnten nicht geladen werden.");

      const root = printableRef.current;
      if (!root) throw new Error("Printbereich nicht gefunden.");

      // A4 Breite in Pixel für 96dpi (html2canvas)
      const A4_W = 794; // px (8.27in * 96)
      root.style.width = `${A4_W}px`;

      // 1) HTML -> Canvas (hohe Auflösung)
      const canvas: HTMLCanvasElement = await html2canvas(root, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
      const fullW = canvas.width;
      const fullH = canvas.height;

      // 2) Canvas in A4-Häppchen schneiden und in PDF einfügen
      const pdf = await PDFLib.PDFDocument.create();
      const pageWpt = 595.28;  // A4 Breite (pt)
      const pageHpt = 841.89;  // A4 Höhe  (pt)
      const pageHpx = Math.floor((pageHpt / pageWpt) * fullW);

      let y = 0;
      const ctx = canvas.getContext("2d")!;
      while (y < fullH) {
        const sliceH = Math.min(pageHpx, fullH - y);
        const slice = document.createElement("canvas");
        slice.width = fullW;
        slice.height = sliceH;
        const sctx = slice.getContext("2d")!;
        const imgData = ctx.getImageData(0, y, fullW, sliceH);
        sctx.putImageData(imgData, 0, 0);

        const dataUrl = slice.toDataURL("image/png");
        const bytes = dataUrlToUint8Array(dataUrl);
        const png = await pdf.embedPng(bytes);
        const imgHpt = (sliceH / fullW) * pageWpt;

        const page = pdf.addPage([pageWpt, pageHpt]);
        page.drawImage(png, { x: 0, y: pageHpt - imgHpt, width: pageWpt, height: imgHpt });

        y += sliceH;
      }

      // 3) AGB hinten anhängen (wenn vorhanden)
      try {
        const agbBytes = await fetch(AGB_PDF_PATH, { cache: "no-store" }).then((r) => r.arrayBuffer());
        const agbDoc = await PDFLib.PDFDocument.load(agbBytes);
        const agbPages = await pdf.copyPages(agbDoc, agbDoc.getPageIndices());
        agbPages.forEach((p) => pdf.addPage(p));
      } catch (e) {
        console.warn("AGB konnten nicht angehängt werden:", e);
      }

      // 4) Download
      const out = await pdf.save();
      const blob = new Blob([out], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.code}_Angebot.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setErr(e?.message ?? "PDF-Export fehlgeschlagen.");
    }
  };

  return (
    <div className="space-y-4">
      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Angebotskopf */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 md:p-6 space-y-3">
          <div className="text-sm text-slate-600">Angebotsdaten</div>
          <div className="grid gap-3">
            <Field label="Angebots‑Nr.">
              <input className="rounded-xl border border-slate-300 px-3 py-2"
                     value={quote?.number ?? ""} onChange={(e) => patchHeader({ number: e.target.value })}
                     placeholder={`${project.code}-A1`} />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Datum">
                <input type="date" className="rounded-xl border border-slate-300 px-3 py-2"
                       value={quote?.date ?? ""} onChange={(e) => patchHeader({ date: e.target.value })} />
              </Field>
              <Field label="Gültig bis">
                <input type="date" className="rounded-xl border border-slate-300 px-3 py-2"
                       value={quote?.valid_until ?? ""} onChange={(e) => patchHeader({ valid_until: e.target.value })} />
              </Field>
            </div>
            <Field label="MwSt‑Satz in %">
              <NumberInput value={num(quote?.tax_rate ?? 19)} onChange={(v) => patchHeader({ tax_rate: v })} />
            </Field>
            <Field label="Notizen">
              <textarea className="rounded-xl border border-slate-300 px-3 py-2" rows={3}
                        value={quote?.notes ?? ""} onChange={(e) => patchHeader({ notes: e.target.value })} />
            </Field>
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              <strong>Wichtig:</strong> {IMPORTANT_NOTE}
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <strong>Zahlungsbedingungen:</strong> 50 % bei Auftragserteilung, 50 % nach Fertigstellung.
            </div>
          </div>
        </div>

        {/* Summen */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 md:p-6 space-y-2">
          <div className="text-sm text-slate-600">Summen</div>
          <KPI label="Zwischensumme (netto)">{money(totals.sumNet)}</KPI>
          <KPI label={`MwSt (${totals.taxRate.toFixed(0)} %)`}>{money(totals.vat)}</KPI>
          <KPI label="Gesamt (brutto)">{money(totals.gross)}</KPI>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button className="rounded-xl bg-blue-600 px-3 py-2 text-white" onClick={saveAndSync}>Speichern</button>
            <button className="rounded-xl border border-slate-300 px-3 py-2" onClick={createItem}>Position hinzufügen</button>
            <button className="rounded-xl border border-slate-300 px-3 py-2" onClick={printOffer}>Drucken / PDF</button>
            <button className="rounded-xl border border-slate-300 px-3 py-2" onClick={exportPdfWithAgb}>Exportieren (PDF inkl. AGB)</button>
          </div>
          <div className="text-xs text-slate-500 pt-1">
            Tipp: „Exportieren (PDF inkl. AGB)“ erzeugt ein zusammenhängendes PDF (Angebot + AGB).
          </div>
        </div>
      </div>

      {/* Positionsliste */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 text-left">Pos.</th>
              <th className="px-4 py-3 text-left">Bezeichnung</th>
              <th className="px-4 py-3 text-left">Beschreibung</th>
              <th className="px-4 py-3 text-left">Einheit</th>
              <th className="px-4 py-3 text-right">Menge</th>
              <th className="px-4 py-3 text-right">EP netto</th>
              <th className="px-4 py-3 text-right">Rabatt %</th>
              <th className="px-4 py-3 text-right">Summe netto</th>
              <th className="px-4 py-3 text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-3 text-slate-500" colSpan={9}>Lädt …</td></tr>
            ) : items.length ? (
              items.map((it, idx) => {
                const lineNet = num(it.qty) * (num(it.unit_price_net) * (1 - num(it.discount_pct) / 100));
                return (
                  <tr key={it.id} className="border-t border-slate-100">
                    <td className="px-4 py-2" style={{ width: 60 }}>
                      <NumberInput small value={num(it.pos ?? idx + 1)} onChange={(v) => patchItem(it.id, { pos: v })} />
                    </td>
                    <td className="px-4 py-2" style={{ minWidth: 220 }}>
                      <input className="w-full rounded-xl border border-slate-300 px-2 py-1" value={it.item}
                             onChange={(e) => patchItem(it.id, { item: e.target.value })} placeholder="Artikel / Leistung" />
                    </td>
                    <td className="px-4 py-2" style={{ minWidth: 260 }}>
                      <input className="w-full rounded-xl border border-slate-300 px-2 py-1" value={it.description ?? ""}
                             onChange={(e) => patchItem(it.id, { description: e.target.value })} placeholder="Beschreibung" />
                    </td>
                    <td className="px-4 py-2" style={{ width: 100 }}>
                      <input className="w-full rounded-xl border border-slate-300 px-2 py-1" value={it.unit ?? ""}
                             onChange={(e) => patchItem(it.id, { unit: e.target.value })} placeholder="Stk / m / h" />
                    </td>
                    <td className="px-4 py-2 text-right" style={{ width: 120 }}>
                      <NumberInput small value={num(it.qty)} onChange={(v) => patchItem(it.id, { qty: v })} />
                    </td>
                    <td className="px-4 py-2 text-right" style={{ width: 140 }}>
                      <NumberInput small value={num(it.unit_price_net)} onChange={(v) => patchItem(it.id, { unit_price_net: v })} />
                    </td>
                    <td className="px-4 py-2 text-right" style={{ width: 120 }}>
                      <NumberInput small value={num(it.discount_pct)} onChange={(v) => patchItem(it.id, { discount_pct: v })} />
                    </td>
                    <td className="px-4 py-2 text-right" style={{ width: 140 }}>{money(lineNet)}</td>
                    <td className="px-4 py-2 text-right" style={{ width: 120 }}>
                      <button className="text-red-600 hover:underline" onClick={() => removeItem(it.id)}>löschen</button>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr><td className="px-4 py-3 text-slate-500" colSpan={9}>Noch keine Positionen.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Unsichtbarer Render-Bereich für PDF (aber NICHT display:none setzen!) */}
      <div
        ref={printableRef}
        className="fixed -left-[10000px] top-0 bg-white text-black"
        style={{ width: 794 }}
      >
        {/* Kopf */}
        <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 8 }}>
          <img src={COMPANY.logoPath} alt={COMPANY.name} style={{ height: 42 }} />
          <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.35 }}>
            <div><strong>{COMPANY.name}</strong></div>
            <div>{COMPANY.addressLines.join(" • ")}</div>
            <div>{COMPANY.email}</div>
          </div>
        </div>

        <h2 style={{ margin: "6px 0 8px", fontSize: 20 }}>Angebot</h2>
        <div style={{ color: "#64748b", fontSize: 12 }}>
          {project.code} — {project.name}
        </div>
        <div style={{ color: "#64748b", fontSize: 12 }}>
          Datum: {quote?.date ?? ""} • Gültig bis: {quote?.valid_until ?? ""} • Angebots‑Nr.: {quote?.number ?? ""}
        </div>

        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: "#0f172a", marginBottom: 4 }}><strong>Kunde</strong></div>
          <div style={{ color: "#64748b", fontSize: 12 }}>{project.customer_address ?? ""}</div>
          <div style={{ color: "#64748b", fontSize: 12 }}>{project.customer_email ?? ""} • {project.customer_phone ?? ""}</div>
        </div>

        <div style={{ borderLeft: "4px solid #ef4444", background: "#fff1f2", padding: "8px 12px", margin: "10px 0", fontSize: 12 }}>
          <strong>WICHTIG:</strong> {IMPORTANT_NOTE}
        </div>

        {/* Tabelle */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, fontSize: 12 }}>
          <thead>
            <tr>
              {["Pos.","Bezeichnung / Beschreibung","Einheit","Menge","EP netto","Rabatt %","Summe netto"].map((h, i) => (
                <th key={i} style={{ border: "1px solid #e2e8f0", padding: "6px 8px", background: "#f8fafc", textAlign: i>=3 ? "right" : "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const line = num(it.qty) * (num(it.unit_price_net) * (1 - num(it.discount_pct) / 100));
              return (
                <tr key={it.id}>
                  <td style={{ border: "1px solid #e2e8f0", padding: "6px 8px" }}>{it.pos ?? i + 1}</td>
                  <td style={{ border: "1px solid #e2e8f0", padding: "6px 8px" }}>
                    <div><strong>{it.item}</strong></div>
                    <div style={{ color: "#64748b" }}>{it.description ?? ""}</div>
                  </td>
                  <td style={{ border: "1px solid #e2e8f0", padding: "6px 8px" }}>{it.unit ?? ""}</td>
                  <td style={{ border: "1px solid #e2e8f0", padding: "6px 8px", textAlign: "right" }}>{num(it.qty).toLocaleString()}</td>
                  <td style={{ border: "1px solid #e2e8f0", padding: "6px 8px", textAlign: "right" }}>{money(num(it.unit_price_net))}</td>
                  <td style={{ border: "1px solid #e2e8f0", padding: "6px 8px", textAlign: "right" }}>{num(it.discount_pct)}%</td>
                  <td style={{ border: "1px solid #e2e8f0", padding: "6px 8px", textAlign: "right" }}>{money(line)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Summen */}
        <div style={{ width: "60%", marginLeft: "auto", marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
            <div>Zwischensumme (netto)</div><div>{money(totals.sumNet)}</div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
            <div>MwSt ({totals.taxRate.toFixed(0)} %)</div><div>{money(totals.vat)}</div>
          </div>
          <div style={{ borderTop: "2px solid #334155", marginTop: 6, paddingTop: 6, display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 12 }}>
            <div>Gesamt (brutto)</div><div>{money(totals.gross)}</div>
          </div>
        </div>

        {/* Zahlungsbed. + Notizen */}
        <div style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Zahlungsbedingungen</div>
          <div style={{ fontSize: 12 }}>50 % bei Auftragserteilung, 50 % nach Fertigstellung.</div>
        </div>

        {quote?.notes && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Hinweise</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>{quote.notes}</div>
          </div>
        )}

        <div style={{ color: "#64748b", fontSize: 12, marginTop: 8 }}>
          Es gelten die beiliegenden Allgemeinen Geschäftsbedingungen (AGB).
        </div>
      </div>
    </div>
  );
}

/* ============================== UI-Helfer ================================= */
function Field(props: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`flex flex-col gap-1 text-sm ${props.className ?? ""}`}><span className="text-slate-600">{props.label}</span>{props.children}</label>;
}
function NumberInput(props: { value: number | null | undefined; onChange: (v: number) => void; small?: boolean }) {
  const { value, onChange, small } = props;
  return <input inputMode="decimal" className={`rounded-xl border border-slate-300 px-3 py-2 text-right ${small ? "px-2 py-1" : ""}`} value={value ?? 0} onChange={(e) => onChange(num(e.target.value))} />;
}
function KPI(props: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"><div className="text-sm text-slate-600">{props.label}</div><div className="text-sm">{props.children}</div></div>;
}

/* ============================== Widgets =================================== */
function CalendarWidget() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 md:p-6">
      <div className="mb-2 text-sm text-slate-600">Kalender</div>
      <div className="text-sm text-slate-500">Hier kann ein Kalender oder eine Timeline eingebunden werden (z. B. externe Komponente oder iCal).</div>
    </div>
  );
}

/* ================================ Auth ==================================== */
function AuthView() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startMicrosoftLogin = async () => {
    try {
      setErr(null); setBusy(true);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "azure",
        options: { scopes: "email", redirectTo: window.location.origin },
      });
      if (error) { setErr(error.message); setBusy(false); }
    } catch (e: any) { setErr(e?.message ?? "Anmeldung fehlgeschlagen."); setBusy(false); }
  };

  const sendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    setBusy(false); if (error) setErr(error.message); else setSent(true);
  };

  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <div className="text-base text-slate-700">Anmelden</div>
        {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>}

        <button type="button" onClick={startMicrosoftLogin} disabled={busy} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
          Mit Microsoft anmelden
        </button>

        <div className="flex items-center gap-3"><div className="h-px flex-1 bg-slate-200" /><span className="text-xs text-slate-500">oder</span><div className="h-px flex-1 bg-slate-200" /></div>

        {sent ? (
          <div className="text-sm text-slate-600">Magic‑Link gesendet. Prüfe dein Postfach und klicke den Link, um dich anzumelden.</div>
        ) : (
          <form onSubmit={sendMagicLink} className="space-y-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-600">E‑Mail</span>
              <input type="email" required className="rounded-xl border border-slate-300 px-3 py-2" placeholder="du@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button type="submit" disabled={busy} className="w-full rounded-xl bg-blue-600 px-3 py-2 text-white disabled:opacity-50">{busy ? "Sende Link …" : "Magic‑Link senden"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
