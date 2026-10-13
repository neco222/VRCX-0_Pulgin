(() => {
  "use strict";

  let generation = 0;
  let dispose = null;

  registerPlugin({
    async start(api) {
      const activeGeneration = ++generation;
      const previousDispose = dispose;
      dispose = null;
      await previousDispose?.();
      if (activeGeneration !== generation) return;

      if (typeof api?.ui?.addUserReviewTab !== "function") {
        throw new Error("すききらVRC requires BetterDiscord v0.4.0 or later. Please update BetterDiscord and restart VRCX-0. / BetterDiscord v0.4.0以降へ更新し、VRCX-0を再起動してください。");
      }

      let tabDispose;
      try {
        // The host owns the fixed review view and supported site API integration.
        tabDispose = await api.ui.addUserReviewTab({
          id: "review",
          title: "レビュー",
          localizedTitle: { ja: "レビュー", en: "Review" },
        });
      } catch (error) {
        // A completed stop or newer start supersedes this registration.
        if (activeGeneration !== generation) return;
        throw error;
      }

      if (activeGeneration !== generation) await tabDispose?.();
      else dispose = tabDispose;
    },
    async stop() {
      ++generation;
      const activeDispose = dispose;
      dispose = null;
      await activeDispose?.();
    },
  });
})();
