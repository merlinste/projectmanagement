import React, { useEffect, useMemo, useState } from "react";
import { createClient, SupabaseClient, Session } from "@supabase/supabase-js";

// ================= ENV / SUPABASE =================
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
export const VAT_RATE = Number(import.meta.env.VITE_VAT_RATE ?? 0.19);
export const DEFAULT_HOURLY = Number(import.meta.env.VITE_DEFAULT_HOURLY_RATE ?? 65);

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
});

// ================= TYPES =================
export type ProjectStatus =
  | "planung"
  | "angebot"
  | "bestellt"
  | "montage"
  | "inbetriebnahme"
  | "abgerechnet"
  | "storniert";

export type Project = {
  id: string;
  code: string; // e.g. 2025-0007
  name: string;
  status: ProjectStatus;
  notes: string | null;
  created_at: string;
  // Profit inputs
  quote_total_net?: number | null;        // Angebotssumme netto
  invoiced_total_net?: number | null;     // tatsächlich abgerechnet netto (optional)
  hourly_rate?: number | null;            // Standard-Satz
};

export type DocumentCategory =
  | "angebot"
  | "einkauf"
  | "inbetriebnahme"
  | "rechnung"
  | "fotos"
  | "sonstiges";

export type DocumentRow = {
  id: string;
  project_id: string;
  category: DocumentCategory;
  filename: string;
  storage_path: string;
  uploaded_at: string;
  file_url: string | null;
};

export type TimeEntry = {
  id: string;
  project_id: string;
  work_date: string; // YYYY-MM-DD
  hours: number;
  description: string | null;
  worker_name: string | null;
  created_at: string;
};

export type Part = {
  id: string;
  project_id: string;
  name: string;
  qty: number;
  supplier: string | null;
  purchase_price_net: number | null; // EK netto / Einheit
  sale_price_net: number | null;     // VK netto / Einheit (optional)
  shipping_cost_net: number | null;  // Versand netto (pro Position)
  ordered: boolean;
  delivered: boolean;
  installed: boolean;
  notes: string | null;
  created_at: string;
};

export type Task = {
  id: string;
  project_id: string;
  title: string;
  due_date: string | null; // YYYY-MM-DD
  done: boolean;
  notes: string | null;
  created_at: string;
};

const DOC_CATEGORIES: { key: DocumentCategory; label: string }[] = [
  { key: "angebot", label: "Angebot" },
  { key: "einkauf", label: "Einkauf (Material/Ware)" },
  { key: "inbetriebnahme", label: "Inbetriebnahme-Protokoll" },
  { key: "rechnung", label: "Rechnung" },
  { key: "fotos", label: "Fotos" },
  { key: "sonstiges", label: "Sonstiges" },
];

const STATUS_LABEL: Record<ProjectStatus, string> = {
  planung: "Planung",
  angebot: "Angebot",
  bestellt: "Bestellt",
  montage: "Montage",
  inbetriebnahme: "Inbetriebnahme",
  abgerechnet: "Abgerechnet",
  storniert: "Storniert",
};

