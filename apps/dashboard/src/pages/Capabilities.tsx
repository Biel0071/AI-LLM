import React from 'react';
import { motion } from 'framer-motion';
import { LoadingState } from '../components/ui-states';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Zap } from 'lucide-react';

export function Capabilities() {
  const { data, isLoading } = useQuery({
    queryKey: ['capabilities'],
    queryFn: api.getCapabilities,
  });

  if (isLoading) return <LoadingState />;

  const capabilities = data?.capabilities || [
    { id: 1, name: "Image Generation", enabled: true },
    { id: 2, name: "Code Completion", enabled: true },
    { id: 3, name: "Audio Transcription", enabled: false },
  ];

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-50">Capabilities</h1>
          <p className="text-slate-400 mt-2">Configure platform capabilities.</p>
        </div>
      </div>
      <div className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-md overflow-hidden p-6">
        <ul className="space-y-4">
          {capabilities.map((cap: any) => (
            <motion.li 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              key={cap.id} 
              className="flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 transition-colors rounded-xl border border-white/10"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-slate-200 font-medium">{cap.name}</h3>
                </div>
              </div>
              <span className={`px-3 py-1 rounded-full font-medium text-xs border ${cap.enabled ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-slate-400 bg-slate-500/10 border-slate-500/20'}`}>
                {cap.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </motion.li>
          ))}
        </ul>
      </div>
    </div>
  );
}
