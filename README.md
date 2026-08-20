# 音声入力アプリ

Windows にインストールして常駐させる音声入力アプリです。`Ctrl + Shift` を押しながら話すと画面右下に
`🔴 録音中...` と表示され、キーを離すと**完全オフラインの音声認識（whisper.cpp）**でテキスト化し、
フィラー語（えー、あの、なんか…）を自動的に除去したうえで、**そのとき focus しているどのアプリの
テキストボックスにも**自動でペーストします。音声データやテキストはインターネットに送信されません。

## インストール方法

1. このリポジトリの GitHub Actions（`Build Windows Installer`）が生成したインストーラー
   （`音声入力アプリ Setup x.x.x.exe`）をダウンロードします。
   - `Actions` タブ → `Build Windows Installer` → 最新の実行 → `voice-input-app-windows-installer`
     アーティファクトからダウンロードできます。
2. ダウンロードした `.exe` を実行してインストールします。
   - 署名なしインストーラーのため、Windows SmartScreen の警告が出た場合は
     「詳細情報」→「実行」を選んでください。
3. インストール後、タスクトレイに常駐します（🎙️ アイコン）。起動直後にマイクの使用許可を
   求められるので「許可」してください（録音の取りこぼしを防ぐため、常駐中はマイクを
   ウォームアップした状態で待機します）。
4. どこでも `Ctrl` + `Shift` を押しながら話し、離すとテキストが入力されます。

初回インストール時に音声認識エンジン（whisper.cpp）と音声モデルが同梱されているため、
**インストール後はインターネット接続不要**で動作します。

## 使い方

- `Ctrl` + `Shift` を押しっぱなしにして話す → 画面右下に `🔴 録音中...`
- キーを離す → `📝 認識中...` → 認識結果がフォーカス中のテキストボックスに自動貼り付け
- タスクトレイのアイコンをクリック、または右クリック →「設定を開く...」で設定画面を開けます
  - 起動時の自動常駐 ON/OFF
  - フィラー語の自動除去 ON/OFF
  - 最大録音秒数（暴走防止の安全装置）
  - 音声認識モデルの変更（上級者向け。より大きいモデルに差し替えると精度が上がります）

## 誤字・フィラー語の除去について

- 音声認識自体に whisper.cpp（OpenAI Whisper 互換のオフラインエンジン）を使用しており、
  ストリーミング型の認識エンジンより誤字が少なく自然な文章になりやすい設計です。
- そのうえで「えー」「あの」「なんか」などのフィラー語や、どもり（同じ文字の連続）を
  ルールベースで自動的に除去します（`src/textCleanup.js`）。
- すべてローカルで完結し、外部サービスへの送信は一切行いません。

## 動作環境・制限事項

- **Windows のみ対応**です。
- フォーカス中のテキストボックスへの貼り付けは、クリップボード経由 + `Ctrl+V` の疑似入力で行います。
  一部のアプリ（管理者権限で実行されているアプリなど）では、OSのセキュリティ制限により
  貼り付けが効かない場合があります。
- 認識精度は同梱モデルのサイズに依存します。デフォルトは `base` モデルです。
  精度を上げたい場合は設定画面から `small` / `medium` モデルに切り替えられます
  （[huggingface.co/ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp) から
  `ggml-small.bin` 等をダウンロードし、設定画面でパスを指定してください）。
- 実行時に DLL 不足のエラーが出る場合は「Microsoft Visual C++ 再頒布可能パッケージ」を
  インストールしてください。

## 開発者向け：ソースからビルドする

```bash
npm install
npm start            # 開発モードで起動（同梱モデルが無い場合は設定画面が自動で開く）
```

インストーラーを作るには、`resources/whisper/bin/` に whisper.cpp の Windows バイナリ
（`whisper-cli.exe` 等）を、`resources/whisper/models/` に `ggml-*.bin` モデルを配置してから:

```bash
npm run dist          # dist/ に NSIS インストーラーが生成されます
```

`.github/workflows/build-windows.yml` は `windows-latest` 上でこれらのファイルを
[whisper.cpp](https://github.com/ggml-org/whisper.cpp) の公式リリースから自動ダウンロードし、
インストーラーをビルドして Actions のアーティファクトとして公開します。

## ファイル構成

```
src/main.js              メインプロセス（トレイ、グローバルホットキー、認識パイプライン、貼り付け）
src/recorder.html/.js    非表示ウィンドウ：マイク録音（16kHz/mono WAV エンコード）
src/overlay.html         「録音中...」インジケーターのオーバーレイ表示
src/settings.html/.js    設定画面
src/whisperEngine.js     whisper.cpp CLI 呼び出し
src/textCleanup.js       フィラー語・どもり除去ロジック
src/paste.js             クリップボード書き込み + Ctrl+V 疑似入力
src/store.js             設定の永続化（%AppData%）
resources/whisper/       同梱する whisper.cpp バイナリ & モデル（ビルド時に配置、Gitには含めない）
.github/workflows/       Windows インストーラーの自動ビルド
```
