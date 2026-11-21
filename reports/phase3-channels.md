# Phase 3 공식 채널 ID 검증 보고서

- **검증 일시**: 2026-11-20
- **검증 대상**: `data/channels-lock.json` 18개 중 `stellive-topic` (`group-sub`, `collect: none`)을 제외한 **17개**
- **교차 확인 소스**:
  1. YouTube 공개 채널 페이지(`https://www.youtube.com/@...`, canonical `channelId` 및 공식 아티스트 배지 `BADGE_STYLE_TYPE_VERIFIED_ARTIST`)
  2. 그룹 공식 채널 `스텔라이브 STELLIVE OFFICIAL` (`@stellive_official`) 추천 채널 탭(`/channels`) 및 영상 설명란/게시물 링크
  3. 스텔라이브 공식 웹사이트(`https://stellive.me/`, `/about`, `/talents`, `/music`, 멤버별 페이지 `/yuni`~`/mary`)
  4. Phase 3 시드 25개 oEmbed 응답

## 1. 요약

- **확정 대상 17개 결과**: **High 16개** / Medium 0개 / Low 0개 / **보류 1개** (`airi-kanna`)
- **제외 항목 참고 (`stellive-topic`)**: oEmbed(`Ei7yWYi7x_E`) 및 채널 페이지로 `UCbiWR9pa5YTRknGPzn0l8Ww` (`스텔라이브 - 주제` / `StelLive - Topic`) 확인됨(`collect: none` 유지).
- **기존 후보 ID 기각 (`stellive`)**: `channels-lock.json`의 `_candidate` `UCMz3R3zOoJnrBC64jN7jeGw`는 비공식 쇼츠/클립 채널 `숏스텔라`로 확인됨. 실제 공식 그룹 채널은 `UC2b4WRE5BZ6SIUWBeJU8rwg` (`@stellive_official`).

## 2. 공식 채널 17개 검증 표

| key | handle | channelId 후보 (24자) | 근거 URL | 확신도 |
|---|---|---|---|---|
| `stellive` | `@stellive_official` | `UC2b4WRE5BZ6SIUWBeJU8rwg` | `https://stellive.me/` · `https://www.youtube.com/@stellive_official` · oEmbed(`v094-E3Pmtk`) | **high** |
| `airi-kanna` | `@airikanna` *(확인 필요)* | `UC6YnTqZidFg4WUiXpiCtSSQ` *(동일 채널 여부 확인 필요)* | `https://www.youtube.com/@airikanna` (`/streams`, `/posts`) · 아래 §3 참고 | **보류** |
| `airi-kanna-music` | `@airikanna` | `UC6YnTqZidFg4WUiXpiCtSSQ` | `https://www.youtube.com/@airikanna` (Verified Artist, `@stellive_official` 추천채널 연결) · oEmbed(`iCCqSFvz9kM`, `of5l0st1kA8`, `zNYEbJr1xj4`) | **high** |
| `ayatsuno-yuni` | `@ayatsunoyuni` | `UClbYIn9LDbbFZ9w2shX3K0g` | `https://stellive.me/yuni` · `@stellive_official/channels` · `https://www.youtube.com/@ayatsunoyuni` (Verified Artist) | **high** |
| `sakihane-fuya` | `@Sakihanechannel` | `UC0YQnenKBCu5sGb7H61n6HA` | `https://stellive.me/huya` · `@stellive_official/channels` · `https://www.youtube.com/@Sakihanechannel` · oEmbed(`eeIMg68ug9Y`) | **high** |
| `akane-lize` | `@akanelize` | `UC7-m6jQLinZQWIbwm9W-1iw` | `https://stellive.me/lize` · `@stellive_official/channels` · `https://www.youtube.com/@akanelize` · oEmbed(`R_B4tmy2DVA`) | **high** |
| `shirayuki-hina` | `@shirayukihina` | `UC1afpiIuBDcjYlmruAa0HiA` | `https://stellive.me/hina` · `@stellive_official/channels` · `https://www.youtube.com/@shirayukihina` · oEmbed(`L1haw5kPB7Q`, `EIii4EXsfsU`) | **high** |
| `neneko-mashiro` | `@neneko_mashiro` | `UC_eeSpMBz8PG4ssdBPnP07g` | `https://stellive.me/mashiro` · `@stellive_official/channels` · `https://www.youtube.com/@neneko_mashiro` · oEmbed(`_8uoathMY0A`) | **high** |
| `arahashi-tabi` | `@arahashitabi` | `UCAHVQ44O81aehLWfy9O6Elw` | `https://stellive.me/tabi` · `@stellive_official/channels` · `https://www.youtube.com/@arahashitabi` (Verified Artist) | **high** |
| `tenko-shibuki` | `@tenkoshibuki` | `UCYxLMfeX1CbMBll9MsGlzmw` | `https://stellive.me/shibuki` · `@stellive_official/channels` · `https://www.youtube.com/@tenkoshibuki` (Verified Artist) | **high** |
| `aokumo-rin` | `@aokumorin` | `UCQmcltnre6aG9SkDRYZqFIg` | `https://stellive.me/rin` · `@stellive_official/channels` · `https://www.youtube.com/@aokumorin` (Verified Artist) | **high** |
| `hanako-nana` | `@hanako_nana` | `UCcA21_PzN1EhNe7xS4MJGsQ` | `https://stellive.me/nana` · `@stellive_official/channels` · `https://www.youtube.com/@hanako_nana` (Verified Artist) | **high** |
| `yuzuha-riko` | `@yuzuhariko` | `UCj0c1jUr91dTetIQP2pFeLA` | `https://stellive.me/riko` · `@stellive_official/channels` · `https://www.youtube.com/@yuzuhariko` (Verified Artist) | **high** |
| `tokino-meri` | `@TokinoMaryChannel` | `UCGSt1yNG5l-jpYRLpJ5oNtA` | `https://stellive.me/mary` · `@stellive_official` 설명란 · `https://www.youtube.com/@TokinoMaryChannel` (Verified Artist) *(주: `@tokino-mary` 404)* | **high** |
| `shizuki-toa` | `@ShizukiToa` | `UClcSEuDF_g_6g4snw_nAavw` | `https://stellive.me/toa` · `@stellive_official/channels` · `https://www.youtube.com/@ShizukiToa` (Verified Artist) | **high** |
| `hanayo-hiyori` | `@HanayoHiyori` | `UCHAr9pWGS30akL4MQCQT4uQ` | `https://stellive.me/hiyori` · `https://www.youtube.com/@HanayoHiyori` (Verified Artist) · oEmbed(`ouKcRBeyKbk`) *(주: `@hanayo-hiyori` 404)* | **high** |
| `kogane-rang` | `@coganerang` | `UCQ6LlsI7Bbj2yhSqLMI1gGA` | `https://stellive.me/rang` · `@stellive_official/channels` · `https://www.youtube.com/@coganerang` (Verified Artist) | **high** |

