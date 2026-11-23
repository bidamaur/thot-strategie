import type { Provider } from "@/lib/monetization/rules";

/** Pastille d'opérateur aux couleurs Orange / MTN (sans logo de marque). */
export function OperatorBadge({ provider, size = "md" }: { provider: Provider | string; size?: "sm" | "md" }) {
  const orange = provider === "ORANGE_MONEY";
  const dim = size === "sm" ? "size-6 text-[9px]" : "size-9 text-[11px]";
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-extrabold tracking-tight ${dim} ${
        orange ? "bg-[#ff7900] text-black" : "bg-[#ffcc00] text-[#00264d]"
      }`}
    >
      {orange ? "OM" : "MTN"}
    </span>
  );
}

const STATUS_STYLE: Record<string, string> = {
  PENDING: "border-[#e0b44c]/40 bg-[#e0b44c]/10 text-[#e8c46a]",
  VALIDATED: "border-accent/40 bg-accent/10 text-accent",
  REJECTED: "border-danger/40 bg-danger/10 text-danger",
};
const STATUS_TEXT: Record<string, string> = {
  PENDING: "En attente de validation",
  VALIDATED: "Validé",
  REJECTED: "Rejeté",
};

export function PaymentStatusChip({ status }: { status: string }) {
  return <span className={`chip whitespace-nowrap ${STATUS_STYLE[status] ?? ""}`}>{STATUS_TEXT[status] ?? status}</span>;
}
