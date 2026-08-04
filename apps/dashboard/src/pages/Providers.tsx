import { motion } from 'framer-motion';
import { CheckCircle2, XCircle, ExternalLink, Settings2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { LoadingState } from '../components/ui-states';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

const defaultProviders = [
  { id: 1, name: "OpenAI", status: "Connected", latency: "230ms", models: 12, cost: "$452.10", icon: "🧠" },
  { id: 2, name: "Anthropic", status: "Connected", latency: "180ms", models: 4, cost: "$120.50", icon: "🤖" },
  { id: 3, name: "Google Vertex", status: "Disconnected", latency: "-", models: 0, cost: "$0.00", icon: "🌐" },
  { id: 4, name: "Local Llama 3", status: "Connected", latency: "45ms", models: 2, cost: "Self-hosted", icon: "🦙" },
];

export function Providers() {
  const { data, isLoading } = useQuery({
    queryKey: ['providers'],
    queryFn: api.getProviders,
  });
  
  if (isLoading) return <LoadingState />;

  const providers = data?.providers || defaultProviders;

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-50">AI Providers</h1>
          <p className="text-slate-400 mt-2">Manage your LLM provider connections and routing.</p>
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-md overflow-hidden">
        <div className="grid grid-cols-6 gap-4 p-4 border-b border-white/10 text-xs font-medium text-slate-400 uppercase tracking-wider bg-black/20">
          <div className="col-span-2 pl-2">Provider</div>
          <div>Status</div>
          <div>Avg Latency</div>
          <div>Models Configured</div>
          <div>Est. Cost (MTD)</div>
        </div>
        
        <div className="divide-y divide-white/5">
          {providers.map((provider: any, i: number) => (
            <motion.div 
              key={provider.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="grid grid-cols-6 gap-4 p-4 items-center hover:bg-white/[0.02] transition-colors"
            >
              <div className="col-span-2 flex items-center gap-3 pl-2">
                <div className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-xl shadow-inner">
                  {provider.icon}
                </div>
                <span className="font-medium text-slate-200">{provider.name}</span>
              </div>
              
              <div>
                <span className={cn(
                  "flex items-center gap-1.5 text-xs font-medium w-fit px-2.5 py-1 rounded-full border",
                  provider.status === 'Connected' ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-slate-400 bg-slate-500/10 border-slate-500/20"
                )}>
                  {provider.status === 'Connected' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                  {provider.status}
                </span>
              </div>

              <div className="text-sm text-slate-300 font-mono">{provider.latency}</div>
              
              <div className="text-sm text-slate-300">
                <span className="px-2 py-1 bg-white/5 rounded-md border border-white/10">{provider.models}</span>
              </div>
              
              <div className="flex items-center justify-between pr-2">
                <span className="text-sm font-medium text-slate-200">{provider.cost}</span>
                <div className="flex gap-2">
                  <button className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-md transition-colors" title="Configure">
                    <Settings2 className="w-4 h-4" />
                  </button>
                  <button className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-md transition-colors" title="View Docs">
                    <ExternalLink className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
