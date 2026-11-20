# Antigravity 작업 명세서 — 스텔라이브 보컬 트래커 UI (초안 v1)

> 이 문서만 보고 작업할 수 있도록 작성했다. 데이터 정의의 원본은 `docs/schema.md`이며, 충돌 시 schema.md가 우선한다.
> **모든 점수는 큐레이터 개인 평가**다. 이 문구는 화면에서 빠지면 안 된다(검수 필수 항목).

## 1. 목표와 범위

- 정적 웹앱 1개: `/index.html` + `/app/*.js`, `/app/*.css`. **빌드 도구 없음**, 바닐라 ES Modules.
- GitHub Pages에 배포 → 구글 사이트에는 **URL 임베드**(iframe)로 삽입.
- 데이터는 같은 저장소의 JSON을 상대경로로 `fetch`:
  `./data/channels-lock.json`, `./data/videos.json`, `./data/overrides.json`, `./data/ratings.json`, `./data/baseline/baseline-2026-11-17.json`
- **하지 않는 것**: 서버, 로그인, YouTube API 호출, 데이터 파일 직접 수정(브라우저는 저장소에 쓸 수 없음).

## 2. 절대 규칙 (위반 시 반려)

1. **파생 계산은 `/lib/derive.mjs`만 사용한다.** UI 안에서 곡 수·평균·순위·등급을 직접 계산하거나 누적(`+= 1`)하지 않는다.
   - derive.mjs는 Sonnet이 구현한다. 그 전까지는 아래 §8의 **인터페이스대로 임시 스텁**을 `/app/derive-stub.mjs`에 두고 개발하되, 최종본에서는 import 경로만 바꾼다.
2. **미채점 = null.** 평가가 없는 영상은 "미채점" 배지로 표시하고, 0점으로 취급하거나 평균에 넣지 않는다.
3. **중복 판정·식별은 11자리 videoId만.** 곡명으로 묶거나 합치지 않는다(같은 곡의 다른 영상은 별개 카드).
4. 기준선 PDF 수치(`baseline`)는 **"기준선(참고)" 라벨로 분리 표시**만 하고 계산값에 더하지 않는다.
5. 외부 CDN을 쓸 경우 버전 고정 + SRI. 차트는 가능하면 **SVG 직접 그리기**(의존성 0)를 권장.

## 3. 화면 구성

### 3.1 상단 공통
- 제목, 데이터 갱신 시각(`videos.updatedAt`), **고정 배너: "모든 점수는 큐레이터 개인 평가이며 공식 평가가 아닙니다."**
- 탭: `스코어카드` · `영상 아카이브` · `채점` · `검토 큐` · `기준선 대조` · `내보내기`
- 우상단: "새 창에서 열기" 링크(iframe 제약 대비, §6).

### 3.2 스코어카드 (15인)
카드 1장 = 멤버 1명. 정렬 기본값 = A 내림차순(동점: B → key).

| 표시 요소 | 출처 (derive) |
|---|---|
| 순위·이름·유닛·졸업 배지(칸나) | `memberCards[].rankA`, channels-lock |
| **A. 루브릭 총점** + 등급(S+/S/A+/A/B+/B) + 물리/55·해석/45 소계 | `rubricTotal`, `grade`, `physical`, `interpretive` |
| 10항목 레이더 또는 가로 막대 (항목별 만점 대비 %) | `rubricItems` |
| **B. 곡 평균** `xx.x (n곡)` | `songAvg`, `songAvgN` |
| B 순위 또는 **"순위 산정 기준 미달 (n/3곡)"** | `rankB` (null이면 미달 문구) |
| 아카이브: 개인/협동/3D·특수/오리지널 슬롯 수 + 합계 | `slots` |
| 미채점 영상 수, 삭제됨 수 | `unratedCount`, `deletedCount` |

