import type { OmitStrict } from "../../types";

import type { State as State_7, Settings as Settings_7 } from "./7";

export {
  VisibleTaskSettings,
  TaskSortType,
  NotificationSettings,
  CachedTasks,
  ConnectionSettings,
  Logging,
  BadgeDisplayType,
} from "./7";

export interface StateVersion {
  stateVersion: 8;
}

export interface Settings extends Settings_7 {
  destinationPaths: string[];
}

export interface State extends StateVersion, OmitStrict<State_7, "settings" | "stateVersion"> {
  settings: Settings;
}

export function migrate(state: State_7): State {
  return {
    ...state,
    stateVersion: 8,
    settings: {
      ...state.settings,
      destinationPaths: [],
    },
  };
}
