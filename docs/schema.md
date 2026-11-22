# 데이터 계약 (0단계 확정본 v1)

> 모든 점수는 **큐레이터 개인 평가(Personal Curated Ratings)** 이며 공식 평가가 아니다.
> 이 문서가 Sonnet(수집)·Antigravity(UI)·Opus(검수) 공통 기준이다. 변경 시 `schemaVersion`을 올린다.

## 0. 저장소 구조와 파일 소유권

```
/index.html, /app/**                 ← Antigravity (UI)
/lib/video-id.mjs                    ← Sonnet  (ID 정규화, 공용)
/lib/classify.mjs                    ← Sonnet  (자동 분류, 스크립트 전용)
/lib/derive.mjs                      ← Sonnet 구현 / Opus 검수 (파생 계산, UI·스크립트 공용)
/scripts/fetch-videos.mjs            ← Sonnet
/.github/workflows/fetch-videos.yml  ← Sonnet
/data/channels-lock.json             ← 사람(사용자 승인) — 봇은 읽기만
/data/videos.json                    ← 봇 전용 쓰기
/data/overrides.json                 ← 사용자 전용 쓰기
/data/ratings.json                   ← 사용자 전용 쓰기 (UI에서 내보내기)
/data/baseline/*.json                ← 읽기 전용 기준선 (PDF 2026-11-17)
/tests/fixtures/*.json               ← 분류·중복 테스트 케이스
```

**쓰기 경계 원칙**: 봇은 `videos.json` 외에는 절대 쓰지 않는다. 사용자의 평가·보정은 봇 커밋과 충돌하지 않는다.

---

## 1. Video ID 규칙 (규칙 1)

- 유효 ID: 정규식 `^[A-Za-z0-9_-]{11}$`. **대소문자 구분** — 소문자화·트림 외 어떤 변형도 금지.
- 입력이 URL이면 `watch?v=`, `youtu.be/`, `/shorts/`, `/live/`, `/embed/`에서 추출 후 검증.
- 중복 판정은 **오직 ID**. 제목·곡명·업로드일은 중복 판정에 쓰지 않는다.
  - 같은 곡을 다시 부른 새 영상 → ID가 다르므로 별도 항목.
  - 같은 ID가 다른 제목/다른 채널 피드로 다시 나타남 → 기존 항목 갱신(제목 변경은 `previousTitles`에 보관).
- `videos.json`의 `videos`는 **ID를 키로 하는 객체**이므로 구조적으로 중복이 불가능하다.

---

## 2. `data/videos.json` (봇 소유)

```jsonc
{
  "schemaVersion": 1,
  "updatedAt": "2026-11-20T03:17:00Z",
  "videos": {
    "R_B4tmy2DVA": {
      "videoId": "R_B4tmy2DVA",
      "title": "출항 [抜錨(발묘)]ㅣ아카네 리제 【COVER】",
      "previousTitles": [],
      "channelKey": "akane-lize",          // 업로드 채널. 미확인이면 null
      "seenOnChannels": ["akane-lize"],     // 피드에서 관측된 채널들
      "publishedAt": "2025-12-04",          // RSS는 ISO 8601 전체, 시드는 날짜만
      "source": "seed",                     // seed | rss | backfill
      "firstSeenAt": "2026-11-17T00:00:00Z",
      "lastSeenInFeedAt": null,
      "status": "unverified",               // active | unverified | private | deleted
      "statusCheckedAt": null,
      "failStreak": 0,                      // 연속 확인 실패 횟수 (2회 이상이면 deleted/private 확정)
      "auto": {
        "category": "solo_cover",           // §5 카테고리
        "members": ["akane-lize"],
        "matchedRules": ["R40-cover"],
        "reviewRequired": false,
        "reviewReasons": []
      }
    }
  }
}
```

- 봇은 `auto`만 계산한다. 사람이 판단할 부분은 `overrides.json`.
- **삭제·비공개 영상도 항목을 지우지 않는다** (`status`만 변경). 평점도 유지된다.
- 키 순서는 `publishedAt` 내림차순으로 직렬화(diff 가독성), 들여쓰기 2칸, 끝 개행.

## 3. `data/overrides.json` (사용자 소유)

