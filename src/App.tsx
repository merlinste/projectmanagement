import React, { useEffect, useMemo, useState } from "react";
import { createClient, SupabaseClient, Session } from "@supabase/supabase-js";

// ====== CONFIG (ENV) ======
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON);

// ====== TYPES ======
export type Project = {
  id: string;
  code: string;
  name: string;
  status: "planung" | "angebot" | "bestellt" | "montage" | "inbetriebnahme" | "abgeschlossen";
  notes: string | null;
  created_at: string;
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
  storage_path: string;
  file_url: string | null;
  uploaded_at: string;
};

export type TimeEntry = {
  id: string;
  project_id: string;
  work_date: string;
  hours: number;
  description: string | null;
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
async function signedUrl(path: string) {
  const { data, error } = await supabase.storage.from("project-files").createSignedUrl(path, 3600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

// ====== AUTH GATE ======
function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const urlOk = Boolean(SUPABASE_URL && SUPABASE_ANON);

  useEffect(() => {
    if (!urlOk) {
      setLoading(false);
      setSession(null);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, [urlOk]);

  if (loading) return <div className="p-6">Lade…</div>;

  if (!urlOk)
    return (
      <div className="p-6 max-w-xl">
        <h1 className="text-2xl font-semibold">Stellwag Klimatechnik – Projekte</h1>
        <p className="mt-3">
          Supabase-Variablen fehlen. Bitte <code>VITE_SUPABASE_URL</code> und{" "}
          <code>VITE_SUPABASE_ANON_KEY</code> setzen (siehe README).
        </p>
        {children}
      </div>
    );

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
    .select("id, code, name, status, notes, created_at")
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
async function fetchDocuments(projectId: string): Promise<DocumentRow[]> {
  const { data, error } = await supabase
    .from("documents")
    .select("id, project_id, category, filename, storage_path, uploaded_at")
    .eq("project_id", projectId)
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  const rows = (data as DocumentRow[]) || [];
  return Promise.all(
    rows.map(async (d) => ({ ...d, file_url: await signedUrl(d.storage_path) }))
  );
}
async function uploadDocument(projectId: string, category: DocumentCategory, file: File) {
  const path = `${projectId}/${category}/${Date.now()}_${file.name}`;
  const { error: upErr } = await supabase.storage.from("project-files").upload(path, file, {
    cacheControl: "3600",
    upsert: false
  });
  if (upErr) throw upErr;
  const { data, error } = await supabase
    .from("documents")
    .insert({ project_id: projectId, category, filename: file.name, storage_path: path })
    .select()
    .single();
  if (error) throw error;
  return data as DocumentRow;
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
    .insert({
      project_id: projectId,
      work_date: entry.work_date,
      hours: entry.hours,
      description: entry.description ?? null
    });
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
  return (
    <span className={clsx("px-2 py-1 rounded-full text-xs", map[value])}>
      {STATUS_LABEL[value]}
    </span>
  );
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
  const [active, setActive] = useState<"overview" | "docs" | "time">("overview");
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
        <button className="text-sm underline" onClick={onBack}>
          Zurück zur Übersicht
        </button>
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
          <TabButton active={active === "docs"} onClick={() => setActive("docs")}>
            Dokumente
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
          {active === "docs" && <DocumentsPanel projectId={project.id} />}
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

function DocumentsPanel({ projectId }: { projectId: string }) {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [cat, setCat] = useState<DocumentCategory>("angebot");

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchDocuments(projectId);
      setDocs(data);
    } catch (e: any) {
      alert(e.message || "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [projectId]);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const d = await uploadDocument(projectId, cat, file);
      const url = await signedUrl(d.storage_path);
      setDocs((xs) => [{ ...(d as any), file_url: url }, ...xs]);
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
          <input type="file" className="hidden" onChange={onUpload} disabled={uploading} />
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
                  <td className="p-3">
                    {DOC_CATEGORIES.find((c) => c.key === d.category)?.label || d.category}
                  </td>
                  <td className="p-3">{d.filename}</td>
                  <td className="p-3">{formatDate(d.uploaded_at)}</td>
                  <td className="p-3 text-right">
                    {d.file_url ? (
                      <a className="text-blue-600 underline" href={d.file_url} target="_blank" rel="noreferrer">
                        Öffnen
                      </a>
                    ) : (
                      <span className="text-slate-400">kein Link</span>
                    )}
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

function TimePanel({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState(1);
  const [desc, setDesc] = useState("");
  const total = useMemo(() => entries.reduce((sum, e) => sum + (Number(e.hours) || 0), 0), [entries]);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchTime(projectId);
      setEntries(data);
    } catch (e: any) {
      alert(e.message || "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => void load(), [projectId]);

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addTime(projectId, { work_date: date, hours: Number(hours), description: desc });
      setDesc("");
      setHours(1);
      await load();
    } catch (e: any) {
      alert(e.message || "Fehler beim Speichern");
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={onAdd} className="grid md:grid-cols-5 gap-3 bg-slate-50 p-3 rounded-2xl">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border rounded-xl px-3 py-2"
        />
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
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="p-4" colSpan={3}>
                  Lädt…
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td className="p-4" colSpan={3}>
                  Keine Einträge vorhanden.
                </td>
              </tr>
            ) : (
              entries.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="p-3">{formatDate(e.work_date)}</td>
                  <td className="p-3">{e.hours}</td>
                  <td className="p-3">{e.description}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t bg-slate-50">
              <td className="p-3 font-medium">Summe</td>
              <td className="p-3 font-medium">{total.toFixed(2)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
