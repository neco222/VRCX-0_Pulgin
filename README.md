# VRCX-0_Pulgin
VRCX-0 Pulgin

## Official VRCX-0 Plugin Store

This directory is a separate, publishable official GitHub Plugin Store. It is independent of the BetterVRCX0 loader repository. Users install its registered plugins from VRCX-0's Settings → Plugins → Store. There is no local file, arbitrary URL, or custom script installation feature.

The official managed repository is [neco222/VRCX-0_Pulgin](https://github.com/neco222/VRCX-0_Pulgin), branch `main`. Its catalog is [index.json](https://raw.githubusercontent.com/neco222/VRCX-0_Pulgin/main/index.json). The BetterVRCX0 distributor pins owner `neco222`, repository `VRCX-0_Pulgin`, and ref `main` during the loader's initial build/setup. There is no user-facing arbitrary store URL input. Normal plugin operations then require no file placement or EXE patching.

## Maintainer publishing

1. Review a plugin's standalone `plugins/<id>/index.js`, manifest, declared permissions and assets.
2. Update its semantic version and `updatedAt`, then run `npm run index`.
3. Run `npm test` and `npm run validate`.
4. Commit the reviewed plugin and generated `index.json` together and push to `neco222/VRCX-0_Pulgin` on `main`. Prefer branch protection and reviewed changes.

`index.json` is the authoritative catalog. Its entry SHA-256 and `files` hashes cover every packaged file, including the manifest and icon. Downloads must come from the pinned official repository/ref and match these hashes before install/update or execution. The metadata manifest is descriptive and never executable. A hash proves consistency with the fetched catalog; access to the official repository must also be protected because a publisher who can replace both catalog and payload can replace code.

When a reviewed plugin advances to a newer version, the generator retains the previous catalog's reviewed `{version, entry, sha256, permissions}` under that plugin's `releases`. Those explicit official catalog pins allow existing installations to continue running while displaying Update available. They do not permit new installation of local or arbitrary historical files; the installer downloads only the current release. Changes to executable content or permissions at the same version are rejected and require a version bump.

To revoke an old version, set `releases` in `manifest.json` to an explicit list containing only the historical pins you still approve, or `[]` to revoke all old releases, and regenerate/publish the index. This override replaces preserved history. Removing the plugin from the catalog revokes the entire plugin. Keep at most 20 historical authorizations and review their permissions along with current code. Runtime historical authorization comes from the official catalog, never a locally invented release manifest.

The default icon is a packaged SVG. The chart colors are supplied by the host adapter's existing `--status-online`, `--status-joinme`, `--status-askme`, and `--status-busy` theme variables. The icon's artwork colors do not determine chart colors.

## User Status Statistics

This plugin requests `feed.read` and `userDialog.modify` for history/chart access, plus `settings.create` and `storage` for its saved default-period setting. Its entire host interaction uses `api.ui.addUserDialogTab`, `api.vrcx.queryFeed` and `api.settings`; it does not query the host DOM, open SQLite, or call Tauri. Its classic JavaScript entry calls `registerPlugin({start, stop})` inside the isolated loader sandbox. The host supplies the chart renderer, period selector, theme, and lifecycle cleanup.

The initial default is 30 days; 7 days, 90 days and all recorded history are also available. Plugin Settings can save a default of 7, 30 or 90 days, applied the next time the plugin is enabled. Unsupported values use 30 days. The adapter supplies `{rows, from, to, coverage}` from the existing `app__feed_rows_query` with the authenticated account as `userId`, the target as `scopedUserIds`, `Status`/`Online`/`Offline` filters, complete cursor pagination, and boundary seed events. Returned rows use `created_at`, `previousStatus`, `rowId`, and `sourceRank` as in VRCX-0's current contracts. Before-range seed events establish state but their duration is clipped out of the selected range.

The plugin integrates elapsed milliseconds. Offline time never enters the denominator. An Online event establishes presence but VRCX-0 stores no status in it. A subsequent Status event's `previousStatus` can resolve the intervening online segment. Offline resets the status so an unobserved change while offline is not guessed. Missing initial presence/status, conflicting history, and unknown statuses are excluded and returned as `unknownMilliseconds`. Description-only updates do not add weight. Ties are deterministic, with Offline winning a same-timestamp conflict.

These are durations inferred from recorded observations, not independently tracked real-world presence. Missing events while VRCX-0 is closed, disabled feed persistence, removed history, and truncation can limit coverage. The adapter must return those coverage limitations and cap `to` if it has a trusted last observation time. The plugin propagates coverage to the host UI; it never substitutes event counts or silently creates online time during known offline intervals.

OFF/uninstall removes the tab and settings page through host ownership and `stop()`. Uninstall removes the saved plugin preference through the core's namespaced storage. The plugin stores no personal history of its own and has no separate statistics database.

## License

The plugin source, store tooling, tests, and packaged icon are available under the [MIT License](LICENSE).