```jsonc
{
  "schemaVersion": 1,
  "videos": {
    "v094-E3Pmtk": {
      "category": "original",                     // 선택: auto.category 대체
      "members": ["akane-lize", "shirayuki-hina"], // 선택: auto.members 통째 대체 (병합 아님)
      "exclude": false,                            // 선택: true면 집계·순위에서 제외
      "reviewed": true,                            // 선택: true면 reviewRequired 해제
      "note": "참여 멤버 확인 완료"
    }
  }
}
```

**유효 분류(effective) 계산** — `lib/derive.mjs`의 `effective(video, override)`:

```
category = override.category ?? video.auto.category
members  = override.members  ?? video.auto.members
excluded = override.exclude === true
needsReview = video.auto.reviewRequired && override.reviewed !== true
```

## 4. `data/ratings.json` (사용자 소유, UI가 내보냄)

```jsonc
{
  "schemaVersion": 1,
  "disclaimer": "모든 점수는 큐레이터 개인 평가이며 공식 평가가 아닙니다.",
  "exportedAt": "2026-11-20T10:00:00+09:00",
  "memberRubric": {                       // A: 멤버 10항목 루브릭 (직접 평가)
    "akane-lize": {
      "items": { "vocalization": 14.3, "pitch": 9.5, "rhythm": 9.5, "range": 9.7, "volume": 9.3,
                 "tone": 9.9, "technique": 9.8, "expression": 9.9, "breath": 9.1, "live": 4.8 },
      "ratedAt": "2026-11-17",
      "source": "baseline-2026-11-17"     // baseline-2026-11-17 | manual
    }
  },
  "videoRatings": {                       // 영상별 평가. 키가 없으면 = 미채점(songScore: null)
    "R_B4tmy2DVA": {
      "songScore": 98.4,                  // 0–100, null 허용 (영상 전체 인상 점수)
      "members": {                        // 선택: 참여 멤버별 5항목 0–100
        "akane-lize": { "pitch": 98, "tone": 99, "expression": 99, "highNotes": 97, "stability": 98 }
      },
      "ratedAt": "2026-11-17",
      "note": ""
    }
  }
}
```

### 4.1 멤버 루브릭 항목 (PDF 기준, 합계 100)

| key | 항목 | 만점 | 그룹 |
|---|---|---|---|
| vocalization | 발성 | 15 | 물리 |
| pitch | 음정 | 10 | 물리 |
| rhythm | 리듬 | 10 | 물리 |
| range | 음역 | 10 | 물리 |
| volume | 성량 | 10 | 물리 |
| tone | 음색 | 10 | 해석 |
| technique | 테크닉 | 10 | 해석 |
| expression | 표현력 | 10 | 해석 |
| breath | 호흡 | 10 | 해석 |
| live | 라이브 | 5 | 해석 |

물리 합 55, 해석 합 45. 입력값은 `0 ≤ x ≤ 만점`, 소수 1자리.

### 4.2 영상별 멤버 5항목 (0–100)

`pitch`(음정) · `tone`(음색) · `expression`(표현력) · `highNotes`(고음) · `stability`(안정성)
5개가 **모두 입력된 경우에만** 해당 멤버의 영상 점수로 인정한다(부분 입력은 미채점 취급, UI는 저장 전 경고).

> 두 척도의 관계: 10항목 루브릭은 "멤버 전체 역량" 직접 평가(A), 5항목은 "이 영상에서의 이 멤버" 평가. 서로 자동 변환하지 않는다.

---

## 5. 카테고리

| key | 표시명 | 집계 대상 |
|---|---|---|
| `solo_cover` | 개인커버 | ✅ |
| `collab_cover` | 협동커버 | ✅ |
| `live_special` | 3D·특수 (공식 라이브 클립·3D·무보정·하이라이트) | ✅ |
| `original` | 오리지널·OST | ✅ |
| `excluded_stream` | 노래방송 풀 VOD | ❌ |
| `excluded_short` | 쇼츠 | ❌ |
| `non_music` | 비음악 (게임·잡담·공지 등) | ❌ |
| `unknown` | 판단 보류 → 검토 큐 | ❌ (검토 전) |

분류 알고리즘·예외는 `docs/classification-rules.md`.

