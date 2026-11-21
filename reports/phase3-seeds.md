# Phase 3 시드 영상 25개 검증 보고서

- **검증 일시**: 2026-11-20
- **검증 대상**: `data/videos.json` 27개 중 `eSI7RsjZy1E`, `ojV55hcIc4w` 제외한 **25개**
- **검증 방법**: `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=<ID>&format=json` (`<= 1 req/sec`) 및 `data/baseline/baseline-2026-11-17.json`, `data/videos.json`, Phase 3 채널 확인 결과 대조

## 1. 요약

- **전체 건수**: 25건 검증 → **200 OK 25건** / 401·403 0건 / 404 0건
- **ID 오타 후보**: **0건** (전부 실존 영상으로 확인)
- **오귀속 의심**: **0건** (모든 영상의 업로더·곡명이 시드/PDF 기준선과 일치. 단, `EIii4EXsfsU`는 `videos.json`의 `channelKey: null` → 실제 업로더 `@shirayukihina` 확인됨)
- **조치 제안 분류**: `OK` **20건** / `override 제안` **5건** (`E_G9otMLf64`, `v094-E3Pmtk`, `G5tTozKJRD4`, `_8uoathMY0A`, `Ei7yWYi7x_E` — 실제 YouTube 제목이 시드 제목과 달라 재분류 시 키워드 탈락 위험)

## 2. 시드 25개 검증 표

