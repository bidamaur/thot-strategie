"use client";

import {
  useState,
  useEffect,
  useCallback,
} from "react";
import {
  LayoutDashboard,
  Users,
  Shield,
  Trophy,
  Settings,
  Activity,
  BarChart3,
  RefreshCw,
  Search,
  Plus,
  Edit,
  Trash2,
  Crown,
  Lock,
  UserPlus,
  Ban,
  Rocket,
  Globe,
  Award,
  Timer,
  Settings as SettingsIcon,
  HelpCircle,
  LogOut,
  ChevronLeft,
  Menu,
  X,
  ScrollText,
  Wallet,
} from "lucide-react";
import { AdminAuditView, AdminSettingsPanel } from "./admin-settings-panel";
import { AdminAnalytics } from "./admin-analytics";
import { AdminCommunity } from "./admin-community";
import { AdminMonetization } from "./admin-monetization";

interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  isAdmin: boolean;
  isPremium: boolean;
  premiumLevel: number;
  pointsFree: number;
  walletReal: string;
  walletLocked?: string;
  moneyVerified?: boolean;
  elo: number;
  country: string | null;
  city: string | null;
  neighborhood: string | null;
  avatar: string | null;
  createdAt: string;
  totalTournaments: number;
  totalMatches: number;
}

interface AdminTournament {
  id: string;
  name: string;
  creatorId: string;
  creatorUsername: string;
  type: string;
  scope: string;
  isPaid: boolean;
  entryFee: string;
  entryPoints: number;
  maxPlayers: number;
  status: string;
  createdAt: string;
  participants: number;
  initialCapital: number | null;
  minBet: number | null;
  maxBet: number | null;
  survivalBankEnabled: boolean;
}

interface AdminConfig {
  key: string;
  value: unknown;
  description: string | null;
  isEditable: boolean;
  updatedAt: string;
}

type View = "dashboard" | "analytics" | "monetization" | "users" | "tournaments" | "community" | "config" | "audit";

const VIEWS: View[] = ["dashboard", "analytics", "monetization", "users", "tournaments", "community", "config", "audit"];

