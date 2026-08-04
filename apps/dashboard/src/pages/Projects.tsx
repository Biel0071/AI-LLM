import React from 'react';
import { motion } from 'framer-motion';
import { FolderGit2, Plus, MoreHorizontal, Activity } from 'lucide-react';
import { cn } from '../lib/utils';
import { LoadingState } from '../components/ui-states';

const projects = [
  { id: 1, name: "Production Gateway", status: "Active", reqs: "840K", keys: 12, env: "Production" },
  { id: 2, name: "Mobile App Backend", status: "Active", reqs: "320K", keys: 4, env: "Production" },
  { id: 3, name: "Staging Environment", status: "Warning", reqs: "45K", keys: 8, env: "Staging" },
  { id: 4, name: "Dev Sandbox", status: "Active", reqs: "2K", keys: 2, env: "Development" },
  { id: 5, name: "Internal Tools AI", status: "Offline", reqs: "0", keys: 1, env: "Internal" },
];

export function Projects() {
  const isLoading = false;
  
  if (isLoading) return <LoadingState />;

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-50">Projects</h1>
          <p className="text-slate-400 mt-2">Manage your API environments and applications.</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl font-medium transition-all shadow-lg shadow-indigo-500/20 active:scale-95">
          <Plus className="w-4 h-4" />
          New Project
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {projects.map((project, i) => (
          <motion.div
            key={project.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="group bg-white/5 border border-white/10 hover:border-indigo-500/30 rounded-2xl p-6 backdrop-blur-md transition-all duration-300 relative overflow-hidden"
          >
            {/* Hover Glow */}
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/0 via-transparent to-indigo-500/0 group-hover:from-indigo-500/5 group-hover:to-fuchsia-500/5 transition-all duration-500" />
            
            <div className="relative z-10">
              <div className="flex justify-between items-start mb-6">
                <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <FolderGit2 className="w-6 h-6 text-indigo-400" />
                </div>
                <button className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-white/10 transition-colors">
                  <MoreHorizontal className="w-5 h-5" />
                </button>
              </div>
              
              <h3 className="text-xl font-medium text-slate-100 mb-1">{project.name}</h3>
              <div className="flex items-center gap-3 mb-6">
                <span className={cn(
                  "flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border",
                  project.status === 'Active' ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" :
                  project.status === 'Warning' ? "text-amber-400 bg-amber-500/10 border-amber-500/20" :
                  "text-slate-400 bg-slate-500/10 border-slate-500/20"
                )}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                  {project.status}
                </span>
                <span className="text-xs text-slate-500 font-medium px-2 py-0.5 bg-white/5 rounded-full border border-white/5">
                  {project.env}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/10">
                <div>
                  <p className="text-xs text-slate-500 mb-1">Requests (30d)</p>
                  <p className="text-sm font-medium text-slate-200 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-indigo-400" />
                    {project.reqs}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">API Keys</p>
                  <p className="text-sm font-medium text-slate-200">{project.keys} Active</p>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
