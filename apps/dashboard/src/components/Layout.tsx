import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
  LayoutDashboard, 
  FolderGit2, 
  Cpu, 
  Key, 
  TerminalSquare, 
  Activity, 
  Menu,
  Bell,
  Search,
  Settings
} from 'lucide-react';
import { cn } from '../lib/utils';

const navItems = [
  { name: 'Overview', path: '/', icon: LayoutDashboard },
  { name: 'Projects', path: '/projects', icon: FolderGit2 },
  { name: 'Providers', path: '/providers', icon: Cpu },
  { name: 'API Keys', path: '/keys', icon: Key },
  { name: 'Playground', path: '/playground', icon: TerminalSquare },
  { name: 'Logs', path: '/logs', icon: Activity },
];

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="flex h-screen overflow-hidden bg-[#09090b] text-slate-50 font-sans selection:bg-indigo-500/30">
      {/* Background Ambient Glows */}
      <div className="pointer-events-none fixed inset-0 flex justify-center z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/20 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-fuchsia-600/20 blur-[120px] rounded-full" />
      </div>

      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: sidebarOpen ? 260 : 80 }}
        className="relative z-20 flex flex-col h-full bg-white/[0.02] border-r border-white/5 backdrop-blur-xl transition-all duration-300"
      >
        <div className="flex items-center justify-between p-4 h-16 border-b border-white/5">
          {sidebarOpen && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 font-bold text-xl tracking-tight">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <LayoutDashboard className="w-4 h-4 text-white" />
              </div>
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-slate-100 to-slate-400">API</span> Enterprise
            </motion.div>
          )}
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 rounded-md hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
            <Menu className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.name}
              to={item.path}
              className={({ isActive }) => cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative",
                isActive ? "bg-indigo-500/10 text-indigo-300 font-medium" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
              )}
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.div 
                      layoutId="activeNav" 
                      className="absolute left-0 w-1 h-6 bg-indigo-500 rounded-r-full"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    />
                  )}
                  <item.icon className={cn("w-5 h-5 transition-colors", isActive ? "text-indigo-400" : "group-hover:text-slate-300")} />
                  {sidebarOpen && <span>{item.name}</span>}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        
        <div className="p-4 border-t border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-slate-800 to-slate-700 border border-white/10 flex items-center justify-center">
              <span className="text-sm font-medium">JD</span>
            </div>
            {sidebarOpen && (
              <div className="flex flex-col">
                <span className="text-sm font-medium">John Doe</span>
                <span className="text-xs text-slate-500">Admin</span>
              </div>
            )}
          </div>
        </div>
      </motion.aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        {/* Header */}
        <header className="h-16 flex items-center justify-between px-8 bg-black/20 backdrop-blur-md border-b border-white/5 sticky top-0 z-30">
          <div className="flex items-center w-96 bg-white/5 border border-white/10 rounded-full px-4 py-2 focus-within:ring-2 ring-indigo-500/50 focus-within:border-indigo-500/50 transition-all">
            <Search className="w-4 h-4 text-slate-400 mr-2" />
            <input 
              type="text" 
              placeholder="Search projects, keys, logs..." 
              className="bg-transparent border-none outline-none text-sm w-full text-slate-200 placeholder:text-slate-500"
            />
          </div>
          <div className="flex items-center gap-4">
            <button className="relative p-2 rounded-full hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-indigo-500 rounded-full shadow-[0_0_8px_rgba(99,102,241,0.8)]"></span>
            </button>
            <button className="p-2 rounded-full hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
