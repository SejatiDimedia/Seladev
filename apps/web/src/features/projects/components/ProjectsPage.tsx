import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useOrgStore } from '../../../stores/org.store';
import { apiClient } from '../../../lib/api-client';
import { Folder, Plus, Loader2, ArrowRight, Layers, LayoutGrid, Calendar } from 'lucide-react';

interface Project {
  id: string;
  name: string;
  description: string;
  orgId: string;
  createdAt: string;
}

export function ProjectsPage() {
  const activeOrgId = useOrgStore((state) => state.activeOrgId);
  const organizations = useOrgStore((state) => state.organizations);
  const activeOrg = organizations.find((o) => o.id === activeOrgId);

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchProjects = async () => {
    if (!activeOrgId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get(`/organizations/${activeOrgId}/projects`);
      setProjects(response.data.data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch projects.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, [activeOrgId]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !activeOrgId) return;

    setCreateLoading(true);
    setCreateError(null);
    try {
      const response = await apiClient.post(`/organizations/${activeOrgId}/projects`, {
        name,
        description,
      });
      setProjects((prev) => [...prev, response.data.data]);
      setShowCreateModal(false);
      setName('');
      setDescription('');
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create project.');
    } finally {
      setCreateLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-3">
            <LayoutGrid className="w-8 h-8 text-indigo-400" />
            Projects
          </h1>
          <p className="text-sm text-neutral-400 leading-normal mt-1">
            Overview of microservices and deployment pipelines in <span className="text-indigo-300 font-semibold">{activeOrg?.name}</span>.
          </p>
        </div>

        <button
          onClick={() => {
            setCreateError(null);
            setShowCreateModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white font-bold rounded-xl text-xs transition-all shadow-lg shadow-indigo-500/20"
        >
          <Plus className="w-4.5 h-4.5" />
          Create Project
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 font-medium">
          {error}
        </div>
      )}

      {/* Project Grid */}
      {loading && projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-neutral-500 gap-2">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
          <span className="text-xs">Loading projects...</span>
        </div>
      ) : projects.length === 0 ? (
        <div className="glass-card p-12 rounded-3xl border border-white/5 text-center max-w-lg mx-auto space-y-6 my-10">
          <Folder className="w-12 h-12 text-indigo-400/50 mx-auto" />
          <h3 className="text-lg font-bold text-white">No Projects Found</h3>
          <p className="text-xs text-neutral-400 leading-relaxed font-light">
            You don't have any projects in this organization workspace. Create a project to orchestrate environment settings and run deployment pipelines.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-6 py-3 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold rounded-xl text-xs transition-all"
          >
            Create Your First Project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <Link
              key={project.id}
              to={`/projects/${project.id}`}
              className="glass-card p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-all flex flex-col justify-between group relative overflow-hidden"
            >
              {/* Subtle hover background highlight */}
              <div className="absolute inset-0 bg-indigo-500/[0.01] opacity-0 group-hover:opacity-100 transition-opacity"></div>
              
              <div className="space-y-4">
                <div className="flex justify-between items-start">
                  <div className="p-3 bg-white/5 rounded-xl border border-white/5 flex items-center justify-center text-indigo-400 group-hover:text-indigo-300 transition-colors">
                    <Folder className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] text-neutral-500 font-mono flex items-center gap-1.5">
                    <Calendar className="w-3 h-3" />
                    {new Date(project.createdAt).toLocaleDateString()}
                  </span>
                </div>

                <div className="space-y-2">
                  <h3 className="font-bold text-lg text-white group-hover:text-indigo-300 transition-colors">
                    {project.name}
                  </h3>
                  <p className="text-neutral-400 text-xs leading-relaxed font-light line-clamp-2">
                    {project.description || 'No description provided.'}
                  </p>
                </div>
              </div>

              <div className="border-t border-white/5 mt-6 pt-4 flex justify-between items-center text-xs text-neutral-500">
                <span className="flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5" />
                  Environments active
                </span>
                <span className="text-indigo-400 font-bold group-hover:translate-x-0.5 transition-transform flex items-center gap-1">
                  Configure
                  <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Create Project Modal */}
      {showCreateModal && (
        <>
          <div onClick={() => setShowCreateModal(false)} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999]"></div>
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-[#09090b] border border-white/10 p-6 rounded-3xl z-[10000] shadow-xl space-y-6">
            <div>
              <h3 className="font-extrabold text-lg text-white">Create Project</h3>
              <p className="text-xs text-neutral-400">Initialize a new project environment scope.</p>
            </div>

            {createError && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 font-medium">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateProject} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Project Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. auth-service"
                  className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Service role description..."
                  rows={3}
                  className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-indigo-500 transition-colors resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 text-xs font-semibold pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2.5 hover:bg-white/5 rounded-xl text-neutral-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createLoading || !name.trim()}
                  className="px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-xl transition-colors flex items-center gap-1.5"
                >
                  {createLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
