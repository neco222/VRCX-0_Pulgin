/* Official-store plugin: VRCX data and UI are accessed through BetterVRCX0 only. */
(() => {
  "use strict";
  const MAX_LOCATION_AGE_MS = 2 * 60 * 60 * 1000;
  let generation = 0;
  let dispose = null;

  const field = (row, ...names) => {
    for (const name of names) {
      if (row?.[name] !== undefined && row[name] !== null) return row[name];
    }
    return undefined;
  };
  const text = (row, ...names) => {
    const value = field(row, ...names);
    return typeof value === "string" ? value : "";
  };
  const userId = (row) => text(row, "userId", "user_id");
  const timestamp = (row) => Date.parse(text(row, "createdAt", "created_at"));
  const type = (row) => text(row, "type").trim().toLowerCase();
  const rows = (value) => Array.isArray(value) ? value.filter((row) => row && typeof row === "object") : [];
  const friendNumber = (row) => {
    const value = Number(field(row, "friendNumber", "friend_number"));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  };
  const location = (value) => {
    if (typeof value !== "string") return null;
    const match = value.trim().match(/^(wrld_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([^\s<>]+)$/i);
    return match ? `${match[1].toLowerCase()}:${match[2]}` : null;
  };
  const isOffline = (row) => type(row) === "offline" || (type(row) === "status" && text(row, "status").trim().toLowerCase() === "offline");

  function feedPresence(feedRows, id, at) {
    let online = false;
    let currentLocation = null;
    let locationAt = -Infinity;
    let offlineAt = -Infinity;
    const events = feedRows
      .filter((row) => userId(row) === id)
      .map((row) => ({ row, time: timestamp(row) }))
      .filter(({ time }) => Number.isFinite(time) && time <= at)
      // An Offline notification at the same instant must win over GPS/Online.
      .sort((a, b) => a.time - b.time || Number(isOffline(a.row)) - Number(isOffline(b.row)));
    for (const { row, time } of events) {
      if (isOffline(row)) {
        online = false;
        currentLocation = null;
        offlineAt = time;
      } else if (type(row) === "online") {
        online = true;
      } else if (["gps", "location"].includes(type(row))) {
        currentLocation = location(field(row, "location"));
        locationAt = time;
        // A valid GPS row already establishes online presence; a missing
        // earlier Online feed notification must not hide that evidence.
        if (currentLocation) online = true;
      }
    }
    return {
      location: online && at - locationAt <= MAX_LOCATION_AGE_MS ? currentLocation : null,
      locationAt,
      offlineAt,
    };
  }

  function friendshipAt(history, person, target, at) {
    const events = history
      .filter((row) => userId(row) === userId(person) && ["friend", "unfriend"].includes(type(row)))
      .map((row) => ({ row, time: timestamp(row) }))
      .filter(({ time }) => Number.isFinite(time));
    if (events.length) {
      const latest = events
        .filter(({ time }) => time <= at)
        .sort((a, b) => a.time - b.time || Number(type(a.row) === "unfriend") - Number(type(b.row) === "unfriend"))
        .at(-1);
      return {
        eligible: !!latest && type(latest.row) === "friend" && latest.time < at,
        known: !!latest && type(latest.row) === "friend" && latest.time < at,
      };
    }
    // Friend order is a useful fallback for old relationships whose Friend
    // log was never recorded, but is less certain than an actual past event.
    const personNumber = friendNumber(person);
    const targetNumber = friendNumber(target);
    return { eligible: personNumber !== null && targetNumber !== null && personNumber < targetNumber, known: false };
  }

  function encounterPresence(encounter, at) {
    if (!encounter || typeof encounter !== "object") return null;
    const encounterLocation = location(encounter.location);
    const start = timestamp(encounter);
    const duration = encounter.durationMs;
    if (!encounterLocation || !Number.isFinite(start) || at < start) return null;
    const validDuration = typeof duration === "number" && Number.isFinite(duration) && duration > 0;
    const end = validDuration ? start + duration : Infinity;
    const spanning = validDuration && at < end;
    const presence = new Map();
    const lastEvent = new Map();
    const events = rows(encounter.events)
      .map((row) => ({ row, time: timestamp(row) }))
      .filter(({ row, time }) => userId(row) && Number.isFinite(time) && time >= start && time <= Math.min(at, end) && ["onplayerjoined", "onplayerleft"].includes(type(row)))
      .sort((a, b) => a.time - b.time || Number(type(a.row) === "onplayerleft") - Number(type(b.row) === "onplayerleft"));
    for (const { row, time } of events) {
      lastEvent.set(userId(row), { time, present: type(row) === "onplayerjoined" });
      if (type(row) === "onplayerleft") presence.delete(userId(row));
      else presence.set(userId(row), time);
    }
    // An ended visit cannot prove current co-presence. Its recorded departures
    // still invalidate older Feed GPS, so preserve them within the visit bounds.
    return { location: encounterLocation, worldName: text(encounter, "worldName", "world_name"), spanning, presence, lastEvent };
  }

  function inferIntroductions(evidence, requestedUserId) {
    if (!evidence || evidence.schemaVersion !== 1 || evidence.userId !== requestedUserId) {
      throw new Error("BetterFriendLog received incompatible friendship evidence.");
    }
    const hidden = new Set(Array.isArray(evidence.hiddenUserIds) ? evidence.hiddenUserIds : []);
    const mutualAvailable = evidence.mutualFriends?.available === true;
    if (hidden.has(requestedUserId) || requestedUserId === evidence.ownerUserId) return { entries: [], mutualAvailable };
    const friends = rows(evidence.friends).filter((row) => userId(row) && !hidden.has(userId(row)) && userId(row) !== evidence.ownerUserId);
    const roster = new Map(friends.map((row) => [userId(row), row]));
    const target = roster.get(requestedUserId) ?? { userId: requestedUserId };
    const mutual = new Set(mutualAvailable && Array.isArray(evidence.mutualFriends.userIds) ? evidence.mutualFriends.userIds : []);
    const history = rows(evidence.relationships);
    const feed = rows(evidence.feedRows);
    const observedAt = Date.parse(evidence.observedAt);
    const at = Date.parse(evidence.addedAt);
    const validAddedAt = Number.isFinite(at) && Number.isFinite(observedAt) && at <= observedAt;
    // The installed renderer uses an empty entry list for missing history.
    // Returning an undated entry would select its old mutual-only explanation.
    if (!validAddedAt) return { entries: [], mutualAvailable };
    const targetFeed = validAddedAt ? feedPresence(feed, requestedUserId, at) : null;
    const encounter = validAddedAt ? encounterPresence(evidence.encounter, at) : null;
    const targetJoinedAt = encounter?.presence.get(requestedUserId);
    const targetInEncounter = encounter?.spanning && targetJoinedAt !== undefined && targetJoinedAt > targetFeed.offlineAt;
    const targetLastEvent = encounter?.lastEvent.get(requestedUserId);
    const targetLeftAfterGps = targetLastEvent?.present === false && targetLastEvent.time >= targetFeed.locationAt;
    const targetFeedLocation = targetLeftAfterGps ? null : targetFeed?.location;
    const sharedLocation = targetInEncounter ? encounter.location : targetFeedLocation;
    const introducedBy = [];
    for (const person of roster.values()) {
      const id = userId(person);
      if (id === requestedUserId) continue;
      const displayName = text(person, "displayName", "display_name") || id;
      const relationship = validAddedAt ? friendshipAt(history, person, target, at) : { eligible: false, known: false };
      const personFeed = validAddedAt ? feedPresence(feed, id, at) : null;
      const joinedAt = encounter?.presence.get(id);
      const inEncounter = targetInEncounter && joinedAt !== undefined && joinedAt > personFeed.offlineAt;
      const personLastEvent = encounter?.lastEvent.get(id);
      const personLeftAfterGps = personLastEvent?.present === false && personLastEvent.time >= personFeed.locationAt;
      // A recorded departure is stronger than an older API-polling GPS row.
      // Do not combine candidates from a stale second location with the
      // currently validated local game session.
      const inFeed = targetFeedLocation && personFeed?.location === targetFeedLocation && !personLeftAfterGps && (!targetInEncounter || targetFeedLocation === encounter.location);
      if (relationship.eligible && mutual.has(id) && (inEncounter || inFeed)) {
        introducedBy.push({ userId: id, displayName, evidence: ["co-presence", "mutual-friend"], relationshipKnown: relationship.known });
      }
    }
    introducedBy.sort((a, b) => a.displayName.localeCompare(b.displayName));
    const entry = {
      friendUserId: requestedUserId,
      friendName: text(target, "displayName", "display_name") || requestedUserId,
      addedAt: validAddedAt ? new Date(at).toISOString() : null,
      introducedBy,
      // Keep the renderer contract while never displaying mutual-only people.
      // Candidates require both mutual-friend and co-presence evidence.
      mutualOnly: [],
    };
    if (sharedLocation) entry.location = sharedLocation;
    if (targetInEncounter && encounter.worldName) entry.worldName = encounter.worldName;
    return { entries: [entry], mutualAvailable };
  }

  registerPlugin({
    async start(api) {
      const activeGeneration = ++generation;
      const previousDispose = dispose;
      dispose = null;
      await previousDispose?.();
      if (activeGeneration !== generation) return;
      if (typeof api.vrcx.getFriendLogEvidence !== "function") {
        throw new Error("BetterFriendLog requires a newer BetterDiscord loader. Please update BetterDiscord.");
      }
      const sectionDispose = await api.ui.addUserActivitySummarySection(
        {
          id: "friend-introductions",
          title: "BetterFriendLog",
          localizedTitle: { ja: "フレンドログ", en: "Friend Log" },
          kind: "friend-introductions",
          periods: ["all"],
          defaultPeriod: "all",
        },
        async ({ userId }) => {
          if (activeGeneration !== generation) return { entries: [], mutualAvailable: false };
          const evidence = await api.vrcx.getFriendLogEvidence(userId);
          if (activeGeneration !== generation) return { entries: [], mutualAvailable: false };
          return inferIntroductions(evidence, userId);
        },
      );
      if (activeGeneration !== generation) await sectionDispose?.();
      else dispose = sectionDispose;
    },
    async stop() {
      generation++;
      const activeDispose = dispose;
      dispose = null;
      await activeDispose?.();
    },
  });
})();
