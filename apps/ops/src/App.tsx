import { useEffect, useState, type ReactNode } from "react";
import { api, type Me } from "./api";
import { useRoute } from "./hooks";
import { Link, StepUpProvider, fmtTime } from "./ui";
import { SignIn } from "./pages/SignIn";
import { Dashboard } from "./pages/Dashboard";
import { Queues } from "./pages/Queues";
import { Jobs } from "./pages/Jobs";
import { JobDetailPage } from "./pages/JobDetail";
import { Workers } from "./pages/Workers";
import { Schedules } from "./pages/Schedules";
import { Audit } from "./pages/Audit";

const NAV = [
  ["", "Dashboard"],
  ["queues", "Queues"],
  ["jobs", "Jobs"],
  ["workers", "Workers"],
  ["schedules", "Schedules"],
  ["audit", "Audit"],
] as const;

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshMe = async () => {
    try {
      setMe(await api.get<Me>("me"));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    void refreshMe();
  }, []);

  if (error) return <Centered><p className="text-sm text-red-600">{error}</p></Centered>;
  if (!me) return <Centered><p className="text-sm text-zinc-500">Loading…</p></Centered>;
  if (!me.ops) return <SignIn me={me} onSignedIn={refreshMe} />;

  return (
    <StepUpProvider>
      <Shell me={me} onSignedOut={refreshMe} onUnauthorized={refreshMe} />
    </StepUpProvider>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center p-4">{children}</div>;
}

function Shell({ me, onSignedOut, onUnauthorized }: { me: Me; onSignedOut: () => void; onUnauthorized: () => void }) {
  const { path } = useRoute();
  const [section, ...rest] = path.split("/");
  const isAdmin = me.operator?.role === "admin";

  const signOut = async () => {
    await api.post("logout").catch(() => {});
    onSignedOut();
  };

  let page: ReactNode;
  switch (section) {
    case "":
      page = <Dashboard onUnauthorized={onUnauthorized} />;
      break;
    case "queues":
      page = <Queues isAdmin={isAdmin} onUnauthorized={onUnauthorized} />;
      break;
    case "jobs":
      page = rest.length >= 2
        ? <JobDetailPage queue={decodeURIComponent(rest[0])} id={rest[1]} isAdmin={isAdmin} onUnauthorized={onUnauthorized} />
        : <Jobs isAdmin={isAdmin} onUnauthorized={onUnauthorized} />;
      break;
    case "workers":
      page = <Workers onUnauthorized={onUnauthorized} />;
      break;
    case "schedules":
      page = <Schedules onUnauthorized={onUnauthorized} />;
      break;
    case "audit":
      page = <Audit onUnauthorized={onUnauthorized} />;
      break;
    default:
      page = <p className="text-sm text-zinc-500">Not found.</p>;
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-52 shrink-0 border-r border-zinc-200 bg-white px-3 py-5">
        <div className="mb-6 px-2">
          <div className="text-sm font-semibold text-brand-700">Hisaabo Ops</div>
          <div className="text-xs text-zinc-500">Queues &amp; workers</div>
        </div>
        <nav className="space-y-1">
          {NAV.map(([to, label]) => (
            <Link
              key={to}
              to={to}
              className={`block rounded-lg px-2 py-1.5 text-sm ${section === to ? "bg-brand-50 font-medium text-brand-700" : "text-zinc-700 hover:bg-zinc-100"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-4 border-b border-zinc-200 bg-white px-6 py-3 text-sm">
          <span className="text-zinc-600">
            {me.operator?.email}
            <span className={`badge ml-2 ${isAdmin ? "bg-brand-100 text-brand-700" : "bg-zinc-100 text-zinc-700"}`}>{me.operator?.role}</span>
          </span>
          <span className="text-xs text-zinc-500">Session until {fmtTime(me.ops?.expiresAt)}</span>
          <button className="btn btn-secondary" onClick={() => void signOut()}>
            Sign out
          </button>
        </header>
        <main className="min-w-0 flex-1 p-6">{page}</main>
      </div>
    </div>
  );
}
