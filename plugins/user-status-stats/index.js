/* Official-store plugin: host features are reached exclusively through BetterVRCX0. */
(() => {
  "use strict";
  const statuses = ["active", "join me", "ask me", "busy"];
  const normalizeStatus = (value) => {
    const text = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (text === "joinme") return "join me";
    if (text === "askme") return "ask me";
    return statuses.includes(text) ? text : null;
  };
  const timestamp = (value) =>
    typeof value === "number" ? value : Date.parse(value);

  // Integrates intervals, never event counts. Before-range rows are boundary seeds.
  function calculateUsage(rows, from, to) {
    const start = timestamp(from);
    const end = timestamp(to);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
      throw new Error("Invalid status-history interval");
    }
    const totals = Object.fromEntries(statuses.map((status) => [status, 0]));
    let unknownMilliseconds = 0;
    let offlineMilliseconds = 0;
    const seen = new Set();
    const priority = { Status: 0, Online: 1, Offline: 2 };
    const events = rows
      .flatMap((row, index) => {
        if (!row || !Object.hasOwn(priority, row.type)) return [];
        const time = timestamp(row.created_at ?? row.createdAt);
        if (!Number.isFinite(time) || time > end) return [];
        const key =
          row.rowId != null
            ? `${row.type}:${row.sourceRank ?? ""}:${row.rowId}`
            : JSON.stringify([time, row.type, row.status, row.previousStatus]);
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ ...row, time, index }];
      })
      .sort(
        (a, b) =>
          a.time - b.time ||
          priority[a.type] - priority[b.type] ||
          (a.sourceRank ?? 0) - (b.sourceRank ?? 0) ||
          (a.rowId ?? a.index) - (b.rowId ?? b.index),
      );

    let presence = null;
    let status = null;
    let cursor = events.length ? Math.min(events[0].time, start) : start;
    const accrue = (next, resolved = status) => {
      const duration = Math.max(
        0,
        Math.min(next, end) - Math.max(cursor, start),
      );
      if (presence === false) offlineMilliseconds += duration;
      else if (presence === true && resolved) totals[resolved] += duration;
      else unknownMilliseconds += duration;
    };
    for (const event of events) {
      // Duplicate presence notifications do not split an unknown online
      // segment that a later previousStatus can resolve.
      if (
        event.type === "Online" &&
        presence === true &&
        !normalizeStatus(event.status)
      )
        continue;
      let resolved = status;
      const previous = normalizeStatus(
        event.previousStatus ?? event.previous_status,
      );
      // Online captures presence, not status. A subsequent Status event's
      // previousStatus can establish that online interval's prior value.
      if (event.type === "Status" && presence === true && previous) {
        resolved = status && status !== previous ? null : previous;
      }
      accrue(event.time, resolved);
      cursor = event.time;
      if (event.type === "Offline") {
        presence = false;
        status = null;
      } else if (event.type === "Online") {
        if (presence !== true) status = normalizeStatus(event.status);
        presence = true;
      } else if (String(event.status).toLowerCase() === "offline") {
        presence = false;
        status = null;
      } else {
        // VRCX-0 emits Status only while the previous presence is online.
        presence = true;
        status = normalizeStatus(event.status);
      }
    }
    accrue(end);
    const totalMilliseconds = Object.values(totals).reduce(
      (sum, value) => sum + value,
      0,
    );
    return {
      data: statuses.map((status) => ({
        status,
        milliseconds: totals[status],
        percentage: totalMilliseconds
          ? (totals[status] / totalMilliseconds) * 100
          : 0,
      })),
      totalMilliseconds,
      unknownMilliseconds,
      offlineMilliseconds,
      from: new Date(start).toISOString(),
      to: new Date(end).toISOString(),
    };
  }

  let disposals = [];
  let active = false;
  let generation = 0;
  registerPlugin({
    async start(api) {
      if (active) return;
      active = true;
      const ownGeneration = ++generation;
      const registrations = [];
      try {
        // Host adapters own native Activity placement and chart rendering.
        // Older loaders still expose the original user-dialog API.
        const addSection =
          typeof api.ui.addUserActivitySection === "function"
            ? api.ui.addUserActivitySection
            : api.ui.addUserDialogTab;
        if (typeof addSection !== "function")
          throw new Error(
            "BetterActivity requires a compatible user Activity adapter",
          );
        const provider = async ({ userId, period = 30 }, own = false) => {
          if (!active || generation !== ownGeneration)
            throw new Error("Plugin is stopped");
          const selected = [7, 30, 90, 180, 365, "all"].includes(period)
            ? period
            : 30;
          const history = await (own ? api.vrcx.queryOwnFeed : api.vrcx.queryFeed)({
            userId,
            period: selected,
          });
          if (!active || generation !== ownGeneration)
            throw new Error("Plugin is stopped");
          return {
            ...calculateUsage(history.rows, history.from, history.to),
            coverage: history.coverage,
            periodLabel:
              selected === "all"
                ? "All recorded history"
                : `Past ${selected} days`,
          };
        };
        registrations.push(await addSection.call(
          api.ui,
          {
            id: "status-usage",
            title: "BetterActivity",
            kind: "status-statistics",
            periods: [7, 30, 90, 180, 365, "all"],
            defaultPeriod: 30,
            periodSource: "activity",
          },
          (context) => provider(context, false),
        ));
        if (typeof api.ui.addOwnActivitySection === "function") {
          registrations.push(await api.ui.addOwnActivitySection(
            {
              id: "own-status-usage",
              title: "BetterActivity",
              kind: "status-statistics",
              periods: [30, 90, 180, 365, "all"],
              defaultPeriod: 30,
              periodSource: "activity-page",
            },
            (context) => provider(context, true),
          ));
        }
        if (active && generation === ownGeneration) disposals = registrations;
        else await Promise.allSettled(registrations.map((registration) => registration()));
      } catch (error) {
        if (generation === ownGeneration) {
          active = false;
        }
        await Promise.allSettled(registrations.reverse().map((registration) => registration()));
        throw error;
      }
    },
    async stop() {
      active = false;
      ++generation;
      const cleanup = disposals;
      disposals = [];
      const results = await Promise.allSettled(
        cleanup.reverse().map(async (remove) => {
          await remove();
        }),
      );
      const failed = results.find((result) => result.status === "rejected");
      if (failed) throw failed.reason;
    },
  });
})();
