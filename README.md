# VRCX-0 Plugin Store

VRCX-0の設定画面から機能を追加できる公式プラグインストアです。一覧は`index.json`、本体は`plugins/`に保存されています。

## はじめに

初回導入に必要な **BetterVRCX0ローダー** は別のパッケージです。未導入の場合は、別途入手した配布ZIPを展開し、同梱の`Start-BetterVRCX0.bat`からセットアップ・起動してください。
その後の操作はVRCX-0内で行えます。プラグインのファイルを手動コピーする必要はありません。

## プラグインの使い方

1. BetterVRCX0から起動したVRCX-0で、**Settings → Plugins → Store** を開きます。
2. 検索欄からプラグインを探し、**Install** を押します。
3. **Installed** で、インストール済みプラグインを管理します。

| ボタン | 操作 |
| --- | --- |
| ON / OFF | 機能を有効化・無効化します。状態は次回起動時も維持されます。 |
| Settings | プラグインごとの設定を変更します。 |
| Update | 新しいバージョンがある場合に更新します。 |
| Uninstall | プラグインと保存された設定を削除します。 |

## User Status Statistics

ユーザー詳細画面の **Status Usage** タブに円グラフを追加します。変更回数ではなく、**そのステータスで過ごした時間**から割合を計算し、Offlineは除外します。

| ステータス | 色 |
| --- | --- |
| join me | 青 |
| active | 緑 |
| ask me | オレンジ |
| busy | 赤 |

期間は **7 days / 30 days / 90 days / All** から選べます。初期設定は30日です。
Settingsで既定の期間を7・30・90日に変更でき、OFF → ONしたときに反映されます。
VRCX-0に保存された履歴を使用するため、記録されていない期間は集計できません。

## ファイルの役割

| ファイル・フォルダー | 内容 |
| --- | --- |
| `README.md` | この説明書 |
| `index.json` | VRCX-0が読み込むプラグイン一覧・バージョン・確認用ハッシュ |
| `plugins/` | プラグイン本体・情報・アイコン |
| `LICENSE` | MITライセンスの利用条件 |
| `.github/` | 管理者向けの一覧生成・テスト・自動チェック |

<details><summary>管理者向け：更新とチェック</summary>

コードや権限を変更するときはversionと更新日を更新し、一覧を再生成します。旧版の許可履歴（`releases`）も確認してください。

```sh
node .github/scripts/store-index.mjs
node --test .github/tests/*.test.mjs
node .github/scripts/store-index.mjs --check
```

プラグインと生成された`index.json`を一緒に公開します。登録されたハッシュと一致するファイルだけが実行されます。

</details>
