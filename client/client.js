/*
 * dsh-usage-cost client: sidebar cost widget.
 *
 * Hand-written __ModuleLoader__ bundle (no build step). The client runtime
 * serves this file and calls the factory with the module require; only
 * "react" is consumed. The widget registers into the sidebar.footer.action
 * list slot and polls GET /usage-cost/summary every 10 seconds.
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

    var styles = {
      root: {
        display: "flex",
        flexDirection: "column",
        gap: "3px",
        padding: "6px 10px",
        borderRadius: "10px",
        background: "color-mix(in srgb, currentColor 6%, transparent)",
        fontSize: "12px",
        lineHeight: "1.35",
        userSelect: "none",
      },
      title: { opacity: 0.6, fontSize: "11px" },
      row: { display: "flex", justifyContent: "space-between", gap: "10px", whiteSpace: "nowrap" },
      label: { opacity: 0.75 },
      value: { fontVariantNumeric: "tabular-nums", fontWeight: 600 },
      ok: {},
      warn: { color: "#d97706" },
      alert: { color: "#dc2626" },
      compact: { display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" },
    };

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

    function colorStyle(cost, thresholds) {
      if (thresholds && cost >= thresholds.alert) return styles.alert;
      if (thresholds && cost >= thresholds.warn) return styles.warn;
      return styles.ok;
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
          { style: styles.root, title: "dsh-usage-cost" },
          React.createElement("div", { style: styles.label }, wide ? "成本统计加载中…" : "¥…"),
        );
      }

      var today = data.today || { cost: 0, totalTokens: 0 };
      var month = data.month || { cost: 0, totalTokens: 0 };
      var thresholds = data.thresholds || {};
      var todayStyle = Object.assign({}, styles.value, colorStyle(today.cost, thresholds));
      var monthStyle = Object.assign({}, styles.value, colorStyle(month.cost, thresholds));

      if (!wide) {
        return React.createElement(
          "div",
          { style: Object.assign({}, styles.root, styles.compact), title: "API 成本 · 今日/本月" },
          React.createElement("span", { style: todayStyle }, money(today.cost, data.currency)),
          React.createElement("span", { style: Object.assign({}, styles.label, { fontSize: "10px" }) }, "月 " + money(month.cost, data.currency)),
        );
      }

      return React.createElement(
        "div",
        { style: styles.root, title: "API 成本（dsh-usage-cost）" },
        React.createElement("div", { style: styles.title }, "API 成本"),
        React.createElement(
          "div",
          { style: styles.row },
          React.createElement("span", { style: styles.label }, "今日"),
          React.createElement("span", { style: todayStyle }, money(today.cost, data.currency)),
        ),
        React.createElement(
          "div",
          { style: styles.row },
          React.createElement("span", { style: styles.label }, "本月"),
          React.createElement("span", { style: monthStyle }, money(month.cost, data.currency)),
        ),
        React.createElement(
          "div",
          { style: styles.row },
          React.createElement("span", { style: styles.label }, "今日 tokens"),
          React.createElement("span", { style: styles.value }, tokensText(today.totalTokens)),
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
