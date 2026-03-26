import {
  ClientRequestResult,
  DownloadStation2,
} from "../common/apis/synology";
import type { FormFile } from "../common/apis/synology/shared";
import { getMutableStateSingleton } from "./backgroundState";
import { pollTasks } from "./actions";
import { notify } from "../common/notify";
import { getErrorForFailedResponse } from "../common/apis/errors";
import { onStoredStateChange } from "../common/state/listen";
import { getHostUrl } from "../common/state";

// The webextension-polyfill overwrites the native browser global and doesn't
// include Firefox-specific APIs like filterResponseData. Access it via the
// chrome global which Firefox also exposes and the polyfill doesn't touch.
declare const chrome: {
  webRequest: {
    filterResponseData: (requestId: string) => browser.webRequest.StreamFilter;
  };
};

const TORRENT_URL_PATTERNS = [
  /\.torrent(\?|$)/i,
  /gettorrent\.php/i,
  /torrents\.php\?action=download/i,
  /\/download\.php\?.*id=/i,
  /\/torrents\/download\//i,
];

let enabled = false;
let defaultDestination: string | undefined = undefined;
let nasBaseUrl: string | undefined = undefined;

onStoredStateChange((state) => {
  enabled = state.settings.shouldHandleDownloadLinks;
  const paths = state.settings.destinationPaths || [];
  defaultDestination = paths.length > 0 ? paths[0] : undefined;
  nasBaseUrl = getHostUrl(state.settings.connection);
});

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

function isNasUrl(url: string): boolean {
  if (!nasBaseUrl) {
    return false;
  }
  try {
    const reqHost = new URL(url).host;
    const nasHost = new URL(nasBaseUrl).host;
    return reqHost === nasHost;
  } catch {
    return false;
  }
}

function guessFilename(url: string, headers: browser.webRequest.HttpHeaders): string {
  const disposition = headers.find(
    (h) => h.name.toLowerCase() === "content-disposition",
  );
  if (disposition?.value) {
    const match = /filename=("([^"]+)"|([^\s;]+))/.exec(disposition.value);
    if (match) {
      const name = match[2] || match[3];
      if (name) return name;
    }
  }
  try {
    const pathname = new URL(url).pathname;
    const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
    if (lastSegment.length > 0) {
      return decodeURIComponent(lastSegment);
    }
  } catch {}
  return "download.torrent";
}

function shouldIntercept(
  details: browser.webRequest._OnHeadersReceivedDetails,
): boolean {
  if (!enabled) {
    return false;
  }

  if (details.type !== "main_frame" && details.type !== "sub_frame") {
    return false;
  }

  if (isNasUrl(details.url)) {
    return false;
  }

  const headers = details.responseHeaders || [];
  const contentType = headers.find(
    (h) => h.name.toLowerCase() === "content-type",
  );
  const contentTypeValue = contentType?.value?.toLowerCase() || "";

  if (contentTypeValue.includes("application/x-bittorrent")) {
    return true;
  }

  if (contentTypeValue.includes("application/octet-stream")) {
    if (isTorrentUrl(details.url) || hasContentDispositionTorrent(headers)) {
      return true;
    }
  }

  return false;
}

async function sendTorrentToDS(content: Blob, filename: string) {
  const state = getMutableStateSingleton();
  const api = state.api;

  const notificationId = state.showNonErrorNotifications
    ? notify(browser.i18n.getMessage("Adding_download"), filename)
    : undefined;

  const file: FormFile = { content, filename };

  try {
    const supportsNewApi = await api.Info.Query({
      query: [DownloadStation2.Task.API_NAME],
    });

    let result: ClientRequestResult<unknown>;

    if (
      !ClientRequestResult.isConnectionFailure(supportsNewApi) &&
      supportsNewApi.success &&
      (supportsNewApi.data[DownloadStation2.Task.API_NAME]?.maxVersion ?? 0) >= 2
    ) {
      result = await api.DownloadStation2.Task.Create({
        type: "file",
        file,
        destination: defaultDestination,
      });
    } else {
      result = await api.DownloadStation.Task.Create({
        file,
        destination: defaultDestination,
      });
    }

    if (ClientRequestResult.isConnectionFailure(result)) {
      notify(
        browser.i18n.getMessage("Failed_to_connect_to_DiskStation"),
        browser.i18n.getMessage("Please_check_your_settings"),
        "failure",
        notificationId,
      );
    } else if (result.success) {
      if (state.showNonErrorNotifications) {
        notify(
          browser.i18n.getMessage("Download_added"),
          filename,
          "success",
          notificationId,
        );
      }
    } else {
      notify(
        browser.i18n.getMessage("Failed_to_add_download"),
        getErrorForFailedResponse(result),
        "failure",
        notificationId,
      );
    }

    await pollTasks(api, state.pollRequestManager);
  } catch (e) {
    notify(
      browser.i18n.getMessage("Failed_to_add_download"),
      browser.i18n.getMessage("Unexpected_error_please_check_your_settings_and_try_again"),
      "failure",
      notificationId,
    );
  }
}

export function initializeTorrentInterceptor() {
  browser.webRequest.onHeadersReceived.addListener(
    (details) => {
      if (!shouldIntercept(details)) {
        return {};
      }

      const headers = details.responseHeaders || [];
      const filename = guessFilename(details.url, headers);

      const filter = chrome.webRequest.filterResponseData(details.requestId);
      const chunks: ArrayBuffer[] = [];

      filter.ondata = (event: { data: ArrayBuffer }) => {
        chunks.push(event.data);
      };

      filter.onstop = () => {
        filter.close();
        const blob = new Blob(chunks, { type: "application/x-bittorrent" });
        sendTorrentToDS(blob, filename);
      };

      filter.onerror = () => {
        filter.close();
      };

      return {};
    },
    { urls: ["http://*/*", "https://*/*"] },
    ["blocking", "responseHeaders"],
  );
}