// ================= UTIL =================
function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}
function formatDate(d?: string | null) {
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
const toNet = (value: number, mode: "netto" | "brutto") => (mode === "brutto" ? value / (1 + VAT_RATE) : value);
const toGross = (net: number) => net * (1 + VAT_RATE);

async function signedUrl(path: string) {
  const { data } = await supabase.storage.from("project-files").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

// ================= AUTH =================
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

  const onMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) alert(error.message);
    else setSent(true);
  };

  const onMicrosoft = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: { scopes: "openid profile email offline_access", redirectTo: window.location.origin },
    });
    if (error) alert(error.message);
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
          <>
            <form onSubmit={onMagicLink} className="space-y-3 mb-4">
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
            <div className="relative flex items-center justify-center my-2">
              <div className="h-px bg-slate-200 w-full" />
              <span className="absolute bg-white px-2 text-xs text-slate-500">oder</span>
            </div>
            <button type="button" className="w-full rounded-xl px-3 py-2 border hover:bg-slate-50" onClick={onMicrosoft}>
              Mit Microsoft anmelden
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ================= DATA HELPERS =================
async function fetchProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select(
      "id, code, name, status, notes, created_at, quote_total_net, invoiced_total_net, hourly_rate"
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as any) as Project[];
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
async function updateProject(id: string, patch: Partial<Project>) {
  const { data, error } = await supabase.from("projects").update(patch).eq("id", id).select().single();
  if (error) throw error;
  return data as Project;
}
async function updateProjectStatus(id: string, status: ProjectStatus) {
  const { error } = await supabase.from("projects").update({ status }).eq("id", id);
  if (error) throw error;
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
  const unique = `${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
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
    .select("id, project_id, work_date, hours, description, worker_name, created_at")
    .eq("project_id", projectId)
    .order("work_date", { ascending: false });
  if (error) throw error;
  return data as TimeEntry[];
}
async function addTime(projectId: string, entry: { work_date: string; hours: number; description?: string; worker_name?: string }) {
  const { error } = await supabase
    .from("time_entries")
    .insert({ project_id: projectId, work_date: entry.work_date, hours: entry.hours, description: entry.description ?? null, worker_name: entry.worker_name ?? null });
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

async function fetchTasksAllProjects(): Promise<(Task & { project: Project })[]> {
  // Upcoming (this month +/-) for dashboard
  const { data, error } = await supabase
    .from("project_tasks")
    .select("id, project_id, title, due_date, done, notes, created_at, projects:project_id(id, name, code, status)")
    .order("due_date", { ascending: true });
  if (error) throw error;
  return (data as any).map((x: any) => ({ ...x, project: x.projects })) as any;
}
async function fetchTasks(projectId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from("project_tasks")
    .select("*")
    .eq("project_id", projectId)
    .order("due_date", { ascending: true });
  if (error) throw error;
  return data as Task[];
}
async function addTask(projectId: string, t: { title: string; due_date?: string | null; notes?: string | null }) {
  const { data, error } = await supabase
    .from("project_tasks")
    .insert({ project_id: projectId, title: t.title, due_date: t.due_date ?? null, notes: t.notes ?? null })
    .select()
    .single();
  if (error) throw error;
  return data as Task;
}
async function updateTask(id: string, patch: Partial<Task>) {
  const { error } = await supabase.from("project_tasks").update(patch).eq("id", id);
  if (error) throw error;
}
async function deleteTask(id: string) {
  const { error } = await supabase.from("project_tasks").delete().eq("id", id);
  if (error) throw error;
}

// ================= UI ROOT =================
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

// ================= LIST + DASHBOARD =================
function ProjectList({ onOpen }: { onOpen: (p: Project) => void }) {
  const [items, setItems] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [tab, setTab] = useState<"laufend" | "abgeschlossen">(
    (localStorage.getItem("spm_list_tab") as any) || "laufend"
  );
  const [tasks, setTasks] = useState<(Task & { project: Project })[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchProjects();
      setItems(data);
      const t = await fetchTasksAllProjects();
      setTasks(t);
    } catch (e: any) {
      alert(e.message || "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => void load(), []);

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
    tab === "abgeschlossen"
      ? ["abgerechnet", "storniert"].includes(p.status)
      : !["abgerechnet", "storniert"].includes(p.status)
  );

  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const monthDays = Array.from({ length: endOfMonth.getDate() }, (_, i) => i + 1);
  const tasksByDay = new Map<number, number>();
  tasks.forEach((t) => {
    if (!t.due_date) return;
    const d = new Date(t.due_date);
    if (d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear()) {
      tasksByDay.set(d.getDate(), (tasksByDay.get(d.getDate()) || 0) + 1);
    }
  });
  const upcoming = tasks
    .filter((t) => !!t.due_date && new Date(t.due_date!) >= today && !t.done)
    .slice(0, 20);

  return (
    <div className="space-y-6">
      {/* DASH: Kalender + Fälligkeiten */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow p-4 md:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium">Kalender – {today.toLocaleString("de-DE", { month: "long", year: "numeric" })}</h3>
            <button className="text-sm underline" onClick={load}>Aktualisieren</button>
          </div>
          <div className="grid grid-cols-7 text-xs text-slate-500 mb-1">
            {["Mo","Di","Mi","Do","Fr","Sa","So"].map((w) => (
              <div key={w} className="px-2 py-1">{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: (startOfMonth.getDay() + 6) % 7 }).map((_, i) => (
              <div key={`pad-${i}`} className="h-20 rounded-xl bg-transparent" />
            ))}
            {monthDays.map((d) => (
              <div key={d} className="h-20 rounded-xl border bg-slate-50 p-2">
                <div className="text-xs font-medium">{d}</div>
                <div className="mt-1 flex gap-1 flex-wrap">
                  {Array.from({ length: tasksByDay.get(d) || 0 }).map((_, i) => (
                    <span key={i} className="w-2 h-2 rounded-full bg-blue-600 inline-block" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow p-4">
          <h3 className="font-medium mb-2">Nächste Fälligkeiten</h3>
          <div className="space-y-2 max-h-64 overflow-auto pr-1">
            {upcoming.length === 0 ? (
              <div className="text-sm text-slate-500">Keine anstehenden Aufgaben.</div>) : (
              upcoming.map((t) => (
                <div key={t.id} className="text-sm border rounded-xl p-2">
                  <div className="font-medium">{t.title}</div>
                  <div className="text-slate-500">{formatDate(t.due_date)} – {t.project?.code} {t.project?.name}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* CREATE */}
      <div className="bg-white rounded-2xl shadow p-4">
        <h2 className="text-lg mb-3">Neues Projekt anlegen</h2>
        <form onSubmit={onCreate} className="grid md:grid-cols-3 gap-3">
          <input className="border rounded-xl px-3 py-2" placeholder="Projekt-/Kundenname" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="border rounded-xl px-3 py-2 md:col-span-2" placeholder="Notizen (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="md:col-span-3">
            <button className="rounded-xl px-4 py-2 bg-blue-600 text-white" disabled={creating}>{creating ? "Speichere…" : "Projekt anlegen"}</button>
          </div>
        </form>
      </div>

      {/* LIST */}
      <div className="bg-white rounded-2xl shadow">
        <div className="p-4 border-b flex items-center gap-2">
          <h2 className="text-lg mr-auto">Projekte</h2>
          <button className={clsx("px-3 py-2 rounded-xl", tab === "laufend" ? "bg-slate-900 text-white" : "hover:bg-slate-100")} onClick={() => { setTab("laufend"); localStorage.setItem("spm_list_tab","laufend"); }}>Laufende Projekte</button>
          <button className={clsx("px-3 py-2 rounded-xl", tab === "abgeschlossen" ? "bg-slate-900 text-white" : "hover:bg-slate-100")} onClick={() => { setTab("abgeschlossen"); localStorage.setItem("spm_list_tab","abgeschlossen"); }}>Abgeschlossene Projekte</button>
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
                <tr><td className="p-4" colSpan={5}>Lädt…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td className="p-4" colSpan={5}>Keine Projekte im Tab „{tab}“.</td></tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="p-3 whitespace-nowrap font-medium">{p.code}</td>
                    <td className="p-3">{p.name}</td>
                    <td className="p-3"><StatusBadge value={p.status} /></td>
                    <td className="p-3 whitespace-nowrap">{formatDate(p.created_at)}</td>
                    <td className="p-3 text-right">
                      <button className="text-blue-600 underline" onClick={() => onOpen(p)}>Öffnen</button>
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

function StatusBadge({ value }: { value: ProjectStatus }) {
  const map: Record<ProjectStatus, string> = {
    planung: "bg-slate-100 text-slate-700",
    angebot: "bg-amber-100 text-amber-800",
    bestellt: "bg-sky-100 text-sky-800",
    montage: "bg-indigo-100 text-indigo-800",
    inbetriebnahme: "bg-emerald-100 text-emerald-800",
    abgerechnet: "bg-green-100 text-green-800",
    storniert: "bg-rose-100 text-rose-800",
  };
  return <span className={clsx("px-2 py-1 rounded-full text-xs", map[value])}>{STATUS_LABEL[value]}</span>;
}

// ================= PROJECT DETAIL =================
function ProjectDetail({ project, onBack, onProjectUpdated }: { project: Project; onBack: () => void; onProjectUpdated: (p: Project) => void }) {
  const [active, setActive] = useState<"overview" | "docs" | "gallery" | "parts" | "time" | "tasks">("overview");
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  useEffect(() => setStatus(project.status), [project.id]);

  const saveStatus = async () => {
    try {
      await updateProjectStatus(project.id, status);
      onProjectUpdated({ ...project, status });
    } catch (e: any) { alert(e.message || "Fehler beim Speichern"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button className="text-sm underline" onClick={onBack}>Zurück zur Übersicht</button>
        <div className="text-right">
          <div className="text-2xl font-semibold">{project.name}</div>
          <div className="text-slate-500">Projekt {project.code}</div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow">
        <div className="flex gap-2 p-2 border-b overflow-auto">
          <TabButton active={active === "overview"} onClick={() => setActive("overview")}>Übersicht</TabButton>
          <TabButton active={active === "parts"} onClick={() => setActive("parts")}>Teile</TabButton>
          <TabButton active={active === "time"} onClick={() => setActive("time")}>Stunden</TabButton>
          <TabButton active={active === "docs"} onClick={() => setActive("docs")}>Dokumente</TabButton>
          <TabButton active={active === "gallery"} onClick={() => setActive("gallery")}>Fotos</TabButton>
          <TabButton active={active === "tasks"} onClick={() => setActive("tasks")}>Aufgaben</TabButton>
        </div>
        <div className="p-4">
          {active === "overview" && <OverviewPanel project={project} status={status} setStatus={setStatus} saveStatus={saveStatus} onProjectUpdated={onProjectUpdated} />}
          {active === "parts" && <PartsPanel projectId={project.id} />}
          {active === "time" && <TimePanel projectId={project.id} />}
          {active === "docs" && <DocumentsPanel projectId={project.id} />}
          {active === "gallery" && <GalleryPanel projectId={project.id} />}
          {active === "tasks" && <TasksPanel projectId={project.id} />}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={clsx("px-3 py-2 rounded-xl whitespace-nowrap", active ? "bg-slate-900 text-white" : "hover:bg-slate-100")} onClick={onClick}>{children}</button>
  );
}

// ================= OVERVIEW (Status, Notizen, Profit) =================
function OverviewPanel({ project, status, setStatus, saveStatus, onProjectUpdated }: { project: Project; status: ProjectStatus; setStatus: (s: ProjectStatus) => void; saveStatus: () => void; onProjectUpdated: (p: Project) => void }) {
  const [notes, setNotes] = useState(project.notes ?? "");
  const [price, setPrice] = useState({
    quote_total_net: project.quote_total_net ?? 0,
    invoiced_total_net: project.invoiced_total_net ?? 0,
    hourly_rate: project.hourly_rate ?? DEFAULT_HOURLY,
  });
  const [parts, setParts] = useState<Part[]>([]);
  const [time, setTime] = useState<TimeEntry[]>([]);

  const reloadAgg = async () => {
    const [p, t] = await Promise.all([fetchParts(project.id), fetchTime(project.id)]);
    setParts(p); setTime(t);
  };
  useEffect(() => { reloadAgg(); }, [project.id]);

  const sumParts = useMemo(() => parts.reduce((s, r) => s + (Number(r.purchase_price_net||0) * Number(r.qty||1)) + Number(r.shipping_cost_net||0), 0), [parts]);
  const sumHours = useMemo(() => time.reduce((s, r) => s + (Number(r.hours)||0), 0), [time]);
  const cost = sumParts + sumHours * Number(price.hourly_rate || 0);
  const revenue = Number(price.invoiced_total_net || price.quote_total_net || 0);
  const margin = revenue - cost;

  const saveNotes = async () => {
    const p = await updateProject(project.id, { notes });
    onProjectUpdated(p);
  };
  const saveFinance = async () => {
    const p = await updateProject(project.id, price);
    onProjectUpdated(p);
  };

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="space-y-4">
        <div>
          <div className="text-sm text-slate-600 mb-1">Status</div>
          <div className="flex gap-2 items-center">
            <select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)} className="border rounded-xl px-3 py-2">
              {Object.entries(STATUS_LABEL).map(([val, label]) => (<option key={val} value={val}>{label}</option>))}
            </select>
            <button className="rounded-xl px-3 py-2 bg-blue-600 text-white" onClick={saveStatus}>Speichern</button>
          </div>
        </div>
        <div>
          <div className="text-sm text-slate-600 mb-1">Notizen</div>
          <textarea className="border rounded-xl px-3 py-2 w-full min-h-[120px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="mt-2"><button className="rounded-xl px-3 py-2 bg-blue-600 text-white" onClick={saveNotes}>Notizen speichern</button></div>
        </div>
      </div>
      <div className="space-y-3 bg-slate-50 p-4 rounded-2xl">
        <div className="text-sm text-slate-600">Profitabilität</div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">Angebot netto
            <input type="number" step="0.01" className="border rounded-xl px-3 py-2 w-full" value={price.quote_total_net} onChange={(e)=>setPrice((x)=>({...x, quote_total_net: Number(e.target.value)}))} />
          </label>
          <label className="text-sm">Abgerechnet netto (optional)
            <input type="number" step="0.01" className="border rounded-xl px-3 py-2 w-full" value={price.invoiced_total_net} onChange={(e)=>setPrice((x)=>({...x, invoiced_total_net: Number(e.target.value)}))} />
          </label>
          <label className="text-sm">Stundensatz (€)
            <input type="number" step="0.5" className="border rounded-xl px-3 py-2 w-full" value={price.hourly_rate} onChange={(e)=>setPrice((x)=>({...x, hourly_rate: Number(e.target.value)}))} />
          </label>
        </div>
        <div className="text-sm grid grid-cols-2 gap-2">
          <div className="p-2 bg-white rounded-xl border">Material+Versand: <b>{sumParts.toFixed(2)} €</b></div>
          <div className="p-2 bg-white rounded-xl border">Arbeitskosten: <b>{(sumHours * Number(price.hourly_rate||0)).toFixed(2)} €</b></div>
          <div className="p-2 bg-white rounded-xl border">Gesamtkosten: <b>{cost.toFixed(2)} €</b></div>
          <div className="p-2 bg-white rounded-xl border">Erlös: <b>{revenue.toFixed(2)} €</b></div>
          <div className={clsx("p-2 bg-white rounded-xl border col-span-2", margin>=0?"text-emerald-700":"text-rose-700")}>Deckungsbeitrag: <b>{margin.toFixed(2)} €</b></div>
        </div>
        <button className="rounded-xl px-3 py-2 bg-blue-600 text-white" onClick={saveFinance}>Finanzwerte speichern</button>
      </div>
    </div>
  );
}

// ================= DOCUMENTS =================
function DocumentsPanel({ projectId }: { projectId: string }) {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [cat, setCat] = useState<DocumentCategory>("angebot");

  const load = async () => {
    setLoading(true);
    try { setDocs(await fetchDocuments(projectId)); } catch (e: any) { alert(e.message || "Fehler beim Laden"); } finally { setLoading(false); }
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
    } catch (e: any) { alert(e.message || "Upload fehlgeschlagen"); }
    finally { setUploading(false); e.currentTarget.value = ""; }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-2 md:items-center">
        <select value={cat} onChange={(e) => setCat(e.target.value as DocumentCategory)} className="border rounded-xl px-3 py-2 w-full md:w-64">
          {DOC_CATEGORIES.filter(c=>c.key!=="fotos").map((c) => (<option key={c.key} value={c.key}>{c.label}</option>))}
        </select>
        <label className="inline-flex items-center gap-2 whitespace-nowrap">
          <div className="rounded-xl bg-blue-600 text-white px-3 py-1.5 text-sm cursor-pointer">Datei hochladen</div>
          <input type="file" className="hidden" onChange={onUpload} disabled={uploading} multiple />
        </label>
        <button className="md:ml-auto underline text-sm" onClick={load}>Aktualisieren</button>
      </div>

      <div className="border rounded-2xl overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="text-left p-3">Kategorie</th><th className="text-left p-3">Datei</th><th className="text-left p-3">Hochgeladen</th><th className="p-3"></th></tr></thead>
          <tbody>
            {loading ? (
              <tr><td className="p-4" colSpan={4}>Lädt…</td></tr>
            ) : docs.filter(d=>d.category!=="fotos").length === 0 ? (
              <tr><td className="p-4" colSpan={4}>Noch keine Dokumente.</td></tr>
            ) : (
              docs.filter(d=>d.category!=="fotos").map((d) => (
                <tr key={d.id} className="border-t">
                  <td className="p-3">{DOC_CATEGORIES.find((c)=>c.key===d.category)?.label || d.category}</td>
                  <td className="p-3">{d.filename}</td>
                  <td className="p-3">{formatDate(d.uploaded_at)}</td>
                  <td className="p-3 text-right flex gap-3 justify-end">
                    {d.file_url ? (<a className="text-blue-600 underline" href={d.file_url} target="_blank" rel="noreferrer">Öffnen</a>) : (<span className="text-slate-400">kein Link</span>)}
                    <button className="text-red-600 underline" onClick={async ()=>{ if(confirm("Dokument löschen?")){ await deleteDocumentRow(d); setDocs((xs)=>xs.filter((x)=>x.id!==d.id)); } }}>Löschen</button>
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

// ================= GALLERY (Fotos, Drag&Drop) =================
function GalleryPanel({ projectId }: { projectId: string }) {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [over, setOver] = useState(false);

  const load = async () => {
    const all = await fetchDocuments(projectId);
    setDocs(all.filter((d) => d.category === "fotos"));
  };
  useEffect(() => void load(), [projectId]);

  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    for (const f of arr) {
      const d = await uploadDocument(projectId, "fotos", f);
      const url = await signedUrl(d.storage_path);
      setDocs((xs) => [{ ...(d as any), file_url: url }, ...xs]);
    }
  };

  return (
    <div className="space-y-4">
      <div
        className={clsx("border-2 border-dashed rounded-2xl p-6 text-center bg-slate-50", over && "border-blue-500 bg-blue-50")}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={async (e) => { e.preventDefault(); setOver(false); await handleFiles(e.dataTransfer.files); }}
      >
        <div className="mb-2 font-medium">Fotos hierher ziehen oder klicken</div>
        <input type="file" multiple accept="image/*" onChange={(e)=> e.target.files && handleFiles(e.target.files)} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {docs.map((d) => (
          <div key={d.id} className="relative group border rounded-xl overflow-hidden bg-white">
            {d.file_url ? (
              <a href={d.file_url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.file_url} alt={d.filename} className="aspect-square object-cover w-full" />
              </a>
            ) : (
              <div className="aspect-square grid place-items-center text-slate-400">kein Bild</div>
            )}
            <button
              className="absolute top-2 right-2 text-xs bg-white/90 border rounded px-2 py-1 hidden group-hover:block"
              onClick={async ()=>{ if(confirm("Foto löschen?")){ await deleteDocumentRow(d); setDocs((xs)=>xs.filter((x)=>x.id!==d.id)); } }}
            >Löschen</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ================= PARTS =================
function PartsPanel({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [display, setDisplay] = useState<"netto" | "brutto">("netto");
  const [form, setForm] = useState({ name: "", qty: 1, supplier: "", purchase_price: "", sale_price: "", shipping_cost: "", price_mode: "netto" as "netto"|"brutto" });

  const load = async () => {
    setLoading(true);
    try { setRows(await fetchParts(projectId)); } finally { setLoading(false); }
  };
  useEffect(() => void load(), [projectId]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const pNet = toNet(Number(form.purchase_price || 0), form.price_mode);
    const sNet = form.sale_price ? toNet(Number(form.sale_price||0), form.price_mode) : null;
    const shipNet = form.shipping_cost ? toNet(Number(form.shipping_cost||0), form.price_mode) : null;
    const rec = await addPart(projectId, {
      name: form.name,
      qty: Number(form.qty)||1,
      supplier: form.supplier || null,
      purchase_price_net: isNaN(pNet) ? null : pNet,
      sale_price_net: sNet,
      shipping_cost_net: shipNet,
    });
    setRows((xs)=>[rec, ...xs]);
    setForm({ name: "", qty: 1, supplier: "", purchase_price: "", sale_price: "", shipping_cost: "", price_mode: form.price_mode });
  };

  const price = (net?: number | null) => {
    const n = Number(net || 0);
    return display === "netto" ? n : toGross(n);
  };

  const sumPurchase = rows.reduce((s,r)=> s + price(r.purchase_price_net) * Number(r.qty||1) + price(r.shipping_cost_net), 0);
  const sumSale = rows.reduce((s,r)=> s + price(r.sale_price_net||0) * Number(r.qty||1), 0);

  const toggle = async (row: Part, key: "ordered"|"delivered"|"installed") => {
    const next = { ...row, [key]: !row[key] } as Part;
    setRows((xs)=> xs.map((x)=> x.id===row.id ? next : x));
    await updatePart(row.id, { [key]: next[key] } as any);
  };

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="grid md:grid-cols-8 gap-3 bg-slate-50 p-3 rounded-2xl">
        <input className="border rounded-xl px-3 py-2 md:col-span-2" placeholder="Teil / Bezeichnung" value={form.name} onChange={(e)=>setForm({...form, name: e.target.value})} required />
        <input type="number" min="0" step="0.01" className="border rounded-xl px-3 py-2" placeholder="Menge" value={form.qty} onChange={(e)=>setForm({...form, qty: Number(e.target.value)})} />
        <input className="border rounded-xl px-3 py-2" placeholder="Bezugsquelle" value={form.supplier} onChange={(e)=>setForm({...form, supplier: e.target.value})} />
        <input type="number" min="0" step="0.01" className="border rounded-xl px-3 py-2" placeholder="EK" value={form.purchase_price} onChange={(e)=>setForm({...form, purchase_price: e.target.value})} />
        <input type="number" min="0" step="0.01" className="border rounded-xl px-3 py-2" placeholder="VK (optional)" value={form.sale_price} onChange={(e)=>setForm({...form, sale_price: e.target.value})} />
        <input type="number" min="0" step="0.01" className="border rounded-xl px-3 py-2" placeholder="Versand" value={form.shipping_cost} onChange={(e)=>setForm({...form, shipping_cost: e.target.value})} />
        <select className="border rounded-xl px-3 py-2" value={form.price_mode} onChange={(e)=>setForm({...form, price_mode: e.target.value as any})}>
          <option value="netto">Eingabe: Netto</option>
          <option value="brutto">Eingabe: Brutto (19%)</option>
        </select>
        <button className="rounded-xl px-4 py-2 bg-blue-600 text-white">Hinzufügen</button>
      </form>

      <div className="flex items-center gap-2">
        <div className="text-sm">Preise anzeigen:</div>
        <button className={clsx("px-3 py-1.5 rounded-xl text-sm", display==="netto"?"bg-slate-900 text-white":"hover:bg-slate-100")} onClick={()=>setDisplay("netto")}>Netto</button>
        <button className={clsx("px-3 py-1.5 rounded-xl text-sm", display==="brutto"?"bg-slate-900 text-white":"hover:bg-slate-100")} onClick={()=>setDisplay("brutto")}>Brutto (19%)</button>
      </div>

      <div className="border rounded-2xl overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-3 text-left">Teil</th>
              <th className="p-3 text-left">Menge</th>
              <th className="p-3 text-left">Bezugsquelle</th>
              <th className="p-3 text-left">EK/{display==="netto"?"netto":"brutto"}</th>
              <th className="p-3 text-left">VK/{display==="netto"?"netto":"brutto"}</th>
              <th className="p-3 text-left">Versand/{display==="netto"?"netto":"brutto"}</th>
              <th className="p-3 text-left">Bestellt</th>
              <th className="p-3 text-left">Geliefert</th>
              <th className="p-3 text-left">Montiert</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="p-4" colSpan={10}>Lädt…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="p-4" colSpan={10}>Noch keine Teile.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-3">{r.name}</td>
                  <td className="p-3">{r.qty}</td>
                  <td className="p-3">{r.supplier}</td>
                  <td className="p-3">{price(r.purchase_price_net).toFixed(2)}</td>
                  <td className="p-3">{r.sale_price_net!=null ? price(r.sale_price_net).toFixed(2) : ""}</td>
                  <td className="p-3">{price(r.shipping_cost_net).toFixed(2)}</td>
                  <td className="p-3"><input type="checkbox" checked={r.ordered} onChange={()=>toggle(r,"ordered")} /></td>
                  <td className="p-3"><input type="checkbox" checked={r.delivered} onChange={()=>toggle(r,"delivered")} /></td>
                  <td className="p-3"><input type="checkbox" checked={r.installed} onChange={()=>toggle(r,"installed")} /></td>
                  <td className="p-3 text-right">
                    <button className="text-red-600 underline" onClick={async ()=>{ if(confirm("Teil löschen?")){ await deletePart(r.id); setRows((xs)=>xs.filter((x)=>x.id!==r.id)); } }}>Löschen</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t bg-slate-50">
              <td className="p-3 font-medium" colSpan={3}>Summe</td>
              <td className="p-3 font-medium">{sumPurchase.toFixed(2)}</td>
              <td className="p-3 font-medium">{sumSale.toFixed(2)}</td>
              <td colSpan={5}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ================= TIME =================
function TimePanel({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState(1);
  const [desc, setDesc] = useState("");
  const [worker, setWorker] = useState("");
  const total = useMemo(() => entries.reduce((s, e) => s + (Number(e.hours) || 0), 0), [entries]);

  const load = async () => {
    setLoading(true);
    try { setEntries(await fetchTime(projectId)); } finally { setLoading(false); }
  };
  useEffect(() => void load(), [projectId]);

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    await addTime(projectId, { work_date: date, hours: Number(hours), description: desc, worker_name: worker });
    setDesc(""); setHours(1); setWorker("");
    await load();
  };

  return (
    <div className="space-y-4">
      <form onSubmit={onAdd} className="grid md:grid-cols-6 gap-3 bg-slate-50 p-3 rounded-2xl">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border rounded-xl px-3 py-2" />
        <input type="number" step="0.25" min="0" value={hours} onChange={(e) => setHours(Number(e.target.value))} className="border rounded-xl px-3 py-2" placeholder="Stunden" />
        <input className="border rounded-xl px-3 py-2" placeholder="Mitarbeiter" value={worker} onChange={(e)=>setWorker(e.target.value)} />
        <input className="border rounded-xl px-3 py-2 md:col-span-2" placeholder="Beschreibung (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <button className="rounded-xl px-4 py-2 bg-blue-600 text-white">Hinzufügen</button>
      </form>

      <div className="border rounded-2xl overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="text-left p-3">Datum</th><th className="text-left p-3">Stunden</th><th className="text-left p-3">Mitarbeiter</th><th className="text-left p-3">Beschreibung</th><th className="p-3"></th></tr></thead>
          <tbody>
            {loading ? (
              <tr><td className="p-4" colSpan={5}>Lädt…</td></tr>
            ) : entries.length === 0 ? (
              <tr><td className="p-4" colSpan={5}>Keine Einträge vorhanden.</td></tr>
            ) : (
              entries.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="p-3">{formatDate(e.work_date)}</td>
                  <td className="p-3">{e.hours}</td>
                  <td className="p-3">{e.worker_name}</td>
                  <td className="p-3">{e.description}</td>
                  <td className="p-3 text-right"><DeleteBtn onClick={async()=>{ if(confirm("Eintrag löschen?")){ await deleteTimeEntry(e.id); setEntries((xs)=>xs.filter((x)=>x.id!==e.id)); } }} /></td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t bg-slate-50"><td className="p-3 font-medium">Summe</td><td className="p-3 font-medium">{total.toFixed(2)}</td><td colSpan={3}></td></tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
function DeleteBtn({ onClick }: { onClick: () => void }) { return <button className="text-red-600 underline" onClick={onClick}>Löschen</button>; }

// ================= TASKS =================
function TasksPanel({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState<string | "">("");

  const load = async () => { setLoading(true); try { setRows(await fetchTasks(projectId)); } finally { setLoading(false); } };
  useEffect(() => void load(), [projectId]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const t = await addTask(projectId, { title, due_date: due || null });
    setRows((xs)=>[...xs, t]); setTitle(""); setDue("");
  };

  const toggle = async (t: Task) => {
    const next = { ...t, done: !t.done };
    setRows((xs)=> xs.map((x)=> x.id===t.id ? next : x));
    await updateTask(t.id, { done: next.done });
  };

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="grid md:grid-cols-4 gap-3 bg-slate-50 p-3 rounded-2xl">
        <input className="border rounded-xl px-3 py-2 md:col-span-2" placeholder="Aufgabe" value={title} onChange={(e)=>setTitle(e.target.value)} />
        <input type="date" className="border rounded-xl px-3 py-2" value={due} onChange={(e)=>setDue(e.target.value)} />
        <button className="rounded-xl px-4 py-2 bg-blue-600 text-white">Hinzufügen</button>
      </form>

      <div className="border rounded-2xl overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="p-3 text-left">Erledigt</th><th className="p-3 text-left">Titel</th><th className="p-3 text-left">Fällig</th><th className="p-3"></th></tr></thead>
          <tbody>
            {loading ? (
              <tr><td className="p-4" colSpan={4}>Lädt…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="p-4" colSpan={4}>Keine Aufgaben.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-3"><input type="checkbox" checked={r.done} onChange={()=>toggle(r)} /></td>
                  <td className="p-3">{r.title}</td>
                  <td className="p-3">{formatDate(r.due_date)}</td>
                  <td className="p-3 text-right"><DeleteBtn onClick={async()=>{ if(confirm("Aufgabe löschen?")){ await deleteTask(r.id); setRows((xs)=>xs.filter((x)=>x.id!==r.id)); } }} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
