[← Back](../README.md) | [English](README.md) | [Japanese](README-ja.md)

# nostr-post-checker

nostr プロトコル用の投稿チェッカーです。

このサイトは、投稿 (ノート) がどのリレーに存在し、どのリレーに存在しないかを調べます。

その投稿の削除依頼 (NIP-09 kind:5) をリレーに送ることもできます。

- デモサイト:
  - https://koteitan.github.io/nostr-post-checker
- nostr プロトコルについて:
  - https://github.com/nostr-protocol/nostr
- ライブラリ
  - https://github.com/penpenpng/rx-nostr

## 仕様

### Get relay ボタン

kind:3 用と kind:10002 用の2つがあります。どちらも、NIP-07 ブラウザ拡張でログインしているユーザーのリレーリストを relays テキストボックスに入れます。

- 公開鍵は拡張から読みます (Alby を先に、次に `window.nostr`)。拡張がないときは、結果欄に `Please set NIP-07 browser extension or Alby extension.` と出ます。
- その公開鍵の最新の kind:3 / kind:10002 イベントを、次のブートストラップリレーから取ります。EOSE は最大 5 秒待ちます:
  - `wss://directory.yabu.me`
  - `wss://purplepag.es`
  - `wss://user.kindpag.es`
  - `wss://indexer.coracle.social`
- リレーはイベントから次のように取り出します。read リレーも write リレーも両方入ります (read / write の印は見ていません)。
  - kind:3: `content` の JSON のキー
  - kind:10002: すべての `r` タグの URL
- イベントが見つからないときは、既定のリレーリストを入れます。
- 取得中はテキストボックスに `wait for your relays...` と出ます。

### search ボタン

relays テキストボックスの各リレー (1行に1つの URL。空行は無視) に、下の条件に合うイベントを問い合わせ、リレーごとの結果を表示します。

