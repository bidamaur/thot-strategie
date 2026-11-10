"use client";

import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@/types";

export function createGameSocket(): Socket<
  ServerToClientEvents,
  ClientToServerEvents
> {
  return io(process.env.NEXT_PUBLIC_SOCKET_URL ?? window.location.origin, {
    autoConnect: false,
  });
}
