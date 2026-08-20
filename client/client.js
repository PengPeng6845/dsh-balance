/*
 * @pengpeng6845/dsh-balance client: sidebar balance widget.
 *
 * Hand-written __ModuleLoader__ bundle (no build step). The widget
 * registers into the sidebar.footer.action list slot, polls
 * GET /dsh-balance/summary every 15 seconds (paused while the tab is
 * hidden), and shows ONLY the real account balance from the official
 * /user/balance endpoint. Texts ride the locale service (zh/en).
 *
 * Visual language matches the native sidebar rows: flat, no card — 8px
 * radius, 0 8px padding, hover-only background, --dsw-alias-* tokens.
 */
window.__ModuleLoader__.load({
  id: "@pengpeng6845/dsh-balance",
  factory: (require) => {
    "use strict";
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");

    var name = "balance";
    var inject = ["slots"];
    var NS = "@pengpeng6845/dsh-balance";

    var DICTS = {
      zh: {
        label: "余额",
        loading: "查询中…",
        unavailable: "不可用",
        title: "API 真实余额",
        today: "今日实际",
        low: "余额低于警戒线",
        stale: "数据过期（上次成功更新的值）",
        updated: "更新于",
        unavailableHint: "余额不可用：检查 DEEPSEEK_API_KEY 是否已配置（凭据环境变量），或网络是否可达",
      },
      en: {
        label: "Balance",
        loading: "Checking…",
        unavailable: "Unavailable",
        title: "Real API balance",
        today: "Today's spend",
        low: "Below low-balance alert",
        stale: "Stale (last successful value)",
        updated: "Updated",
        unavailableHint: "Balance unavailable: check that DEEPSEEK_API_KEY is configured (credential env var) or that the network is reachable",
      },
    };

    var CSS = [
      ".ub-wrap{display:flex;flex-direction:column;gap:2px;padding:2px 0}",
      ".ub-row{cursor:default;user-select:none;display:flex;align-items:center;gap:6px;",
      "border-radius:8px;padding:0 8px;height:24px;",
      "color:var(--dsw-alias-label-primary,#3f3f46);font-size:12px;line-height:17px}",
      ".ub-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08))}",
      ".ub-label{flex:1;min-width:0;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.85))}",
      ".ub-value{font-variant-numeric:tabular-nums;font-weight:600}",
      ".ub-value.ub-warn{color:var(--dsw-alias-state-warn-primary,#d97706)}",
      ".ub-value.ub-stale{opacity:.55}",
      ".ub-compact{justify-content:center;padding:0 6px}",
    ].join("\n");

    var cssInstalled = false;
    function ensureCss() {
      if (cssInstalled) return;
      cssInstalled = true;
      if (typeof document === "undefined") return;
      var id = "@pengpeng6845/dsh-balance/client.css";
      if (document.querySelector("style[data-plugin-css=" + JSON.stringify(id) + "]") !== null) return;
      var tag = document.createElement("style");
      tag.dataset.plugin = "@pengpeng6845/dsh-balance";
      tag.dataset.pluginCss = id;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    function money(n, currency) {
      var symbol = currency === "USD" ? "$" : currency === "EUR" ? "EUR " : "¥";
      return symbol + (Number(n) || 0).toFixed(2);
    }

    function valueClass(data) {
      var classes = "";
      if (data && data.lowBalance === true) classes += " ub-warn";
      if (data && data.balance && data.balance.stale === true) classes += " ub-stale";
      return classes;
    }

    function makeWidget(t) {
      return function BalanceWidget(props) {
        var wide = !(props && props.wide === false);
        var state = React.useState(null);
        var data = state[0];
        var setData = state[1];
        var settled = React.useRef(false);

        React.useEffect(function () {
          var stop = false;
          function load() {
            fetch("/dsh-balance/summary")
              .then(function (resp) {
                if (!resp.ok) return null;
                return resp.json();
              })
              .then(function (json) {
                if (stop || !json || typeof json !== "object") return;
                settled.current = true;
                setData(json);
              })
              .catch(function () {});
          }
          function onVisibility() {
            if (document.hidden) return;
            load();
          }
          load();
          var id = setInterval(function () {
            if (!document.hidden) load();
          }, 15000);
          document.addEventListener("visibilitychange", onVisibility);
          return function () {
            stop = true;
            clearInterval(id);
            document.removeEventListener("visibilitychange", onVisibility);
          };
        }, []);

        var pending = !settled.current && !data;

        if (pending) {
          return React.createElement(
            "div",
            { className: "ub-row", title: "@pengpeng6845/dsh-balance" },
            React.createElement("span", { className: "ub-label" }, wide ? t("loading") : "…"),
          );
        }

        var unavailable = !data || !data.balance;
        if (unavailable) {
          return React.createElement(
            "div",
            { className: "ub-row", title: t("unavailableHint") },
            React.createElement("span", { className: "ub-label" }, wide ? t("unavailable") : "—"),
          );
        }

        var bal = data.balance;
        var valueText = money(bal.totalBalance, bal.currency);
        var title = t("title") + " " + valueText;
        if (typeof data.realTodayCost === "number" && data.realTodayCost > 0) {
          title += " · " + t("today") + " " + money(data.realTodayCost, bal.currency);
        }
        if (data.lowBalance === true) {
          title += " · " + t("low") + " " + money(data.lowBalanceThreshold, bal.currency);
        }
        if (bal.stale === true) {
          title += " · " + t("stale");
        }
        if (bal.checkedAt) {
          title += " · " + t("updated") + " " + new Date(bal.checkedAt).toLocaleTimeString();
        }

        if (!wide) {
          return React.createElement(
            "div",
            { className: "ub-row ub-compact", title: title },
            React.createElement("span", { className: "ub-value" + valueClass(data) }, valueText),
          );
        }

        return React.createElement(
          "div",
          { className: "ub-row", title: title },
          React.createElement("span", { className: "ub-label" }, t("label")),
          React.createElement("span", { className: "ub-value" + valueClass(data) }, valueText),
        );
      };
    }

    function apply(ctx) {
      var slots = ctx.get("slots");
      if (slots === undefined) return;
      var locale = ctx.get("locale");
      var t;
      if (locale) {
        ctx.effect(() => locale.register(NS, DICTS));
        t = locale.bind(NS);
      } else {
        t = function (key) {
          return DICTS.zh[key] ?? key;
        };
      }
      ensureCss();
      ctx.effect(function () {
        return slots.inject("sidebar.footer.action", function () {
          return slots.register(
            { name: "sidebar.footer.action", id: "balance" },
            makeWidget(t),
          );
        });
      });
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
