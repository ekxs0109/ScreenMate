import { browser } from "wxt/browser";
import { useEffect, useState } from "react";

const initialSnapshot = {
  status: "idle" as const,
  roomId: null as string | null,
  viewerCount: 0,
};

export function useHostControls() {
  const [snapshot, setSnapshot] = useState(initialSnapshot);

  useEffect(() => {
    browser.runtime.sendMessage({ type: "screenmate:get-host-state" }).then(setSnapshot);
  }, []);

  return {
    snapshot,
    startSharing: () => browser.runtime.sendMessage({ type: "screenmate:start-sharing" }),
    stopSharing: () => browser.runtime.sendMessage({ type: "screenmate:stop-sharing" }),
  };
}
