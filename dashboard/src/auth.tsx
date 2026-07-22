import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getPersona, login as persistLogin, logout as persistLogout, PERSONAS, type Persona, type Role } from "./api";

type Session = {
  persona: Persona;
  role: Role;
  label: string;
};

type AuthValue = {
  session: Session | null;
  login: (persona: Persona) => void;
  logout: () => void;
  switchPersona: (persona: Persona) => void;
};

const AuthContext = createContext<AuthValue | null>(null);

function readSession(): Session | null {
  const persona = getPersona();
  if (!persona) return null;
  const info = PERSONAS[persona];
  return { persona, role: info.role, label: info.label };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(readSession);

  const login = (persona: Persona) => {
    persistLogin(persona);
    setSession(readSession());
  };
  const logout = () => {
    persistLogout();
    setSession(null);
  };

  useEffect(() => {
    const expired = () => logout();
    window.addEventListener("aegis:session-expired", expired);
    return () => window.removeEventListener("aegis:session-expired", expired);
  }, []);

  const value = useMemo(() => ({ session, login, logout, switchPersona: login }), [session]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export function canWrite(role: Role | null, capability: "policy" | "agent" | "emergency" | "integrity") {
  if (!role) return false;
  if (capability === "policy" || capability === "agent") return role === "admin";
  if (capability === "emergency") return role === "admin" || role === "operator";
  return role === "admin" || role === "operator" || role === "auditor";
}