- 카드 하단 작은 글씨: "A = 멤버 직접 평가(10항목), B = 채점된 영상 평균. 개인 평가."
- 상단 요약 바: 고유 영상 수(`uniqueVideos`)와 멤버 슬롯 합(`totalSlots`)을 **이름을 구분해** 나란히 표시.

### 3.3 영상 아카이브
- 표/그리드: 썸네일(`https://i.ytimg.com/vi/{id}/mqdefault.jpg`), 제목, 멤버 칩, 카테고리, 업로드일, 점수 또는 "미채점", 상태 배지(`삭제됨`/`비공개`/`미검증`).
- 필터: 멤버, 카테고리, 채점 여부, 상태, 검토 필요. 검색: 제목.
- 삭제·비공개 영상은 흐리게 표시하되 목록에 남김.
- 클릭 → 채점 패널.

### 3.4 채점 패널 (슬라이더)
- 영상 정보 + YouTube 임베드(`https://www.youtube-nocookie.com/embed/{id}`) 선택 토글.
- **songScore** 슬라이더 0–100(0.1 단위) + 숫자 입력 + **"미채점으로 되돌리기"** 버튼(null로 복원).
- 참여 멤버별 접이식 섹션: 5항목 슬라이더 0–100 — 음정(pitch)·음색(tone)·표현력(expression)·고음(highNotes)·안정성(stability).
  - 5개 중 일부만 입력 시 경고 "5개 모두 입력해야 멤버 점수에 반영됩니다".
  - 슬라이더 초기 상태는 **값 없음**(회색 핸들) — 50 같은 기본값을 넣지 않는다.
- 별도 탭/모달: **멤버 루브릭(10항목)** 편집 — 항목별 만점(발성 15, 라이브 5, 나머지 10) 슬라이더, 소계·총점·등급 미리보기(derive 사용).
- 편집 내용은 즉시 `localStorage` 초안에 저장, 화면 상단에 "저장 안 된 변경 n건" 표시.

### 3.5 검토 큐
- `needsReview`인 영상과 `unknown` 카테고리 목록 + 사유 코드 한글 표시.
- 각 항목에서 카테고리·멤버를 고르면 **overrides 초안**에 추가 → `overrides.json` 내보내기.

### 3.6 기준선 대조
- 멤버 × 카테고리 표: `계산값 / 기준선(PDF)`과 차이(±). 기준선 열은 회색 배경 + "참고" 라벨.
- `knownDiscrepancies` 목록 표시.

### 3.7 내보내기 / 가져오기
- `ratings.json 내보내기`: 저장소 ratings + localStorage 초안 병합 → `schemaVersion`, `disclaimer`, `exportedAt` 포함, 키 정렬, 들여쓰기 2칸.
- `overrides.json 내보내기`: 동일 방식.
- 제공 방식 3가지(iframe에서 다운로드가 막힐 수 있어 전부 제공): ① 파일 다운로드 ② 클립보드 복사 ③ 새 창에 JSON 표시.
- `가져오기`: JSON 파일 선택 → schemaVersion·ID 형식 검증 → 미리보기 diff → 초안에 반영.
- 내보낸 뒤 안내: "GitHub 저장소의 data/ratings.json을 이 파일로 교체해 커밋하세요."

## 4. 로컬 초안 규칙
- 키: `stellive-tracker:draft:v1` → `{ ratings: {...부분...}, overrides: {...부분...}, updatedAt }`
- 화면 표시 = 저장소 데이터 위에 초안을 덮어쓴 결과(같은 derive 함수 사용).
- "초안 폐기" 버튼 제공. localStorage 미지원/차단 시 메모리 모드로 동작 + 경고 배너.

## 5. 디자인
- 한국어 UI, 다크/라이트 자동(`prefers-color-scheme`).
- 멤버 색상은 임의 지정하지 말고 중립 팔레트 + 카테고리 4색만 사용(접근성 대비 4.5:1 이상).
- 차트: 레이더(10항목), 멤버 A/B 비교 가로 막대, 카테고리 누적 막대. 모든 차트 제목 옆에 "개인 평가" 표기, 값 툴팁, 미채점은 차트에서 제외하고 범례에 "미채점 n" 표기.
- 반응형: 구글 사이트 임베드 폭 ~ 800px, 모바일 360px에서 깨지지 않을 것.

