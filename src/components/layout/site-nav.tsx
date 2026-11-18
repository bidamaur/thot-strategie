"use client";

import {
  BarChart3,
  Bot,
  Crown,
  Download,
  Gamepad2,
  Home,
  LogOut,
  Medal,
  Menu,
  MessagesSquare,
  Settings2,
  Shield,
  Swords,
  Trophy,
  Users,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { NotificationBell } from "./notification-bell";

interface NavUser {
  username: string;
  isAdmin: boolean;
  isPremium: boolean;
  pointsFree: number;
  elo: number;
}

const LINKS = [
  { href: "/", label: "Accueil", icon: Home, exact: true, mobile: true },
  { href: "/match/en-ligne", label: "Jouer", icon: Gamepad2, mobile: true },
  { href: "/match/ia", label: "Entraînement", icon: Bot, mobile: false },
  { href: "/tournois", label: "Tournois", icon: Trophy, mobile: true },
  { href: "/communaute", label: "Communauté", icon: MessagesSquare, mobile: true },
  { href: "/clubs", label: "Clubs", icon: Users, mobile: false },
  { href: "/classements", label: "Classements", icon: Medal, mobile: false },
  { href: "/mes-parties", label: "Mes parties", icon: BarChart3, mobile: false },
  { href: "/premium", label: "Premium", icon: Crown, mobile: false },
  { href: "/portefeuille", label: "Portefeuille", icon: Wallet, mobile: false },
] as const;

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href || pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Navigation globale. Masquée dans l'administration (qui a sa propre
 * structure) et réduite au minimum en salle de jeu pour laisser toute la
 * place au plateau.
 */
export function SiteNav() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [user, setUser] = useState<NavUser | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { user?: NavUser } | null) => {
        if (active) setUser(data?.user ?? null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [pathname]);

  // Le menu « Plus » se referme à chaque changement de page.
  useEffect(() => {
    const handle = setTimeout(() => setMoreOpen(false), 0);
    return () => clearTimeout(handle);
  }, [pathname]);

  if (pathname.startsWith("/admin")) return null;
  const inGameRoom = /^\/match\/(?!en-ligne|ia)[^/]+$/.test(pathname);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setUser(null);
    router.push("/");
    router.refresh();
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Thot Stratégie — accueil">
            <span className="flex size-8 items-center justify-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
              <Swords size={16} />
            </span>
            <span className="hidden text-[13px] font-bold tracking-[0.16em] sm:block">
              THOT <span className="text-accent">STRATÉGIE</span>
            </span>
          </Link>

          <nav aria-label="Navigation principale" className="hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto lg:flex">
            {LINKS.map(({ href, label, icon: Icon, ...rest }) => {
              const active = isActive(pathname, href, "exact" in rest ? rest.exact : false);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                    active ? "bg-surface-3 text-ink" : "text-ink-muted hover:bg-surface-2 hover:text-ink"
                  }`}
                >
                  <Icon size={15} />
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {user ? (
              <>
                <span className="hidden items-center gap-3 rounded-lg border border-line px-3 py-1 text-xs sm:flex">
                  <span className="font-semibold text-ink">{user.username}</span>
                  {user.isPremium && <Crown size={13} className="text-gold" aria-label="Premium" />}
                  <span className="tabular text-ink-muted">{user.elo} ELO</span>
                  <span className="tabular text-ink-muted">{Math.round(user.pointsFree)} pts</span>
                </span>
                <NotificationBell paused={inGameRoom} />
                <Link href="/parametres" className="btn btn-ghost hidden min-h-0 px-2.5 py-1.5 lg:inline-flex" aria-label="Paramètres de jeu" title="Paramètres de jeu">
                  <Settings2 size={15} />
                </Link>
                {user.isAdmin && (
                  <Link href="/admin" className="btn btn-ghost min-h-0 px-2.5 py-1.5" aria-label="Administration">
                    <Shield size={15} />
                    <span className="hidden xl:inline">Admin</span>
                  </Link>
                )}
                <button type="button" onClick={logout} className="btn btn-ghost min-h-0 px-2.5 py-1.5" aria-label="Déconnexion">
                  <LogOut size={15} />
                </button>
              </>
            ) : (
              <Link href="/" className="btn btn-primary min-h-0 px-3 py-1.5">
                Se connecter
              </Link>
            )}
          </div>
        </div>
      </header>

      {!inGameRoom && (
        <nav
          aria-label="Navigation mobile"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-canvas/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
        >
          <div className="mx-auto grid max-w-lg grid-cols-5">
            {LINKS.filter((link) => link.mobile).map(({ href, label, icon: Icon, ...rest }) => {
              const active = isActive(pathname, href, "exact" in rest ? rest.exact : false);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-12 flex-col items-center justify-center gap-0.5 py-2 text-[11px] ${active ? "text-accent" : "text-ink-muted"}`}
                >
                  <Icon size={19} />
                  {label}
                </Link>
              );
            })}
            <button
              type="button"
              onClick={() => setMoreOpen((open) => !open)}
              aria-expanded={moreOpen}
              aria-controls="mobile-more"
              className={`flex min-h-12 flex-col items-center justify-center gap-0.5 py-2 text-[11px] ${
                moreOpen || LINKS.some((l) => !l.mobile && isActive(pathname, l.href)) ? "text-accent" : "text-ink-muted"
              }`}
            >
              {moreOpen ? <X size={19} /> : <Menu size={19} />}
              Plus
            </button>
          </div>
        </nav>
      )}

      {!inGameRoom && moreOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 backdrop-blur-[2px] lg:hidden" onClick={() => setMoreOpen(false)}>
          <div
            id="mobile-more"
            role="menu"
            aria-label="Plus de rubriques"
            onClick={(event) => event.stopPropagation()}
            className="absolute inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] rounded-t-3xl border-t border-line-strong bg-surface p-4 shadow-2xl"
          >
            {user && (
              <div className="mb-3 flex items-center gap-3 rounded-2xl border border-line px-3 py-2 text-xs">
                <span className="font-semibold text-ink">{user.username}</span>
                {user.isPremium && <Crown size={13} className="text-gold" aria-label="Premium" />}
                <span className="tabular text-ink-muted">{user.elo} ELO</span>
                <span className="tabular text-ink-muted">{Math.round(user.pointsFree)} pts</span>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              {LINKS.filter((link) => !link.mobile).map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  role="menuitem"
                  className={`flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl border text-xs ${
                    isActive(pathname, href) ? "border-accent/40 bg-accent/10 text-accent" : "border-line bg-surface-2 text-ink-soft"
                  }`}
                >
                  <Icon size={20} />
                  {label}
                </Link>
              ))}
              <Link
                href="/parametres"
                role="menuitem"
                className={`flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl border text-xs ${
                  isActive(pathname, "/parametres") ? "border-accent/40 bg-accent/10 text-accent" : "border-line bg-surface-2 text-ink-soft"
                }`}
              >
                <Settings2 size={20} />
                Paramètres
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false);
                  window.dispatchEvent(new Event("thot:install"));
                }}
                className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl border border-line bg-surface-2 text-xs text-ink-soft"
              >
                <Download size={20} />
                Installer l’app
              </button>
              {user?.isAdmin && (
                <Link href="/admin" role="menuitem" className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl border border-line bg-surface-2 text-xs text-ink-soft">
                  <Shield size={20} />
                  Admin
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