- 条件は1つのフィルタにまとめます。チェックボックスが ✅ で、テキストボックスの値が正しいときだけ、その条件を使います:
  - event id: `ids` または `authors` ([event id テキストボックス](#event-id-テキストボックス) を参照)
  - kinds: `kinds`
  - since: `since`
  - until: `until`
- 問い合わせは backward の REQ です。EOSE を最大 60 秒待ち、待っている間は結果欄に `left N seconds until timeout` と出ます。
- 受け取ったイベントが「見つかった」になるのは、event id (チェックが ✅ のとき) と kinds (チェックが ✅ のとき) にも合う場合だけです。
- プレビュー欄には、受け取った中で一番新しいイベントの日時と本文を出します。作成者のアイコン・表示名・名前も出します。これは同じリレーから取った、作成者の最新の kind:0 から読みます。
- 設定はブラウザ (localStorage) に保存し、次に開いたときに戻します。
- 縦長の画面では、結果のところまで自動でスクロールします。
- [copy URL ボタン](#copy-url-ボタン) で作った URL でページを開いたときも、自動で検索が始まります。

#### 結果

|表示|意味|
|----|----|
|connecting...|リレーの返事を待っている|
|exist|リレーが条件に合うイベントを返した|
|not exist|リレーが条件に合うイベントを返さずに EOSE を返した|
|error to open|リレーへの接続を開けなかった|
|no reply|REQ は送ったが、60 秒以内に EOSE が返らなかった。または EOSE の前に接続が切れた|
|id is invalid|event id が受け付ける形式でないので、何も送っていない。結果欄に `Invalid id. id should start from npub or nprofile or note or nevent.` と出る|

同じリレーを2回書いた場合 (末尾の `/` や大文字・小文字の違いも含む)、両方の行に同じ結果が出ます。

#### event id テキストボックス

|入力|何として探すか|
|----|--------------|
|`note1...`|イベント ID (`ids`)|
|`nevent1...`|イベント ID (`ids`)|
|`npub1...`|作成者の公開鍵 (`authors`)。その人のイベントがあるか|
|`nprofile1...`|作成者の公開鍵 (`authors`)|
|16進数の文字列|イベント ID (`ids`)|

- bech32 の形式は、どれも頭に `nostr:` が付いていても受け付けます。
- `nevent1...` と `nprofile1...` に入っているリレーの候補 (relay hint) は使いません。`nevent1...` の kind は、[delete request](#delete-request-ボタン) の `k` タグにだけ使います。
- ほかの形式 (`naddr1...`、`nsec1...` など) は不正な id になります。
- 空のときは、id の条件はありません。

#### kinds テキストボックス

- イベントの kind を数字で、カンマか空白で区切って入れます (例: `1, 7 30023`)。
- 各部分は先頭の数字として読みます (`7a` は 7)。数字で始まらない部分は無視します。空のときは、kind の条件はありません。

#### since テキストボックス

探す `created_at` の一番古い時刻です。受け付ける形式は次のとおりです:

- 9 桁以上の UNIX タイムスタンプ (例: `1700000000`)
- `YYYY/MM/DD` または `YYYY-MM-DD`。後ろに ` HH:MM:SS` (それぞれ2桁) とタイムゾーンを付けられます:
  - 時差: `+09:00`、`+0900`、`-05:00` など
  - 略号: `JST` `KST` `HKT` `SGT` `IST` `PHT` `WIB` `THA` `AEST` `ACST` `AWST` `NZST` `NZDT` `GMT` `UTC` `BST` `CET` `CEST` `EET` `EEST` `MSK` `SAST` `EST` `EDT` `CST` `CDT` `MST` `MDT` `PST` `PDT` `AKST` `AKDT` `HST` `BRT` `ART` (`CST` は北米中部標準時で -06:00)
  - タイムゾーンなし、または知らない略号: ブラウザのローカル時刻

これ以外の形式の値は無視します。

#### until テキストボックス

探す `created_at` の一番新しい時刻です。形式は [since テキストボックス](#since-テキストボックス) と同じです。

### copy URL ボタン

今の設定をクエリパラメータに入れた、このページの URL をクリップボードにコピーします。その URL を開くと設定が戻ります。

|パラメータ|意味|
|----------|----|
|`eid=`|event id テキストボックス|
|`kind=`|kinds テキストボックス|
|`since=`|since テキストボックス|
|`until=`|until テキストボックス|
|`relay=`|relays テキストボックス。リレーの間は `;`|
|`disableid`、`disablekind`、`disablesince`、`disableuntil`|そのチェックボックスがオフ|
|`hideform`|メニューの "show form" がオフ|
|`hidepv`|メニューの "show pv" がオフ|

- 古い版の `noteid=` は `eid=` として読みます。
- URL に `eid`、`noteid`、`kind`、`relay`、`since`、`until` のどれか1つでもあれば、自動で検索が始まります。

### delete request ボタン

そのイベントの削除依頼 (NIP-09 kind:5) を送ります。

- 結果の各行のボタンは、その行のリレーに依頼を送ります。
- 一番下の `all relays` の行のボタンは、結果が `exist` のリレー全部に依頼を送ります。最初の `exist` が出るまでは押せません。
- ボタンが押せるのは、検索した時点で event id のチェックが ✅ で、event id が `note1...` か `nevent1...` (`nostr:` 付きも含む) のときだけです。それ以外は灰色で押せません。
- 確認ダイアログのあと、NIP-07 拡張で1回だけ署名して送ります:
  - `kind`: 5
  - `content`: 空
  - `tags`: `["e", <イベント ID>]`。イベントの kind が分かるとき (見つかったイベント、または `nevent1...` から) は `["k", <kind>]` も付けます
- 各リレーの結果は、その行のリレーの欄に出ます:

|表示|意味|
|----|----|
|sending...|依頼を送っているところ|
|accepted|リレーが OK true を返した。リレーのメッセージがあれば `: ` の後に続く (例: `accepted: deleted 1 event(s)`、`accepted: duplicate: have this event`)|
|rejected: *理由*|リレーが OK false と *理由* を返した|
|error to open|接続を開けなかったので、依頼は送っていない|
|no response|依頼は送ったが、15 秒以内に返事がなかった。または返事の前に接続が切れた|
|not sent|NIP-07 の署名が失敗したか断られたので、何も送っていない|

- `accepted` は緑、`sending...` 以外のそれ以外は赤で出ます。
- `all relays` の行には `accepted 2, rejected 1, error to open 1` のような集計が出ます。`accepted` は常に出し、ほかは 0 でないときだけ出します。
- イベントが消えたかどうかは、もう一度検索して確かめてください。
