# 자동 분류 규칙 v1 (`lib/classify.mjs`)

원칙: **틀리게 확신하느니 보류(`unknown`)한다.** 보류는 검토 큐로 가고 `overrides.json`으로 확정한다.
분류는 중복 판정과 무관하다(중복은 ID만, `schema.md` §1).

## 1. 정규화

1. `title.normalize("NFKC")` → 소문자화 (영문만 영향).
2. 전각 괄호·기호는 NFKC로 반각화됨. `【】「」『』[]()|ㅣ/` 는 **구분자**로 취급.
3. 정규화는 매칭에만 쓰고 저장 제목은 원문 그대로.

## 2. 토큰 경계 매칭 (오분류 방지의 핵심)

모든 키워드는 부분 문자열이 아니라 **경계 매칭**한다.

```js
// 앞뒤가 글자(\p{L})·숫자(\p{N})가 아니어야 매치
const tok = (kw) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(kw)}(?![\\p{L}\\p{N}])`, "iu");
```

이로써 자동으로 막히는 사례:

| 제목 일부 | 키워드 | 결과 | 이유 |
|---|---|---|---|
| `StelLive` | `live` | ❌ 불일치 | 앞이 `l`(글자) |
| `스텔라이브` | `라이브` | ❌ 불일치 | 앞이 `텔`(글자) |
| `MVP` | `mv` | ❌ 불일치 | 뒤가 `p`(글자) |
| `디스커버리` | `커버` | ❌ 불일치 | 앞뒤가 한글 |
| `recover` | `cover` | ❌ 불일치 | 앞이 `e` |
| `【COVER】` | `cover` | ✅ 일치 | 앞뒤가 괄호 |
| `Live Clip` | `live clip` | ✅ 일치 | |

추가 안전장치: 매칭 전 보호어(`stellive`, `스텔라이브`)를 공백으로 치환한 사본을 사용한다(이중 방어).

> 한계: 띄어쓰기 없는 `리제커버` 같은 표기는 매치되지 않아 `unknown`으로 간다 — 의도된 보수적 동작.

## 3. 키워드 사전

| 그룹 | 키워드 |
|---|---|
| SHORT | `#shorts`, `shorts`, `쇼츠` |
| STREAM (풀 VOD) | `노래방송`, `노래 방송`, `歌枠`, `utawaku`, `karaoke`, `다시보기` |
| CLIP (STREAM 무효화) | `클립`, `clip`, `하이라이트`, `highlight` |
| SONG_CTX (하이라이트가 음악인지 판정) | `노래`, `노래방송`, `歌`, `歌枠`, `song`, `karaoke`, `cover`, `커버` |
| LIVE_STRONG | `3d live`, `3d 라이브`, `live clip`, `라이브 클립`, `live ver`, `live stage`, `무보정 라이브`, `방종 라이브`, `concert clip`, `콘서트 클립` |
| LIVE_WEAK | `live`, `라이브`, `3d`, `무대`, `콘서트`, `concert`, `무보정` |
| ORIGINAL | `official mv`, `official audio`, `official music video`, `mv`, `m/v`, `오리지널`, `original`, `ost`, `acoustic ver` |
| COVER | `cover`, `커버`, `歌ってみた`, `불러보았다` |
| COLLAB_SEP | 멤버 별칭 사이의 ` x `, ` × `, ` & `, `with`, `w.`, `feat` |

> `하이라이트`·`콘서트`·`무대` 단독은 게임 하이라이트·공지·브이로그에서 흔하므로 강한 신호로 쓰지 않는다.

## 4. 결정 순서 (첫 매치에서 종료)

| 순위 | 규칙 ID | 조건 | 결과 |
|---|---|---|---|
| 1 | R10-short | SHORT | `excluded_short` |
| 2 | R20-stream | STREAM 이고 CLIP 없음 | `excluded_stream` |
| 3 | R25-song-highlight | CLIP 이고 SONG_CTX | `live_special` (노래방송 하이라이트·공식 클립) |
| 4 | R30-live | LIVE_STRONG | `live_special` (커버·오리지널보다 우선: "3D Live Cover"는 3D·특수) |
| 5 | R35-original | ORIGINAL (COVER 동시 매치 시 reason `category_conflict`) | `original` |
| 6 | R40-cover | COVER, 감지 멤버 ≤ 1 (0명이면 reason `no_member_detected`) | `solo_cover` |
| 7 | R41-collab | COVER, 감지 멤버 ≥ 2 | `collab_cover` |
| 8 | R50-weak-live | LIVE_WEAK만 있음 | `unknown` + reason `weak_live_token` |
| 9 | R90-none | 아무것도 없음 | `non_music` |

`non_music`·`excluded_*`에는 멤버 관련 review 사유를 붙이지 않는다(검토 큐 오염 방지).

## 5. 멤버 감지

1. **업로드 채널 소유자**(멤버 채널이면) 항상 포함.
2. 제목에서 `channels-lock.json`의 멤버 `aliases`를 §2 경계 규칙으로 매칭.
   - **전체 이름**(공백 포함 별칭: `아오쿠모 린`, `Aokumo Rin`)은 단독으로 인정.
   - **이름만**(공백 없는 별칭: `린`, `Rin`, `리제`, `Lize`)은 COLLAB_SEP 바로 옆에 있을 때만 인정
     (예: `히나 × 린 Cover` ✅, `린 (Rin) 이라는 곡 Cover | 하나코 나나` → 린 불인정).
3. 유닛 별칭(`4기`, `ABYSS` 등) 매치 → 해당 유닛 멤버 전원 추가, `reviewReasons += "unit_expansion"`.
   - 곡명과 겹치는 단어(`Universe` 등)는 유닛 별칭에서 제외한다(ALL_GROUPS에 곡 "Universe" 존재).
4. 그룹 별칭(`스텔라이브`, `StelLive`)이 그룹 채널 업로드에서 주체로 쓰이고 멤버 미감지 →
   **업로드일 기준 재적 멤버 전원**(joinedAt ≤ 날짜 ≤ graduatedAt) 추가, `reviewRequired: true`, reason `group_expansion`.
5. 그룹 채널 업로드인데 멤버를 전혀 못 찾음 → `members: []`, `reviewRequired: true`, reason `no_member_detected`.

## 6. reviewRequired 사유 코드

`weak_live_token` · `unit_expansion` · `group_expansion` · `no_member_detected` · `post_graduation_upload` · `category_conflict`(ORIGINAL과 COVER 동시 매치 등) · `unknown_channel`

`unit_expansion`만 있는 경우는 기본적으로 `reviewRequired: false`(유닛 곡은 보통 전원 참여)로 두되 사유는 기록한다. 그 외 사유는 `reviewRequired: true`.

## 7. 테스트

- `tests/fixtures/classification-cases.json` — 시드 27개 + 오분류 함정 케이스. 전부 통과해야 머지.
- `tests/fixtures/dedupe-cases.json` — ID 기준 중복 처리 시나리오.
- 규칙을 바꾸면 fixtures 기대값부터 수정하고 사유를 커밋 메시지에 남긴다.
