/*
 * dsh-usage-cost client: sidebar cost widget.
 *
 * Hand-written __ModuleLoader__ bundle (no build step). The client runtime
 * serves this file and calls the factory with the module require; only
 * "react" is consumed. The widget registers into the sidebar.footer.action
 * list slot and polls GET /usage-cost/summary every 10 seconds.
 *
 * Styling rides the DSH theme tokens (--dsw-alias-*) with neutral
 * fallbacks, so the card adapts to light and dark themes.
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
      ".uc-card{display:flex;flex-direction:column;gap:6px;padding:8px 10px;",
      "border-radius:10px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.16));",
      "background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.05));",
      "font-size:12px;line-height:1.4;color:var(--dsw-alias-label-primary,inherit);",
      "user-select:none;transition:border-color .15s ease}",
      ".uc-card:hover{border-color:var(--dsw-alias-border-l2,rgba(128,128,128,.28))}",
      ".uc-head{display:flex;align-items:center;gap:6px}",
      ".uc-dot{flex:none;width:7px;height:7px;border-radius:50%;",
      "background:var(--dsw-alias-state-success-primary,#22c55e);",
      "animation:uc-pulse 2.4s ease-in-out infinite}",
      ".uc-dot.uc-warn{background:var(--dsw-alias-state-warn-primary,#d97706)}",
      ".uc-dot.uc-alert{background:var(--dsw-alias-state-error-primary,#dc2626)}",
      "@keyframes uc-pulse{0%,100%{opacity:1}50%{opacity:.4}}",
      ".uc-title{flex:1;font-size:11px;font-weight:600;letter-spacing:.02em;",
      "color:var(--dsw-alias-label-secondary,rgba(128,128,128,.9))}",
      ".uc-live{font-size:10px;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.7))}",
      ".uc-row{display:flex;justify-content:space-between;align-items:baseline;gap:10px}",
      ".uc-label{color:var(--dsw-alias-label-secondary,rgba(128,128,128,.9))}",
      ".uc-amount{font-size:14px;font-weight:650;font-variant-numeric:tabular-nums;",
      "color:var(--dsw-alias-label-primary,inherit)}",
      ".uc-amount.uc-warn{color:var(--dsw-alias-state-warn-primary,#d97706)}",
      ".uc-amount.uc-alert{color:var(--dsw-alias-state-error-primary,#dc2626)}",
      ".uc-sub{font-size:11px;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.75));",
      "font-variant-numeric:tabular-nums}",
      ".uc-divider{height:1px;background:var(--dsw-alias-border-l1,rgba(128,128,128,.14));",
      "margin:1px 0}",
      ".uc-compact{align-items:center;text-align:center}",
      ".uc-compact .uc-amount{font-size:13px}",
    ].join("\n");

    var styleEl = null;
    function styleTag() {
      if (styleEl === null) {
        styleEl = React.createElement("style", {
          dangerouslySetInnerHTML: { __html: CSS },
        });
      }
      return styleEl;
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
          React.Fragment,
          null,
          styleTag(),
          React.createElement(
            "div",
            { className: "uc-card", title: "dsh-usage-cost" },
            React.createElement(
              "div",
              { className: "uc-head" },
              React.createElement("span", { className: "uc-dot" }),
              React.createElement("span", { className: "uc-title" }, "API 成本"),
            ),
            React.createElement(
              "div",
              { className: "uc-label" },
              wide ? "统计加载中…" : "…",
            ),
          ),
        );
      }

      var today = data.today || { cost: 0, totalTokens: 0 };
      var month = data.month || { cost: 0, totalTokens: 0 };
      var thresholds = data.thresholds || {};
      var todayLevel = levelClass(today.cost, thresholds);
      var monthLevel = levelClass(month.cost, thresholds);
      var dotLevel = todayLevel || monthLevel;

      if (!wide) {
        return React.createElement(
          React.Fragment,
          null,
          styleTag(),
          React.createElement(
            "div",
            { className: "uc-card uc-compact", title: "API 成本 · 今日 ¥" + money(today.cost, data.currency).slice(1) + " · 本月 ¥" + money(month.cost, data.currency).slice(1) },
            React.createElement("span", { className: "uc-dot" + dotLevel }),
            React.createElement(
              "span",
              { className: "uc-amount" + todayLevel },
              money(today.cost, data.currency),
            ),
            React.createElement(
              "span",
              { className: "uc-sub" },
              "月 " + money(month.cost, data.currency),
            ),
          ),
        );
      }

      return React.createElement(
        React.Fragment,
        null,
        styleTag(),
        React.createElement(
          "div",
          { className: "uc-card", title: "API 成本（dsh-usage-cost）" },
          React.createElement(
            "div",
            { className: "uc-head" },
            React.createElement("span", { className: "uc-dot" + dotLevel }),
            React.createElement("span", { className: "uc-title" }, "API 成本"),
            React.createElement("span", { className: "uc-live" }, "实时"),
          ),
          React.createElement(
            "div",
            { className: "uc-row" },
            React.createElement("span", { className: "uc-label" }, "今日"),
            React.createElement(
              "span",
              { className: "uc-amount" + todayLevel },
              money(today.cost, data.currency),
            ),
          ),
          React.createElement("div", { className: "uc-divider" }),
          React.createElement(
            "div",
            { className: "uc-row" },
            React.createElement("span", { className: "uc-label" }, "本月"),
            React.createElement(
              "span",
              { className: "uc-amount" + monthLevel },
              money(month.cost, data.currency),
            ),
          ),
          React.createElement(
            "div",
            { className: "uc-row" },
            React.createElement("span", { className: "uc-label" }, "今日 tokens"),
            React.createElement("span", { className: "uc-sub" }, tokensText(today.totalTokens)),
          ),
        ),
      );
    }

    function apply(ctx) {
      var slots = ctx.get("slots");
      if (slots === undefined) return;
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
