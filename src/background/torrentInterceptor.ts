import { getMutableStateSingleton } from "./backgroundState";
import { addDownloadTasksAndPoll } from "./actions";
import { onStoredStateChange } from "../common/state/listen";

const TORRENT_CONTENT_TYPES = [
  "application/x-bittorrent",
  "application/octet-stream",
];

const TORRENT_URL_PATTERNS = [
  /\.torrent(\?|$)/i,
  /gettorrent\.php/i,
  /torrents\.php\?action=download/i,
  /\/download\.php\?.*id=/i,
  /\/torrents\/download\//i,
];

let enabled = false;

onStoredStateChange((state) => {
  enabled = state.settings.shouldHandleDownloadLinks;
});

function isTorrentContentType(headers: browser.webRequest.HttpHeaders): boolean {
  const contentType = headers.find(
    (h) => h.name.toLowerCase() === "content-type",
  );
  if (!contentType || !contentType.value) {
    return false;
  }
  const value = contentType.value.toLowerCase();
  return TORRENT_CONTENT_TYPES.some((type) => value.includes(type));
}

function isTorrentUrl(url: string): boolean {
  return TORRENT_URL_PATTERNS.some((pattern) => pattern.test(url));
}

function hasContentDispositionTorrent(headers: browser.webRequest.HttpHeaders): boolean {
  const disposition = headers.find(
    (h) => h.name.toLowerCase() === "content-disposition",
  );
  if (!disposition || !disposition.value) {
    return false;
  }
  return /\.torrent/i.test(disposition.value);
}

function shouldIntercept(
  details: browser.webRequest._OnHeadersReceivedDetails,
): boolean {
  if (!enabled) {
    return false;
  }

  // Only intercept top-level navigations and downloads - not XHRs, images, etc.
  if (details.type !== "main_frame" && details.type !== "sub_frame") {
    return false;
  }

  const headers = details.responseHeaders || [];
  const contentType = headers.find(
    (h) => h.name.toLowerCase() === "content-type",
  );
  const contentTypeValue = contentType?.value?.toLowerCase() || "";

  // Definite torrent: content-type is explicitly x-bittorrent
  if (contentTypeValue.includes("application/x-bittorrent")) {
    return true;
  }

  // Probable torrent: octet-stream with a torrent-like URL or content-disposition
  if (contentTypeValue.includes("application/octet-stream")) {
    if (isTorrentUrl(details.url) || hasContentDispositionTorrent(headers)) {
      return true;
    }
  }

  return false;
}

export function initializeTorrentInterceptor() {
  browser.webRequest.onHeadersReceived.addListener(
    (details) => {
      if (!shouldIntercept(details)) {
        return {};
      }

      const state = getMutableStateSingleton();
      addDownloadTasksAndPoll(
        state.api,
        state.pollRequestManager,
        state.showNonErrorNotifications,
        [details.url],
      );

      return { cancel: true };
    },
    { urls: ["http://*/*", "https://*/*"] },
    ["blocking", "responseHeaders"],
  );
}
