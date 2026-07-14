# ターミナルなしで公開する方法

## 結論

ターミナルを使わない場合は、次の構成が一番現実的です。

1. サイト本体は GitHub にブラウザからアップロードする。
2. Google Cloud Console の Cloud Run で GitHubリポジトリと連携する。
3. 週次データは Google Apps Script のWebアプリからGoogle SheetsをJSON化して取得する。

この形にすると、毎週火曜日中にスプレッドシートが更新された後、サイト側は最新データを読み込めます。ローカルPCへのGoogle Cloud CLIインストールは不要です。

## パターンA: 推奨 / 現在のデザインを活かす

### 初回だけ行うこと

1. GitHubをブラウザで開く。
2. 新しいリポジトリを作る。
3. `akb-weekly-dashboard` 内のファイルをアップロードする。
4. Google Cloud Consoleで Cloud Run を開く。
5. 「サービスを作成」から「リポジトリから継続的にデプロイ」を選ぶ。
6. GitHubを接続し、アップロードしたリポジトリを選ぶ。
7. ビルド設定は `Dockerfile` を使う。
8. リージョンは `asia-northeast1`。
9. 認証は、URL共有したい場合は「未認証の呼び出しを許可」。

### 毎週の更新

Google Apps Script WebアプリURLを `data/config.js` の `AKB_DATA_ENDPOINT` に設定しておけば、サイトはSheetsの最新値を読みに行きます。毎週のCloud Run再デプロイは不要です。

## パターンB: 最短 / Google Sites + Looker Studio

デザインの自由度は落ちますが、ターミナルもCloud Runも不要です。

1. Looker StudioでGoogle Sheetsを接続する。
2. ダッシュボードを作る。
3. Google Sitesに埋め込む。
4. 社内共有設定をする。

早く社内共有したい場合はこの方法が最短です。

## パターンC: 手動アップロード運用

1. GitHubにサイトファイルをアップロードする。
2. Cloud RunをGitHub連携でデプロイする。
3. 毎週、`data/latest.js` だけGitHub画面で差し替える。

完全自動ではありませんが、CLIなしで今のサイトを公開できます。

## Apps Script Webアプリの作り方

1. ブラウザで https://script.google.com/ を開く。
2. 新しいプロジェクトを作る。
3. `deploy/apps-script-dashboard-api.gs` の中身を貼り付ける。
4. 「デプロイ」>「新しいデプロイ」>「ウェブアプリ」を選ぶ。
5. 実行ユーザーは自分。
6. アクセスできるユーザーは、公開サイトにするなら「全員」。社内限定なら組織内にする。
7. 発行されたWebアプリURLをコピーする。
8. `data/config.js` の `window.AKB_DATA_ENDPOINT = "";` にURLを入れる。

## 注意

- WebアプリURLを公開すると、ダッシュボード用に整形された数値JSONも見られます。
- 社外公開を避けるなら、Cloud RunもApps Scriptも社内限定にしてください。
- Cloud RunのGitHub連携は、Google公式ドキュメントでは「リポジトリから継続的にデプロイ」として案内されています。
