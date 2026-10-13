import { createContext, useContext } from "react";

export const PlayerInteractionContext = createContext({
  setPanelOpen: (_panel: string, _open: boolean) => {},
});

export const usePlayerInteraction = () => useContext(PlayerInteractionContext);
