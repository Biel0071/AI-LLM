import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Overview } from './pages/Overview';
import { Projects } from './pages/Projects';
import { Providers } from './pages/Providers';
import { Models } from './pages/Models';
import { Capabilities } from './pages/Capabilities';
import { Logs } from './pages/Logs';
import { Storage } from './pages/Storage';

// Note: Create placeholder components for the rest of the routes
const Placeholder = ({ name }: { name: string }) => (
  <div className="flex items-center justify-center h-full text-slate-400">
    {name} Page - Coming Soon
  </div>
);

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="projects" element={<Projects />} />
          <Route path="providers" element={<Providers />} />
          <Route path="models" element={<Models />} />
          <Route path="capabilities" element={<Capabilities />} />
          <Route path="logs" element={<Logs />} />
          <Route path="storage" element={<Storage />} />
          <Route path="keys" element={<Placeholder name="API Keys" />} />
          <Route path="playground" element={<Placeholder name="Playground" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
