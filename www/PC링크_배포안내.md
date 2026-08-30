# PC 링크 모드 — 배포 안내 (2026-08-26)

글작성 결과 화면의 **💻 PC 링크** 버튼이 동작하려면 아래 3가지를 올려야 합니다.
셋 중 하나라도 빠지면 "링크 만들기 실패" 또는 링크 페이지가 "불러오지 못했습니다"로 뜹니다.

---

## 1. Firestore 규칙 — `sns_posts` 블록 추가

`match /databases/{database}/documents {` 안에 그대로 붙여넣으세요.

```
    // PC 링크 모드: 글+사진 공개 페이지 (2026-08-26)
    // read 를 열어두는 이유 = 링크(임의 20자 ID)를 아는 사람만 접근할 수 있고,
    //                        네이버 서버가 사진을 가져가려면 공개여야 하기 때문.
    // 만료된 문서는 functions/cleanupSnsPosts 가 매시간 지웁니다.
    match /sns_posts/{postId} {
      allow read: if true;
      allow create: if request.auth != null
                    && request.resource.data.uid == request.auth.uid
                    && request.resource.data.expiresAt is timestamp;
      allow update, delete: if request.auth != null && resource.data.uid == request.auth.uid;
    }
```

## 2. Storage 규칙 — `snsPosts` 블록 추가

```
    // PC 링크 모드 사진 (2026-08-26)
    // 경로에 uid 가 들어가므로 '남의 링크에 사진 끼워넣기'가 막힙니다.
    match /snsPosts/{uid}/{postId}/{file} {
      allow read: if true;
      allow write: if request.auth != null
                   && request.auth.uid == uid
                   && request.resource.size < 8 * 1024 * 1024
                   && request.resource.contentType.matches('image/.*');
      allow delete: if request.auth != null && request.auth.uid == uid;
    }
```

## 3. 호스팅 + 함수 배포

```
cd C:\aircon-report
firebase deploy --only hosting,functions
```

- `site/post.html` (새 페이지) 와 `functions/cleanupSnsPosts` (매시간 만료 청소) 가 함께 올라갑니다.
- 함수 배포가 10초 타임아웃으로 죽으면: `set FUNCTIONS_DISCOVERY_TIMEOUT=120` 먼저 실행.

---

## 확인 방법

1. 앱에서 사진 있는 작업 → AI 글작성 → **💻 PC 링크**
2. 뜬 주소를 PC 브라우저에서 열기 → 글과 사진이 보이면 성공
3. **글+사진 전체 복사** → 네이버 블로그 글쓰기 본문에 `Ctrl+V`
4. 사진이 하나씩 네이버로 옮겨지면 정상 (base64 가 아니라 실제 URL 이라 가능한 것)
5. Firebase 콘솔 → Functions → `cleanupSnsPosts` 가 매시간 도는지 확인

## 주의

- 링크는 **24시간 뒤 자동 만료**됩니다. 페이지가 먼저 만료를 표시하고, 실제 삭제는 청소 함수가 합니다.
- **청소 함수가 배포되지 않으면 공개 사진이 계속 쌓입니다.** 3번을 건너뛰지 마세요.
- 주소를 아는 사람은 누구나 볼 수 있습니다. 앱 안내 문구에도 적어 두었습니다.
- 호스팅 주소를 바꾸면 `js/sns_share.js` 의 `POST_BASE` 한 줄을 같이 고쳐야 합니다.
