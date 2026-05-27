"use client";

import { createContext, useContext } from "react";

export interface K8sContextValue {
  connectionId: string;
  namespace: string; // "*" = all namespaces
  setNamespace: (ns: string) => void;
  namespaces: string[];
  filter: string;
  setFilter: (s: string) => void;
  setFilterOpen: (open: boolean) => void;
  setCommandOpen: (open: boolean) => void;
  setHelpOpen: (open: boolean) => void;
  context: string;
  serverVersion: string;
}

const Ctx = createContext<K8sContextValue | null>(null);

export const K8sContextProvider = Ctx.Provider;

export function useK8s(): K8sContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useK8s must be used inside <K8sShell>");
  return v;
}