export default function AdminDashboard({ adminUser, initialView }: { adminUser: any; initialView?: string }) {
  // Vue initiale lisible dans l'adresse (?view=monetization), utilisée par les notifications.
  const [view, setView] = useState<View>(VIEWS.includes(initialView as View) ? (initialView as View) : "dashboard");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [tournaments, setTournaments] = useState<AdminTournament[]>([]);
  const [configs, setConfigs] = useState<AdminConfig[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchUsers, setSearchUsers] = useState("");
  const [filterRole, setFilterRole] = useState("all");
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editingConfig, setEditingConfig] = useState<AdminConfig | null>(null);
  const [configValue, setConfigValue] = useState("");

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [usersRes, statsRes, tournamentsRes, configsRes] = await Promise.all([
        fetch(
          `/api/admin/users?page=1&limit=100&search=${encodeURIComponent(searchUsers)}&role=${filterRole}`,
          { cache: "no-store" },
        ),
        fetch("/api/admin/stats", { cache: "no-store" }),
        fetch("/api/admin/tournaments", { cache: "no-store" }),
        fetch("/api/admin/tournaments/config", { cache: "no-store" }),
      ]);

      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsers(data.users);
      }
      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data);
      }
      const tournamentsData = await tournamentsRes.json();
      if (!tournamentsRes.ok) {
        throw new Error(
          tournamentsData.error ?? "Impossible de charger les tournois.",
        );
      }
      setTournaments(tournamentsData.tournaments);
      const configsData = await configsRes.json();
      if (!configsRes.ok) {
        throw new Error(
          configsData.error ?? "Impossible de charger la configuration.",
        );
      }
      setConfigs(configsData.configs);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Erreur lors du chargement des données.",
      );
    } finally {
      setLoading(false);
    }
  }, [searchUsers, filterRole]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Format helpers
  const formatPoints = (n: number) =>
    new Intl.NumberFormat("fr-FR").format(n);
  const formatDate = (d: string) => new Date(d).toLocaleDateString("fr-FR");

  // Sidebar navigation
  const navItems = [
    { id: "dashboard", label: "Tableau de bord", icon: LayoutDashboard },
    { id: "analytics", label: "Audience et conversion", icon: LayoutDashboard },
    { id: "monetization", label: "Monétisation", icon: Wallet },
    { id: "users", label: "Utilisateurs", icon: Users },
    { id: "tournaments", label: "Tournois", icon: Trophy },
    { id: "community", label: "Communauté", icon: Globe },
    { id: "config", label: "Paramètres", icon: Settings },
    { id: "audit", label: "Journal d’audit", icon: ScrollText },
  ];

  return (
    <div className="min-h-screen bg-canvas text-white flex flex-col">
      {/* Top Bar */}
      <header className="h-16 bg-surface border-b border-line flex items-center justify-between px-6 z-20">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-yellow-500 to-orange-600 rounded flex items-center justify-center font-bold text-black text-sm">
              T
            </div>
            <span className="font-bold text-xl tracking-tight text-yellow-400">
              THOT ADMIN
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-3 px-4 py-2 rounded-lg bg-surface-2 border border-line-strong">
            <span className="text-xs text-zinc-400">Connecté en tant que</span>
            <span className="text-sm font-medium text-white">{adminUser.username}</span>
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-green-900/30 border border-green-500/30 text-green-400 text-xs">
              <Crown className="w-3 h-3" /> ADMINISTRATEUR
            </span>
          </div>
          <button
            onClick={() => {
              fetch("/api/auth/logout", { method: "POST" }).then(() => {
                window.location.href = "/";
              });
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-surface-3 transition text-zinc-300"
          >
            <LogOut className="w-4 h-4" /> <span className="text-sm">Déconnexion</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 bg-surface border-r border-line flex flex-col hidden md:block">
          <nav className="flex-1 py-6 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = view === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setView(item.id as View)}
                  className={`flex items-center gap-3 px-6 py-3 text-sm font-medium transition-all ${
                    isActive
                      ? "bg-yellow-500 text-black"
                      : "text-zinc-400 hover:bg-surface-2 hover:text-white"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="p-6 border-t border-line">
            <div className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-3">
              Système
            </div>
            <button
              onClick={() => {
                fetch("/api/auth/logout", { method: "POST" }).then(() => {
                  window.location.href = "/";
                });
              }}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-3 transition text-zinc-300 text-sm"
            >
              <LogOut className="w-4 h-4" /> Déconnexion
            </button>
          </div>
        </aside>

        {/* Mobile sidebar toggle */}
        <div className="md:hidden">
          <button
            type="button"
            className="p-3 text-zinc-400 hover:text-white hover:bg-surface-3 rounded"
            aria-label={mobileMenuOpen ? "Fermer le menu" : "Ouvrir le menu"}
            aria-expanded={mobileMenuOpen}
            aria-controls="admin-mobile-navigation"
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          {mobileMenuOpen && (
            <nav
              id="admin-mobile-navigation"
              className="fixed left-0 right-0 top-16 z-30 border-b border-line bg-surface py-2 shadow-lg"
            >
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setView(item.id as View);
                      setMobileMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 px-6 py-3 text-left text-sm font-medium ${
                      view === item.id
                        ? "bg-yellow-500 text-black"
                        : "text-zinc-400 hover:bg-surface-2 hover:text-white"
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          )}
        </div>

        {/* Content */}
        <main className="min-w-0 flex-1 overflow-y-auto bg-canvas p-4 sm:p-6 lg:p-8">
          {view === "dashboard" && (
            <AdminDashboardView
              stats={stats}
              loadData={loadData}
              formatPoints={formatPoints}
              formatDate={formatDate}
            />
          )}
          {view === "users" && (
            <AdminUsersView
              users={users}
              searchUsers={searchUsers}
              setSearchUsers={setSearchUsers}
              filterRole={filterRole}
              setFilterRole={setFilterRole}
              loading={loading}
              error={error}
              loadData={loadData}
              formatPoints={formatPoints}
              formatDate={formatDate}
              onEditUser={setEditingUser}
            />
          )}
          {view === "tournaments" && (
            <AdminTournamentsView
              tournaments={tournaments}
              error={error}
              loadData={loadData}
              formatDate={formatDate}
            />
          )}
          {view === "audit" && <AdminAuditView />}
          {view === "community" && <AdminCommunity />}
          {view === "analytics" && <AdminAnalytics />}
          {view === "monetization" && <AdminMonetization />}
          {view === "config" && <AdminSettingsPanel />}
          {view === "config" && (
            <details className="mt-10">
              <summary className="cursor-pointer text-sm text-ink-muted">Clés avancées (JSON brut, usage expert)</summary>
              <div className="mt-4">
            <AdminConfigView
              configs={configs}
              error={error}
              loadData={loadData}
              editingConfig={editingConfig}
              setEditingConfig={setEditingConfig}
              configValue={configValue}
              setConfigValue={setConfigValue}
            />
              </div>
            </details>
          )}
        </main>
      </div>

      {/* Edit User Modal */}
      {editingUser && (
        <AdminUserEditModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSave={loadData}
        />
      )}
    </div>
  );
}

// ── Sub-components ──

function AdminDashboardView({
  stats,
  loadData,
  formatPoints,
  formatDate,
}: {
  stats: any;
  loadData: () => void;
  formatPoints: (n: number) => string;
  formatDate: (d: string) => string;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Tableau de bord</h1>
          <p className="text-zinc-400 text-sm">
            Vue d'ensemble de la plateforme Thot Stratégie
          </p>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-2 border border-line-strong hover:bg-surface-3 transition text-sm"
        >
          <RefreshCw className="w-4 h-4" /> Actualiser
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Utilisateurs totaux"
          value={stats?.totalUsers ?? 0}
          icon={Users}
          color="text-blue-400"
          bg="bg-blue-900/20 border-blue-500/30"
        />
        <StatCard
          title="Administrateurs"
          value={stats?.totalAdmins ?? 0}
          icon={Shield}
          color="text-purple-400"
          bg="bg-purple-900/20 border-purple-500/30"
        />
        <StatCard
          title="Utilisateurs Premium"
          value={stats?.totalPremium ?? 0}
          icon={Crown}
          color="text-yellow-400"
          bg="bg-yellow-900/20 border-yellow-500/30"
        />
        <StatCard
          title="Tournois"
          value={stats?.totalTournaments ?? 0}
          icon={Trophy}
          color="text-emerald-400"
          bg="bg-emerald-900/20 border-emerald-500/30"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-surface border border-line rounded-xl p-6">
          <h3 className="text-sm font-semibold text-zinc-300 mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4" /> Activité récente
          </h3>
          <div className="space-y-3">
            <ActivityItem
              icon={UserPlus}
              text="Nouvel utilisateur inscrit"
              time="Il y a 2 heures"
              color="text-blue-400"
            />
            <ActivityItem
              icon={Trophy}
              text="Tournoi terminé"
              time="Il y a 5 heures"
              color="text-emerald-400"
            />
            <ActivityItem
              icon={Rocket}
              text="Nouveau tournoi créé"
              time="Il y a 1 jour"
              color="text-purple-400"
            />
          </div>
        </div>

        <div className="bg-surface border border-line rounded-xl p-6">
          <h3 className="text-sm font-semibold text-zinc-300 mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4" /> Répartition rapide
          </h3>
          <div className="space-y-3">
            <StatRow label="Matchs terminés" value={stats?.finishedMatches ?? 0} />
            <StatRow label="Tournois actifs" value={stats?.activeTournaments ?? 0} />
            <StatRow label="Points distribués" value={formatPoints(stats?.totalPointsDistributed ?? 0)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  color,
  bg,
}: {
  title: string;
  value: number;
  icon: any;
  color: string;
  bg: string;
}) {
  return (
    <div className={`rounded-xl p-5 border ${bg} ${color}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-zinc-400 text-xs font-medium uppercase tracking-wider">
            {title}
          </p>
          <p className="text-3xl font-bold text-white mt-1">{value}</p>
        </div>
        <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
}

function ActivityItem({
  icon: Icon,
  text,
  time,
  color,
}: {
  icon: any;
  text: string;
  time: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs bg-white/5 border border-white/10">
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1">
        <p className="text-sm text-zinc-200">{text}</p>
        <p className="text-xs text-zinc-500">{time}</p>
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-zinc-400">{label}</span>
      <span className="text-white font-medium">{value}</span>
    </div>
  );
}

// ── Users View ──
function AdminUsersView({
  users,
  searchUsers,
  setSearchUsers,
  filterRole,
  setFilterRole,
  loading,
  error,
  loadData,
  formatPoints,
  formatDate,
  onEditUser,
}: {
  users: AdminUser[];
  searchUsers: string;
  setSearchUsers: (s: string) => void;
  filterRole: string;
  setFilterRole: (r: string) => void;
  loading: boolean;
  error: string;
  loadData: () => void;
  formatPoints: (n: number) => string;
  formatDate: (d: string) => string;
  onEditUser: (u: AdminUser) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Gestion des utilisateurs</h1>
          <p className="text-zinc-400 text-sm">
            Gérez les comptes, les statuts Premium et les points
          </p>
        </div>
        <button
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-yellow-500 text-black hover:bg-yellow-400 transition text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> Nouvel utilisateur
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-900/20 border border-red-500/30 p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-3 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Rechercher un utilisateur..."
            value={searchUsers}
            onChange={(e) => setSearchUsers(e.target.value)}
            className="w-full bg-surface border border-line-strong rounded-lg px-4 pl-10 py-2 text-white focus:outline-none focus:border-yellow-500 transition"
          />
        </div>
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          className="bg-surface border border-line-strong rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-yellow-500 transition"
        >
          <option value="all">Tous les rôles</option>
          <option value="admin">Administrateurs</option>
          <option value="premium">Premium</option>
          <option value="user">Utilisateurs standards</option>
        </select>
      </div>

      {/* Users Table */}
      <div className="bg-surface border border-line rounded-xl overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-surface-2 border-b border-line">
            <tr>
              <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Utilisateur</th>
              <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Rôle</th>
              <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Points</th>
              <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Elo</th>
              <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Tournois</th>
              <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Matchs</th>
              <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-surface-2/50 transition">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {user.avatar ? (
                      <img src={user.avatar} alt="" className="w-8 h-8 rounded-full" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-surface-3 flex items-center justify-center text-xs font-bold">
                        {user.username.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-medium text-white">{user.username}</p>
                      <p className="text-xs text-zinc-500">{formatDate(user.createdAt)}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {user.isAdmin ? (
                    <span className="flex items-center gap-1 px-2 py-1 rounded bg-purple-900/30 border border-purple-500/30 text-purple-400 text-xs font-medium">
                      <Shield className="w-3 h-3" /> Admin
                    </span>
                  ) : user.isPremium ? (
                    <span className={`flex items-center gap-1 px-2 py-1 rounded border text-xs font-medium ${
                      user.premiumLevel === 5
                        ? "bg-yellow-900/30 border-yellow-500/30 text-yellow-400"
                        : "bg-yellow-900/20 border-yellow-500/20 text-yellow-300"
                    }`}>
                      <Crown className="w-3 h-3" /> Premium {user.premiumLevel}
                    </span>
                  ) : (
                    <span className="px-2 py-1 rounded bg-surface-3 border border-line-strong text-zinc-400 text-xs font-medium">
                      Utilisateur
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-sm font-mono text-white">
                  {formatPoints(user.pointsFree)}
                </td>
                <td className="px-4 py-3 text-sm font-mono text-zinc-300">{user.elo}</td>
                <td className="px-4 py-3 text-sm text-zinc-300">{user.totalTournaments}</td>
                <td className="px-4 py-3 text-sm text-zinc-300">{user.totalMatches}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => onEditUser(user)}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-surface-2 border border-line-strong hover:bg-surface-3 transition text-xs text-zinc-300"
                  >
                    <Edit className="w-3 h-3" /> Modifier
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {loading && (
        <div className="flex justify-center py-4">
          <div className="flex gap-1">
            {[1, 2, 3].map((i) => (
              <div key={i} className="w-2 h-2 bg-zinc-600 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.1}s` }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tournaments View ──
function AdminTournamentsView({
  tournaments,
  error,
  loadData,
  formatDate,
}: {
  tournaments: AdminTournament[];
  error: string;
  loadData: () => void;
  formatDate: (d: string) => string;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Gestion des tournois</h1>
          <p className="text-zinc-400 text-sm">
            Supervisez tous les tournois de la plateforme
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-900/20 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="bg-surface border border-line rounded-xl overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-surface-2 border-b border-line">
            <tr>
              <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Tournoi</th>
              <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Type</th>
              <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Organisateur</th>
              <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Statut</th>
              <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Joueurs</th>
              <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Créé le</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {tournaments.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-sm text-zinc-500"
                >
                  {error ? "La liste des tournois n’a pas pu être chargée." : "Aucun tournoi créé."}
                </td>
              </tr>
            )}
            {tournaments.map((t) => (
              <tr key={t.id} className="hover:bg-surface-2/50 transition">
                <td className="px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-white">{t.name}</p>
                    <p className="text-xs text-zinc-500">{t.scope}</p>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    t.type === "SURVIVAL_BANK"
                      ? "bg-emerald-900/30 border border-emerald-500/30 text-emerald-400"
                      : "bg-blue-900/30 border border-blue-500/30 text-blue-400"
                  }`}>
                    {t.type}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-zinc-300">{t.creatorUsername}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    t.status === "IN_PROGRESS"
                      ? "bg-emerald-900/30 border border-emerald-500/30 text-emerald-400"
                      : t.status === "COMPLETED"
                        ? "bg-zinc-900/30 border border-zinc-500/30 text-zinc-400"
                        : "bg-yellow-900/30 border border-yellow-500/30 text-yellow-400"
                  }`}>
                    {t.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-zinc-300">{t.participants}/{t.maxPlayers}</td>
                <td className="px-4 py-3 text-sm text-zinc-300">{formatDate(t.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Config View ──
function AdminConfigView({
  configs,
  error,
  loadData,
  editingConfig,
  setEditingConfig,
  configValue,
  setConfigValue,
}: {
  configs: AdminConfig[];
  error: string;
  loadData: () => void;
  editingConfig: AdminConfig | null;
  setEditingConfig: (c: AdminConfig | null) => void;
  configValue: string;
  setConfigValue: (v: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Configuration centrale</h1>
          <p className="text-zinc-400 text-sm">
            Paramétrez les règles globales de la plateforme
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-900/20 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {configs.length === 0 && !error && (
        <p className="text-sm text-zinc-400">Aucune configuration disponible.</p>
      )}

      <div className="bg-surface border border-line rounded-xl overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-surface-2 border-b border-line">
            <tr>
              <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Paramètre</th>
              <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Valeur</th>
              <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Description</th>
              <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {configs.map((c) => (
              <tr key={c.key} className="hover:bg-surface-2/50 transition">
                <td className="px-4 py-3">
                  <p className="text-sm font-medium text-white">{c.key}</p>
                  <p className="text-xs text-zinc-500">{c.isEditable ? "Modifiable" : "Verrouillé"}</p>
                </td>
                <td className="px-4 py-3">
                  {editingConfig?.key === c.key ? (
                    <input
                      type="text"
                      value={configValue}
                      onChange={(e) => setConfigValue(e.target.value)}
                      className="w-full bg-surface-2 border border-line-strong rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-yellow-500"
                    />
                  ) : (
                    <div className="text-sm font-mono text-zinc-300 truncate max-w-xs">
                      {JSON.stringify(c.value)}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-zinc-400">{c.description ?? "—"}</td>
                <td className="px-4 py-3 text-right">
                  {c.isEditable && (
                    <button
                      onClick={() => {
                        setEditingConfig(c);
                        setConfigValue(typeof c.value === "string" ? c.value : JSON.stringify(c.value));
                      }}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-surface-2 border border-line-strong hover:bg-surface-3 transition text-xs text-zinc-300"
                    >
                      <Edit className="w-3 h-3" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editingConfig && (
        <div className="mt-4 p-4 rounded-lg bg-surface-2 border border-line-strong">
          <h3 className="text-sm font-semibold text-white mb-3">Modifier {editingConfig.key}</h3>
          <div className="flex gap-3">
            <button
              onClick={async () => {
                const res = await fetch("/api/admin/tournaments/config", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    key: editingConfig.key,
                    value: configValue,
                    description: editingConfig.description,
                    isEditable: editingConfig.isEditable,
                  }),
                });
                if (res.ok) {
                  setEditingConfig(null);
                  await loadData();
                }
              }}
              className="px-4 py-2 rounded bg-yellow-500 text-black hover:bg-yellow-400 transition text-sm font-medium"
            >
              Enregistrer
            </button>
            <button
              onClick={() => setEditingConfig(null)}
              className="px-4 py-2 rounded bg-surface-3 border border-line-strong hover:bg-surface-3 transition text-sm text-zinc-300"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Edit User Modal ──
function AdminUserEditModal({
  user,
  onClose,
  onSave,
}: {
  user: AdminUser;
  onClose: () => void;
  onSave: () => void;
}) {
  const [isAdmin, setIsAdmin] = useState(user.isAdmin);
  const [isPremium, setIsPremium] = useState(user.isPremium);
  const [premiumLevel, setPremiumLevel] = useState(user.premiumLevel ?? 0);
  const [pointsFree, setPointsFree] = useState(String(user.pointsFree));
  const [elo, setElo] = useState(String(user.elo));
  const [walletReal, setWalletReal] = useState(String(user.walletReal));
  const [moneyVerified, setMoneyVerified] = useState(Boolean(user.moneyVerified));
  const [reason, setReason] = useState("");
  const [saveError, setSaveError] = useState("");

  const handleSave = async () => {
    setSaveError("");
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isAdmin,
        isPremium,
        premiumLevel,
        pointsFree: Number(pointsFree),
        walletReal: Number(walletReal),
        moneyVerified,
        elo: Number(elo),
        reason: reason.trim() || undefined,
      }),
    });
    if (res.ok) {
      onClose();
      onSave();
    } else {
      const json = await res.json().catch(() => ({}));
      setSaveError(json.error ?? "Enregistrement impossible.");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-line-strong rounded-xl p-6 max-w-md w-full max-h-[90dvh] overflow-y-auto">
        <h2 className="text-lg font-bold text-white mb-4">Modifier {user.username}</h2>
        <div className="space-y-3">
          <label className="text-xs text-zinc-400 uppercase">Administrateur</label>
          <input
            type="checkbox"
            checked={isAdmin}
            onChange={(e) => setIsAdmin(e.target.checked)}
            className="rounded bg-surface-2 border-line-strong text-yellow-500 focus:ring-yellow-500"
          />
        </div>
        <div className="space-y-3">
          <label className="text-xs text-zinc-400 uppercase">Premium</label>
          <input
            type="checkbox"
            checked={isPremium}
            onChange={(e) => setIsPremium(e.target.checked)}
            className="rounded bg-surface-2 border-line-strong text-yellow-500 focus:ring-yellow-500"
          />
        </div>
        {isPremium && (
          <div className="space-y-3">
            <label className="text-xs text-zinc-400 uppercase">Niveau Premium</label>
            <select
              value={premiumLevel}
              onChange={(e) => setPremiumLevel(Number(e.target.value))}
              className="w-full bg-surface-2 border border-line-strong rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-yellow-500"
            >
              {[1, 2, 3, 4, 5].map((l) => (
                <option key={l} value={l}>Niveau {l}</option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-3">
          <label className="text-xs text-zinc-400 uppercase">Points gratuits</label>
          <input
            type="number"
            value={pointsFree}
            onChange={(e) => setPointsFree(e.target.value)}
            className="w-full bg-surface-2 border border-line-strong rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-yellow-500"
          />
        </div>
        <div className="space-y-3">
          <label className="text-xs text-zinc-400 uppercase">Elo</label>
          <input
            type="number"
            value={elo}
            onChange={(e) => setElo(e.target.value)}
            className="w-full bg-surface-2 border border-line-strong rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-yellow-500"
          />
        </div>
        <div className="space-y-3">
          <label className="text-xs text-zinc-400 uppercase">Points argent disponibles (FCFA)</label>
          <input
            type="number"
            min={0}
            value={walletReal}
            onChange={(e) => setWalletReal(e.target.value)}
            className="w-full bg-surface-2 border border-line-strong rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-yellow-500"
          />
          {user.walletLocked && Number(user.walletLocked) > 0 && (
            <p className="text-xs text-zinc-500">{user.walletLocked} FCFA bloqués en partie (non modifiables).</p>
          )}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={moneyVerified} onChange={(e) => setMoneyVerified(e.target.checked)} />
          Compte vérifié pour les parties rémunérées
        </label>
        <div className="mt-3 space-y-2">
          <label className="text-xs text-zinc-400 uppercase">Motif (journal d’audit)</label>
          <input
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex. correction après litige"
            className="w-full bg-surface-2 border border-line-strong rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-yellow-500"
          />
        </div>
        {saveError && <p className="mt-3 text-sm text-danger">{saveError}</p>}
        <div className="flex gap-3 pt-4">
          <button onClick={handleSave} className="flex-1 px-4 py-2 rounded bg-yellow-500 text-black hover:bg-yellow-400 transition text-sm font-medium">
            Enregistrer
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded bg-surface-3 border border-line-strong hover:bg-surface-3 transition text-sm text-zinc-300">
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}
