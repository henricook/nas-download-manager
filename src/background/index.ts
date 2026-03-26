import "../common/init/nonContentContext";
import { onStoredStateChange, maybeMigrateState } from "../common/state";
import { saveLastSevereError } from "../common/errorHandlers";
import { onStoredStateChange as onStoredStateChangeListener } from "./onStateChange";
import { initializeContextMenus } from "./contextMenus";
import { initializeMessageHandler } from "./messages";
import { initializeTorrentInterceptor } from "./torrentInterceptor";

initializeContextMenus();
initializeMessageHandler();
initializeTorrentInterceptor();

maybeMigrateState()
  .then(() => {
    onStoredStateChange(onStoredStateChangeListener);
  })
  .catch(saveLastSevereError);
