[← Back](../README.md) | [English](README.md) | [Japanese](README-ja.md)

# nostr-post-checker

post checker for nostr protocol.

this site checks the post (=note) exists on the relays or not.

it can also send a deletion request (NIP-09 kind:5) for the post to the relays.

- demo site:
  - https://koteitan.github.io/nostr-post-checker
- about nostr protocol:
  - https://github.com/nostr-protocol/nostr
- library
  - https://github.com/penpenpng/rx-nostr

## specification

### Get relay button

There are two buttons, one for kind:3 and one for kind:10002. Each one fills the relays text box with the relay list of the user logged in with a NIP-07 browser extension.

- The public key is read from the extension (Alby first, then `window.nostr`). Without an extension, the result area shows `Please set NIP-07 browser extension or Alby extension.`
- The newest kind:3 or kind:10002 event of that public key is fetched from these bootstrap relays, waiting up to 5 seconds for EOSE:
  - `wss://directory.yabu.me`
  - `wss://purplepag.es`
  - `wss://user.kindpag.es`
  - `wss://indexer.coracle.social`
- The relays are taken from the event as below. Both read and write relays are added; the read / write markers are not looked at.
  - kind:3: the keys of the JSON in `content`
  - kind:10002: the URLs of all the `r` tags
- If no event is found, the default relay list is put in instead.
- The text box shows `wait for your relays...` while fetching.

### search button

Asks each relay in the relays text box (one URL per line; empty lines are ignored) for the events matching the conditions below, and shows the result of each relay.

- The conditions are combined into one filter. A condition is used only when its checkbox is on and its text box gives a valid value:
  - event id: `ids` or `authors` (see [event id text box](#event-id-text-box))
  - kinds: `kinds`
  - since: `since`
  - until: `until`
- The request is a backward REQ. It waits up to 60 seconds for EOSE, and the result area shows `left N seconds until timeout` while waiting.
- A received event counts as found only if it also matches the event id (when that checkbox is on) and the kinds (when that checkbox is on).
- The preview box shows the newest received event: its date and its content, with the picture, display name and name of its author, taken from the author's newest kind:0 on the same relays.
- The settings are saved in the browser (localStorage) and restored next time.
- On a portrait screen, the page scrolls down to the results.
- The search also starts by itself when the page is opened with a URL from the [copy URL button](#copy-url-button).

#### results

|display|meaning|
|-------|-------|
|connecting...|waiting for the relay|
|exist|the relay returned a matching event|
|not exist|the relay returned EOSE without any matching event|
|error to open|the connection to the relay could not be opened|
|no reply|the REQ was sent, but no EOSE came back within 60 seconds, or the connection closed before EOSE|
|id is invalid|the event id is not in an accepted format, and nothing was sent. The result area shows `Invalid id. id should start from npub or nprofile or note or nevent.`|

A relay written twice (also with a trailing `/` or in different letter case) gets the same result on both rows.

#### event id text box

|input|searched as|
|-----|-----------|
|`note1...`|event id (`ids`)|
|`nevent1...`|event id (`ids`)|
|`npub1...`|public key of the author (`authors`): any event by the author|
|`nprofile1...`|public key of the author (`authors`)|
|hexadecimal string|event id (`ids`)|

- Every bech32 form may start with `nostr:`.
- The relay hints in `nevent1...` and `nprofile1...` are not used. The kind in `nevent1...` is used only for the `k` tag of the [delete request](#delete-request-button).
- Other forms (`naddr1...`, `nsec1...`, ...) are invalid.
- When it is empty, there is no id condition.

#### kinds text box

- Event kinds as numbers, separated by commas or spaces (e.g. `1, 7 30023`).
- Each part is read as the number at its start; parts that do not start with a number are ignored. When it is empty, there is no kind condition.

#### since text box

The oldest `created_at` to search for. The accepted formats are:

- a UNIX timestamp of 9 or more digits (e.g. `1700000000`)
- `YYYY/MM/DD` or `YYYY-MM-DD`, optionally followed by ` HH:MM:SS` (two digits each) and a timezone:
  - an offset up to ±14:00: `+09:00`, `+0900`, `-05:00`, ...
  - an abbreviation: `JST` `KST` `HKT` `SGT` `IST` `PHT` `WIB` `THA` `AEST` `ACST` `AWST` `NZST` `NZDT` `GMT` `UTC` `BST` `CET` `CEST` `EET` `EEST` `MSK` `SAST` `EST` `EDT` `CST` `CDT` `MST` `MDT` `PST` `PDT` `AKST` `AKDT` `HST` `BRT` `ART` (`CST` is North American Central Standard Time, -06:00)
  - no timezone, or an unknown abbreviation: the local time of the browser

A value in any other format, or a date or time that does not exist (e.g. `2024/02/30`, `24:00:00`), is ignored.

#### until text box

The newest `created_at` to search for. The formats are the same as the [since text box](#since-text-box).

### copy URL button

Copies a URL of this page to the clipboard, with the current settings as its query parameters. Opening the URL restores the settings.

|parameter|meaning|
|---------|-------|
|`eid=`|event id text box|
|`kind=`|kinds text box|
|`since=`|since text box|
|`until=`|until text box|
|`relay=`|relays text box, with `;` between the relays|
|`disableid`, `disablekind`, `disablesince`, `disableuntil`|the checkbox is off|
|`hideform`|"show form" in the menu is off|
|`hidepv`|"show pv" in the menu is off|

- `noteid=` of older versions is read as `eid=`.
- The search starts by itself when the URL has at least one of `eid`, `noteid`, `kind`, `relay`, `since` and `until`.

### delete request button

Sends a deletion request (NIP-09 kind:5) for the event.

- Each result row has a button that sends the request to the relay of that row.
- The `all relays` row at the bottom has a button that sends the request to all the relays whose result is `exist`. It is disabled until the first `exist` appears.
- The buttons are enabled only when, at the time of the search, the checkbox of the event id is on and the event id is a `note1...` or `nevent1...` (also with `nostr:`). Otherwise they are greyed out.
- After a confirmation dialog, the request is signed once with the NIP-07 extension and sent:
  - `kind`: 5
  - `content`: empty
  - `tags`: `["e", <event id>]`, plus `["k", <kind>]` when the kind of the event is known (from the found event, or from `nevent1...`)
- The result of each relay is shown in the relay column of its row:

|display|meaning|
|-------|-------|
|sending...|the request is being sent|
|accepted|the relay answered OK true. The message of the relay follows after `: ` if any (e.g. `accepted: deleted 1 event(s)`, `accepted: duplicate: have this event`)|
|rejected: *reason*|the relay answered OK false with *reason*|
|error to open|the connection could not be opened, so the request was not sent|
|no response|the request was sent, but no answer came within 15 seconds, or the connection closed before the answer|
|not sent|the NIP-07 signing failed or was refused, so nothing was sent|

- `accepted` is shown in green, and the others except `sending...` in red.
- The `all relays` row shows a summary such as `accepted 2, rejected 1, error to open 1`. `accepted` is always shown; the others only when the count is not 0.
- To see whether the event is gone, search again.
