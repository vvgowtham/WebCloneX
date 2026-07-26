import { BrowserRouter, Routes, Route, NavLink, Link } from 'react-router-dom';
import { Boxes, History, Layers, BookOpen, Github } from 'lucide-react';
import Studio from './pages/Studio';
import HistoryPage from './pages/HistoryPage';
import Mapping from './pages/Mapping';
import Docs from './pages/Docs';

const NAV = [
  { to: '/', label: 'Studio', icon: Boxes, end: true },
  { to: '/history', label: 'History', icon: History },
  { to: '/mapping', label: 'Widget Map', icon: Layers },
  { to: '/docs', label: 'Docs', icon: BookOpen },
];

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid-lines min-h-screen">
      <header className="sticky top-0 z-40 border-b border-edge bg-void/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-volt font-display text-sm font-black text-void">
              EL
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-cyan" />
            </span>
            <span className="leading-none">
              <span className="block font-display text-[17px] font-bold tracking-tight">
                WebCloner<span className="text-volt">ELX</span>
              </span>
              <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-dim">
                site → elementor json
              </span>
            </span>
          </Link>

          <nav className="ml-auto flex items-center gap-1 overflow-x-auto">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium transition ${
                    isActive ? 'bg-volt/12 text-volt' : 'text-muted hover:bg-white/5 hover:text-ink'
                  }`
                }
              >
                <Icon size={15} />
                <span className="hidden sm:inline">{label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>

      <footer className="mt-14 border-t border-edge">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-dim sm:flex-row sm:items-center sm:px-6">
          <span className="font-mono">WebClonerELX v1.0 · Elementor template generator</span>
          <span className="sm:ml-auto flex items-center gap-1.5 font-mono">
            <Github size={12} /> Export schema v0.4 · compatible with Elementor 3.x
          </span>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<Studio />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/mapping" element={<Mapping />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="*" element={<Studio />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}