| ID | 결과 | 업로드 채널 (`author_name` / `author_url`) | 일치 여부 (채널·제목/곡명) | 조치 제안 |
|---|---|---|---|---|
| `8lD-6Xyq4Lg` | 200 | 하나코 나나 HANAKO NANA (`/@hanako_nana`) | 채널 일치(`hanako-nana`) · 제목 일치(`발랄라이카 [ BALALAIKA / 9Lana ] / 하나코 나나 COVER`) | **OK** |
| `liPEQZJLQh4` | 200 | 아카네 리제 AKANE LIZE (`/@akanelize`) | 채널 일치(`akane-lize`) · 제목 일치(`로스트원의 호곡 [ロストワンの号哭 / Neru]ㅣ아카네 리제(Akane Lize) 【COVER】`) | **OK** |
| `Ei7yWYi7x_E` | 200 | StelLive - Topic (`/channel/UCbiWR9pa5YTRknGPzn0l8Ww`) | 채널 일치(`stellive-topic`) · 곡명 일치(`Where Stars Begin` = `'별이 시작되는 곳'` 영문 유통명, 실제 제목에 `Official Audio` 미포함) | **override 제안**: `category: "original"` 명시 권장 (Topic 채널 실제 제목에 `ORIGINAL` 키워드 없음) |
| `3Xf1Wt7Z-RY` | 200 | 텐코 시부키 TENKO SHIBUKI (`/@tenkoshibuki`) | 채널 일치(`tenko-shibuki`) · 제목 일치(`혁명도중 [革命道中 / アイナ・ジ・エンド] / 텐코 시부키 (Tenko Shibuki) cover`) | **OK** |
| `ouKcRBeyKbk` | 200 | 하나요 히요리 HANAYO HIYORI (`/@HanayoHiyori`) | 채널 일치(`hanayo-hiyori`) · 제목 일치(`유령이 되고싶어 [ゆうれいになりたい / 유이카] / 하나요 히요리 (Hanayo Hiyori) Cover`) | **OK** |
| `MZNKiadMo3U` | 200 | 시즈키 토아 SHIZUKI TOA (`/@ShizukiToa`) | 채널 일치(`shizuki-toa`) · 제목 일치(`제육감 [第六感 l Reol] / 시즈키 토아(Shizuki Toa) Cover`) | **OK** |
| `iAoU1UGPoXc` | 200 | 코가네 랑 COGANE RANG (`/@coganerang`) | 채널 일치(`kogane-rang`) · 제목 일치(`호랑풍류가 [나와 호랑이님 OST] / 코가네 랑 (Cogane Rang) Cover`) | **OK** |
| `kNzGpNEdBqw` | 200 | 아야츠노 유니 AYATSUNO YUNI (`/@ayatsunoyuni`) | 채널 일치(`ayatsuno-yuni`) · 제목 일치(`오버라이드 「オーバーライド / 吉田夜世」 - 아야츠노 유니 Cover`) | **OK** |
| `Qi_JLmXBFFo` | 200 | 아오쿠모 린 AOKUMO RIN (`/@aokumorin`) | 채널 일치(`aokumo-rin`) · 제목 일치(`불가행력 [不可幸力 / Vaundy ] / 아오쿠모 린 (Aokumo Rin) Cover`) | **OK** |
| `FzefgoF26Ac` | 200 | 아카네 리제 AKANE LIZE (`/@akanelize`) | 채널 일치(`akane-lize`) · 제목 일치(`여우의 별자리 「심월과 달의 노래」 (『명조워더링 웨이브』 OST)ㅣ아카네 리제(Akane Lize) 【COVER】`) | **OK** |
| `v094-E3Pmtk` | 200 | 스텔라이브 STELLIVE OFFICIAL (`/@stellive_official`) | 채널 일치(`stellive`) · 곡명 일치(`스텔라이브 (StelLive) I 'STAR TRAIL (스타트레일)'` — 실제 제목에 `Official MV` 미포함) | **override 제안**: `category: "original"`, `reviewed: true` 및 참여 멤버 확정 (현재 `needsReview: true`, 실제 제목으로 재분류 시 `non_music` 위험) |
| `fLLX2R-RwVE` | 200 | 유즈하 리코 YUZUHA RIKO (`/@yuzuhariko`) | 채널 일치(`yuzuha-riko`) · 제목 일치(`숨바꼭질 [ かくれんぼㅣAliA ] / 유즈하 리코 Yuzuha Riko cover`) | **OK** |
| `R_B4tmy2DVA` | 200 | 아카네 리제 AKANE LIZE (`/@akanelize`) | 채널 일치(`akane-lize`) · 제목 일치(`출항 [抜錨(발묘) / 나나호시 관현악단 ナナホシ管弦楽団] ㅣ아카네 리제(Akane Lize) 【COVER】`) | **OK** |
| `bJqdy8925Oc` | 200 | 텐코 시부키 TENKO SHIBUKI (`/@tenkoshibuki`) | 채널 일치(`tenko-shibuki`) · 제목 일치(`생명에게 미움받고 있어 (命に嫌われている。) / 텐코 시부키(Tenko Shibuki) cover`) | **OK** |
| `EIii4EXsfsU` | 200 | 시라유키 히나 SHIRAYUKI HINA (`/@shirayukihina`) | 업로더 확인(`videos.json` `channelKey: null` → 실제 `shirayuki-hina`, `members` 일치) · 제목 일치(`JANE DOE ... \| 시라유키 히나 x 아오쿠모 린 Cover`) | **OK** (참고: `channelKey: "shirayuki-hina"` 보완 가능) |
| `eeIMg68ug9Y` | 200 | 사키하네 후야 SAKIHANE HUYA (`/@Sakihanechannel`) | 채널 일치(`sakihane-fuya`) · 제목 일치(`별자리가 될 수 있다면 (星座になれたら) l 사키하네 후야(Sakihane Huya) Cover`) | **OK** |
| `E_G9otMLf64` | 200 | 아라하시 타비 ARAHASHI TABI (`/@arahashitabi`) | 채널 일치(`arahashi-tabi`) · 곡명/영상 일치(`[4K] 스텔라이브 아라하시 타비! 3D 데뷔!` — 실제 제목에 `Live`/`라이브` 미포함) | **override 제안**: `category: "live_special"`, `reviewed: true` (실제 제목에 `3D`만 있어 재분류 시 `LIVE_WEAK`→`unknown` 위험) |
| `L1haw5kPB7Q` | 200 | 시라유키 히나 SHIRAYUKI HINA (`/@shirayukihina`) | 채널 일치(`shirayuki-hina`) · 제목 일치(`만찬가『晩餐歌』 \| 시라유키 히나 Cover`) | **OK** |
| `G5tTozKJRD4` | 200 | 아라하시 타비 ARAHASHI TABI (`/@arahashitabi`) | 채널 일치(`arahashi-tabi`) · 곡명 일치(`아라하시 타비 (Arahashi Tabi) \| '여로'` — 실제 제목에 `Official MV` 미포함) | **override 제안**: `category: "original"` 명시 권장 (실제 제목에 `ORIGINAL` 키워드 없음) |
| `_8uoathMY0A` | 200 | 네네코 마시로 NENEKO MASHIRO (`/@neneko_mashiro`) | 채널 일치(`neneko-mashiro`) · 곡명 일치(`네네코 마시로(Neneko Mashiro) \| ‘봄꿈’` — 실제 제목에 `Official MV` 미포함) | **override 제안**: `category: "original"` 명시 권장 (실제 제목에 `ORIGINAL` 키워드 없음) |
| `O1MqvWf7q58` | 200 | 아오쿠모 린 AOKUMO RIN (`/@aokumorin`) | 채널 일치(`aokumo-rin`) · 제목 일치(`무희 (Vaundy) / 아오쿠모 린(Aokumo Rin) Cover`) | **OK** |
| `CyOAmEihVHs` | 200 | 아카네 리제 AKANE LIZE (`/@akanelize`) | 채널 일치(`akane-lize`) · 제목 일치(`Drowning (WOODZ)ㅣ아카네 리제 (Akane Lize) 【Cover】`) | **OK** |
| `iCCqSFvz9kM` | 200 | 아이리 칸나 Music Official (`/@airikanna`) | 채널 일치(`airi-kanna-music`) · 제목 일치(`아이리 칸나(Airi Kanna) \| 최종화 (Acoustic Ver.)`) | **OK** |
| `of5l0st1kA8` | 200 | 아이리 칸나 Music Official (`/@airikanna`) | 채널 일치(`airi-kanna-music`) · 곡명 일치(`怪獣の花唄 (Vaundy) / 藍璃かんな Cover` = 괴수의 꽃노래) | **OK** |
| `zNYEbJr1xj4` | 200 | 아이리 칸나 Music Official (`/@airikanna`) | 채널 일치(`airi-kanna-music`) · 제목 일치(`아이리 칸나 (Airi Kanna) - 최종화 (The Last Flower) Live Clip`) | **OK** |

## 3. 오귀속 의심 및 Override 제안 요약

- **오귀속 의심 건**: **없음** (이미 제외된 `eSI7RsjZy1E`, `ojV55hcIc4w` 외 25건 모두 정상 업로더·곡명 확인).
- **분류 보호용 Override 제안 (5건)**:
  - `v094-E3Pmtk`: `category: "original"`, `reviewed: true` (및 `members` 확인 — 현재 `reviewQueue` 대기 중이며 실제 제목에 `Official MV`가 없음).
  - `E_G9otMLf64`: `category: "live_special"`, `reviewed: true` (실제 제목 `[4K] 스텔라이브 아라하시 타비! 3D 데뷔!`에 `Live`가 없어 `LIVE_WEAK` 위험).
  - `G5tTozKJRD4`, `_8uoathMY0A`, `Ei7yWYi7x_E`: `category: "original"` 명시 (실제 YouTube 제목에 `Official MV` / `Official Audio` 키워드 부재 대비).
