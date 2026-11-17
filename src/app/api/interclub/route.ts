import { communityRoute, readJson } from "@/lib/community/http";
import { interclubStandings, listClubMatches, proposeClubMatch } from "@/lib/community/interclub";

/** ?club=<slug> : rencontres d'un club ; sans paramètre : classement interclubs. */
export async function GET(request: Request) {
  const club = new URL(request.url).searchParams.get("club");
  return communityRoute(
    request,
    async () => (club ? { matches: await listClubMatches(club) } : { standings: await interclubStandings() }),
    { auth: "optional" },
  );
}

export async function POST(request: Request) {
  return communityRoute(request, async (user) => proposeClubMatch(user!.id, await readJson(request)));
}
