import React, { useEffect, useMemo, useState } from "react";
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

  // Finanzfelder
  quote_total_net: number | null;
  hourly_rate: number | null;
  hours_planned: number | null;
  hours_actual: number | null; // optional, historisch
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
  work_date: string; // YYYY-MM-DD
  person: string | null;
  description: string | null;
  hours: number | null;
  billable: boolean | null;
  hourly_rate: number | null;
  created_at: string | null;
};

type FileEntry = { name: string; path: string; size: number; updated_at?: string };

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

const isArchived = (status?: string | null) => {
  const s = String(status ?? "").toLowerCase();
  return s === "abgeschlossen" || s === "nicht beauftragt";
};

/* ================================= Utils ================================= */
const money = (n: number) =>
  (isFinite(n) ? n : 0).toLocaleString(undefined, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  });

const num = (v: any, fallback = 0) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return isFinite(n) ? n : fallback;
};

const formatDate = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString();
};

/* =========================== Datenfunktionen: Projekte ==================== */
async function fetchProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
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
    .select("*")
    .single();
  if (error) throw error;
  return data as Project;
}

async function updateProject(id: string, patch: Partial<Project>): Promise<Project> {
  const { data, error } = await supabase
    .from("projects")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Project;
}

/* ============================ Datenfunktionen: BOM ======================== */
async function fetchBom(projectId: string): Promise<BomItem[]> {
  const { data, error } = await supabase
    .from("bom_items")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
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
  const { data, error } = await supabase
    .from("bom_items")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
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
  const { data, error } = await supabase.storage.from(bucket).list(prefix, {
    limit: 100,
    sortBy: { column: "updated_at", order: "desc" },
  });
  if (error) throw error;
  return (data ?? []).map((o) => ({
    name: o.name,
    path: `${prefix}${o.name}`,
    size: o.metadata?.size ?? 0,
    updated_at: o.updated_at ?? undefined,
  }));
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

/* ====================== Datenfunktionen: Zeit (Erfassung) ================= */
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
  const { data, error } = await supabase
    .from("time_entries")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as TimeEntry;
}

async function deleteTimeEntry(id: string) {
  const { error } = await supabase.from("time_entries").delete().eq("id", id);
  if (error) throw error;
}

