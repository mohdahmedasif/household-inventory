import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation, useOutletContext } from "react-router-dom";

export const PAGE_ACTIONS_ID = "page-actions";

export type PageTitleOverride = { path: string; title: string } | null;

export type LayoutContext = {
  setTitleOverride: (value: PageTitleOverride) => void;
};

export default function PageActions({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(document.getElementById(PAGE_ACTIONS_ID));
  }, []);

  return target ? createPortal(children, target) : null;
}

export function usePageTitle(title: string | undefined) {
  const { setTitleOverride } = useOutletContext<LayoutContext>();
  const { pathname } = useLocation();

  useEffect(() => {
    setTitleOverride(title ? { path: pathname, title } : null);
  }, [title, pathname, setTitleOverride]);
}
