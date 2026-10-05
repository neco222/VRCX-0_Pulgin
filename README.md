# VRCX-0 Plugin Store

VRCX-0の設定画面から機能を追加できる公式プラグインストアです。一覧は`index.json`、本体は`plugins/`に保存されています。

## はじめに

**[Windows用セットアップEXEをダウンロード](https://github.com/neco222/VRCX-0_Pulgin/releases/download/bettervrcx0-v0.2.1/BetterVRCX0-Setup.exe)**

1. VRCX-0を終了します。タスクトレイに残っている場合も終了してください。
2. `BetterVRCX0-Setup.exe`を開き、**インストール / 更新 → 実行** を選びます。
3. スタートメニューの **BetterVRCX0** からVRCX-0を起動します。

必要な実行環境はEXEに同梱されています。VRCX-0が自動検出されない場合だけ、参照ボタンで既存の実行ファイルを選んでください。初回導入後のプラグイン操作はVRCX-0内で行えます。

### プラグイン機能全体を削除する場合

VRCX-0を終了し、同じEXEで **アンインストール → 実行** を選びます。Windowsの「インストールされているアプリ」のBetterVRCX0からも開けます。
削除対象はBetterVRCX0のローダー・付属実行環境・専用ショートカットです。**VRCX-0本体、ログイン情報、履歴、VRCX-0の設定は削除しません。**
プラグインごとの保存設定も消したい場合は、先にVRCX-0内の **Plugins → Installed → Uninstall** を使用してください。

配布内容と確認用ハッシュは[リリースページ](https://github.com/neco222/VRCX-0_Pulgin/releases/tag/bettervrcx0-v0.2.1)にあります。現在のEXEにはコード署名がありません。

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

各フレンドのユーザー詳細画面で **Activity** タブを開くと、**Status Usage** の円グラフとステータスごとの割合（%）を確認できます。変更回数ではなく、**そのステータスで過ごした時間**から割合を計算し、Offlineは除外します。

表示されない場合は、**Settings → Plugins → Installed** でUser Status Statisticsを **ON** にしてください。既に導入済みの方は、上のセットアップEXEでローダーを更新し、Pluginsの **Check for updates → Update** からプラグインも更新できます。ON/OFFと保存設定は更新後も引き継ぎます。

| ステータス | 色 |
| --- | --- |
| join me | 青 |
| active | 緑 |
| ask me | オレンジ |
| busy | 赤 |

期間は **7 days / 30 days / 90 days / All** から選べます。初期設定は30日です。
Settingsで既定の期間を7・30・90日に変更でき、OFF → ONしたときに反映されます。
VRCX-0に保存された履歴を使用するため、記録されていない期間は集計できません。
旧ローダーではユーザー詳細画面の独立した **Status Usage** タブに表示されます。Activity内の表示には対応したBetterVRCX0への更新が必要です。

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
