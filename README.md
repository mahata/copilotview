# copilotview

`~/.copilot/session-state/` に残る GitHub Copilot CLI の過去セッションを、ローカルで検索・閲覧・俯瞰するためのツールです。

元データは読み取り専用で扱い、検索用のインデックスを `~/.copilotview/index.db` に作ります。外部にデータを送信する処理はありません。

## できること

- **全文検索** — 自分の発言 / Copilot の応答 / 計画・要約 / ファイル名をスコープ指定して横断検索。リポジトリ・モデルで絞り込み
- **セッション閲覧** — やり取りのタイムライン、ツール実行ログ、触れたファイル、計画や完了レポート
- **統計** — 月別のセッション数、リポジトリ・モデル・ツールの利用傾向

要約は LLM を呼ばず、セッションに既に残っている情報（`workspace.yaml` の summary、完了レポート、チェックポイント、集計値）をまとめて表示します。

## 必要なもの

Node.js 24 以上。内蔵の `node:sqlite` を使うのでネイティブモジュールのビルドは不要です。

## セットアップ

```bash
npm install
npm run build
```

## 使い方

```bash
# インデックスを構築（2 回目以降は変更があったセッションだけ読み直す）
node dist/cli.js index

# ブラウザ UI を起動（http://127.0.0.1:4178）
node dist/cli.js serve

# インデックスの概要を表示
node dist/cli.js stats
```

### オプション

| オプション | 説明 |
| --- | --- |
| `--source <dir>` | session-state ディレクトリ（既定: `~/.copilot/session-state`） |
| `--index <file>` | インデックスの保存先（既定: `~/.copilotview/index.db`） |
| `--force` | 変更検出を無視して全セッションを読み直す |
| `--port <n>` | `serve` のポート（既定: 4178） |
| `--host <addr>` | `serve` のバインドアドレス（既定: `127.0.0.1`） |

環境変数 `COPILOTVIEW_SESSION_STATE` / `COPILOTVIEW_INDEX` でも既定値を上書きできます。

## 検索の挙動

SQLite の FTS5 を trigram トークナイザで使っています。日本語も分かち書きなしで検索できますが、trigram の性質上 **3 文字未満の語はインデックスに載りません**。そのため 2 文字以下の語は LIKE による逐次検索にフォールバックします（UI にその旨が表示されます）。複数の語はスペース区切りの AND です。

## 開発

```bash
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run lint      # eslint
npm run dev:web   # Vite 開発サーバ（API は 4178 の serve にプロキシ）
```

## 設計メモ

- インデックスにはメッセージ本文・計画・要約・ファイルパスのみを保存し、**ツール実行の出力本文は保存しません**。1.2GB の元データが 30MB 程度に収まります
- スキーマを変更したときはインデックスを捨てて再構築します。元データは常に残っているので安全です
- `~/.copilot/session-store.db` は Copilot 内部の非公開スキーマなので参照しません

## ライセンス

MIT
