# AKBの素を出すちゃんねる 週次ダッシュボード

`index.html` をブラウザで開くと、蓄積用Google Sheetsの最新週次結果を視覚化したダッシュボードを確認できます。

Google Cloudで社内やスマホからURL閲覧できるようにする場合は、Cloud Runにデプロイします。

## 更新方針

- 毎週火曜13:00: 既存の週次レポート自動化がスプレッドシートを更新
- 毎週火曜15:00: サイトがApps Script経由でスプレッドシートの全週データを読み込み
- 表示対象: `CSV_週次集計`、`自チャンネル動画`、`企画案`、`目標設定`
- サイト上部のプルダウンで、蓄積された週次レポートを切り替え表示

## Google Cloud公開

初回だけ `deploy/cloud-run.env.example` を `deploy/cloud-run.env` にコピーして、`PROJECT_ID` を設定してください。

```bash
cd /Users/terakadotomohiro/Documents/Youtubeリサーチ/akb-weekly-dashboard
bash deploy/deploy-cloud-run.sh
```

詳しい設計は `docs/google-cloud-design.md` にまとめています。

## 反映元

https://docs.google.com/spreadsheets/d/1fYJtcL-rqzLLe-vJmkWBQR5q9M5cxXCam5v0TAHJBZM/edit?usp=drivesdk

## 目標設定

`目標設定` タブで、2027年3月末までの累計目標を管理します。

- `目標値` を変更すると、サイトの進捗率と達成見込みが変わります。
- `対象指標` は `CSV_週次集計` の列名と一致させます。
- 達成見込みは、現在までの累計ペースと残り週数から簡易計算します。蓄積週が増えるほど見立ての精度が上がります。
