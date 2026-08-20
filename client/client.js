/*
 * dsh-usage-cost client: sidebar cost widget.
 *
 * Hand-written __ModuleLoader__ bundle (no build step). The client runtime
 * serves this file and calls the factory with the module require; only
 * "react" is consumed. The widget registers into the sidebar.footer.action
 * list slot and polls GET /usage-cost/summary every 10 seconds.
 *
 * Visual language matches the native sidebar rows (see the workspace rows
 * CSS in dsh-client-ui-workspace): flat, no card — 8px radius, 0 8px
 * padding, hover-only background, --dsw-alias-* tokens, status dot.
 */
window.__ModuleLoader__.load({
  id: "dsh-usage-cost",
  factory: (require) => {
    "use strict";
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");

    var name = "usage-cost";
    var inject = ["slots"];

    var CSS = [
      ".uc-wrap{display:flex;flex-direction:column;gap:2px;padding:2px 0}",
      ".uc-row{cursor:default;user-select:none;display:flex;align-items:center;gap:6px;",
      "border-radius:8px;padding:0 8px;height:24px;",
      "color:var(--dsw-alias-label-primary,#3f3f46);font-size:12px;line-height:17px}",
      ".uc-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08))}",
      ".uc-label{flex:1;min-width:0;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.85))}",
      ".uc-value{font-variant-numeric:tabular-nums;font-weight:600}",
      ".uc-value.uc-warn{color:var(--dsw-alias-state-warn-primary,#d97706)}",
      ".uc-value.uc-alert{color:var(--dsw-alias-state-error-primary,#dc2626)}",
      ".uc-dot{flex:none;width:6px;height:6px;border-radius:50%;",
      "background:var(--dsw-alias-state-success-primary,#22c55e)}",
      ".uc-dot.uc-warn{background:var(--dsw-alias-state-warn-primary,#d97706)}",
      ".uc-dot.uc-alert{background:var(--dsw-alias-state-error-primary,#dc2626)}",
      ".uc-compact{justify-content:center;padding:0 6px}",
    ].join("\n");

    var cssInstalled = false;
    function ensureCss() {
      if (cssInstalled) return;
      cssInstalled = true;
      if (typeof document === "undefined") return;
      var id = "dsh-usage-cost/client.css";
      if (document.querySelector("style[data-plugin-css=" + JSON.stringify(id) + "]") !== null) return;
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-usage-cost";
      tag.dataset.pluginCss = id;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    function money(n, currency) {
      var symbol = currency === "USD" ? "$" : currency === "EUR" ? "EUR " : "¥";
      return symbol + (Number(n) || 0).toFixed(2);
    }

    function tokensText(n) {
      var v = Number(n) || 0;
      if (v >= 1000000) return (v / 1000000).toFixed(2) + "M";
      if (v >= 1000) return (v / 1000).toFixed(1) + "k";
      return String(v);
    }

    function levelClass(cost, thresholds) {
      if (thresholds && cost >= thresholds.alert) return " uc-alert";
      if (thresholds && cost >= thresholds.warn) return " uc-warn";
      return "";
    }

    function row(label, valueText, level, showDot) {
      return React.createElement(
        "div",
        { className: "uc-row" },
        React.createElement("span", { className: "uc-label" }, label),
        showDot === false
          ? null
          : React.createElement("span", { className: "uc-dot" + level }),
        React.createElement("span", { className: "uc-value" + level }, valueText),
      );
    }

    function CostWidget(props) {
      var wide = !(props && props.wide === false);
      var state = React.useState(null);
      var data = state[0];
      var setData = state[1];

      React.useEffect(function () {
        var stop = false;
        function load() {
          fetch("/usage-cost/summary")
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
        var id = setInterval(load, 10000);
        return function () {
          stop = true;
          clearInterval(id);
        };
      }, []);

      if (!data) {
        return React.createElement(
          "div",
          { className: "uc-row", title: "dsh-usage-cost" },
          React.createElement("span", { className: "uc-label" }, wide ? "成本统计中…" : "…"),
        );
      }

      var today = data.today || { cost: 0, totalTokens: 0 };
      var month = data.month || { cost: 0, totalTokens: 0 };
      var thresholds = data.thresholds || {};
      var todayLevel = levelClass(today.cost, thresholds);
      var monthLevel = levelClass(month.cost, thresholds);
      var title =
        "API 成本 · 今日(估算) " +
        money(today.cost, data.currency) +
        "（" +
        tokensText(today.totalTokens) +
        " tokens）· 本月 " +
        money(month.cost, data.currency);
      if (data.balance) {
        title +=
          " · 真实余额 " +
          money(data.balance.totalBalance, data.balance.currency);
      }
      if (typeof data.realTodayCost === "number") {
        title += " · 今日实际(余额差) " + money(data.realTodayCost, data.currency);
      }

      if (!wide) {
        return React.createElement(
          "div",
          { className: "uc-row uc-compact", title: title },
          React.createElement("span", { className: "uc-dot" + todayLevel }),
          React.createElement(
            "span",
            { className: "uc-value" + todayLevel },
            money(today.cost, data.currency),
          ),
        );
      }

      return React.createElement(
        "div",
        { className: "uc-wrap", title: title },
        row("今日", money(today.cost, data.currency), todayLevel),
        row("本月", money(month.cost, data.currency), monthLevel),
        data.balance
          ? row("余额", money(data.balance.totalBalance, data.balance.currency), "", false)
          : null,
      );
    }

    function apply(ctx) {
      var slots = ctx.get("slots");
      if (slots === undefined) return;
      ensureCss();
      ctx.effect(function () {
        return slots.inject("sidebar.footer.action", function () {
          return slots.register(
            { name: "sidebar.footer.action", id: "usage-cost" },
            CostWidget,
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
