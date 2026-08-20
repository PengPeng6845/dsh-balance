/*
 * @pengpeng6845/dsh-balance client: sidebar balance widget.
 *
 * Hand-written __ModuleLoader__ bundle (no build step). The widget
 * registers into the sidebar.footer.action list slot, polls
 * GET /dsh-balance/summary every 30 seconds, and shows ONLY the real
 * account balance from the official /user/balance endpoint.
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

    var CSS = [
      ".ub-wrap{display:flex;flex-direction:column;gap:2px;padding:2px 0}",
      ".ub-row{cursor:default;user-select:none;display:flex;align-items:center;gap:6px;",
      "border-radius:8px;padding:0 8px;height:24px;",
      "color:var(--dsw-alias-label-primary,#3f3f46);font-size:12px;line-height:17px}",
      ".ub-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08))}",
      ".ub-label{flex:1;min-width:0;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.85))}",
      ".ub-value{font-variant-numeric:tabular-nums;font-weight:600}",
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

    function BalanceWidget(props) {
      var wide = !(props && props.wide === false);
      var state = React.useState(null);
      var data = state[0];
      var setData = state[1];

      React.useEffect(function () {
        var stop = false;
        function load() {
          fetch("/dsh-balance/summary")
            .then(function (resp) {
              if (!resp.ok) return null;
              return resp.json();
            })
            .then(function (json) {
              if (!stop && json && typeof json === "object") setData(json);
            })
            .catch(function () {});
        }
        load();
        var id = setInterval(load, 30000);
        return function () {
          stop = true;
          clearInterval(id);
        };
      }, []);

      if (!data || !data.balance) {
        return React.createElement(
          "div",
          { className: "ub-row", title: "@pengpeng6845/dsh-balance" },
          React.createElement("span", { className: "ub-label" }, wide ? "余额查询中…" : "…"),
        );
      }

      var bal = data.balance;
      var valueText = money(bal.totalBalance, bal.currency);
      var title = "API 真实余额 " + valueText;
      if (typeof data.realTodayCost === "number" && data.realTodayCost > 0) {
        title += " · 今日实际 " + money(data.realTodayCost, bal.currency);
      }
      if (bal.checkedAt) {
        title += " · 更新于 " + new Date(bal.checkedAt).toLocaleTimeString();
      }

      if (!wide) {
        return React.createElement(
          "div",
          { className: "ub-row ub-compact", title: title },
          React.createElement("span", { className: "ub-value" }, valueText),
        );
      }

      return React.createElement(
        "div",
        { className: "ub-row", title: title },
        React.createElement("span", { className: "ub-label" }, "余额"),
        React.createElement("span", { className: "ub-value" }, valueText),
      );
    }

    function apply(ctx) {
      var slots = ctx.get("slots");
      if (slots === undefined) return;
      ensureCss();
      ctx.effect(function () {
        return slots.inject("sidebar.footer.action", function () {
          return slots.register(
            { name: "sidebar.footer.action", id: "balance" },
            BalanceWidget,
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
