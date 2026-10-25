import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Icon } from "./Icon";

type Kind = "ok" | "error";
interface FlashMsg { message: string; kind: Kind; at: number }
interface FlashState { msg: FlashMsg | null; flash: (message: string, kind?: Kind) => void; clear: () => void }

const FlashContext = createContext<FlashState>({ msg: null, flash: () => {}, clear: () => {} });

/** `flash("Saved.")` shows a message at the top of the page. */
export const useFlash = () => useContext(FlashContext).flash;

export function FlashProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<FlashMsg | null>(null);
  const flash = useCallback((message: string, kind: Kind = "ok") => setMsg({ message, kind, at: Date.now() }), []);
  const clear = useCallback(() => setMsg(null), []);
  const value = useMemo(() => ({ msg, flash, clear }), [msg, flash, clear]);
  return <FlashContext.Provider value={value}>{children}</FlashContext.Provider>;
}

/** Shows the latest message. A message set just before navigating survives the move; older ones are dropped. */
export function FlashOutlet() {
  const { msg, clear } = useContext(FlashContext);
  const { pathname } = useLocation();
  const latest = useRef(msg);
  latest.current = msg;

  useEffect(() => {
    if (latest.current && Date.now() - latest.current.at > 1000) clear();
  }, [pathname, clear]);

  if (!msg) return null;
  return (
    <div className={`flash ${msg.kind}`} role="status">
      <Icon name={msg.kind === "error" ? "alert" : "check-circle"} size={17} />
      <span className="grow">{msg.message}</span>
      <button className="flash-x" onClick={clear} aria-label="Dismiss"><Icon name="x" size={15} /></button>
    </div>
  );
}