## 3. 졸업 멤버(아이리 칸나) 채널 상태 및 `graduatedAt` 검증

- **채널 상태**: `@airikanna` (`UC6YnTqZidFg4WUiXpiCtSSQ`, 현 채널명 `아이리 칸나 Music Official`, 구독자 28.5만명, `BADGE_STYLE_TYPE_VERIFIED_ARTIST`)는 삭제되지 않고 공개 보관 상태로 유지 중이며, `stellive.me/music`에서도 `[졸업생] 아이리 칸나`로 표기된다.
- **`graduatedAt` (`2024-12-02`) 일치 여부**: `@airikanna/posts`에 게시된 공식 공지 `💎AIRI KANNA LAST CONCERT💎 「The finale」 2024.12.02 오후 7시 (GMT+9)`과 **정확히 일치**한다. RSS 피드(`UC6YnTqZidFg4WUiXpiCtSSQ`)의 마지막 업로드는 `2024-09-06T10:58:07+00:00` (`6A04OifrfR0`)으로, 졸업일 이후 신규 업로드는 없다.
- **보류 사유 및 사용자 질문 (`airi-kanna` vs `airi-kanna-music`)**:
  - `@airikanna` (`UC6YnTqZidFg4WUiXpiCtSSQ`)의 `/streams` 탭과 RSS 피드에 칸나의 게임·잡담 생방송 VOD(`7m3xatpfc6o`, `5wh_pXyifWU`, `V399asNlB-w`)와 음악 영상(`iCCqSFvz9kM`, `of5l0st1kA8`, `zNYEbJr1xj4`)이 **함께** 존재한다. 즉 `@airikanna`가 본채널이었고 졸업 전후로 채널명이 `아이리 칸나 Music Official`로 변경된 것으로 보인다.
  - 별도 본채널이나 다시보기 채널(`@airikannafull`, `@airikanna_full`, `@airikanna_replay` 등은 모두 404; `@airikanna_ch`는 구독자 2명의 개인 팬 아카이브 계정)은 확인되지 않았다.
  - **질문(보류)**: `channels-lock.json`에서 `airi-kanna`와 `airi-kanna-music`을 동일 `UC6YnTqZidFg4WUiXpiCtSSQ`로 통합(또는 `airi-kanna`를 `collect: none` 시드/졸업 기준용으로 두고 `airi-kanna-music`만 `archive-watch` 수집)할까요, 아니면 별도로 존재했던 채널이 있었나요?

## 4. D5 (1기 유닛명 `Mystic` vs `Everys`) 공식 표기 근거

1. `https://stellive.me/about`: `"여성 VTuber 그룹인 '에버리스'과 '유니버스', ‘클리셰’가 있으며"` → 현행 1기 공식 유닛명은 **Everys(에버리스)**.
2. `https://stellive.me/talents`: 1기(`01.png`) 유닛 로고 `EVERYS.png` 아래 `아야츠노 유니`(`/yuni`)·`사키하네 후야`(`/huya`) 배치.
3. `https://stellive.me/news`: `<스텔라이브 에버리스 1주년>` 등 공식 공지에서 **에버리스(Everys)** 사용.
4. `https://stellive.me/music`: 아이리 칸나 재적 시기 1·2기 단체 커버 `✧Alice in Musicland✧`에는 **`Mystic & Universe`**로, 이후 1기 커버 `팝핀 캔디☆피버!`에는 **`Everys`**로 표기됨.
- **결론**: 초기 1기(칸나 재적기) 공식 표기는 `Mystic`, 현재 1기(유니·후야) 공식 표기는 `Everys`로 확인되며, `channels-lock.json`의 `gen1-mystic` / `gen1-everys` 병기는 공식 자료와 정합적이다.
