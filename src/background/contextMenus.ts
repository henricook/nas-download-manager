import { getMutableStateSingleton } from "./backgroundState";
import { notify } from "../common/notify";
import { onStoredStateChange } from "../common/state/listen";

import { addDownloadTasksAndPoll } from "./actions";
import { ALL_DOWNLOADABLE_PROTOCOLS, startsWithAnyProtocol } from "../common/apis/protocols";

const CONTEXTS: ContextsMenuContextType[] = ["link", "audio", "video", "image", "selection"];

let currentDestinations: string[] = [];

function handleContextMenuClick(data: ContextMenusOnClickData, path?: string) {
  const state = getMutableStateSingleton();
  const options = path ? { path } : undefined;

  if (data.linkUrl) {
    addDownloadTasksAndPoll(
      state.api,
      state.pollRequestManager,
      state.showNonErrorNotifications,
      [data.linkUrl],
      options,
    );
  } else if (data.srcUrl) {
    addDownloadTasksAndPoll(
      state.api,
      state.pollRequestManager,
      state.showNonErrorNotifications,
      [data.srcUrl],
      options,
    );
  } else if (data.selectionText) {
    let urls = data.selectionText
      .split("\n")
      .map((url) => url.trim())
      .filter((url) => startsWithAnyProtocol(url, ALL_DOWNLOADABLE_PROTOCOLS));

    if (urls.length == 0) {
      notify(
        browser.i18n.getMessage("Failed_to_add_download"),
        browser.i18n.getMessage("Selected_text_is_not_a_valid_URL"),
        "failure",
      );
    } else {
      addDownloadTasksAndPoll(
        state.api,
        state.pollRequestManager,
        state.showNonErrorNotifications,
        urls,
        options,
      );
    }
  } else {
    notify(
      browser.i18n.getMessage("Failed_to_add_download"),
      browser.i18n.getMessage("URL_is_empty_or_missing"),
      "failure",
    );
  }
}

async function rebuildContextMenus(destinations: string[]) {
  await browser.contextMenus.removeAll();

  const baseTitle = browser.i18n.getMessage("Download_with_DownloadStation");

  if (destinations.length <= 1) {
    const path = destinations.length === 1 ? destinations[0] : undefined;
    browser.contextMenus.create({
      id: "download-default",
      enabled: true,
      title: baseTitle,
      contexts: CONTEXTS,
      onclick: (data) => handleContextMenuClick(data, path),
    });
  } else {
    const parentId = browser.contextMenus.create({
      id: "download-parent",
      enabled: true,
      title: baseTitle,
      contexts: CONTEXTS,
    });

    destinations.forEach((dest, i) => {
      browser.contextMenus.create({
        id: `download-dest-${i}`,
        parentId: parentId,
        title: dest,
        contexts: CONTEXTS,
        onclick: (data) => handleContextMenuClick(data, dest),
      });
    });
  }
}

export function initializeContextMenus() {
  onStoredStateChange((state) => {
    const newDestinations = state.settings.destinationPaths || [];
    if (JSON.stringify(newDestinations) !== JSON.stringify(currentDestinations)) {
      currentDestinations = newDestinations;
      rebuildContextMenus(newDestinations);
    }
  });
}