---

## 6. 파생 계산 (규칙 2·3) — `lib/derive.mjs`

**어떤 숫자도 저장하지 않고 매번 세 파일에서 계산한다.** `+= 1` 누적 코드는 금지(검수 항목).

```
MUSIC = {solo_cover, collab_cover, live_special, original}
counted(v) = effective.category ∈ MUSIC && !excluded && !needsReview
```
- 삭제/비공개 영상도 `counted`에 포함(아카이브 기록). UI에서 "삭제됨 n"을 별도 표기.

### 6.1 아카이브 수
- `uniqueVideos` = counted 영상 수 (영상 1개 = 1)
- `memberSlots[m][category]` = counted 영상 중 `m ∈ members`인 수 (듀엣은 각 멤버에 1씩 → PDF의 "604 슬롯"과 같은 방식)
- 두 수치는 항상 **함께, 이름을 구분해** 표시한다.

### 6.2 점수
```
memberVideoScore(m, v) = mean(ratings.videoRatings[v].members[m] 5항목)  // 5개 모두 있을 때만
songScore(v)           = ratings.videoRatings[v]?.songScore ?? null
contribution(m, v)     = memberVideoScore(m, v) ?? songScore(v)          // 둘 다 없으면 null → 제외
```
- **A. 루브릭 총점** = `sum(memberRubric[m].items)` (물리·해석 소계도 합으로 계산). 루브릭 없으면 null.
- **B. 곡 평균** = counted 영상 중 `m ∈ members` 이고 `contribution ≠ null`인 값들의 평균. `n` = 그 개수.
- B 순위는 `n ≥ MIN_RATED (=3)`인 멤버만. 미달 멤버도 카드에 `B값 (n곡)`과 "순위 산정 기준 미달" 표시.
- 미채점 영상(`contribution = null`)은 A·B·순위 어디에도 영향 없음 → 새 영상은 자동으로 무영향.
- 메인 순위 = A 내림차순(동점 시 B, 그다음 멤버 key). 반올림은 표시 시점에만(소수 1자리), 계산은 원값.

### 6.3 등급 (A 기준)
`S+ ≥ 95` · `S ≥ 90` · `A+ ≥ 85` · `A ≥ 80` · `B+ ≥ 75` · `B < 75`
(PDF 표에서 역산. B+ 하한 75 사용자 확정 2026-11-20)

### 6.4 기준선 대조
`data/baseline/baseline-2026-11-17.json`의 `reportedCounts`와 `memberSlots`를 비교해 차이를 **표시만** 한다. 기준선 값은 어떤 계산에도 더하지 않는다.

---

## 7. `data/channels-lock.json`

```jsonc
{
  "schemaVersion": 1,
  "lockedAt": null,                 // 사용자가 전 채널 승인 시 날짜 기입
  "units": [ { "key": "gen4-abyss", "label": "4기 ABYSS", "aliases": ["4기", "ABYSS"] } ],
  "channels": [
    {
      "key": "akane-lize",
      "type": "member",              // group | member
      "displayName": "아카네 리제",
      "unit": "gen2-universe",
      "handle": null,                // "@..." 사용자 확인 필요
      "channelId": null,             // "UC" + 22자. RSS 수집에 필수
      "verified": false,             // 사용자 승인 전 false → 수집 스크립트는 건너뜀
      "status": "active",            // active | graduated
      "joinedAt": null,
      "graduatedAt": null,
      "collect": "active",           // active | archive-watch
      "aliases": ["아카네 리제", "리제", "Akane Lize", "Lize"]
    }
  ]
}
```

- `type` 4종 (v1.1, 2026-11-20 추가):
  - `group`: 그룹 공식 채널
  - `member`: 멤버 본채널. **멤버 카드(15장)는 이 유형에서만 만든다.**
  - `member-sub`: 멤버의 보조 채널(현재 사용 항목 없음. 2026-11-21에 칸나의 `airi-kanna-music`은 같은 채널 `@airikanna`로 확인되어 `airi-kanna`에 통합됨). `memberKey`로 귀속 멤버를 지정하며, 업로드는 그 멤버의 영상으로 분류된다. 졸업일·검토 큐 규칙도 귀속 멤버 기준.
  - `group-sub`: 그룹의 보조 채널(예: `stellive-topic` = YouTube 자동 생성 Topic). 그룹 확장 판단에서 `group`과 동일하게 취급.
