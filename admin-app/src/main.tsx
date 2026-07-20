import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient, Session } from "@supabase/supabase-js";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Database,
  KeyRound,
  RefreshCcw,
  Search,
  Shield,
  UserCog,
} from "lucide-react";
import "./styles.css";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

type Lab = {
  id: string;
  name: string;
  code: string;
  city: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  plan_status: "trial" | "active" | "inactive" | "suspended";
  active_upto: string | null;
  created_at: string;
};

type LabUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  lab_id: string | null;
};

type ActionResult = {
  success?: boolean;
  message?: string;
  stats?: Record<string, unknown>;
  [key: string]: unknown;
};

const FIXED_ADMIN_USERS = [
  {
    id: "89d8a7f7-c932-46b3-97a8-d45c7a13145d",
    name: "dr Anand",
    email: "anprohealthtech@gmail.com",
  },
  {
    id: "752fc6ee-63d0-425f-98bd-fc4ac6bf0ff9",
    name: "accucell12",
    email: "accucell12@gmail.com",
  },
  {
    id: null,
    name: "accucell",
    email: "accucell@gmail.com",
  },
];

const FRONTEND_ALLOWED_ADMIN_EMAILS = new Set([
  "anprohealthtech@gmail.com",
  "accucell12@gmail.com",
  "accucell@gmail.com",
]);

