import { getSessionUserByToken, toPublicProfile } from "@/lib/auth/session";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AdminDashboard from "@/components/admin/admin-dashboard";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
  const user = await getSessionUserByToken(token);

  if (!user || !user.isAdmin) {
    redirect("/");
  }

  return <AdminDashboard adminUser={toPublicProfile(user)} initialView={view} />;
}
