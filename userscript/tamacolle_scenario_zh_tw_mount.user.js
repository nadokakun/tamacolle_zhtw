// ==UserScript==
// @name         Tamacolle Scenario zh-TW Mount
// @namespace    local.tamacolle.translation
// @version      2.0.0
// @description  Mount Traditional Chinese translated scenario txt files for Tamacolle.
// @match        https://tukitama.com/tamacolle/*
// @match        https://nijitama.app/games/tamacolle/*
// @match        https://nijitama.app/games/tamacolle/index*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      nadokakun.github.io
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = {
    locale: "zh-TW",
    version: "2.0.0",
    translationBaseUrl: "https://nadokakun.github.io/tamacolle_zhtw/zh_tw/raw/",
    timeoutMs: 15000
  };

  const cache = new Map();
  const pending = new Map();
  let requestId = 0;

  const REQUEST_EVENT = "__tamacolleZhTwRequest";
  const RESPONSE_EVENT = "__tamacolleZhTwResponse";

  function normalizeUrl(input) {
    try {
      return new URL(String(input), location.href);
    } catch (_) {
      return null;
    }
  }

  function scenarioFile(input) {
    const url = normalizeUrl(input);
    if (!url) return null;
    const match = url.pathname.match(/\/resources\/scenario\/(scenario_[^/?#]+\.txt)$/);
    return match ? match[1] : null;
  }

  function translationUrl(file) {
    return new URL(file, CONFIG.translationBaseUrl).toString();
  }

  function fetchTranslation(file) {
    if (cache.has(file)) return cache.get(file);

    const promise = new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: "GET",
        url: translationUrl(file),
        timeout: CONFIG.timeoutMs,
        responseType: "text",
        onload: function (response) {
          if (response.status >= 200 && response.status < 300) {
            resolve(response.responseText);
            return;
          }
          reject(new Error("translation not found: " + file + " (" + response.status + ")"));
        },
        onerror: function () {
          reject(new Error("translation request failed: " + file));
        },
        ontimeout: function () {
          reject(new Error("translation request timed out: " + file));
        }
      });
    }).catch(function (error) {
      cache.delete(file);
      throw error;
    });

    cache.set(file, promise);
    return promise;
  }

  window.addEventListener(REQUEST_EVENT, function (event) {
    const detail = event && event.detail;
    if (!detail || !detail.id || !detail.file) return;

    fetchTranslation(detail.file).then(function (body) {
      window.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
        detail: {
          id: detail.id,
          ok: true,
          body: body
        }
      }));
    }).catch(function (error) {
      window.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
        detail: {
          id: detail.id,
          ok: false,
          error: error && error.message ? error.message : String(error)
        }
      }));
    });
  });

  const pageScript = document.createElement("script");
  pageScript.textContent = "(" + function (config, requestEvent, responseEvent) {
    "use strict";

    const pending = new Map();
    let requestId = 0;

    function normalizeUrl(input) {
      try {
        return new URL(String(input), location.href);
      } catch (_) {
        return null;
      }
    }

    function scenarioFile(input) {
      const url = normalizeUrl(input);
      if (!url) return null;
      const match = url.pathname.match(/\/resources\/scenario\/(scenario_[^/?#]+\.txt)$/);
      return match ? match[1] : null;
    }

    function requestTranslation(file) {
      return new Promise(function (resolve, reject) {
        const id = "tama-zh-" + (++requestId);
        pending.set(id, { resolve: resolve, reject: reject });
        window.dispatchEvent(new CustomEvent(requestEvent, {
          detail: { id: id, file: file }
        }));
      });
    }

    window.addEventListener(responseEvent, function (event) {
      const detail = event && event.detail;
      if (!detail || !detail.id) return;
      const entry = pending.get(detail.id);
      if (!entry) return;
      pending.delete(detail.id);
      if (detail.ok) {
        entry.resolve(detail.body);
      } else {
        entry.reject(new Error(detail.error || "translation unavailable"));
      }
    });

    const nativeFetch = window.fetch;
    if (nativeFetch) {
      window.fetch = function (input, init) {
        const url = typeof input === "string" ? input : input && input.url;
        const file = scenarioFile(url);
        if (!file) {
          return nativeFetch.apply(this, arguments);
        }

        return requestTranslation(file).then(function (body) {
          return new Response(body, {
            status: 200,
            statusText: "OK",
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "X-Tamacolle-Translation": config.locale
            }
          });
        }).catch(function () {
          return nativeFetch.apply(this, arguments);
        }.bind(this));
      };
    }

    const nativeOpen = XMLHttpRequest.prototype.open;
    const nativeSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      this.__tamaZhUrl = url;
      return nativeOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
      const sendArgs = arguments;
      const file = scenarioFile(this.__tamaZhUrl);
      if (!file) {
        return nativeSend.apply(this, sendArgs);
      }

      const xhr = this;
      requestTranslation(file).then(function (body) {
        setTimeout(function () {
          const responseUrl = String(xhr.__tamaZhUrl || "");
          const responseHeaders = "content-type: text/plain; charset=utf-8
x-tamacolle-translation: " + config.locale + "
";
          Object.defineProperty(xhr, "readyState", { configurable: true, value: 4 });
          Object.defineProperty(xhr, "status", { configurable: true, value: 200 });
          Object.defineProperty(xhr, "statusText", { configurable: true, value: "OK" });
          Object.defineProperty(xhr, "responseURL", { configurable: true, value: responseUrl });
          Object.defineProperty(xhr, "responseType", { configurable: true, value: xhr.responseType || "" });
          Object.defineProperty(xhr, "responseText", { configurable: true, value: body });
          Object.defineProperty(xhr, "response", { configurable: true, value: body });
          xhr.getAllResponseHeaders = function () { return responseHeaders; };
          xhr.getResponseHeader = function (name) {
            if (!name) return null;
            const lower = String(name).toLowerCase();
            if (lower === "content-type") return "text/plain; charset=utf-8";
            if (lower === "x-tamacolle-translation") return config.locale;
            return null;
          };
          xhr.overrideMimeType = function () {};

          const readystatechange = new Event("readystatechange");
          const progress = new ProgressEvent("progress", { lengthComputable: true, loaded: body.length, total: body.length });
          const load = new Event("load");
          const loadend = new Event("loadend");

          if (typeof xhr.onreadystatechange === "function") xhr.onreadystatechange(readystatechange);
          xhr.dispatchEvent(readystatechange);
          if (typeof xhr.onprogress === "function") xhr.onprogress(progress);
          xhr.dispatchEvent(progress);
          if (typeof xhr.onload === "function") xhr.onload(load);
          xhr.dispatchEvent(load);
          if (typeof xhr.onloadend === "function") xhr.onloadend(loadend);
          xhr.dispatchEvent(loadend);
        }, 0);
      }).catch(function () {
        nativeSend.apply(xhr, sendArgs);
      });
    };

    window.__tamacolleScenarioZhTwConfig = config;
  } + ")(" + JSON.stringify(CONFIG) + "," + JSON.stringify(REQUEST_EVENT) + "," + JSON.stringify(RESPONSE_EVENT) + ");";
  (document.documentElement || document.head || document.body).appendChild(pageScript);
  pageScript.remove();
})();
