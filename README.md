# AKBの素を出すちゃんねる 週次ダッシュボード

`index.html` をブラウザで開くと、蓄積用Google Sheetsの最新週次結果を視覚化したダッシュボードを確認できます。

Google Cloudで社内やスマホからURL閲覧できるようにする場合は、Cloud Runにデプロイします。

## 更新方針

- 毎週火曜13:00: 既存の週次レポート自動化がスプレッドシートを更新
- 毎週火曜15:00: サイト更新自動化がスプレッドシートを読み、`data/latest.js` を更新してCloud Runへ反映
- 表示対象: `CSV_週次集計`、`自チャンネル動画`、`企画案`

## Google Cloud公開

初回だけ `deploy/cloud-run.env.example` を `deploy/cloud-run.env` にコピーして、`PROJECT_ID` を設定してください。

```bash
cd /Users/terakadotomohiro/Documents/Youtubeリサーチ/akb-weekly-dashboard
bash deploy/deploy-cloud-run.sh
```

詳しい設計は `docs/google-cloud-design.md` にまとめています。

## 反映元

https://docs.google.com/spreadsheets/d/1fYJtcL-rqzLLe-vJmkWBQR5q9M5cxXCam5v0TAHJBZM/edit?usp=drivesdk
