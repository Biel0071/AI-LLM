import React from 'react';
import { motion } from 'framer-motion';
import { LoadingState } from '../components/ui-states';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { HardDrive } from 'lucide-react';

export function Storage() {
  const { data, isLoading } = useQuery({
    queryKey: ['storage'],
    queryFn: api.getStorage,
  });

  if (isLoading) return <LoadingState />;

  const storage = data?.storage || [
    { id: 1, name: "Primary Database", type: "PostgreSQL", size: "45 GB", status: "Healthy" },
    { id: 2, name: "Vector Store", type: "Pinecone", size: "12 GB", status: "Healthy" },
    { id: 3, name: "Log Storage", type: "Elasticsearch", size: "128 GB", status: "Warning" }
  ];

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-50">Storage</h1>
          <p className="text-slate-400 mt-2">Manage data storage and databases.</p>
        </div>
      </div>
      <div className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-md overflow-hidden p-6">
        <ul className="space-y-4">
          {storage.map((st: any) => (
            <motion.li 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              key={st.id} 
              className="flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 transition-colors rounded-xl border border-white/10"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <HardDrive className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-slate-200 font-medium">{st.name}</h3>
                  <p className="text-slate-400 text-sm">{st.type} • {st.size}</p>
                </div>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-medium border ${st.status === 'Healthy' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-amber-400 bg-amber-500/10 border-amber-500/20'}`}>
                {st.status}
              </span>
            </motion.li>
          ))}
        </ul>
      </div>
    </div>
  );
}