/* ===================== Projektcode (YYYY-XXX) Vorschlag =================== */
async function getNextProjectCode(): Promise<string> {
  const year = new Date().getFullYear();
  const { data, error } = await supabase
    .from("projects")
    .select("code")
    .ilike("code", `${year}-%`)
    .limit(1000);
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

  // Auth initialisieren + Listener
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled) {
        setSession(data.session);
        setAuthLoading(false);
      }
    })();
    const { data: listener } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s);
    });
    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  // Projekte laden (nur wenn eingeloggt)
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

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  const handleCreated = (p: Project) => setProjects((prev) => [p, ...prev]);
  const handleUpdated = (p: Project) => setProjects((prev) => prev.map((x) => (x.id === p.id ? p : x)));

  if (authLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center text-slate-600">
        Lädt …
      </div>
    );
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
              <span className="hidden sm:inline text-sm text-slate-500 truncate max-w-[200px]">
                {session.user.email}
              </span>
              <button
                onClick={async () => {
                  await supabase.auth.signOut();
                }}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                Abmelden
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {errorMsg && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {errorMsg}
          </div>
        )}

        {!session ? (
          <AuthView />
        ) : selectedProject ? (
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

/* ================================ Home ==================================== */
function HomeDashboard(props: {
  projects: Project[];
  loading: boolean;
  onSelect: (id: string) => void;
  onCreated: (p: Project) => void;
}) {
  const { projects, loading, onSelect, onCreated } = props;
  const [projTab, setProjTab] = useState<"active" | "archive">("active");

  const activeProjects = projects.filter((p) => !isArchived(p.status));
  const archivedProjects = projects.filter((p) => isArchived(p.status));

  return (
    <div className="space-y-8">
      {/* Aktuelle Projekte + Archiv-Tabs */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-base text-slate-600">Projekte</div>
          <div className="flex gap-2">
            <TabButton active={projTab === "active"} onClick={() => setProjTab("active")}>
              Aktive ({activeProjects.length})
            </TabButton>
            <TabButton active={projTab === "archive"} onClick={() => setProjTab("archive")}>
              Archiv ({archivedProjects.length})
            </TabButton>
          </div>
        </div>

        <ProjectsTable
          projects={projTab === "active" ? activeProjects : archivedProjects}
          loading={loading}
          onSelect={onSelect}
        />
      </section>

      {/* Neues Projekt anlegen */}
      <section>
        <div className="mb-3 text-base text-slate-600">Neues Projekt anlegen</div>
        <CreateProjectForm onCreated={onCreated} />
      </section>

      {/* Fälligkeiten + Kalender */}
      <section className="grid gap-6 md:grid-cols-2">
        <DueWidget projects={activeProjects} />
        <CalendarWidget />
      </section>
    </div>
  );
}

/* ============================= ProjectsTable ============================== */
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
        Keine Projekte in diesem Tab.
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

/* ============================== CreateProject ============================= */
function CreateProjectForm(props: { onCreated: (p: Project) => void }) {
  const { onCreated } = props;
  const [form, setForm] = useState<NewProject>({
    code: "",
    name: "",
    status: "Neu",
    notes: "",
  });
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
    return () => {
      cancelled = true;
    };
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
      // Nächsten Code vorschlagen
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
        <Field label="Code">
          <div className="flex items-center gap-2">
            <input
              className="flex-1 rounded-xl border border-slate-300 px-3 py-2"
              value={form.code}
              onChange={(e) => setForm((s) => ({ ...s, code: e.target.value }))}
              required
            />
            <button
              type="button"
              onClick={recalcCode}
              className="rounded-xl border border-slate-300 px-2 py-1 text-sm"
              title="Code neu berechnen"
              disabled={codeBusy}
            >
              {codeBusy ? "…" : "↻"}
            </button>
          </div>
        </Field>
        <Field label="Name">
          <input
            className="rounded-xl border border-slate-300 px-3 py-2"
            value={form.name}
            onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
            required
          />
        </Field>
        <Field label="Status">
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
        </Field>
        <Field label="Notizen" className="md:col-span-2">
          <textarea
            className="rounded-xl border border-slate-300 px-3 py-2"
            rows={3}
            value={form.notes ?? ""}
            onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
          />
        </Field>
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

/* ============================= Projektdetails ============================= */
function ProjectDetail(props: {
  project: Project;
  onBack: () => void;
  onProjectUpdated: (p: Project) => void;
}) {
  const { project, onBack, onProjectUpdated } = props;
  const [active, setActive] = useState<"overview" | "profit" | "bom" | "files" | "photos" | "time">(
    "overview"
  );

  const [bom, setBom] = useState<BomItem[]>([]);
  const [bomLoading, setBomLoading] = useState(true);
  const reloadBom = async () => {
    setBomLoading(true);
    try {
      setBom(await fetchBom(project.id));
    } finally {
      setBomLoading(false);
    }
  };
  useEffect(() => {
    reloadBom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

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

      <div className="flex gap-2 overflow-x-auto">
        <TabButton active={active === "overview"} onClick={() => setActive("overview")}>
          Übersicht
        </TabButton>
        <TabButton active={active === "profit"} onClick={() => setActive("profit")}>
          Profitabilität
        </TabButton>
        <TabButton active={active === "bom"} onClick={() => setActive("bom")}>
          Stückliste
        </TabButton>
        <TabButton active={active === "files"} onClick={() => setActive("files")}>
          Dateien
        </TabButton>
        <TabButton active={active === "photos"} onClick={() => setActive("photos")}>
          Fotos
        </TabButton>
        <TabButton active={active === "time"} onClick={() => setActive("time")}>
          Zeit
        </TabButton>
      </div>

      {active === "overview" && (
        <OverviewPanel project={project} onProjectUpdated={onProjectUpdated} />
      )}
      {active === "profit" && (
        <ProfitabilityPanel project={project} bom={bom} refreshingBom={bomLoading} />
      )}
      {active === "bom" && (
        <BomPanel
          project={project}
          items={bom}
          loading={bomLoading}
          onChange={setBom}
          onReload={reloadBom}
        />
      )}
      {active === "files" && <FilesPanel project={project} />}
      {active === "photos" && <PhotosPanel project={project} />}
      {active === "time" && <TimePanel project={project} />}
    </div>
  );
}

function TabButton(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      className={
        "px-3 py-2 rounded-xl text-sm border " +
        (props.active
          ? "bg-blue-600 text-white border-blue-600"
          : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50")
      }
    >
      {props.children}
    </button>
  );
}

/* ====================== Übersicht (Basis + Kundendaten) =================== */
function OverviewPanel(props: { project: Project; onProjectUpdated: (p: Project) => void }) {
  const { project, onProjectUpdated } = props;
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [base, setBase] = useState({
    name: project.name ?? "",
    code: project.code ?? "",
    status: project.status ?? "",
    notes: project.notes ?? "",
  });

  const [cust, setCust] = useState({
    customer_address: project.customer_address ?? "",
    customer_email: project.customer_email ?? "",
    customer_phone: project.customer_phone ?? "",
  });

  const hasChanges =
    base.name !== (project.name ?? "") ||
    base.code !== (project.code ?? "") ||
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
      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {errorMsg}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Basisdaten */}
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
            <div className="text-xs text-slate-500">Angelegt am {formatDate(project.created_at)}</div>
          </div>
        </div>

        {/* Kundendaten */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 md:p-6 space-y-4">
          <div className="text-sm text-slate-600">Kundendaten</div>
          <div className="grid gap-3">
            <Field label="Adresse">
              <input
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
                placeholder="Straße Hausnr., PLZ Ort"
                value={cust.customer_address}
                onChange={(e) => setCust((s) => ({ ...s, customer_address: e.target.value }))}
              />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="E‑Mail">
                <input
                  type="email"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  placeholder="kunde@example.com"
                  value={cust.customer_email}
                  onChange={(e) => setCust((s) => ({ ...s, customer_email: e.target.value }))}
                />
              </Field>
              <Field label="Telefon">
                <input
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  placeholder="+49 …"
                  value={cust.customer_phone}
                  onChange={(e) => setCust((s) => ({ ...s, customer_phone: e.target.value }))}
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

/* ============================= Profitabilität ============================= */
function ProfitabilityPanel(props: {
  project: Project;
  bom: BomItem[];
  refreshingBom: boolean;
}) {
  const { project, bom, refreshingBom } = props;
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fin, setFin] = useState({
    quote_total_net: project.quote_total_net ?? 0,
    hourly_rate: project.hourly_rate ?? 0,
    hours_planned: project.hours_planned ?? 0,
    hours_actual: project.hours_actual ?? 0,
    other_costs: project.other_costs ?? 0,
    invoiced_net: project.invoiced_net ?? 0,
    payments_received: project.payments_received ?? 0,
  });

  // Zeitkosten aus Erfassung
  const [timeSum, setTimeSum] = useState<{ hours: number; cost: number }>({ hours: 0, cost: 0 });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const entries = await fetchTimeEntries(project.id);
        const hours = entries.reduce((s, e) => s + num(e.hours), 0);
        const cost = entries.reduce(
          (s, e) => s + num(e.hours) * num(e.hourly_rate ?? project.hourly_rate),
          0
        );
        if (!cancelled) setTimeSum({ hours, cost });
      } catch {
        // noop
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project.id, project.hourly_rate]);

  const bomTotal = useMemo(
    () => bom.reduce((s, it) => s + num(it.qty) * num(it.unit_price_net), 0),
    [bom]
  );

  const plannedCost = num(fin.hours_planned) * num(fin.hourly_rate) + num(bomTotal) + num(fin.other_costs);
  const actualCost = num(timeSum.cost) + num(bomTotal) + num(fin.other_costs);
  const plannedProfit = num(fin.quote_total_net) - plannedCost;
  const actualProfit = num(fin.invoiced_net) - actualCost;

  const plannedMargin = num(fin.quote_total_net) ? (plannedProfit / num(fin.quote_total_net)) * 100 : 0;
  const actualMargin = num(fin.invoiced_net) ? (actualProfit / num(fin.invoiced_net)) * 100 : 0;

  const handleSave = async () => {
    try {
      setErr(null);
      setSaving(true);
      const patch: Partial<Project> = {
        quote_total_net: num(fin.quote_total_net),
        hourly_rate: num(fin.hourly_rate),
        hours_planned: num(fin.hours_planned),
        hours_actual: num(fin.hours_actual),
        other_costs: num(fin.other_costs),
        invoiced_net: num(fin.invoiced_net),
        payments_received: num(fin.payments_received),
      };
      await updateProject(project.id, patch);
    } catch (e: any) {
      console.error(e);
      setErr(e?.message ?? "Konnte Finanzdaten nicht speichern.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {err}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 md:p-6 space-y-4">
          <div className="text-sm text-slate-600">Plan / IST</div>
          <div className="grid gap-3">
            <Field label="Angebot (netto)">
              <NumberInput
                value={fin.quote_total_net}
                onChange={(v) => setFin((s) => ({ ...s, quote_total_net: v }))}
              />
            </Field>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Stundensatz">
                <NumberInput
                  value={fin.hourly_rate}
                  onChange={(v) => setFin((s) => ({ ...s, hourly_rate: v }))}
                />
              </Field>
              <Field label="Stunden geplant">
                <NumberInput
                  value={fin.hours_planned}
                  onChange={(v) => setFin((s) => ({ ...s, hours_planned: v }))}
                />
              </Field>
              <Field label="Stunden IST (manuell)">
                <NumberInput
                  value={fin.hours_actual}
                  onChange={(v) => setFin((s) => ({ ...s, hours_actual: v }))}
                />
              </Field>
            </div>
            <Field label="Sonstige Kosten">
              <NumberInput
                value={fin.other_costs}
                onChange={(v) => setFin((s) => ({ ...s, other_costs: v }))}
              />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Rechnungen (netto)">
                <NumberInput
                  value={fin.invoiced_net}
                  onChange={(v) => setFin((s) => ({ ...s, invoiced_net: v }))}
                />
              </Field>
              <Field label="Zahlungseingänge">
                <NumberInput
                  value={fin.payments_received}
                  onChange={(v) => setFin((s) => ({ ...s, payments_received: v }))}
                />
              </Field>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 md:p-6 space-y-3">
          <div className="text-sm text-slate-600 flex items-center gap-2">
            Kennzahlen
            {refreshingBom && (
              <span className="text-xs text-slate-500">Stückliste wird aktualisiert …</span>
            )}
          </div>
          <KPI label="Zeit aus Erfassung (h)">{num(timeSum.hours).toFixed(2)}</KPI>
          <KPI label="Zeitkosten (Erfassung)">{money(timeSum.cost)}</KPI>
          <KPI label="BOM (Material)">{money(bomTotal)}</KPI>
          <KPI label="Plan-Kosten (Std geplant + BOM + sonst.)">{money(plannedCost)}</KPI>
          <KPI label="IST-Kosten (ZE + BOM + sonst.)">{money(actualCost)}</KPI>
          <KPI label="Plan-Gewinn">{money(plannedProfit)}</KPI>
          <KPI label="Plan-Marge">
            {isFinite(plannedMargin) ? plannedMargin.toFixed(1) + " %" : "—"}
          </KPI>
          <KPI label="IST-Gewinn">{money(actualProfit)}</KPI>
          <KPI label="IST-Marge">
            {isFinite(actualMargin) ? actualMargin.toFixed(1) + " %" : "—"}
          </KPI>
          <KPI label="Offen (Rechnung − Zahlung)">
            {money(num(fin.invoiced_net) - num(fin.payments_received))}
          </KPI>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          className="rounded-xl bg-blue-600 px-3 py-2 text-white disabled:opacity-50"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Speichern …" : "Speichern"}
        </button>
      </div>
    </div>
  );
}

/* =============================== Stückliste =============================== */
function BomPanel(props: {
  project: Project;
  items: BomItem[];
  loading: boolean;
  onChange: (items: BomItem[]) => void;
  onReload: () => void;
}) {
  const { project, items, loading, onChange, onReload } = props;
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const total = items.reduce((s, it) => s + num(it.qty) * num(it.unit_price_net), 0);

  const create = async () => {
    try {
      const created = await addBomItem(project.id, { item: "", qty: 1, unit_price_net: 0 });
      onChange([...items, created]);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Konnte Position nicht anlegen.");
    }
  };

  const patch = async (id: string, p: Partial<BomItem>) => {
    const optimistic = items.map((x) => (x.id === id ? ({ ...x, ...p } as BomItem) : x));
    onChange(optimistic);
    try {
      const updated = await updateBomItem(id, p);
      onChange(items.map((x) => (x.id === id ? updated : x)));
    } catch {
      onReload();
    }
  };

  const remove = async (id: string) => {
    const optimistic = items.filter((x) => x.id !== id);
    onChange(optimistic);
    try {
      await deleteBomItem(id);
    } catch {
      onReload();
    }
  };

  return (
    <div className="space-y-4">
      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {errorMsg}
        </div>
      )}

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
              <tr>
                <td className="px-4 py-3 text-slate-500" colSpan={7}>
                  Lädt …
                </td>
              </tr>
            ) : items.length ? (
              items.map((it, idx) => {
                const rowSum = num(it.qty) * num(it.unit_price_net);
                return (
                  <tr key={it.id} className="border-t border-slate-100">
                    <td className="px-4 py-2">{idx + 1}</td>
                    <td className="px-4 py-2">
                      <input
                        className="w-full rounded-xl border border-slate-300 px-2 py-1"
                        value={it.item ?? ""}
                        onChange={(e) => patch(it.id, { item: e.target.value })}
                        placeholder="Artikel / Leistung"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        className="w-full rounded-xl border border-slate-300 px-2 py-1"
                        value={it.unit ?? ""}
                        onChange={(e) => patch(it.id, { unit: e.target.value })}
                        placeholder="Stk, m, h …"
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <NumberInput small value={num(it.qty)} onChange={(v) => patch(it.id, { qty: v })} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <NumberInput small value={num(it.unit_price_net)} onChange={(v) => patch(it.id, { unit_price_net: v })} />
                    </td>
                    <td className="px-4 py-2 text-right">{money(rowSum)}</td>
                    <td className="px-4 py-2 text-right">
                      <button className="text-red-600 hover:underline" onClick={() => remove(it.id)}>
                        löschen
                      </button>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className="px-4 py-3 text-slate-500" colSpan={7}>
                  Keine Positionen angelegt.
                </td>
              </tr>
            )}
          </tbody>
          {items.length > 0 && (
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50">
                <td className="px-4 py-2" colSpan={5}>
                  Summe
                </td>
                <td className="px-4 py-2 text-right">{money(total)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="flex items-center gap-3">
        <button className="rounded-xl bg-blue-600 px-3 py-2 text-white" onClick={create}>
          Position hinzufügen
        </button>
        <button className="rounded-xl border border-slate-300 px-3 py-2" onClick={onReload}>
          Aktualisieren
        </button>
      </div>
    </div>
  );
}

/* ================================= Dateien ================================ */
function FilesPanel(props: { project: Project }) {
  const { project } = props;
  const [items, setItems] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await listBucket("files", project.id);
      setItems(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      await uploadToBucket("files", project.id, f);
    }
    await reload();
    e.currentTarget.value = "";
  };

  const onDelete = async (path: string) => {
    await removeFromBucket("files", path);
    await reload();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-600">Dateien</div>
        <label className="cursor-pointer rounded-xl bg-blue-600 px-3 py-2 text-white">
          Dateien hochladen
          <input type="file" className="hidden" multiple onChange={onUpload} />
        </label>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        {loading ? (
          <div className="text-sm text-slate-500">Lädt …</div>
        ) : items.length ? (
          <ul className="divide-y divide-slate-100">
            {items.map((f) => (
              <li key={f.path} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm">{f.name}</div>
                  <div className="text-xs text-slate-500">
                    {f.size} B • {formatDate(f.updated_at)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <a
                    className="text-blue-600 hover:underline text-sm"
                    href="#"
                    onClick={async (ev) => {
                      ev.preventDefault();
                      const url = await signedUrl("files", f.path);
                      window.open(url, "_blank");
                    }}
                  >
                    öffnen
                  </a>
                  <button className="text-red-600 hover:underline text-sm" onClick={() => onDelete(f.path)}>
                    löschen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-slate-500">Noch keine Dateien.</div>
        )}
      </div>
    </div>
  );
}

/* ================================== Fotos ================================= */
function PhotosPanel(props: { project: Project }) {
  const { project } = props;
  const [items, setItems] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await listBucket("photos", project.id);
      setItems(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      await uploadToBucket("photos", project.id, f);
    }
    await reload();
    e.currentTarget.value = "";
  };

  const onDelete = async (path: string) => {
    await removeFromBucket("photos", path);
    await reload();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-600">Foto‑Galerie</div>
        <label className="cursor-pointer rounded-xl bg-blue-600 px-3 py-2 text-white">
          Fotos hochladen
          <input type="file" accept="image/*" className="hidden" multiple onChange={onUpload} />
        </label>
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
          Lädt …
        </div>
      ) : items.length ? (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          {items.map((f) => (
            <PhotoThumb key={f.path} bucket="photos" entry={f} onDelete={() => onDelete(f.path)} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
          Noch keine Fotos vorhanden.
        </div>
      )}
    </div>
  );
}

function PhotoThumb(props: { bucket: "files" | "photos"; entry: FileEntry; onDelete: () => void }) {
  const { bucket, entry, onDelete } = props;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const u = await signedUrl(bucket, entry.path, 3600);
      if (!cancelled) setUrl(u);
    })();
    return () => {
      cancelled = true;
    };
  }, [bucket, entry.path]);

  return (
    <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-white">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={entry.name} className="w-full h-40 object-cover" />
        </a>
      ) : (
        <div className="h-40 flex items-center justify-center text-sm text-slate-500">Lädt …</div>
      )}
      <div className="absolute top-2 right-2">
        <button className="rounded-lg bg-white/90 px-2 py-1 text-xs text-red-600" onClick={onDelete}>
          löschen
        </button>
      </div>
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

  const reload = async () => {
    setLoading(true);
    try {
      const data = await fetchTimeEntries(project.id);
      setEntries(data);
    } catch (e: any) {
      setErr(e?.message ?? "Konnte Zeitbuchungen nicht laden.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const add = async () => {
    const created = await addTimeEntry(project, { hourly_rate: project.hourly_rate ?? undefined });
    setEntries((prev) => [created, ...prev]);
  };

  const patch = async (id: string, p: Partial<TimeEntry>) => {
    const optimistic = entries.map((x) => (x.id === id ? ({ ...x, ...p } as TimeEntry) : x));
    setEntries(optimistic);
    try {
      const updated = await updateTimeEntry(id, p);
      setEntries((prev) => prev.map((x) => (x.id === id ? updated : x)));
    } catch {
      reload();
    }
  };

  const remove = async (id: string) => {
    const optimistic = entries.filter((x) => x.id !== id);
    setEntries(optimistic);
    try {
      await deleteTimeEntry(id);
    } catch {
      reload();
    }
  };

  const totalHours = entries.reduce((s, e) => s + num(e.hours), 0);
  const totalCost = entries.reduce(
    (s, e) => s + num(e.hours) * num(e.hourly_rate ?? project.hourly_rate),
    0
  );

  return (
    <div className="space-y-4">
      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {err}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-600">Stundenerfassung</div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-slate-600">
            Summe: {totalHours.toFixed(2)} h • Kosten: {money(totalCost)}
          </div>
          <button className="rounded-xl bg-blue-600 px-3 py-2 text-white" onClick={add}>
            Buchung hinzufügen
          </button>
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
              <tr>
                <td className="px-4 py-3 text-slate-500" colSpan={8}>
                  Lädt …
                </td>
              </tr>
            ) : entries.length ? (
              entries.map((e) => {
                const cost = num(e.hours) * num(e.hourly_rate ?? project.hourly_rate);
                return (
                  <tr key={e.id} className="border-t border-slate-100">
                    <td className="px-4 py-2">
                      <input
                        type="date"
                        className="rounded-xl border border-slate-300 px-2 py-1"
                        value={e.work_date ?? ""}
                        onChange={(ev) => patch(e.id, { work_date: ev.target.value })}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        className="w-full rounded-xl border border-slate-300 px-2 py-1"
                        value={e.person ?? ""}
                        onChange={(ev) => patch(e.id, { person: ev.target.value })}
                        placeholder="Name"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        className="w-full rounded-xl border border-slate-300 px-2 py-1"
                        value={e.description ?? ""}
                        onChange={(ev) => patch(e.id, { description: ev.target.value })}
                        placeholder="Tätigkeit"
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <NumberInput small value={num(e.hours)} onChange={(v) => patch(e.id, { hours: v })} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <NumberInput
                        small
                        value={num(e.hourly_rate ?? project.hourly_rate)}
                        onChange={(v) => patch(e.id, { hourly_rate: v })}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        checked={!!e.billable}
                        onChange={(ev) => patch(e.id, { billable: ev.target.checked })}
                      />
                    </td>
                    <td className="px-4 py-2 text-right">{money(cost)}</td>
                    <td className="px-4 py-2 text-right">
                      <button className="text-red-600 hover:underline" onClick={() => remove(e.id)}>
                        löschen
                      </button>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className="px-4 py-3 text-slate-500" colSpan={8}>
                  Noch keine Zeitbuchungen.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <button className="rounded-xl border border-slate-300 px-3 py-2" onClick={reload}>
          Aktualisieren
        </button>
      </div>
    </div>
  );
}

/* ============================== UI-Helfer ================================= */
function Field(props: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${props.className ?? ""}`}>
      <span className="text-slate-600">{props.label}</span>
      {props.children}
    </label>
  );
}

function NumberInput(props: {
  value: number | null | undefined;
  onChange: (v: number) => void;
  small?: boolean;
}) {
  const { value, onChange, small } = props;
  return (
    <input
      inputMode="decimal"
      className={`rounded-xl border border-slate-300 px-3 py-2 text-right ${small ? "px-2 py-1" : ""}`}
      value={value ?? 0}
      onChange={(e) => onChange(num(e.target.value))}
    />
  );
}

function KPI(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
      <div className="text-sm text-slate-600">{props.label}</div>
      <div className="text-sm">{props.children}</div>
    </div>
  );
}

/* ============================== Widgets =================================== */
function DueWidget(props: { projects: Project[] }) {
  const { projects } = props;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 md:p-6">
      <div className="mb-2 text-sm text-slate-600">Fälligkeiten</div>
      <div className="text-sm text-slate-500">Keine individuellen Fälligkeiten konfiguriert.</div>
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

function CalendarWidget() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 md:p-6">
      <div className="mb-2 text-sm text-slate-600">Kalender</div>
      <div className="text-sm text-slate-500">
        Hier kann ein Kalender oder eine Timeline eingebunden werden (z. B. externe Komponente oder iCal).
      </div>
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
      setErr(null);
      setBusy(true);
      // Azure (Microsoft) OAuth – E-Mail-Scope zwingend; optional redirectTo
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "azure",
        options: {
          scopes: "email",
          redirectTo: window.location.origin, // muss in Supabase → Auth → Redirect URLs erlaubt sein
        },
      });
      // Bei Erfolg übernimmt der Browser die Redirects; busy bleibt gesetzt.
      if (error) {
        setErr(error.message);
        setBusy(false);
      }
    } catch (e: any) {
      setErr(e?.message ?? "Anmeldung fehlgeschlagen.");
      setBusy(false);
    }
  };

  const sendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
  };

  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <div className="text-base text-slate-700">Anmelden</div>

        {err && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {err}
          </div>
        )}

        {/* Microsoft-Login */}
        <button
          type="button"
          onClick={startMicrosoftLogin}
          disabled={busy}
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          Mit Microsoft anmelden
        </button>

        {/* Trenner */}
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-xs text-slate-500">oder</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        {/* Magic-Link als Alternative */}
        {sent ? (
          <div className="text-sm text-slate-600">
            Magic‑Link gesendet. Prüfe dein Postfach und klicke den Link, um dich anzumelden.
          </div>
        ) : (
          <form onSubmit={sendMagicLink} className="space-y-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-600">E‑Mail</span>
              <input
                type="email"
                required
                className="rounded-xl border border-slate-300 px-3 py-2"
                placeholder="du@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-blue-600 px-3 py-2 text-white disabled:opacity-50"
            >
              {busy ? "Sende Link …" : "Magic‑Link senden"}
            </button>
          </form>
        )}
      </div>
      {/* Der frühere Hinweistext wurde entfernt */}
    </div>
  );
}
