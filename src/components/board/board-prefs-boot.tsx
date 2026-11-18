"use client";

import { useEffect } from "react";
import { getBoardPrefs, syncBoardPrefs } from "@/lib/client/board-prefs-store";

/** Charge les préférences de plateau du compte au démarrage et après connexion. */
export function BoardPrefsBoot() {
  useEffect(() => {
    getBoardPrefs();
    void syncBoardPrefs();
    const onAuth = () => void syncBoardPrefs();
    window.addEventListener("thot:auth-changed", onAuth);
    return () => window.removeEventListener("thot:auth-changed", onAuth);
  }, []);
  return null;
}
