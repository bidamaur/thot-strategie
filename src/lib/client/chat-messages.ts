import type { ChatMessagePayload } from "@/types";

/**
 * Message affiché dans le chat de la salle. Tant que le serveur n'a pas confirmé
 * un message envoyé, il est « en attente » et identifié par son clientId.
 */
export interface ChatEntry {
  id: string;
  clientId: string | null;
  from: string;
  text: string;
  ts: number;
  pending: boolean;
}

const MAX_ENTRIES = 100;

export const newClientId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const optimisticEntry = (clientId: string, from: string, text: string): ChatEntry => ({
  id: `local-${clientId}`,
  clientId,
  from,
  text,
  ts: Date.now(),
  pending: true,
});

const confirmed = (message: ChatMessagePayload): ChatEntry => ({
  id: message.id,
  clientId: message.clientId,
  from: message.from,
  text: message.text,
  ts: message.ts,
  pending: false,
});

const cap = (list: ChatEntry[]) => (list.length > MAX_ENTRIES ? list.slice(-MAX_ENTRIES) : list);

/**
 * Ajoute un message confirmé par le serveur :
 * - déjà présent (même id) → ignoré ;
 * - réponse à un message optimiste (même expéditeur et clientId) → le remplace sur place ;
 * - sinon → ajouté une seule fois.
 */
export function mergeChatMessage(list: ChatEntry[], message: ChatMessagePayload): ChatEntry[] {
  if (list.some((entry) => entry.id === message.id)) return list;
  if (message.clientId) {
    const index = list.findIndex(
      (entry) => entry.pending && entry.clientId === message.clientId && entry.from === message.from,
    );
    if (index !== -1) {
      const next = list.slice();
      next[index] = confirmed(message);
      return next;
    }
  }
  return cap([...list, confirmed(message)]);
}

/** Historique reçu à l'entrée dans la salle (actualisation, reconnexion). */
export function mergeChatHistory(list: ChatEntry[], messages: ChatMessagePayload[]): ChatEntry[] {
  return messages.reduce(mergeChatMessage, list);
}
