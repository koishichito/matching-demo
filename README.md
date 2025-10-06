# JOIN US ブラウザ完結版（デモ）

JOIN US の主要体験（在室トグル→近接一覧→相互提案→チャット）を Next.js App Router 上で再現したブラウザ完結デモです。PWA 対応を備え、ホーム画面追加や簡易オフライン体験も可能です。

## 構成概要

- **フロントエンド**: React / Next.js 15 (App Router, TypeScript, Tailwind CSS)
- **状態管理**: ローカルストレージ + in-memory API 連携
- **API**: Next.js Route Handler (Node.js runtime) + WebSocket (ws) を用いた擬似リアルタイム
- **データ**: メモリ保持のデモ用ユーザー・presence・proposal・match・message
- **PWA**: manifest.ts + public/sw.js（オフライン fallback /offline）

## セットアップ & 実行

`ash
npm install
npm run dev
`

開発サーバーが起動したら [http://localhost:3000](http://localhost:3000) を開いてください。2 台目のブラウザ／シークレットウィンドウを開くとデモシナリオ（近接リスト・相互合意・チャット）を再現できます。

### 主要スクリプト

| コマンド          | 説明                          |
| ----------------- | ----------------------------- |
| 
pm run dev     | 開発サーバー (Next.js)        |
| 
pm run lint    | ESLint (全ファイル)           |
| 
pm run build   | 本番ビルド + 型チェック       |
| 
pm run start   | 本番サーバー（build 後）      |

## デモの確認ポイント

- **オンボーディング**: 年齢確認 → プロフィール（タグ / 雰囲気 / 予算） → 位置選択（Geolocation or プリセット）
- **在室トグル**: 「Presence ON/OFF」で一覧掲載が切り替わり、05:00 JST のリセットを擬似再現
- **近接一覧**: radius 可変（2 / 3 / 5 / 10 km）。自分自身はハイライト表示
- **合流提案**: 片側が送信 → もう片側が承認するとチャット解錠
- **チャット**: テキストのみ、通報送り、モバイル想定 UI
- **リセット**: 手動リセット API → presence / match / proposal をクリーンアップ
- **オフライン**: サービスワーカー登録済み。/offline fallback ページを参照

## PWA 検証フロー

1. 
pm run build && npm run start
2. Chrome DevTools > Application > Manifest で PWA スコアを確認
3. 「Add to Home Screen」を実行してスタンドアロン起動を確認
4. 機内モードに切り替え → /offline が表示されることを確認

## デモ台本 (想定 3〜5 分)

1. 端末 A: 渋谷プリセットで在室 ON → 自分カードが一覧に出る
2. 端末 B: 恵比寿プリセット → 近接一覧に端末 A を確認
3. 端末 B から proposal → 端末 A が承認 → チャット解錠
4. チャットで 2〜3 往復 → 通報 UI チラ見せ
5. 手動リセット → presence & match がクリアされる

## 補足

- この実装はデモ用途であり、永続ストレージ・認証・本番級セキュリティは未実装です
- WebSocket はアプリ起動時にローカル ws://localhost:3333 を起動します
- 05:00 JST リセットは in-memory タイマー。サーバー再起動で状態が初期化されます

