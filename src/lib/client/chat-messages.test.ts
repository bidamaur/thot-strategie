import { describe, expect, it } from "vitest";
import type { ChatMessagePayload } from "@/types";
import { mergeChatHistory, mergeChatMessage, optimisticEntry } from "./chat-messages";

const server = (over: Partial<ChatMessagePayload>): ChatMessagePayload => ({
  matchId: "m1",
  id: "srv-1",
  clientId: null,
  from: "alice",
  text: "salut",
  ts: 1000,
  ...over,
});

describe("chat de la salle : déduplication", () => {
  it("remplace le message optimiste par sa confirmation au lieu de le dupliquer", () => {
    const list = [optimisticEntry("c1", "alice", "salut")];
    const next = mergeChatMessage(list, server({ clientId: "c1" }));
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ id: "srv-1", pending: false, text: "salut" });
  });

  it("garde l'ordre avec plusieurs messages successifs confirmés dans le désordre", () => {
    let list = [optimisticEntry("c1", "alice", "un"), optimisticEntry("c2", "alice", "deux")];
    list = mergeChatMessage(list, server({ id: "s2", clientId: "c2", text: "deux" }));
    list = mergeChatMessage(list, server({ id: "s1", clientId: "c1", text: "un" }));
    expect(list.map((m) => [m.id, m.text])).toEqual([["s1", "un"], ["s2", "deux"]]);
  });

  it("ignore un message déjà reçu (même identifiant serveur)", () => {
    const list = mergeChatMessage([], server({ from: "bob" }));
    expect(mergeChatMessage(list, server({ from: "bob" }))).toBe(list);
  });

  it("le destinataire reçoit le message une seule fois", () => {
    const msg = server({ from: "bob", clientId: "c9" });
    const list = mergeChatMessage(mergeChatMessage([], msg), msg);
    expect(list).toHaveLength(1);
  });

  it("un clientId d'un autre joueur ne remplace pas mon message", () => {
    const list = [optimisticEntry("c1", "alice", "salut")];
    const next = mergeChatMessage(list, server({ from: "bob", clientId: "c1", text: "hey" }));
    expect(next).toHaveLength(2);
    expect(next[0].pending).toBe(true);
  });

  it("l'historique de reconnexion ne duplique pas les messages déjà affichés", () => {
    const a = server({ id: "s1", clientId: "c1" });
    const b = server({ id: "s2", from: "bob", text: "yo" });
    let list = mergeChatMessage([optimisticEntry("c1", "alice", "salut")], a);
    list = mergeChatHistory(list, [a, b]);
    expect(list.map((m) => m.id)).toEqual(["s1", "s2"]);
  });

  it("l'historique confirme un message encore en attente", () => {
    const list = mergeChatHistory([optimisticEntry("c1", "alice", "salut")], [server({ clientId: "c1" })]);
    expect(list).toHaveLength(1);
    expect(list[0].pending).toBe(false);
  });
});
