/* Official-store plugin: VRCX data and UI are accessed through BetterVRCX0 only. */
(() => {
  "use strict";
  let dispose = null;

  registerPlugin({
    async start(api) {
      dispose = await api.ui.addUserActivitySummarySection(
        {
          id: "friend-introductions",
          title: "BetterFriendLog",
          localizedTitle: { ja: "フレンドログ", en: "Friend Log" },
          kind: "friend-introductions",
          periods: ["all"],
          defaultPeriod: "all",
        },
        ({ userId }) => api.vrcx.queryFriendIntroductions(userId),
      );
    },
    async stop() {
      await dispose?.();
      dispose = null;
    },
  });
})();
