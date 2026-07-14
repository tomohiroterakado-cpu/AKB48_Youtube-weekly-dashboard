# AKB YouTube AI Director

「AKBの素を出すちゃんねる」の週次CSVを蓄積し、新規動画だけを確認して、週次レポートと企画判断につなげるWebアプリです。既存の週次ダッシュボードを維持しながら、CSV取込・重複防止・動画属性確認・安全なAI Director表示を追加しています。

## 毎週の運用

1. YouTube Studioの `コンテンツ別CSV` と `日別CSV` を同じ対象期間でアップロードする。
2. その週に公開された新規動画だけ、自動判定結果を確認する。
3. AI Directorの週次レポートを確認する。

詳しい操作は [docs/operations-manual.md](docs/operations-manual.md) を参照してください。

## システム構成

- フロントエンド: HTML / CSS / Vanilla JavaScript
- Webサーバー: Node.js 20以上
- 本番データ: Google Sheets API経由の既存蓄積シート
- ローカルデータ: JSONファイル（開発専用）
- 公開: Cloud Build + Artifact Registry + Cloud Run
- 既存週次データ: Google Apps Scriptの読取API。取得失敗時は同梱データへフォールバック

詳細は [docs/architecture.md](docs/architecture.md) を参照してください。

## ローカル起動

```bash
ADMIN_ACCESS_TOKEN=local-test-token \
DATA_BACKEND=json \
PORT=8080 \
node server.js
```

ブラウザで `http://127.0.0.1:8080` を開きます。JSONは `.data/director.json` に保存され、Git管理されません。

## 環境変数

| 変数 | 必須 | 用途 |
|---|---:|---|
| `PORT` | Cloud Runで自動 | HTTP待受ポート |
| `NODE_ENV` | 推奨 | 本番は `production` |
| `DATA_BACKEND` | 本番必須 | `sheets` または開発用 `json` |
| `GOOGLE_SPREADSHEET_ID` | sheets時必須 | 永続化するGoogle Sheets ID |
| `ADMIN_ACCESS_TOKEN` | 書込時必須 | CSV取込・確認・マスタ編集の保護 |
| `GOOGLE_ACCESS_TOKEN` | ローカルSheets検証のみ | 本番Cloud Runではメタデータ認証を使用 |
| `DATA_FILE` | 任意 | JSON保存先 |

`ADMIN_ACCESS_TOKEN`、OAuth JSON、APIキーはコードやGitHubに保存しません。

## 管理モード

公開サイトは閲覧モードで利用できます。CSV取込、未確認動画の確認、動画属性・マスタの更新を行う場合だけ、画面右上の **管理モードにログイン** から管理コードを入力してください。

- 管理コードはブラウザのセッション中だけ保持され、ブラウザを閉じると消去されます。
- ログアウトを押すと、その場で管理モードを終了します。
- 管理コードは `ADMIN_ACCESS_TOKEN` としてCloud Runの環境変数にのみ保存し、GitHubやスプレッドシートには保存しません。

## 週次CSV仕様

対象期間は毎週 **土曜日から金曜日まで** の7日間です。翌火曜日中に、同じ対象期間で出力した次の2ファイルをセットで取り込みます。

- コンテンツ別CSV: 動画ID・動画タイトルを含む動画別の表データ
- 日別CSV: `日付` 列を含む日別の視聴者・再生指標データ

日別CSVの日付が期間外の場合は取込を停止します。7日中の欠けは警告として表示し、日別グラフを参考値として扱います。コンテンツCSVと日別CSVは個別にハッシュで重複検出し、既存データは削除せず、更新版は履歴を残します。

## コンテンツ別CSV仕様

必須列は動画IDと動画タイトルです。YouTube Studioの表記揺れとして `コンテンツ` / `動画ID`、`動画のタイトル` / `動画タイトル` を自動マッピングします。利用可能な列・欠損時の扱いは [docs/csv-spec.md](docs/csv-spec.md) に記載しています。

重複時の規則:

- 同一ファイルハッシュ: スキップ
- 同一期間・同一動画・更新CSV: 既定は別バージョンとして保存
- `skip`: 既存指標を残す
- `update`: 旧版を残したまま最新版フラグを切り替える
- Sheets保存中断: `processing` として残し、同じCSVを再実行すると同じ取込IDで復旧する
- CSV形式エラー: `error` とエラー内容を取込履歴に残す
- 既存データの削除は行わない

## 自動判定

- ルール判定: 動画形式候補、タイトル特徴、企画ジャンル候補、タグ候補
- メンバー候補: メンバーマスタとの一致を最優先。未登録時はタイトル内ハッシュタグを低信頼度候補として表示
- サムネイル: YouTubeのサムネイルURLを取得。画像内容のAI判定は現段階では未判定
- 保存元: `system_auto`、将来の `ai_suggestion`、`user_confirmed`、`user_manual` を分離

ユーザー確認済み属性は、翌週CSVや自動判定の再実行で上書きしません。

確認済み動画も「マスタ管理」の動画属性から、企画ジャンル、サブジャンル、出演メンバー、ゲスト、タグ、コラボ、タイトル訴求、想定ターゲット、季節イベント、制作コスト、撮影難易度、備考を後から編集できます。

## データ不足時の挙動

- 履歴1週: `参考値`、信頼度 `低`
- 必要列なし: `データ不足のため判定不可`
- 4週未満: 4週移動平均を表示しない
- 24時間 / 48時間 / 7日等の同一経過期間データなし: 空欄。推測しない
- AI API失敗・未設定: CSV取込、動画確認、通常集計は利用可能

## テスト

```bash
npm test
npm run check
```

ユニットテストはCSV引用符、列名揺れ、必須列不足、説明行除外、動画尺、JST公開日時、重複防止、履歴保存、Sheets中断復旧、確認済み保護、再判定、属性編集、信頼度を対象にしています。

信頼度の閾値は `lib/analysis-config.js` にまとめています。運用方針の変更時は、ここだけを変更してテスト後にデプロイしてください。

## Cloud Runデプロイ

GitHubの `main` へのpushでCloud Buildトリガーが起動し、Artifact Registryへ保存後、Cloud Run `akb-weekly-dashboard` を更新します。

初回に必要な作業:

1. Cloud Run実行サービスアカウントへ対象Google Sheetsの編集権限を付与する。
2. Cloud Run環境変数 `ADMIN_ACCESS_TOKEN` に長いランダム文字列を設定する。
3. Google Sheets APIが有効であることを確認する。
4. `main` へ反映し、Cloud Build成功後に `/api/health` を確認する。

## バックアップと復旧

- 正本はGoogle Sheets。Driveの版履歴を保持する。
- CSV原本は削除せず、取込ファイル名とSHA-256を履歴に残す。
- Cloud Runはコンテナイメージの旧リビジョンへトラフィックを戻せる。
- コードは機能単位コミットへ戻す。
- AI用タブを削除しても既存の週次KPI・自チャンネル動画・企画案・目標設定には影響しない。

## 今後必要なCSV

- 公開後24 / 48時間、7 / 28 / 90日のスナップショット
- 平均視聴率
- Shortsの視聴選択率、スワイプ率、共有数
- 性別×動画、新規／リピーター×動画
- 流入元と関連動画への送客
- サムネイル変更履歴

ロードマップは [docs/future-roadmap.md](docs/future-roadmap.md) を参照してください。