- `collect`: `active` | `archive-watch` | `none`. `none`이면 승인 여부와 무관하게 자동 수집하지 않는다(시드 귀속용 등록).
- `verified: false` 채널은 수집하지 않는다(잘못된 채널 오염 방지).
- `collect: "archive-watch"`(칸나): 계속 RSS를 확인하되 `graduatedAt` 이후 업로드는 `reviewRequired: true, reviewReasons: ["post_graduation_upload"]`로 들어와 **사용자가 overrides로 승인하기 전까지 집계 제외**.
- 별칭 매칭은 `docs/classification-rules.md` §2의 경계 규칙을 따른다.

---

## 8. 수집 정책 요약 (Sonnet 상세는 handoff 별도)

- 기본: API 키 없이 RSS `https://www.youtube.com/feeds/videos.xml?channel_id=UC…` (채널당 최신 15개).
  - 쇼츠 분리 옵션: `playlist_id=UULF{channelId[2:]}`(롱폼만) — 동작 확인 후 채택, 실패 시 channel_id 피드로 폴백.
- 상태 확인: oEmbed `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={id}&format=json`
  - 200 → active, 404 → deleted 후보, 401/403 → private 후보. `failStreak ≥ 2`일 때만 상태 확정.
  - 실행당 최대 N개(기본 60)씩 순환 확인(오래 확인 안 된 순).
- 선택: `--backfill` + `YOUTUBE_API_KEY`(playlistItems, 1유닛/50개)로 과거 전체 수집. 기본 비활성.
- 주기: 3시간마다(`17 */3 * * *`, 정각 혼잡 회피). 변경이 있을 때만 커밋.

## 부록: 조회수 필드 (2026-11-22)

- `videos.<id>.viewCount` (number, 선택): YouTube `videos.list` `statistics.viewCount`. 영상 1개의 원시 값이며 집계값이 아니다.
- `videos.<id>.viewCountAt` (ISO 시각, 선택): 마지막 조회수 갱신 시각.
- 수집: `YOUTUBE_API_KEY`가 있을 때만 음악 카테고리(override 우선) 영상을 24시간에 한 번 갱신한다(50개당 1 quota). `--no-views`로 끔, `--views-limit N`으로 상한 조정.
- 표시 전용: 점수·순위 계산(`lib/derive.mjs`)에는 쓰지 않는다.

## 부록: 수집 파이프라인 범위 (2026-11-22)

- 분류: 신규 ID만 1회 분류한다. 기존 영상은 저장된 `auto`를 유지하며, 제목·채널이 바뀐 경우에만 재분류한다. 분류 규칙을 바꾼 뒤에는 `--reclassify-all`로 1회 전체 재분류한다.
- 상태 확인(oEmbed): 음악 카테고리(override 우선, `exclude` 제외)만 대상이다. `deleted`·`private` 판정은 최종이라 다시 확인하지 않는다.
- 쇼츠 판정: 음악·판단 보류 영상만 대상이며 영상당 1회(`isShort`) 확인한다. 조회수: 음악·공개 영상만 대상이며 24시간에 1회 갱신한다.

## 부록: 단체곡 평가 제외 (2026-11-22)

- 단체곡 = 유효 멤버 수가 `GROUP_SONG_MIN_MEMBERS`(3) 이상인 영상(`lib/derive.mjs` `isGroupSong`). 듀엣(2인)은 평가 대상이다.
- 단체곡은 목록·검색·미리보기에 그대로 노출되고 멤버 슬롯에도 집계되지만, B(곡 평균)·`songAvgN`·B 순위에는 반영하지 않는다. `videoRows[].groupSong`, `memberCards[].groupSongCount`로 표시한다.
- `ratings.json`의 단체곡 점수(예: STAR TRAIL 96.8)는 원본 보존을 위해 그대로 두며, UI에서는 점수 대신 "단체곡 · 평가 제외" 배지를 보인다. 루브릭 A는 영상과 무관하므로 영향이 없다.
