# Phase 3 검증 체크리스트: 시드 25개 + 공식 채널

The rules from Phase 2 still apply. Results go into a **report** only. Values in `data/` change only after the lead reviews them and the user approves.

## A. 시드 영상 25개 실존·업로드 채널 검증
대상은 `data/videos.json`의 27개 중 25개입니다. `eSI7RsjZy1E`과 `ojV55hcIc4w`는 이미 override로 제외했지만 ratings에는 보존합니다.

- [ ] `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=<ID>&format=json` 호출 → 200 / 401·403 / 404를 기록
- [ ] 200이면 `author_name`·`author_url`(채널 핸들)을 기록하고, `channels-lock.json`의 해당 멤버 핸들과 일치하는지 확인
- [ ] 404이면 ID 오타 후보(l/1, 0/O, I/l 혼동)를 PDF 원문과 대조하고 정정 후보를 제안. **직접 수정은 금지**
- [ ] 제목이 PDF 곡명과 일치하는지 확인 (조회수 표기는 무시)
- [ ] 원곡자·클립 채널 업로드 같은 오귀속 의심 건은 override 제안 목록에 넣음
- [ ] 산출물: `reports/phase3-seeds.md`. 표 컬럼은 ID / 결과 / 업로드 채널 / 일치 여부 / 조치 제안

## B. 공식 채널 ID 확정 (`channels-lock.json`, 현재 18개 항목)
구성은 member 15, member-sub 1, group 1, group-sub 1입니다. group-sub는 Topic 채널이고 `collect:none`이라 확정 대상이 아닙니다. **확정 대상은 17개**입니다.

- [ ] 각 핸들(`@...`)의 채널 페이지에서 `UC…`로 시작하는 24자 channelId를 확인
- [ ] 공식 여부는 그룹 공식 채널의 링크나 구독 목록, 인증 배지로 교차 확인
- [ ] 졸업 멤버(아이리 칸나)는 채널 상태(유지·보관)와 `graduatedAt`이 일치하는지 확인
- [ ] D5(1기 유닛명 Mystic/Everys)의 공식 표기 근거를 수집
- [ ] 산출물: `reports/phase3-channels.md`. 표 컬럼은 key / handle / channelId 후보 / 근거 URL / 확신도

## C. 리드 승인 단계 (Claude)
- [ ] 보고서를 검토한 뒤 사용자 승인을 받음
- [ ] `channels-lock.json`에 `channelId`, `verified:true`, `lockedAt`을 반영 (리드가 직접 커밋)
- [ ] 시드 정정이나 override는 별도 커밋으로 처리
- [ ] 전체 테스트를 실행하고, `data/` 해시가 바뀌었으면 새 기준 태그를 생성
- [ ] 수집을 재개하기 전에 `npm run fetch`를 로컬에서 1회 dry-run해 신규 후보 수를 확인

## 주의
- 네트워크 호출은 oEmbed와 공개 채널 페이지만 허용합니다. API 키는 쓰지 않으며 비공개 정보는 요청하지 않습니다.
- 확신도가 낮은 항목은 "보류"로 두고 사용자에게 질문합니다.
