/**
 * Pays (codes ISO 3166-1 alpha-2) : noms français fournis par Intl.DisplayNames
 * (aucune liste à maintenir), drapeau en emoji calculé à partir du code.
 * Le pays est stocké en clair (nom français, ex. « Cameroun ») comme auparavant :
 * les profils existants restent valides. Importable côté client et serveur.
 */

const CODES = (
  "AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ " +
  "DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KW KG " +
  "LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG KP MK NO OM PK PW PS PA PG PY " +
  "PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA KR SS ES LK SD SR SE CH SY TW TJ TZ TH TL TG TO TT TN TR TM " +
  "TV UG UA AE GB US UY UZ VU VA VE VN YE ZM ZW HK MO PR RE GP MQ GF YT NC PF XK"
).split(" ");

/** Pays mis en avant en tête de liste (public principal de la plateforme). */
export const FEATURED_COUNTRIES = ["CM", "CI", "SN", "GA", "CG", "CD", "TD", "CF", "GQ", "NG", "BJ", "TG", "BF", "ML", "FR", "BE", "CA", "CH", "US"];

let displayNames: Intl.DisplayNames | null = null;
function names() {
  displayNames ??= new Intl.DisplayNames(["fr"], { type: "region" });
  return displayNames;
}

export function countryName(code: string): string {
  if (code === "XK") return "Kosovo";
  try {
    return names().of(code) ?? code;
  } catch {
    return code;
  }
}

export interface Country {
  code: string;
  name: string;
}

let cache: Country[] | null = null;
/** Tous les pays, triés par nom (ordre alphabétique français). */
export function allCountries(): Country[] {
  cache ??= CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return cache;
}

/** Emoji drapeau (indicateurs régionaux) d'un code ISO. */
export function flagEmoji(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

let byName: Map<string, string> | null = null;
/** Code ISO d'un pays saisi en texte libre (nom français ou anglais, ou code) ; null si inconnu. */
export function countryCodeFromName(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed) && CODES.includes(trimmed.toUpperCase())) return trimmed.toUpperCase();
  if (!byName) {
    byName = new Map();
    let en: Intl.DisplayNames | null = null;
    try {
      en = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      en = null;
    }
    for (const code of CODES) {
      byName.set(fold(countryName(code)), code);
      const english = en?.of(code);
      if (english) byName.set(fold(english), code);
    }
  }
  return byName.get(fold(trimmed)) ?? null;
}
