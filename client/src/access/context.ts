import { createContext, useContext } from "react";
import type { Profile } from "../api";

export type Access = {
  profile: Profile;
  /** Ask for the PIN again on this device. */
  lock: () => void;
  /** End the session and go back to the profile list. */
  switchProfile: () => void;
  /** This browser was unpaired or the profile deleted: start again from the top. */
  restart: () => void;
};

export const AccessContext = createContext<Access | null>(null);

export function useAccess(): Access {
  const access = useContext(AccessContext);
  if (!access) throw new Error("useAccess was called outside the unlocked app.");
  return access;
}