## 6. 임베드 제약 체크리스트
- 구글 사이트 iframe 안에서 localStorage·다운로드가 막혀도 앱이 죽지 않을 것(try/catch, 대체 경로 §3.7).
- `target="_blank"` 링크로 "새 창에서 열기" 제공.
- 외부 요청은 `i.ytimg.com`, `youtube-nocookie.com`만.

## 7. 수용 기준 (Opus 검수 항목)
- [ ] 미채점 영상을 추가해도 A·B·순위가 변하지 않는다(샘플 데이터에 ratings 없는 영상 1개 추가해 확인).
- [ ] B 순위는 n ≥ 3 멤버만, 미달 멤버는 "기준 미달 (n/3곡)"과 현재 값이 보인다.
- [ ] 같은 곡명의 다른 videoId 2개가 별도 카드로 보인다.
- [ ] 곡 수·점수 계산 코드가 UI에 없다(derive 호출만).
- [ ] "개인 평가" 문구: 배너, 스코어카드, 차트, 내보낸 JSON의 disclaimer.
- [ ] 슬라이더 기본값이 비어 있고, "미채점으로 되돌리기"가 null을 기록한다.
- [ ] 내보낸 ratings.json이 schema.md §4 형식과 일치(키 정렬, 2칸 들여쓰기).
- [ ] 삭제됨 영상이 목록에 남고 평점이 보존된다.
- [ ] iframe(구글 사이트) 및 360px 모바일에서 동작.

## 8. derive.mjs 인터페이스 (Sonnet 구현, UI는 호출만)

```js
// 모든 함수는 순수 함수. 입력 객체를 변경하지 않는다.
export const MIN_RATED = 3;
export const RUBRIC_ITEMS;          // [{key, label, max, group:'physical'|'interpretive'}] ×10
export const VIDEO_ITEMS;           // [{key, label}] ×5
export const CATEGORIES;            // [{key, label, counted:boolean}]

export function effective(video, override) // → {category, members, excluded, needsReview}
export function songScore(videoId, ratings) // → number|null
export function memberVideoScore(memberKey, videoId, ratings) // → number|null (5개 모두일 때만)
export function grade(total)                 // → 'S+'|'S'|'A+'|'A'|'B+'|'B'|null
export function deriveAll({ channels, videos, overrides, ratings, baseline })
// → {
//   uniqueVideos, totalSlots, deletedCount,
//   memberCards: [{ key, displayName, unit, status,
//     rubricTotal, physical, interpretive, rubricItems, grade, rankA,
//     songAvg, songAvgN, rankB,                 // rankB=null if songAvgN < MIN_RATED
//     slots: {solo_cover, collab_cover, live_special, original, total},
//     unratedCount, deletedCount }],
//   videoRows: [{ videoId, title, publishedAt, status, category, members, excluded, needsReview,
//                 reviewReasons, songScore, memberScores: {key: number|null}, counted }],
//   reviewQueue: [videoId...],
//   baselineDiff: { [memberKey]: { [category]: { derived, baseline, delta } } }
// }
```

## 9. 작업 순서
1. 레이아웃·탭·공통 배너, 샘플 데이터 로드(`derive-stub.mjs`).
2. 스코어카드 15인(A/B/슬롯/미달 표시).
3. 영상 아카이브 + 필터 + 상태 배지.
4. 채점 패널(songScore, 멤버 5항목, 루브릭 10항목) + localStorage 초안.
5. 차트 3종.
6. 검토 큐 + overrides 초안.
7. 기준선 대조.
8. 내보내기/가져오기 3경로.
9. 임베드·모바일 점검 → 결과물을 이 저장소에 두고 Opus 검수 요청.