const formatDate = (value?: string | null) => {
  if (!value) return "No expiry";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

const daysRemaining = (value?: string | null) => {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86400000);
};

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [labs, setLabs] = useState<Lab[]>([]);
  const [users, setUsers] = useState<LabUser[]>([]);
  const [selectedLabId, setSelectedLabId] = useState("");
  const [fixedUserLabIds, setFixedUserLabIds] = useState<Record<string, string>>({});
  const [copySourceLabId, setCopySourceLabId] = useState("");
  const [copyCategory, setCopyCategory] = useState("");
  const [copyDepartment, setCopyDepartment] = useState("");
  const [copySearch, setCopySearch] = useState("");
  const [copyOverwriteExisting, setCopyOverwriteExisting] = useState(false);
  const [copyBillingItemTypes, setCopyBillingItemTypes] = useState(true);
  const [search, setSearch] = useState("");
  const [trialDays, setTrialDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [lastResult, setLastResult] = useState<ActionResult | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const selectedLab = useMemo(
    () => labs.find((lab) => lab.id === selectedLabId) || null,
    [labs, selectedLabId],
  );
  const sessionEmail = session?.user.email?.toLowerCase() || "";
  const isFrontendAllowed = session ? FRONTEND_ALLOWED_ADMIN_EMAILS.has(sessionEmail) : false;

  const filteredLabs = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return labs;
    return labs.filter((lab) =>
      [lab.name, lab.code, lab.city, lab.phone, lab.email]
        .filter(Boolean)
        .some((part) => String(part).toLowerCase().includes(needle)),
    );
  }, [labs, search]);

  const trialLabs = useMemo(
    () => labs.filter((lab) => lab.plan_status === "trial"),
    [labs],
  );

  const callAdmin = async <T,>(action: string, payload: Record<string, unknown> = {}) => {
    if (!supabase) throw new Error("Missing Supabase environment variables");
    setError("");
    setMessage("");
    setLastResult(null);

    const { data, error: fnError } = await supabase.functions.invoke("admin-ops", {
      body: { action, ...payload },
    });

    if (fnError) throw new Error(fnError.message);
    const result = data as T;
    setLastResult(result as ActionResult);
    return result;
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await callAdmin<{ labs: Lab[]; users: LabUser[] }>("overview");
      setLabs(data.labs || []);
      setUsers(data.users || []);
      if (!selectedLabId && data.labs?.length) setSelectedLabId(data.labs[0].id);
      setMessage("Overview refreshed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session) void refresh();
  }, [session]);

  useEffect(() => {
    if (users.length === 0) return;
    setFixedUserLabIds((current) => {
      const next = { ...current };
      for (const fixedUser of FIXED_ADMIN_USERS) {
        const key = fixedUser.id || fixedUser.email;
        if (!next[key]) {
          const liveUser = users.find((user) =>
            fixedUser.id ? user.id === fixedUser.id : user.email.toLowerCase() === fixedUser.email,
          );
          if (liveUser?.lab_id) next[key] = liveUser.lab_id;
        }
      }
      return next;
    });
  }, [users]);

  useEffect(() => {
    if (!selectedLabId || copySourceLabId !== selectedLabId) return;
    const fallbackSource = labs.find((lab) => lab.id !== selectedLabId);
    setCopySourceLabId(fallbackSource?.id || "");
  }, [copySourceLabId, labs, selectedLabId]);

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setError("");
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  if (!supabase) {
    return (
      <main className="login-shell">
        <div className="login-card">
          <div className="brand-mark">
            <AlertCircle size={28} />
          </div>
          <h1>Missing Netlify env</h1>
          <p>Add these variables in this Netlify site, then redeploy:</p>
          <pre>{`VITE_SUPABASE_URL=https://api.limsapp.in
VITE_SUPABASE_ANON_KEY=your-anon-key`}</pre>
        </div>
      </main>
    );
  }

  const runAction = async (label: string, action: string, payload: Record<string, unknown>) => {
    if (!selectedLabId && action !== "overview") {
      setError("Select a lab first.");
      return;
    }
    setLoading(true);
    try {
      const result = await callAdmin<ActionResult>(action, payload);
      setMessage(result.message || `${label} completed.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const assignUserToLab = async (userId: string) => {
    const fixedUser = FIXED_ADMIN_USERS.find((user) => (user.id || user.email) === userId);
    const labId = fixedUserLabIds[userId];
    if (!labId) {
      setError("Select a lab for this user first.");
      return;
    }
    await runAction("Admin user reassignment", "assign_users_to_lab", {
      lab_id: labId,
      ...(fixedUser?.id ? { user_ids: [fixedUser.id] } : { user_emails: [fixedUser?.email || userId] }),
    });
  };

  const assignAllConfiguredUsers = async () => {
    const configured = FIXED_ADMIN_USERS.filter((user) => fixedUserLabIds[user.id || user.email]);
    if (configured.length === 0) {
      setError("Select at least one lab assignment.");
      return;
    }

    setLoading(true);
    try {
      for (const fixedUser of configured) {
        const key = fixedUser.id || fixedUser.email;
        await callAdmin<ActionResult>("assign_users_to_lab", {
          lab_id: fixedUserLabIds[key],
          ...(fixedUser.id ? { user_ids: [fixedUser.id] } : { user_emails: [fixedUser.email] }),
        });
      }
      setMessage(`Updated ${configured.length} user assignment(s).`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const copyCatalogToSelectedLab = async () => {
    if (!copySourceLabId) {
      setError("Select a source lab first.");
      return;
    }
    if (!selectedLabId) {
      setError("Select a target lab first.");
      return;
    }
    if (copySourceLabId === selectedLabId) {
      setError("Source and target labs must be different.");
      return;
    }

    await runAction("Catalog copy", "copy_lab_catalog", {
      source_lab_id: copySourceLabId,
      target_lab_id: selectedLabId,
      category: copyCategory.trim() || undefined,
      department: copyDepartment.trim() || undefined,
      search: copySearch.trim() || undefined,
      overwrite_existing: copyOverwriteExisting,
      include_billing_item_types: copyBillingItemTypes,
    });
  };

  if (!session) {
    return (
      <main className="login-shell">
        <form className="login-card" onSubmit={signIn}>
          <div className="brand-mark">
            <Shield size={28} />
          </div>
          <h1>LIMS Admin</h1>
          <p>Sign in with an owner email allowed in `ADMIN_EMAILS`.</p>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" />
          </label>
          <label>
            Password
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" />
          </label>
          {error && <div className="notice error"><AlertCircle size={16} />{error}</div>}
          <button type="submit" disabled={loading}>{loading ? "Signing in..." : "Sign in"}</button>
        </form>
      </main>
    );
  }

  if (!isFrontendAllowed) {
    return (
      <main className="login-shell">
        <div className="login-card">
          <div className="brand-mark">
            <Shield size={28} />
          </div>
          <h1>Access blocked</h1>
          <p>{sessionEmail || "This user"} is not allowed to use this admin app.</p>
          <div className="notice error">
            <AlertCircle size={16} />
            Allowed admin emails are hardcoded in this frontend and must also be set in the `ADMIN_EMAILS` Supabase secret.
          </div>
          <button type="button" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">Service console</span>
          <h1>LIMS Admin</h1>
        </div>
        <div className="top-actions">
          <button className="secondary" onClick={refresh} disabled={loading}>
            <RefreshCcw size={16} /> Refresh
          </button>
          <button className="secondary" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>

      {(message || error) && (
        <div className={`notice ${error ? "error" : "success"}`}>
          {error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          {error || message}
        </div>
      )}

      <section className="stats-grid">
        <div className="stat"><Database size={20} /><span>Labs</span><strong>{labs.length}</strong></div>
        <div className="stat"><Activity size={20} /><span>Trial</span><strong>{trialLabs.length}</strong></div>
        <div className="stat"><UserCog size={20} /><span>Users</span><strong>{users.length}</strong></div>
      </section>

      <section className="workspace">
        <aside className="lab-list">
          <div className="searchbox">
            <Search size={16} />
            <input placeholder="Search labs" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <div className="labs-scroll">
            {filteredLabs.map((lab) => {
              const remaining = daysRemaining(lab.active_upto);
              return (
                <button
                  key={lab.id}
                  className={`lab-row ${selectedLabId === lab.id ? "active" : ""}`}
                  onClick={() => setSelectedLabId(lab.id)}
                >
                  <span>
                    <strong>{lab.name}</strong>
                    <small>{lab.code} {lab.city ? `| ${lab.city}` : ""}</small>
                  </span>
                  <em className={lab.plan_status}>{remaining == null ? lab.plan_status : `${remaining}d`}</em>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="panel">
          {selectedLab ? (
            <>
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">{selectedLab.code}</span>
                  <h2>{selectedLab.name}</h2>
                  <p>{selectedLab.email || "No email"} | {selectedLab.phone || "No phone"}</p>
                </div>
                <span className={`status ${selectedLab.plan_status}`}>{selectedLab.plan_status}</span>
              </div>

              <div className="details-grid">
                <div><span>Created</span><strong>{formatDate(selectedLab.created_at)}</strong></div>
                <div><span>Active upto</span><strong>{formatDate(selectedLab.active_upto)}</strong></div>
                <div><span>Lab ID</span><strong className="mono">{selectedLab.id}</strong></div>
              </div>

              <div className="tool-grid">
                <div className="tool-card">
                  <h3><KeyRound size={18} /> Move fixed admins to labs</h3>
                  <div className="fixed-users">
                    {FIXED_ADMIN_USERS.map((fixedUser) => {
                      const key = fixedUser.id || fixedUser.email;
                      const liveUser = users.find((user) =>
                        fixedUser.id ? user.id === fixedUser.id : user.email.toLowerCase() === fixedUser.email,
                      );
                      const currentLab = labs.find((lab) => lab.id === liveUser?.lab_id);
                      return (
                        <div key={key} className="fixed-user-row">
                          <strong>{fixedUser.name}</strong>
                          <span>{fixedUser.email}</span>
                          <small>Current lab: {currentLab?.name || liveUser?.lab_id || "not loaded"}</small>
                          <select
                            value={fixedUserLabIds[key] || ""}
                            onChange={(event) =>
                              setFixedUserLabIds((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }))
                            }
                          >
                            <option value="">Select target lab</option>
                            {labs.map((lab) => (
                              <option key={lab.id} value={lab.id}>
                                {lab.name} ({lab.code})
                              </option>
                            ))}
                          </select>
                          <button className="secondary" onClick={() => assignUserToLab(key)} disabled={loading}>
                            Update this user
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={assignAllConfiguredUsers} disabled={loading}>Apply configured assignments</button>
                </div>

                <div className="tool-card">
                  <h3><Activity size={18} /> Trial and status</h3>
                  <label>
                    Extend by days
                    <input type="number" min={1} max={365} value={trialDays} onChange={(event) => setTrialDays(Number(event.target.value))} />
                  </label>
                  <div className="button-row">
                    <button onClick={() => runAction("Trial extension", "extend_trial", { lab_id: selectedLabId, days: trialDays })} disabled={loading}>Extend trial</button>
                    <button className="secondary" onClick={() => runAction("Activated lab", "set_lab_status", { lab_id: selectedLabId, plan_status: "active" })} disabled={loading}>Mark active</button>
                  </div>
                </div>

                <div className="tool-card wide">
                  <h3><Database size={18} /> Catalog repairs</h3>
                  <p>Sync section headings, sort order, missing group analytes, report sections, and calculated metadata from the global catalog. Dependency repair replaces lab-scoped dependency rows from fixed global dependencies.</p>
                  <div className="button-row">
                    <button onClick={() => runAction("Catalog sync", "sync_catalog", { lab_id: selectedLabId })} disabled={loading}>Sync catalog from global</button>
                    <button className="secondary" onClick={() => runAction("Section order repair", "repair_section_order", { lab_id: selectedLabId })} disabled={loading}>Repair section/order</button>
                    <button className="secondary" onClick={() => runAction("Dependency repair", "repair_dependencies", { lab_id: selectedLabId })} disabled={loading}>Repair analyte dependencies</button>
                  </div>
                </div>

                <div className="tool-card wide">
                  <h3><Database size={18} /> Copy catalog between labs</h3>
                  <p>Copies test groups, linked lab analytes, test-analyte layout, report sections, collection charges on tests, and optional extra charge types from a source lab into the selected target lab.</p>
                  <div className="copy-grid">
                    <label>
                      Source lab
                      <select value={copySourceLabId} onChange={(event) => setCopySourceLabId(event.target.value)}>
                        <option value="">Select source lab</option>
                        {labs.filter((lab) => lab.id !== selectedLabId).map((lab) => (
                          <option key={lab.id} value={lab.id}>
                            {lab.name} ({lab.code})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Category filter
                      <input placeholder="Optional, e.g. Radiology" value={copyCategory} onChange={(event) => setCopyCategory(event.target.value)} />
                    </label>
                    <label>
                      Department filter
                      <input placeholder="Optional, e.g. Radiology" value={copyDepartment} onChange={(event) => setCopyDepartment(event.target.value)} />
                    </label>
                    <label>
                      Search filter
                      <input placeholder="Optional name/code text" value={copySearch} onChange={(event) => setCopySearch(event.target.value)} />
                    </label>
                  </div>
                  <div className="check-row">
                    <label>
                      <input type="checkbox" checked={copyBillingItemTypes} onChange={(event) => setCopyBillingItemTypes(event.target.checked)} />
                      Copy extra charge types
                    </label>
                    <label>
                      <input type="checkbox" checked={copyOverwriteExisting} onChange={(event) => setCopyOverwriteExisting(event.target.checked)} />
                      Overwrite matching target tests/analytes/sections
                    </label>
                  </div>
                  <button onClick={copyCatalogToSelectedLab} disabled={loading || !copySourceLabId || !selectedLabId}>
                    Copy into {selectedLab.name}
                  </button>
                </div>
              </div>

              <h3 className="section-title">Users in selected lab</h3>
              <div className="user-table">
                {users.filter((user) => user.lab_id === selectedLabId).map((user) => (
                  <div key={user.id} className="user-row">
                    <strong>{user.name}</strong>
                    <span>{user.email}</span>
                    <em>{user.role}</em>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="empty">No lab selected.</div>
          )}
        </section>
      </section>

      {lastResult && (
        <section className="result-panel">
          <h3>Last function response</h3>
          <pre>{JSON.stringify(lastResult, null, 2)}</pre>
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
